from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from sqlalchemy.orm import Session

from .config import to_jsonable
from .models import AuditEvent, ManifestRequest, PolicyDecision, PolicyOutcome


@dataclass
class DecisionRecord:
    decision_id: str
    manifest_id: str


def hash_payload(payload: object) -> str:
    canonical = json.dumps(to_jsonable(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def create_manifest(db: Session, payload: dict, party_id: str, party_type: str) -> ManifestRequest:
    manifest = ManifestRequest(
        manifest_payload=to_jsonable(payload),
        party_id=party_id,
        party_type=party_type,
    )
    db.add(manifest)
    db.flush()
    return manifest


def create_decision(
    db: Session,
    manifest_id: str,
    outcome: PolicyOutcome,
    reason_code: str,
    trigger_id: str | None,
) -> PolicyDecision:
    decision = PolicyDecision(
        manifest_id=manifest_id,
        outcome=outcome.value,
        reason_code=reason_code,
        trigger_id=trigger_id,
    )
    db.add(decision)
    db.flush()
    return decision


def create_audit_event(
    db: Session,
    *,
    manifest_id: str,
    decision_id: str,
    endpoint: str,
    request_payload: object,
    response_payload: object,
) -> AuditEvent:
    event = AuditEvent(
        manifest_id=manifest_id,
        decision_id=decision_id,
        endpoint=endpoint,
        request_hash=hash_payload(request_payload),
        response_hash=hash_payload(response_payload),
    )
    db.add(event)
    db.flush()
    return event
