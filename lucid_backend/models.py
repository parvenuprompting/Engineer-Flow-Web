from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PartyType(str, Enum):
    GARAGE = "garage"
    FABRIKANT = "fabrikant"
    VERZEKERAAR = "verzekeraar"


class MembershipRole(str, Enum):
    OWNER = "owner"
    MANAGER = "manager"
    TECHNICIAN = "technician"
    VIEWER = "viewer"


class MembershipStatus(str, Enum):
    INVITED = "invited"
    ACTIVE = "active"
    REVOKED = "revoked"


class ClaimStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"


class PolicyOutcome(str, Enum):
    ALLOW = "allow"
    DENY = "deny"


class BatchStatus(str, Enum):
    RUNNING = "running"
    FINISHED = "finished"
    FAILED = "failed"


class WerkbonStatus(str, Enum):
    OPEN = "open"
    AFGEROND = "afgerond"


class FactuurStatus(str, Enum):
    CONCEPT = "concept"
    GEFINALISEERD = "gefinaliseerd"


class Party(Base):
    __tablename__ = "parties"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    party_type: Mapped[str] = mapped_column(String(24), index=True)
    name: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    firebase_uid: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class GarageMembership(Base):
    __tablename__ = "garage_memberships"
    __table_args__ = (
        UniqueConstraint("garage_party_id", "user_id", name="uq_garage_membership_user"),
        Index("ix_garage_memberships_user_status", "user_id", "status"),
        Index("ix_garage_memberships_garage_status", "garage_party_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    garage_party_id: Mapped[str] = mapped_column(ForeignKey("parties.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(24), default=MembershipRole.TECHNICIAN.value, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default=MembershipStatus.INVITED.value, nullable=False)
    invited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    garage = relationship("Party")
    user = relationship("User")


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        UniqueConstraint("garage_party_id", "external_vehicle_ref", name="uq_vehicle_ref_per_garage"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    garage_party_id: Mapped[str] = mapped_column(ForeignKey("parties.id"), index=True)
    external_vehicle_ref: Mapped[str] = mapped_column(String(255), index=True)
    hash_salt_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    superstructure_id: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    garage = relationship("Party")


class DiagnosisEvent(Base):
    __tablename__ = "diagnosis_events"
    __table_args__ = (
        Index("ix_diagnosis_vehicle_dtc_time", "vehicle_id", "dtc_code", "occurred_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    vehicle_id: Mapped[str] = mapped_column(ForeignKey("vehicles.id"), index=True)
    dtc_code: Mapped[str] = mapped_column(String(64), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    source: Mapped[str] = mapped_column(String(128), default="garage", nullable=False)
    repair_action: Mapped[str | None] = mapped_column(Text, nullable=True)

    vehicle = relationship("Vehicle")


class EflCase(Base):
    __tablename__ = "efl_cases"
    __table_args__ = (
        Index("ix_efl_cases_garage_status", "garage_party_id", "status"),
        UniqueConstraint("garage_party_id", "idempotency_key", name="uq_efl_case_idempotency"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    garage_party_id: Mapped[str] = mapped_column(ForeignKey("parties.id"), index=True)
    owner_subject: Mapped[str] = mapped_column(String(255), index=True)
    vehicle_ref: Mapped[str] = mapped_column(String(255), index=True)
    status: Mapped[str] = mapped_column(String(24), default="open", nullable=False)
    confirmed_failure_mode_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), nullable=True)

    garage = relationship("Party")


class EflDiagnosis(Base):
    __tablename__ = "efl_diagnoses"
    __table_args__ = (
        UniqueConstraint("diagnosis_id", name="uq_efl_diagnoses_diagnosis_id"),
        Index("ix_efl_diagnoses_case_created", "case_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    diagnosis_id: Mapped[str] = mapped_column(String(255), nullable=False)
    case_id: Mapped[str] = mapped_column(ForeignKey("efl_cases.id"), index=True)
    garage_party_id: Mapped[str] = mapped_column(ForeignKey("parties.id"), index=True)
    owner_subject: Mapped[str] = mapped_column(String(255), index=True)
    symptom_text: Mapped[str] = mapped_column(Text, nullable=False)
    engine_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    response_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    case_metadata: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    case = relationship("EflCase")
    garage = relationship("Party")


class FeedbackEvent(Base):
    __tablename__ = "feedback_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    case_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    failure_mode_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    garage_party_id: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    processed: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)


class OwnerConsent(Base):
    __tablename__ = "owner_consents"
    __table_args__ = (
        Index("ix_owner_consents_lookup", "vehicle_id", "consent_type", "granted_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    vehicle_id: Mapped[str] = mapped_column(ForeignKey("vehicles.id"), index=True)
    consent_type: Mapped[str] = mapped_column(String(128), index=True)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Claim(Base):
    __tablename__ = "claims"
    __table_args__ = (
        Index("ix_claim_vehicle_status", "vehicle_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    insurer_party_id: Mapped[str] = mapped_column(ForeignKey("parties.id"), index=True)
    vehicle_id: Mapped[str] = mapped_column(ForeignKey("vehicles.id"), index=True)
    status: Mapped[str] = mapped_column(String(24), default=ClaimStatus.OPEN.value, nullable=False)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ClaimAccessGrant(Base):
    __tablename__ = "claim_access_grants"
    __table_args__ = (
        Index("ix_claim_access_grants_claim", "claim_id", "consumed_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    claim_id: Mapped[str] = mapped_column(ForeignKey("claims.id"), index=True)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ManufacturerDefinition(Base):
    __tablename__ = "manufacturer_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    dtc_code: Mapped[str] = mapped_column(String(64), index=True)
    technische_definitie: Mapped[str] = mapped_column(Text)
    source_version: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class GarageSeenCode(Base):
    __tablename__ = "garage_seen_codes"
    __table_args__ = (
        UniqueConstraint("garage_party_id", "dtc_code", name="uq_garage_dtc"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    garage_party_id: Mapped[str] = mapped_column(ForeignKey("parties.id"), index=True)
    dtc_code: Mapped[str] = mapped_column(String(64), index=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    seen_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class ManifestRequest(Base):
    __tablename__ = "manifest_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    manifest_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    party_id: Mapped[str] = mapped_column(String(36), index=True)
    party_type: Mapped[str] = mapped_column(String(24), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class PolicyDecision(Base):
    __tablename__ = "policy_decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    manifest_id: Mapped[str] = mapped_column(ForeignKey("manifest_requests.id"), index=True)
    outcome: Mapped[str] = mapped_column(String(24), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(128), nullable=False)
    trigger_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    manifest_id: Mapped[str] = mapped_column(ForeignKey("manifest_requests.id"), index=True)
    decision_id: Mapped[str] = mapped_column(ForeignKey("policy_decisions.id"), index=True)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    response_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class BatchJob(Base):
    __tablename__ = "batch_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    trigger_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    records_sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ManufacturerBatchRecord(Base):
    __tablename__ = "manufacturer_batch_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    batch_job_id: Mapped[str] = mapped_column(ForeignKey("batch_jobs.id"), index=True)
    vehicle_id: Mapped[str] = mapped_column(ForeignKey("vehicles.id"), index=True)
    anonymized_vehicle_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    dtc_code: Mapped[str] = mapped_column(String(64), nullable=False)
    count_in_window: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Werkbon(Base):
    __tablename__ = "werkbonnen"
    __table_args__ = (
        Index("ix_werkbonnen_voertuig_status", "voertuig_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    case_id: Mapped[str | None] = mapped_column(ForeignKey("efl_cases.id"), index=True, nullable=True)
    voertuig_id: Mapped[str] = mapped_column(ForeignKey("vehicles.id"), index=True)
    garage_party_id: Mapped[str] = mapped_column(ForeignKey("parties.id"), index=True)
    root_cause: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default=WerkbonStatus.OPEN.value, nullable=False)
    aangemaakt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    afgerond_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WerkbonRegel(Base):
    __tablename__ = "werkbon_regels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    werkbon_id: Mapped[str] = mapped_column(ForeignKey("werkbonnen.id"), index=True)
    omschrijving: Mapped[str] = mapped_column(Text, nullable=False)
    uren: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    uurtarief: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    onderdeel_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    onderdeel_prijs: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)


class Factuur(Base):
    __tablename__ = "facturen"
    __table_args__ = (
        UniqueConstraint("werkbon_id", name="uq_facturen_werkbon"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    werkbon_id: Mapped[str] = mapped_column(ForeignKey("werkbonnen.id"), index=True)
    garage_party_id: Mapped[str] = mapped_column(ForeignKey("parties.id"), index=True)
    status: Mapped[str] = mapped_column(String(24), default=FactuurStatus.CONCEPT.value, nullable=False)
    factuurnummer: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    subtotaal: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    btw: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    totaal: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    aangemaakt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    gefinaliseerd_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)


class GrootboekPost(Base):
    __tablename__ = "grootboek_posten"
    __table_args__ = (
        Index("ix_grootboek_posten_factuur_type", "factuur_id", "type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    factuur_id: Mapped[str] = mapped_column(ForeignKey("facturen.id"), index=True)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    rekening: Mapped[str] = mapped_column(String(64), nullable=False)
    bedrag: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    geboekt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
