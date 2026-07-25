#!/usr/bin/env python3
"""End-to-end check for native werkbon + facturatie flow."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

BASE_URL = os.getenv("LUCID_TEST_BASE_URL", "http://127.0.0.1:8000")


def _parse_body(body: str) -> dict[str, Any] | str:
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


def _pretty(label: str, status: int, body: dict[str, Any] | str) -> None:
    print(f"\n=== {label} ===")
    print(f"HTTP {status}")
    if isinstance(body, dict):
        print(json.dumps(body, indent=2, ensure_ascii=False))
    else:
        print(body)


def _request(method: str, url: str, payload: dict[str, Any] | None = None, token: str | None = None) -> tuple[int, dict[str, Any] | str]:
    data: bytes | None = None
    headers: dict[str, str] = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, _parse_body(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, _parse_body(exc.read().decode("utf-8"))


def _extract_data(body: dict[str, Any] | str) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise RuntimeError("Response body is geen JSON object")
    data = body.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("Response bevat geen data object")
    return data


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def _get_dev_token() -> str:
    status, body = _request(
        "POST",
        f"{BASE_URL}/auth/dev-token",
        payload={
            "party_type": "garage",
            "party_id": "garage-001",
            "scopes": ["diagnosis:read_local", "consent:write"],
            "subject": "test-werkbon-factuur",
            "expires_in_minutes": 60,
        },
    )
    _pretty("Dev token ophalen (garage)", status, body)
    if status != 200 or not isinstance(body, dict) or "token" not in body:
        raise RuntimeError("Kan geen dev token ophalen. Controleer LUCID_ENABLE_DEV_AUTH=true.")
    return str(body["token"])


def main() -> int:
    try:
        token = _get_dev_token()

        # 1) Werkbon aanmaken
        status, body = _request(
            "POST",
            f"{BASE_URL}/werkbonnen",
            payload={"voertuig_id": "VTG-001", "root_cause": "Ontsteking storingen veroorzaken misfire"},
            token=token,
        )
        _pretty("Werkbon aanmaken", status, body)
        _assert(status == 200, "Werkbon aanmaken mislukt")
        werkbon_id = _extract_data(body)["werkbon_id"]

        # 2) Regels toevoegen
        status, body = _request(
            "POST",
            f"{BASE_URL}/werkbonnen/{werkbon_id}/regels",
            payload={
                "omschrijving": "Diagnose en vervanging bougies",
                "uren": 2.5,
                "uurtarief": 95.0,
                "onderdeel_code": "SPARK-SET-01",
                "onderdeel_prijs": 120.0,
            },
            token=token,
        )
        _pretty("Werkbon regel toevoegen #1", status, body)
        _assert(status == 200, "Werkbon regel #1 toevoegen mislukt")

        status, body = _request(
            "POST",
            f"{BASE_URL}/werkbonnen/{werkbon_id}/regels",
            payload={
                "omschrijving": "Proefrit en eindcontrole",
                "uren": 0.5,
                "uurtarief": 95.0,
                "onderdeel_code": None,
                "onderdeel_prijs": 0.0,
            },
            token=token,
        )
        _pretty("Werkbon regel toevoegen #2", status, body)
        _assert(status == 200, "Werkbon regel #2 toevoegen mislukt")

        # 3) Werkbon afronden
        status, body = _request("POST", f"{BASE_URL}/werkbonnen/{werkbon_id}/afronden", payload={}, token=token)
        _pretty("Werkbon afronden", status, body)
        _assert(status == 200, "Werkbon afronden mislukt")

        # 4) Factuur concept aanmaken
        status, body = _request("POST", f"{BASE_URL}/facturen", payload={"werkbon_id": werkbon_id}, token=token)
        _pretty("Factuur concept aanmaken", status, body)
        _assert(status == 200, "Factuur concept aanmaken mislukt")
        factuur_data = _extract_data(body)
        factuur_id = factuur_data["factuur_id"]

        current_year = datetime.now(timezone.utc).year
        _assert(
            bool(re.match(rf"^{current_year}-\d{{4}}$", str(factuur_data["factuurnummer"]))),
            "Factuurnummer is niet sequentieel geformatteerd als YYYY-0001",
        )

        # 5) Factuur finaliseren
        status, body = _request("POST", f"{BASE_URL}/facturen/{factuur_id}/finaliseren", payload={}, token=token)
        _pretty("Factuur finaliseren", status, body)
        _assert(status == 200, "Factuur finaliseren mislukt")
        finalized = _extract_data(body)
        posts = finalized.get("grootboek_posten", [])
        _assert(isinstance(posts, list) and len(posts) == 3, "Verwacht 3 grootboekposten na finaliseren")

        debet = round(sum(float(p["bedrag"]) for p in posts if p.get("type") == "debet"), 2)
        credit = round(sum(float(p["bedrag"]) for p in posts if p.get("type") == "credit"), 2)
        _assert(debet == credit, f"Double-entry niet in balans: debet={debet} credit={credit}")

        # 6) Factuur ophalen en inhoud valideren
        status, body = _request("GET", f"{BASE_URL}/facturen/{factuur_id}", token=token)
        _pretty("Factuur ophalen", status, body)
        _assert(status == 200, "Factuur ophalen mislukt")
        fetched = _extract_data(body)
        fetched_posts = fetched.get("grootboek_posten", [])
        _assert(len(fetched_posts) == 3, "Opgehaalde factuur mist grootboekposten")
        _assert(fetched.get("status") == "gefinaliseerd", "Factuurstatus is niet gefinaliseerd")

        print("\nKlaar. Werkbon + facturatie flow succesvol gevalideerd.")
        return 0

    except urllib.error.URLError as exc:
        print(f"\nFOUT: API onbereikbaar op {BASE_URL}: {exc}")
        return 1
    except RuntimeError as exc:
        print(f"\nFOUT: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
