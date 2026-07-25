from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import (
    Claim,
    ClaimAccessGrant,
    ClaimStatus,
    OwnerConsent,
    PartyType,
    Vehicle,
)
from .security import AuthContext


class PolicyDenied(Exception):
    def __init__(self, reason_code: str, detail: str, trigger_id: str | None = None, status_code: int = 403):
        self.reason_code = reason_code
        self.detail = detail
        self.trigger_id = trigger_id
        self.status_code = status_code
        super().__init__(detail)


@dataclass
class PolicyDecisionData:
    allowed: bool
    reason_code: str
    trigger_id: str | None


settings = get_settings()


TRIGGER_1 = "T1_GARAGE_TO_FABRIKANT"
TRIGGER_2 = "T2_GARAGE_TO_VERZEKERAAR"
TRIGGER_3 = "T3_FABRIKANT_TO_GARAGE"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_aware_utc(dt: datetime) -> datetime:
    # SQLite frequently returns naive datetimes even for timezone=True columns.
    # Treat naive values as UTC to avoid runtime comparison errors.
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def anonymize_vehicle_ref(external_vehicle_ref: str, salt_version: int) -> str:
    key = f"{settings.hmac_secret}:v{salt_version}".encode("utf-8")
    digest = hmac.new(key, external_vehicle_ref.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"veh_{salt_version}_{digest[:24]}"


def claim_scoped_vehicle_ref(claim_id: str, vehicle_id: str, salt_version: int) -> str:
    key = f"{settings.hmac_secret}:claim:v{salt_version}".encode("utf-8")
    material = f"{claim_id}:{vehicle_id}".encode("utf-8")
    digest = hmac.new(key, material, hashlib.sha256).hexdigest()
    return f"claimref_{digest[:24]}"


def latest_consent(db: Session, vehicle_id: str, consent_type: str) -> OwnerConsent | None:
    stmt = (
        select(OwnerConsent)
        .where(OwnerConsent.vehicle_id == vehicle_id, OwnerConsent.consent_type == consent_type)
        .order_by(OwnerConsent.granted_at.desc())
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()


def has_active_consent(db: Session, vehicle_id: str, consent_type: str) -> bool:
    record = latest_consent(db, vehicle_id=vehicle_id, consent_type=consent_type)
    if not record:
        return False
    if record.granted is not True:
        return False
    if record.revoked_at is not None:
        return False
    return True


def evaluate_data_request(auth: AuthContext) -> PolicyDecisionData:
    if auth.party_type == PartyType.GARAGE.value:
        return PolicyDecisionData(allowed=True, reason_code="ALLOW_GARAGE_LOCAL", trigger_id=None)

    if auth.party_type == PartyType.FABRIKANT.value:
        return PolicyDecisionData(
            allowed=False,
            reason_code="TRIGGER1_BATCH_ONLY",
            trigger_id=TRIGGER_1,
        )

    if auth.party_type == PartyType.VERZEKERAAR.value:
        return PolicyDecisionData(
            allowed=True,
            reason_code="PENDING_TRIGGER2_CHECKS",
            trigger_id=TRIGGER_2,
        )

    return PolicyDecisionData(allowed=False, reason_code="UNKNOWN_PARTY_TYPE", trigger_id=None)


def enforce_trigger2_and_consume_grant(
    db: Session,
    *,
    auth: AuthContext,
    manifest_claim_id: str | None,
    vehicle: Vehicle,
) -> tuple[Claim, ClaimAccessGrant]:
    if auth.party_type != PartyType.VERZEKERAAR.value:
        raise PolicyDenied(
            reason_code="NOT_VERZEKERAAR",
            detail="Trigger 2 is alleen van toepassing voor verzekeraars.",
            trigger_id=TRIGGER_2,
        )

    if not manifest_claim_id:
        raise PolicyDenied(
            reason_code="CLAIM_ID_REQUIRED",
            detail="Manifest vereist claim_id voor verzekeraarstoegang.",
            trigger_id=TRIGGER_2,
        )

    claim = db.get(Claim, manifest_claim_id)
    if not claim:
        raise PolicyDenied(
            reason_code="CLAIM_NOT_FOUND",
            detail="Claim niet gevonden.",
            trigger_id=TRIGGER_2,
        )

    if claim.insurer_party_id != auth.party_id:
        raise PolicyDenied(
            reason_code="CLAIM_NOT_OWNED",
            detail="Claim behoort niet tot deze verzekeraar.",
            trigger_id=TRIGGER_2,
        )

    if claim.vehicle_id != vehicle.id:
        raise PolicyDenied(
            reason_code="CLAIM_VEHICLE_MISMATCH",
            detail="Claim is niet gekoppeld aan dit voertuig.",
            trigger_id=TRIGGER_2,
        )

    grant_stmt = (
        select(ClaimAccessGrant)
        .where(ClaimAccessGrant.claim_id == claim.id)
        .order_by(ClaimAccessGrant.granted_at.desc())
        .limit(1)
    )
    grant = db.execute(grant_stmt).scalar_one_or_none()
    if not grant:
        raise PolicyDenied(
            reason_code="CLAIM_ACCESS_GRANT_MISSING",
            detail="Geen claim access grant gevonden.",
            trigger_id=TRIGGER_2,
        )

    # Must be checked first so repeated reads always resolve to CLAIM_ALREADY_CONSUMED
    # even when the claim is already closed.
    if grant.consumed_at is not None:
        raise PolicyDenied(
            reason_code="CLAIM_ALREADY_CONSUMED",
            detail="Claimhistorie is al eenmalig opgevraagd voor deze claim.",
            trigger_id=TRIGGER_2,
        )

    if claim.status != ClaimStatus.OPEN.value:
        raise PolicyDenied(
            reason_code="CLAIM_NOT_ACTIVE",
            detail="Claim is niet actief.",
            trigger_id=TRIGGER_2,
        )

    if not has_active_consent(db, vehicle_id=vehicle.id, consent_type="claim_history_share"):
        raise PolicyDenied(
            reason_code="CONSENT_REQUIRED_CLAIM_HISTORY",
            detail="Eigenaar heeft geen actieve toestemming voor claimhistorie gedeeld.",
            trigger_id=TRIGGER_2,
        )

    now = _utcnow()
    expires_at = _to_aware_utc(grant.expires_at)
    if expires_at < now:
        raise PolicyDenied(
            reason_code="CLAIM_ACCESS_EXPIRED",
            detail="Claim access grant is verlopen.",
            trigger_id=TRIGGER_2,
        )

    grant.consumed_at = now
    db.add(grant)

    return claim, grant


def enforce_trigger3_payload(contains_commercial_data: bool) -> None:
    if contains_commercial_data:
        raise PolicyDenied(
            reason_code="COMMERCIAL_DATA_BLOCKED",
            detail="Trigger 3 blokkeert commerciële data in fabrikant-updates.",
            trigger_id=TRIGGER_3,
        )
