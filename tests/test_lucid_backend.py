from __future__ import annotations

from datetime import datetime, timezone

import jwt
from fastapi.testclient import TestClient

from lucid_backend.config import get_settings
from lucid_backend.database import SessionLocal
from lucid_engineer_flow import app
from lucid_backend.models import GarageMembership, MembershipRole, MembershipStatus, Party, PartyType, User


settings = get_settings()


def _mint_token(
    client: TestClient,
    *,
    party_type: str,
    party_id: str,
    scopes: list[str],
    subject: str = "pytest",
) -> str:
    resp = client.post(
        "/auth/dev-token",
        json={
            "party_type": party_type,
            "party_id": party_id,
            "scopes": scopes,
            "subject": subject,
            "expires_in_minutes": 60,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_auth_token_without_party_type_returns_401() -> None:
    with TestClient(app) as client:
        payload = {
            "sub": "pytest",
            "party_id": "garage-001",
            "scopes": ["diagnosis:read_local"],
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "exp": 9999999999,
        }
        private_key = settings.jwt_private_keys[settings.default_jwt_kid]
        bad_token = jwt.encode(
            payload,
            key=private_key,
            algorithm=settings.jwt_algorithm,
            headers={"kid": settings.default_jwt_kid},
        )

        resp = client.post(
            "/data/opvragen",
            headers=_headers(bad_token),
            json={"voertuig_id": "VTG-001", "purpose": "test"},
        )
        assert resp.status_code == 401


def test_scope_violation_returns_403() -> None:
    with TestClient(app) as client:
        token = _mint_token(
            client,
            party_type="garage",
            party_id="garage-001",
            scopes=["consent:write"],
        )
        resp = client.post(
            "/data/opvragen",
            headers=_headers(token),
            json={"voertuig_id": "VTG-001", "purpose": "test"},
        )
        assert resp.status_code == 403
        assert "Missing required scope: diagnosis:read_local" in resp.json()["detail"]


def test_trigger2_allows_once_then_blocks() -> None:
    with TestClient(app) as client:
        insurer_token = _mint_token(
            client,
            party_type="verzekeraar",
            party_id="verzekeraar-001",
            scopes=["claim:read_history"],
        )

        claim_resp = client.post(
            "/claims",
            headers=_headers(insurer_token),
            json={"voertuig_id": "VTG-001", "access_ttl_minutes": 30},
        )
        assert claim_resp.status_code == 200, claim_resp.text
        claim_id = claim_resp.json()["claim_id"]

        first = client.post(
            "/data/opvragen",
            headers=_headers(insurer_token),
            json={
                "voertuig_id": "VTG-001",
                "purpose": "claim history",
                "claim_id": claim_id,
            },
        )
        assert first.status_code == 200, first.text
        first_json = first.json()
        assert "claim_scoped_vehicle_ref" in first_json["data"]
        assert "voertuig_id" not in first_json["data"]

        second = client.post(
            "/data/opvragen",
            headers=_headers(insurer_token),
            json={
                "voertuig_id": "VTG-001",
                "purpose": "claim history",
                "claim_id": claim_id,
            },
        )
        assert second.status_code == 403
        assert second.json()["detail"]["reason_code"] == "CLAIM_ALREADY_CONSUMED"


def test_trigger3_blocks_commercial_data() -> None:
    with TestClient(app) as client:
        token = _mint_token(
            client,
            party_type="fabrikant",
            party_id="fabrikant-001",
            scopes=["definitions:write", "patterns:read_anon"],
        )

        blocked = client.post(
            "/fabrikant/update",
            headers=_headers(token),
            json={
                "foutcode": "P9999",
                "technische_definitie": "Commercial bundle",
                "source_version": "v1",
                "contains_commercial_data": True,
            },
        )
        assert blocked.status_code == 403
        assert blocked.json()["detail"]["reason_code"] == "COMMERCIAL_DATA_BLOCKED"

        allowed = client.post(
            "/fabrikant/update",
            headers=_headers(token),
            json={
                "foutcode": "P0300",
                "technische_definitie": "Misfire meerdere cilinders",
                "source_version": "v2",
                "contains_commercial_data": False,
            },
        )
        assert allowed.status_code == 200
        assert allowed.json()["data"]["commercieel"] is False


def test_trigger1_batch_anonymizes() -> None:
    with TestClient(app) as client:
        garage_token = _mint_token(
            client,
            party_type="garage",
            party_id="garage-001",
            scopes=["diagnosis:read_local", "consent:write"],
        )

        result = client.post("/jobs/trigger1/run", headers=_headers(garage_token))
        assert result.status_code == 200, result.text
        payload = result.json()
        records = payload["data"]["records"]

        # The seeded database always contains a Trigger 1-eligible vehicle.
        assert payload["data"]["records_sent"] >= 1
        assert records, "Trigger 1 batch bevat geen records; seed-data ontbreekt of is gewijzigd"
        for record in records:
            assert record["anonymized_vehicle_ref"].startswith("veh_")
            assert "VTG-001" not in record["anonymized_vehicle_ref"]
            assert record["dtc_code"]


def test_manifest_audit_returns_real_entries() -> None:
    with TestClient(app) as client:
        garage_token = _mint_token(
            client,
            party_type="garage",
            party_id="garage-001",
            scopes=["diagnosis:read_local", "consent:write"],
        )

        opvraag = client.post(
            "/data/opvragen",
            headers=_headers(garage_token),
            json={"voertuig_id": "VTG-001", "purpose": "local read"},
        )
        assert opvraag.status_code == 200, opvraag.text
        manifest_id = opvraag.json()["manifest_id"]

        audit = client.get(f"/manifest/audit/{manifest_id}", headers=_headers(garage_token))
        assert audit.status_code == 200
        body = audit.json()
        assert body["manifest_id"] == manifest_id
        assert len(body["decisions"]) >= 1
        assert len(body["events"]) >= 1
        integrity = client.get(f"/manifest/audit/{manifest_id}/verify", headers=_headers(garage_token))
        assert integrity.status_code == 200
        assert integrity.json()["integrity_ok"] is True
        exported = client.get(f"/manifest/audit/{manifest_id}/export", headers=_headers(garage_token))
        assert exported.status_code == 200
        assert exported.json()["schema_version"] == "audit-export-v1"
        assert exported.json()["integrity_ok"] is True


def test_efl_case_and_diagnosis_persist_once() -> None:
    with TestClient(app) as client:
        token = _mint_token(
            client,
            party_type="garage",
            party_id="garage-001",
            scopes=["diagnosis:read_local"],
        )
        headers = _headers(token)

        case_resp = client.post(
            "/cases",
            headers=headers,
            json={"vehicle_id": "VTG-001", "idempotency_key": "case-persist-test-key"},
        )
        assert case_resp.status_code == 200, case_resp.text
        case_id = case_resp.json()["case_id"]
        replay = client.post(
            "/cases",
            headers=headers,
            json={"vehicle_id": "VTG-001", "idempotency_key": "case-persist-test-key"},
        )
        assert replay.status_code == 200
        assert replay.json()["case_id"] == case_id
        assert replay.json()["idempotent_replay"] is True

        diagnosis_payload = {
            "diagnosis_id": "diag-persist-test",
            "case_id": case_id,
            "symptom_text": "De trommel draait langzaam onder belasting.",
            "response": {"diagnosis_status": "ranked", "audit_trail": {"engine_version": "test"}},
            "idempotency_key": "persist-test-key",
        }
        first = client.post("/diagnoses", headers=headers, json=diagnosis_payload)
        assert first.status_code == 200, first.text
        assert first.json()["status"] == "persisted"

        second = client.post("/diagnoses", headers=headers, json=diagnosis_payload)
        assert second.status_code == 200, second.text
        assert second.json()["status"] == "duplicate"

        listed = client.get("/diagnoses", headers=headers)
        assert listed.status_code == 200, listed.text
        assert any(item["diagnosis_id"] == "diag-persist-test" for item in listed.json()["diagnoses"])
        filtered = client.get("/diagnoses?q=diag-persist-test&limit=1", headers=headers)
        assert filtered.status_code == 200, filtered.text
        assert filtered.json()["pagination"]["total"] == 1
        assert filtered.json()["diagnoses"][0]["case_status"] == "open"
        pdf = client.get("/diagnoses/diag-persist-test/export?format=pdf", headers=headers)
        assert pdf.status_code == 200, pdf.text
        assert pdf.content.startswith(b"%PDF-")

        updated = client.patch(
            "/diagnoses/diag-persist-test",
            headers=headers,
            json={"title": "Hydrauliek onder belasting", "status": "under_investigation"},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["metadata"]["title"] == "Hydrauliek onder belasting"

        detail = client.get("/diagnoses/diag-persist-test", headers=headers)
        assert detail.status_code == 200, detail.text
        assert detail.json()["metadata"]["title"] == "Hydrauliek onder belasting"

        confirmed = client.post(
            f"/cases/{case_id}/confirm",
            headers=headers,
            json={"failure_mode_id": "FM-HYDRAULIC-PUMP"},
        )
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["status"] == "confirmed"


def test_membership_scope_blocks_cross_garage_diagnosis_reads() -> None:
    with SessionLocal() as db:
        second_garage = Party(id="garage-002", party_type=PartyType.GARAGE.value, name="Second Garage")
        second_user = User(firebase_uid="second-garage-user", email="second@example.test")
        db.add_all([second_garage, second_user])
        db.flush()
        db.add(
            GarageMembership(
                garage_party_id=second_garage.id,
                user_id=second_user.id,
                role=MembershipRole.OWNER.value,
                status=MembershipStatus.ACTIVE.value,
                invited_at=datetime.now(timezone.utc),
            )
        )
        db.commit()

    with TestClient(app) as client:
        garage_one_token = _mint_token(
            client,
            party_type="garage",
            party_id="ignored-party-id",
            scopes=["diagnosis:read_local"],
        )
        case = client.post("/cases", headers=_headers(garage_one_token), json={"vehicle_id": "VTG-001"})
        assert case.status_code == 200, case.text
        case_id = case.json()["case_id"]
        assert client.get(f"/cases/{case_id}", headers=_headers(garage_one_token)).status_code == 200
        diagnosis = client.post(
            "/diagnoses",
            headers=_headers(garage_one_token),
            json={
                "diagnosis_id": "cross-garage-read-test",
                "case_id": case_id,
                "symptom_text": "Hydrauliek draait langzaam",
                "response": {},
            },
        )
        assert diagnosis.status_code == 200, diagnosis.text

        second_token = _mint_token(
            client,
            party_type="garage",
            party_id="garage-001",
            scopes=["diagnosis:read_local"],
            subject="second-garage-user",
        )
        assert client.get(f"/cases/{case_id}", headers=_headers(second_token)).status_code == 404
        response = client.get("/diagnoses/cross-garage-read-test", headers=_headers(second_token))
        assert response.status_code == 404
        assert response.json()["detail"] == "Diagnose niet gevonden"

        work_order = client.post(
            "/werkbonnen",
            headers=_headers(garage_one_token),
            json={"case_id": case_id, "voertuig_id": "VTG-001", "root_cause": "Test ownership"},
        )
        assert work_order.status_code == 200, work_order.text
        work_order_id = work_order.json()["data"]["werkbon_id"]
        cross_garage_mutation = client.post(
            f"/werkbonnen/{work_order_id}/regels",
            headers=_headers(second_token),
            json={"omschrijving": "Unauthorized", "uren": 1, "uurtarief": 100},
        )
        assert cross_garage_mutation.status_code == 403
        assert cross_garage_mutation.json()["detail"]["reason_code"] == "GARAGE_NOT_OWNER"


def test_viewer_membership_cannot_mutate_cases() -> None:
    with TestClient(app) as client:
        owner_token = _mint_token(
            client,
            party_type="garage",
            party_id="anything",
            scopes=["diagnosis:read_local"],
        )
        invited = client.post(
            "/garages/garage-001/memberships",
            headers=_headers(owner_token),
            json={"firebase_uid": "viewer-user", "role": "viewer"},
        )
        assert invited.status_code == 200, invited.text
        membership_id = invited.json()["membership_id"]
        activated = client.patch(
            f"/garages/garage-001/memberships/{membership_id}",
            headers=_headers(owner_token),
            json={"status": "active"},
        )
        assert activated.status_code == 200, activated.text

        viewer_token = _mint_token(
            client,
            party_type="garage",
            party_id="garage-001",
            scopes=["diagnosis:read_local"],
            subject="viewer-user",
        )
        response = client.post("/cases", headers=_headers(viewer_token), json={"vehicle_id": "VTG-001"})
        assert response.status_code == 403

        revoked = client.patch(
            f"/garages/garage-001/memberships/{membership_id}",
            headers=_headers(owner_token),
            json={"status": "revoked"},
        )
        assert revoked.status_code == 200
        memberships = client.get("/garages/garage-001/memberships", headers=_headers(viewer_token))
        assert memberships.status_code == 403


def test_viewer_cannot_finalize_invoice() -> None:
    with TestClient(app) as client:
        owner_token = _mint_token(
            client,
            party_type="garage",
            party_id="untrusted-party-id",
            scopes=["diagnosis:read_local"],
        )
        viewer_invite = client.post(
            "/garages/garage-001/memberships",
            headers=_headers(owner_token),
            json={"firebase_uid": "invoice-viewer", "role": "viewer"},
        )
        assert viewer_invite.status_code == 200, viewer_invite.text
        membership_id = viewer_invite.json()["membership_id"]
        assert client.patch(
            f"/garages/garage-001/memberships/{membership_id}",
            headers=_headers(owner_token),
            json={"status": "active"},
        ).status_code == 200

        work_order = client.post(
            "/werkbonnen",
            headers=_headers(owner_token),
            json={
                "case_id": client.post("/cases", headers=_headers(owner_token), json={"vehicle_id": "VTG-001"}).json()["case_id"],
                "voertuig_id": "VTG-001",
                "root_cause": "Invoice authorization test",
            },
        )
        assert work_order.status_code == 200, work_order.text
        work_order_id = work_order.json()["data"]["werkbon_id"]
        assert client.post(
            f"/werkbonnen/{work_order_id}/regels",
            headers=_headers(owner_token),
            json={"omschrijving": "Arbeid", "uren": 1, "uurtarief": 100},
        ).status_code == 200
        assert client.post(
            f"/werkbonnen/{work_order_id}/afronden",
            headers=_headers(owner_token),
        ).status_code == 200
        invoice = client.post(
            "/facturen",
            headers=_headers(owner_token),
            json={"werkbon_id": work_order_id, "idempotency_key": "invoice-idempotency-test"},
        )
        assert invoice.status_code == 200, invoice.text
        invoice_id = invoice.json()["data"]["factuur_id"]
        invoice_replay = client.post(
            "/facturen",
            headers=_headers(owner_token),
            json={"werkbon_id": work_order_id, "idempotency_key": "invoice-idempotency-test"},
        )
        assert invoice_replay.status_code == 200
        assert invoice_replay.json()["data"]["factuur_id"] == invoice_id
        assert invoice_replay.json()["data"]["idempotent_replay"] is True

        viewer_token = _mint_token(
            client,
            party_type="garage",
            party_id="another-untrusted-party-id",
            scopes=["diagnosis:read_local"],
            subject="invoice-viewer",
        )
        response = client.post(
            f"/facturen/{invoice_id}/finaliseren",
            headers=_headers(viewer_token),
        )
        assert response.status_code == 403
        assert "Deze rol mag geen garagegegevens wijzigen" in response.json()["detail"]


def test_diagnosis_delete_records_audit_event() -> None:
    with TestClient(app) as client:
        token = _mint_token(
            client,
            party_type="garage",
            party_id="ignored",
            scopes=["diagnosis:read_local"],
        )
        headers = _headers(token)
        case = client.post("/cases", headers=headers, json={"vehicle_id": "VTG-001"})
        assert case.status_code == 200, case.text
        diagnosis = client.post(
            "/diagnoses",
            headers=headers,
            json={
                "diagnosis_id": "delete-audit-test",
                "case_id": case.json()["case_id"],
                "symptom_text": "Test verwijdering",
                "response": {},
            },
        )
        assert diagnosis.status_code == 200, diagnosis.text
        deleted = client.delete("/diagnoses/delete-audit-test", headers=headers)
        assert deleted.status_code == 200, deleted.text
        audit = client.get(f"/manifest/audit/{deleted.json()['audit_manifest_id']}", headers=headers)
        assert audit.status_code == 200, audit.text
        assert any(event["endpoint"] == "/diagnoses/{diagnosis_id}" for event in audit.json()["events"])


def test_token_party_id_claim_does_not_override_subject_membership() -> None:
    """Garage-authorisatie hangt af van het subject (firebase_uid), niet van party_id.

    Een token kan liegen over zijn party_id claim; de daadwerkelijke garage-binding
    wordt bepaald door de actieve membership van het subject. Dit test de trust-grens
    die de rest van de autorisatie dragend maakt.
    """
    with SessionLocal() as db:
        second_garage = Party(id="garage-002", party_type=PartyType.GARAGE.value, name="Tweede Garage")
        second_user = User(firebase_uid="other-owner", email="other@example.test")
        db.add_all([second_garage, second_user])
        db.flush()
        db.add(
            GarageMembership(
                garage_party_id=second_garage.id,
                user_id=second_user.id,
                role=MembershipRole.OWNER.value,
                status=MembershipStatus.ACTIVE.value,
                invited_at=datetime.now(timezone.utc),
                activated_at=datetime.now(timezone.utc),
            )
        )
        db.commit()

    with TestClient(app) as client:
        # Subject "pytest" is owner van garage-001, maar de token claimt party_id garage-002.
        misleading_token = _mint_token(
            client,
            party_type="garage",
            party_id="garage-002",
            scopes=["diagnosis:read_local"],
        )
        case = client.post("/cases", headers=_headers(misleading_token), json={"vehicle_id": "VTG-001"})
        assert case.status_code == 200, case.text
        case_id = case.json()["case_id"]

        # De case is voor garage-001 aangemaakt (subject-binding); eigenaar garage-001 kan hem lezen.
        assert client.get(f"/cases/{case_id}", headers=_headers(misleading_token)).status_code == 200

        # Subject "other-owner" is owner van garage-002, maar claimt party_id garage-001.
        # Als party_id leidend was, zou dit een datalek zijn.
        other_token = _mint_token(
            client,
            party_type="garage",
            party_id="garage-001",
            scopes=["diagnosis:read_local"],
            subject="other-owner",
        )
        leaked = client.get(f"/cases/{case_id}", headers=_headers(other_token))
        assert leaked.status_code == 404
        assert leaked.json()["detail"] == "Case niet gevonden"

        # Een geldig ondertekende token zonder actieve membership krijgt geen toegang.
        stranger_token = _mint_token(
            client,
            party_type="garage",
            party_id="garage-001",
            scopes=["diagnosis:read_local"],
            subject="no-membership-stranger",
        )
        blocked = client.post("/cases", headers=_headers(stranger_token), json={"vehicle_id": "VTG-001"})
        assert blocked.status_code == 403
        assert "Geen actieve garage membership" in blocked.json()["detail"]


def test_security_headers_and_correlation_id_are_present() -> None:
    with TestClient(app) as client:
        response = client.get("/", headers={"X-Correlation-ID": "ci-correlation-id"})

    assert response.status_code == 200
    assert response.headers["x-correlation-id"] == "ci-correlation-id"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_oversized_request_is_rejected_before_route_execution() -> None:
    with TestClient(app) as client:
        response = client.post("/", content=b"x" * (2 * 1024 * 1024 + 1))

    assert response.status_code == 413


def test_untrusted_host_is_rejected() -> None:
    with TestClient(app) as client:
        response = client.get("/", headers={"Host": "attacker.example"})

    assert response.status_code == 400
