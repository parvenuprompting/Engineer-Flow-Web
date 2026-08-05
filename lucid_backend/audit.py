from __future__ import annotations

import hashlib
import json
import re
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


_SENSITIVE_AUDIT_KEYS = re.compile(r"^(?:photo|image|attachment|file)(?:_|$)", re.IGNORECASE)


def redact_audit_payload(payload: object) -> object:
    """Keep audit metadata useful without persisting raw photos or attachments."""
    if isinstance(payload, dict):
        return {
            key: "[REDACTED]"
            if str(key).lower() not in {"photo_attached", "image_attached"} and _SENSITIVE_AUDIT_KEYS.match(str(key))
            else redact_audit_payload(value)
            for key, value in payload.items()
        }
    if isinstance(payload, (list, tuple, set)):
        return [redact_audit_payload(value) for value in payload]
    return payload


def verify_audit_integrity(
    manifest: ManifestRequest,
    decisions: list[PolicyDecision],
    events: list[AuditEvent],
) -> list[str]:
    errors: list[str] = []
    decision_ids = {decision.id for decision in decisions}
    if any(decision.manifest_id != manifest.id for decision in decisions):
        errors.append("decision_manifest_mismatch")
    if any(event.manifest_id != manifest.id for event in events):
        errors.append("event_manifest_mismatch")
    if any(event.decision_id not in decision_ids for event in events):
        errors.append("event_decision_missing")
    for event in events:
        if not re.fullmatch(r"[0-9a-f]{64}", event.request_hash) or not re.fullmatch(r"[0-9a-f]{64}", event.response_hash):
            errors.append(f"invalid_hash:{event.id}")
        if not event.correlation_id:
            errors.append(f"missing_correlation_id:{event.id}")
    return errors


def create_manifest(db: Session, payload: dict, party_id: str, party_type: str) -> ManifestRequest:
    manifest = ManifestRequest(
        manifest_payload=to_jsonable(redact_audit_payload(payload)),
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
        request_hash=hash_payload(redact_audit_payload(request_payload)),
        response_hash=hash_payload(redact_audit_payload(response_payload)),
    )
    db.add(event)
    db.flush()
    return event
