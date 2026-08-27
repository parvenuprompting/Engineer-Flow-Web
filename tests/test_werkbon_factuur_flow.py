"""End-to-end werkbon + facturatie flow as real pytest behavior tests.

Ported from the former smoke script tests/test_werkbon_factuur.py, which pytest
never collected (it only defined a main() entrypoint and required a live API).
These assertions run in CI against the SQLite TestClient.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from lucid_engineer_flow import app


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


def _posten_signature(posten: list[dict]) -> list[tuple[str, str, float]]:
    return sorted((p["type"], p["rekening"], round(float(p["bedrag"]), 2)) for p in posten)


def test_werkbon_factuur_flow_and_double_entry_balance() -> None:
    with TestClient(app) as client:
        token = _mint_token(
            client,
            party_type="garage",
            party_id="garage-001",
            scopes=["diagnosis:read_local", "consent:write"],
        )
        headers = _headers(token)

        case = client.post("/cases", headers=headers, json={"vehicle_id": "VTG-001"})
        assert case.status_code == 200, case.text
        case_id = case.json()["case_id"]

        werkbon = client.post(
            "/werkbonnen",
            headers=headers,
            json={
                "case_id": case_id,
                "voertuig_id": "VTG-001",
                "root_cause": "Ontsteking storingen veroorzaken misfire",
            },
        )
        assert werkbon.status_code == 200, werkbon.text
        werkbon_id = werkbon.json()["data"]["werkbon_id"]

        regel1 = client.post(
            f"/werkbonnen/{werkbon_id}/regels",
            headers=headers,
            json={
                "omschrijving": "Diagnose en vervanging bougies",
                "uren": 2.5,
                "uurtarief": 95.0,
                "onderdeel_code": "SPARK-SET-01",
                "onderdeel_prijs": 120.0,
            },
        )
        assert regel1.status_code == 200, regel1.text

        regel2 = client.post(
            f"/werkbonnen/{werkbon_id}/regels",
            headers=headers,
            json={"omschrijving": "Proefrit en eindcontrole", "uren": 0.5, "uurtarief": 95.0},
        )
        assert regel2.status_code == 200, regel2.text

        afgerond = client.post(f"/werkbonnen/{werkbon_id}/afronden", headers=headers, json={})
        assert afgerond.status_code == 200, afgerond.text
        assert afgerond.json()["data"]["status"] == "afgerond"

        factuur = client.post("/facturen", headers=headers, json={"werkbon_id": werkbon_id})
        assert factuur.status_code == 200, factuur.text
        factuur_data = factuur.json()["data"]
        factuur_id = factuur_data["factuur_id"]
        assert factuur_data["status"] == "concept"

        current_year = datetime.now(timezone.utc).year
        assert re.match(
            rf"^{current_year}-\d{{4}}$", str(factuur_data["factuurnummer"])
        ), factuur_data["factuurnummer"]

        gefinaliseerd = client.post(f"/facturen/{factuur_id}/finaliseren", headers=headers, json={})
        assert gefinaliseerd.status_code == 200, gefinaliseerd.text
        finalized = gefinaliseerd.json()["data"]
        assert finalized["status"] == "gefinaliseerd"

        posten = finalized["grootboek_posten"]
        assert len(posten) == 3, posten
        debet = round(sum(float(p["bedrag"]) for p in posten if p["type"] == "debet"), 2)
        credit = round(sum(float(p["bedrag"]) for p in posten if p["type"] == "credit"), 2)
        assert debet == credit, f"Double-entry niet in balans: debet={debet} credit={credit}"

        # De drie grootboekposten moeten exact overeenkomen met de factuurbedragen.
        expected = [
            ("debet", "debiteuren", round(float(finalized["totaal"]), 2)),
            ("credit", "omzet", round(float(finalized["subtotaal"]), 2)),
            ("credit", "btw_te_betalen", round(float(finalized["btw"]), 2)),
        ]
        assert _posten_signature(posten) == sorted(expected)

        # Finaliseren is idempotent en mag de grootboekposten niet wijzigen.
        replay = client.post(f"/facturen/{factuur_id}/finaliseren", headers=headers, json={})
        assert replay.status_code == 200, replay.text
        assert replay.json()["data"]["idempotent_replay"] is True
        assert _posten_signature(replay.json()["data"]["grootboek_posten"]) == _posten_signature(posten)

        fetched = client.get(f"/facturen/{factuur_id}", headers=headers)
        assert fetched.status_code == 200, fetched.text
        fetched_data = fetched.json()["data"]
        assert fetched_data["status"] == "gefinaliseerd"
        assert _posten_signature(fetched_data["grootboek_posten"]) == _posten_signature(posten)
        assert len(fetched_data["regels"]) == 2
