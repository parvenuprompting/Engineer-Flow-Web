#!/usr/bin/env python3
"""Extended integration check for LUCID backend.

This script:
1. Requests dev tokens for garage, fabrikant, verzekeraar
2. Calls POST /data/opvragen for each role with voertuig_id=VTG-001
3. Runs Trigger 1 batch via POST /jobs/trigger1/run
4. Runs full insurer claim flow:
   - open claim
   - request data with claim_id
   - close claim
   - request data again (should be blocked)
5. Prints clearly labeled responses + HTTP statuses

Run:
    python test_lucid.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

BASE_URL = os.getenv("LUCID_TEST_BASE_URL", "http://127.0.0.1:8000")


def post_json(url: str, payload: dict[str, Any], token: str | None = None) -> tuple[int, dict[str, Any] | str]:
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, _parse_body(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        return exc.code, _parse_body(body)


def _parse_body(body: str) -> dict[str, Any] | str:
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


def _extract_detail(body: dict[str, Any] | str) -> str:
    if isinstance(body, dict):
        detail = body.get("detail")
        if isinstance(detail, dict):
            return json.dumps(detail, ensure_ascii=False)
        if detail is not None:
            return str(detail)
        return json.dumps(body, ensure_ascii=False)
    return body


def pretty(label: str, status: int, body: dict[str, Any] | str) -> None:
    print(f"\n=== {label} ===")
    print(f"HTTP {status}")
    if isinstance(body, dict):
        print(json.dumps(body, indent=2, ensure_ascii=False))
    else:
        print(body)


def get_dev_token(role: str, party_id: str, scopes: list[str]) -> str:
    status, body = post_json(
        f"{BASE_URL}/auth/dev-token",
        {
            "party_type": role,
            "party_id": party_id,
            "scopes": scopes,
            "subject": "test-lucid",
            "expires_in_minutes": 60,
        },
    )
    pretty(f"Dev token ophalen ({role})", status, body)

    if status != 200 or not isinstance(body, dict) or "token" not in body:
        raise RuntimeError(
            f"Kon geen dev token ophalen voor '{role}'. "
            "Controleer of de API draait en LUCID_ENABLE_DEV_AUTH=true staat."
        )
    return str(body["token"])


def run_base_data_requests(garage_token: str, fabrikant_token: str, verzekeraar_token: str) -> None:
    requests = [
        ("Garage -> /data/opvragen", garage_token, {"purpose": "test-garage", "voertuig_id": "VTG-001"}),
        ("Fabrikant -> /data/opvragen", fabrikant_token, {"purpose": "test-fabrikant", "voertuig_id": "VTG-001"}),
        ("Verzekeraar -> /data/opvragen", verzekeraar_token, {"purpose": "test-verzekeraar", "voertuig_id": "VTG-001"}),
    ]

    for label, token, payload in requests:
        status, body = post_json(f"{BASE_URL}/data/opvragen", payload, token=token)
        pretty(label, status, body)


def run_trigger1_batch(garage_token: str) -> None:
    status, body = post_json(f"{BASE_URL}/jobs/trigger1/run", payload={}, token=garage_token)
    pretty("Trigger 1 batch run -> /jobs/trigger1/run", status, body)

    if status != 200 or not isinstance(body, dict):
        print("Trigger 1 batch kon niet worden uitgevoerd.")
        return

    data = body.get("data", {})
    records = data.get("records", []) if isinstance(data, dict) else []

    print("\n--- Trigger 1 Samenvatting ---")
    print(f"Meegenomen records: {len(records)}")
    if records:
        for idx, rec in enumerate(records, start=1):
            if isinstance(rec, dict):
                anon_ref = rec.get("anonymized_vehicle_ref", "?")
                dtc = rec.get("dtc_code", "?")
                cnt = rec.get("count_in_window", "?")
                print(f"  {idx}. voertuig_ref={anon_ref} | code={dtc} | count={cnt}")

    # The API currently returns included records only; blocked list is not explicit.
    print("Geblokkeerd (opt-out): niet expliciet geretourneerd door endpoint.")
    print("Verwachte fixture-blokkade: voertuig met actieve opt-out (bijv. VTG-002) wordt niet meegenomen.")


def run_full_insurer_flow(verzekeraar_token: str) -> None:
    print("\n=== Volledige verzekeraar flow ===")

    # 1) Open claim
    open_status, open_body = post_json(
        f"{BASE_URL}/claims",
        {"voertuig_id": "VTG-001", "access_ttl_minutes": 30},
        token=verzekeraar_token,
    )
    pretty("Stap 1: Open claim -> /claims", open_status, open_body)

    if open_status != 200 or not isinstance(open_body, dict) or "claim_id" not in open_body:
        print("Kan verzekeraar flow niet vervolgen zonder claim_id.")
        return

    claim_id = str(open_body["claim_id"])

    # 2) Request data with claim_id (should be allowed)
    req1_status, req1_body = post_json(
        f"{BASE_URL}/data/opvragen",
        {"purpose": "verzekeraar-claim-read-1", "voertuig_id": "VTG-001", "claim_id": claim_id},
        token=verzekeraar_token,
    )
    pretty("Stap 2: Claim-gebonden data opvragen #1 -> /data/opvragen", req1_status, req1_body)

    # 3) Close claim
    close_status, close_body = post_json(
        f"{BASE_URL}/claims/{claim_id}/close",
        {},
        token=verzekeraar_token,
    )
    pretty("Stap 3: Sluit claim -> /claims/{claim_id}/close", close_status, close_body)

    # 4) Request data again with same claim_id (should be blocked)
    req2_status, req2_body = post_json(
        f"{BASE_URL}/data/opvragen",
        {"purpose": "verzekeraar-claim-read-2", "voertuig_id": "VTG-001", "claim_id": claim_id},
        token=verzekeraar_token,
    )
    pretty("Stap 4: Claim-gebonden data opvragen #2 (verwacht geblokkeerd)", req2_status, req2_body)

    reason_text = _extract_detail(req2_body)
    print("\n--- Policy check stap 4 ---")
    if req2_status >= 400:
        print("Resultaat: GEBLOKKEERD (OK)")
        print(f"Detail: {reason_text}")
        if "CLAIM_ALREADY_CONSUMED" in reason_text:
            print("Reason code bevestigd: CLAIM_ALREADY_CONSUMED")
        else:
            print("Reason code CLAIM_ALREADY_CONSUMED niet letterlijk in response; controleer backend reason mapping.")
    else:
        print("Resultaat: NIET geblokkeerd (ONVERWACHT)")


def main() -> int:
    try:
        garage_token = get_dev_token(
            role="garage",
            party_id="garage-001",
            scopes=["diagnosis:read_local", "consent:write"],
        )
        fabrikant_token = get_dev_token(
            role="fabrikant",
            party_id="fabrikant-001",
            scopes=["patterns:read_anon", "definitions:write"],
        )
        verzekeraar_token = get_dev_token(
            role="verzekeraar",
            party_id="verzekeraar-001",
            scopes=["claim:read_history"],
        )

        run_base_data_requests(garage_token, fabrikant_token, verzekeraar_token)
        run_trigger1_batch(garage_token)
        run_full_insurer_flow(verzekeraar_token)

    except urllib.error.URLError as exc:
        print(f"\nFOUT: Kan de API niet bereiken op {BASE_URL}: {exc}")
        return 1
    except RuntimeError as exc:
        print(f"\nFOUT: {exc}")
        return 1

    print("\nKlaar. Script succesvol uitgevoerd.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
