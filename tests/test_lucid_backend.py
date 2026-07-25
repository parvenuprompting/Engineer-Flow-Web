from __future__ import annotations

import os
from pathlib import Path

import jwt
from fastapi.testclient import TestClient

# Force SQLite for tests before importing app modules.
TEST_DB = Path(".tmp_lucid_test.db")
if TEST_DB.exists():
    TEST_DB.unlink()

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["LUCID_ENABLE_DEV_AUTH"] = "true"

from lucid_backend.config import get_settings
from lucid_engineer_flow import app


settings = get_settings()


def _mint_token(client: TestClient, *, party_type: str, party_id: str, scopes: list[str]) -> str:
    resp = client.post(
        "/auth/dev-token",
        json={
            "party_type": party_type,
            "party_id": party_id,
            "scopes": scopes,
            "subject": "pytest",
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

        if records:
            first = records[0]
            assert first["anonymized_vehicle_ref"].startswith("veh_")
            assert "VTG-001" not in first["anonymized_vehicle_ref"]


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


if TEST_DB.exists():
    TEST_DB.unlink()
