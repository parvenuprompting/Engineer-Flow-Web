from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ManifestRequestIn(BaseModel):
    purpose: str = "Diagnostische voertuigdata uitwisselen met conditionele toegang"
    voertuig_id: str
    trigger: str | None = None
    claim_id: str | None = None
    metadata: dict | None = None

    # Backward-compat shim: ignored by server, party is always derived from JWT.
    aanvrager: str | None = Field(default=None, deprecated=True)


class ClaimCreateIn(BaseModel):
    voertuig_id: str
    access_ttl_minutes: int = Field(default=30, ge=1, le=1440)


class ConsentUpsertIn(BaseModel):
    voertuig_id: str
    consent_type: Literal["claim_history_share", "manufacturer_sharing_opt_out"]
    granted: bool


class ManufacturerUpdateIn(BaseModel):
    foutcode: str
    technische_definitie: str
    source_version: str
    contains_commercial_data: bool = False


class DiagnosisEventIn(BaseModel):
    voertuig_id: str
    dtc_code: str
    occurred_at: datetime | None = None
    source: str = "garage"
    repair_action: str | None = None


class EflCaseCreateIn(BaseModel):
    vehicle_id: str = Field(min_length=1, max_length=255)


class EflDiagnosisPersistIn(BaseModel):
    diagnosis_id: str = Field(min_length=1, max_length=255)
    case_id: str = Field(min_length=1, max_length=36)
    symptom_text: str = Field(min_length=3, max_length=2000)
    response: dict
    idempotency_key: str | None = Field(default=None, max_length=255)


class EflCaseConfirmIn(BaseModel):
    failure_mode_id: str = Field(min_length=1, max_length=255)


class EflDiagnosisMetadataIn(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    vehicle_id: str | None = Field(default=None, max_length=255)
    summary: dict | None = None
    flow_steps: list[str] | None = None
    status: str | None = Field(default=None, max_length=64)
    confirmed_fix_id: str | None = Field(default=None, max_length=255)
    service_flow: dict | None = None


class WerkbonCreateIn(BaseModel):
    voertuig_id: str
    root_cause: str = Field(min_length=3)


class WerkbonRegelIn(BaseModel):
    omschrijving: str = Field(min_length=2)
    uren: float = Field(ge=0)
    uurtarief: float = Field(ge=0)
    onderdeel_code: str | None = None
    onderdeel_prijs: float = Field(default=0, ge=0)


class FactuurCreateIn(BaseModel):
    werkbon_id: str


class BatchRunOut(BaseModel):
    batch_job_id: str
    trigger_id: str
    records_sent: int
    batch_interval_minutes: int
    records: list[dict]


class PolicyEnvelope(BaseModel):
    manifest_id: str
    decision_id: str
    policy_version: str
    data: dict


class AuditOut(BaseModel):
    manifest_id: str
    manifest_payload: dict
    party_id: str
    party_type: str
    created_at: datetime
    decisions: list[dict]
    events: list[dict]


class DevTokenIn(BaseModel):
    party_type: Literal["garage", "fabrikant", "verzekeraar"]
    party_id: str
    scopes: list[str]
    subject: str = "dev-user"
    expires_in_minutes: int = Field(default=60, ge=1, le=1440)


class DevTokenOut(BaseModel):
    token: str
    token_type: str = "bearer"
    expires_in_minutes: int


class EflAuditEventIn(BaseModel):
    event_id: str
    event_type: Literal["diagnosis_started", "diagnosis_completed", "diagnosis_failed"]
    created_at: datetime
    execution_signature: str
    payload_hash: str
    previous_event_hash: str | None = None
    case_id: str | None = None
    diagnosis_id: str | None = None
    payload: dict


class EflAuditSyncIn(BaseModel):
    events: list[EflAuditEventIn]


class FeedbackEventIn(BaseModel):
    case_id: str | None = None
    failure_mode_id: str
    success: bool = True


class FeedbackEventOut(BaseModel):
    id: str
    case_id: str | None
    failure_mode_id: str
    success: bool
    created_at: datetime
    processed: bool
