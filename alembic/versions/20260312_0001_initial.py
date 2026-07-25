"""initial lucid v0.2 schema

Revision ID: 20260312_0001
Revises:
Create Date: 2026-03-12 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260312_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "parties",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("party_type", sa.String(length=24), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_parties_party_type", "parties", ["party_type"])

    op.create_table(
        "vehicles",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("garage_party_id", sa.String(length=36), sa.ForeignKey("parties.id"), nullable=False),
        sa.Column("external_vehicle_ref", sa.String(length=255), nullable=False),
        sa.Column("hash_salt_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("garage_party_id", "external_vehicle_ref", name="uq_vehicle_ref_per_garage"),
    )
    op.create_index("ix_vehicles_garage_party_id", "vehicles", ["garage_party_id"])
    op.create_index("ix_vehicles_external_vehicle_ref", "vehicles", ["external_vehicle_ref"])

    op.create_table(
        "diagnosis_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("vehicle_id", sa.String(length=36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("dtc_code", sa.String(length=64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=128), nullable=False),
        sa.Column("repair_action", sa.Text(), nullable=True),
    )
    op.create_index("ix_diagnosis_events_vehicle_id", "diagnosis_events", ["vehicle_id"])
    op.create_index("ix_diagnosis_events_dtc_code", "diagnosis_events", ["dtc_code"])
    op.create_index(
        "ix_diagnosis_vehicle_dtc_time",
        "diagnosis_events",
        ["vehicle_id", "dtc_code", "occurred_at"],
    )

    op.create_table(
        "owner_consents",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("vehicle_id", sa.String(length=36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("consent_type", sa.String(length=128), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_owner_consents_vehicle_id", "owner_consents", ["vehicle_id"])
    op.create_index("ix_owner_consents_consent_type", "owner_consents", ["consent_type"])
    op.create_index(
        "ix_owner_consents_lookup",
        "owner_consents",
        ["vehicle_id", "consent_type", "granted_at"],
    )

    op.create_table(
        "claims",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("insurer_party_id", sa.String(length=36), sa.ForeignKey("parties.id"), nullable=False),
        sa.Column("vehicle_id", sa.String(length=36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_claims_insurer_party_id", "claims", ["insurer_party_id"])
    op.create_index("ix_claims_vehicle_id", "claims", ["vehicle_id"])
    op.create_index("ix_claim_vehicle_status", "claims", ["vehicle_id", "status"])

    op.create_table(
        "claim_access_grants",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("claim_id", sa.String(length=36), sa.ForeignKey("claims.id"), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_claim_access_grants_claim_id", "claim_access_grants", ["claim_id"])
    op.create_index("ix_claim_access_grants_claim", "claim_access_grants", ["claim_id", "consumed_at"])

    op.create_table(
        "manufacturer_definitions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("dtc_code", sa.String(length=64), nullable=False),
        sa.Column("technische_definitie", sa.Text(), nullable=False),
        sa.Column("source_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_manufacturer_definitions_dtc_code", "manufacturer_definitions", ["dtc_code"])

    op.create_table(
        "garage_seen_codes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("garage_party_id", sa.String(length=36), sa.ForeignKey("parties.id"), nullable=False),
        sa.Column("dtc_code", sa.String(length=64), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("seen_count", sa.Integer(), nullable=False),
        sa.UniqueConstraint("garage_party_id", "dtc_code", name="uq_garage_dtc"),
    )
    op.create_index("ix_garage_seen_codes_garage_party_id", "garage_seen_codes", ["garage_party_id"])
    op.create_index("ix_garage_seen_codes_dtc_code", "garage_seen_codes", ["dtc_code"])

    op.create_table(
        "manifest_requests",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("manifest_payload", sa.JSON(), nullable=False),
        sa.Column("party_id", sa.String(length=36), nullable=False),
        sa.Column("party_type", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_manifest_requests_party_id", "manifest_requests", ["party_id"])
    op.create_index("ix_manifest_requests_party_type", "manifest_requests", ["party_type"])

    op.create_table(
        "policy_decisions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("manifest_id", sa.String(length=36), sa.ForeignKey("manifest_requests.id"), nullable=False),
        sa.Column("outcome", sa.String(length=24), nullable=False),
        sa.Column("reason_code", sa.String(length=128), nullable=False),
        sa.Column("trigger_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_policy_decisions_manifest_id", "policy_decisions", ["manifest_id"])

    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("manifest_id", sa.String(length=36), sa.ForeignKey("manifest_requests.id"), nullable=False),
        sa.Column("decision_id", sa.String(length=36), sa.ForeignKey("policy_decisions.id"), nullable=False),
        sa.Column("endpoint", sa.String(length=255), nullable=False),
        sa.Column("request_hash", sa.String(length=128), nullable=False),
        sa.Column("response_hash", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_audit_events_manifest_id", "audit_events", ["manifest_id"])
    op.create_index("ix_audit_events_decision_id", "audit_events", ["decision_id"])

    op.create_table(
        "batch_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("trigger_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("records_sent", sa.Integer(), nullable=False),
    )

    op.create_table(
        "manufacturer_batch_records",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("batch_job_id", sa.String(length=36), sa.ForeignKey("batch_jobs.id"), nullable=False),
        sa.Column("vehicle_id", sa.String(length=36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("anonymized_vehicle_ref", sa.String(length=128), nullable=False),
        sa.Column("dtc_code", sa.String(length=64), nullable=False),
        sa.Column("count_in_window", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_manufacturer_batch_records_batch_job_id", "manufacturer_batch_records", ["batch_job_id"])
    op.create_index("ix_manufacturer_batch_records_vehicle_id", "manufacturer_batch_records", ["vehicle_id"])


def downgrade() -> None:
    op.drop_index("ix_manufacturer_batch_records_vehicle_id", table_name="manufacturer_batch_records")
    op.drop_index("ix_manufacturer_batch_records_batch_job_id", table_name="manufacturer_batch_records")
    op.drop_table("manufacturer_batch_records")

    op.drop_table("batch_jobs")

    op.drop_index("ix_audit_events_decision_id", table_name="audit_events")
    op.drop_index("ix_audit_events_manifest_id", table_name="audit_events")
    op.drop_table("audit_events")

    op.drop_index("ix_policy_decisions_manifest_id", table_name="policy_decisions")
    op.drop_table("policy_decisions")

    op.drop_index("ix_manifest_requests_party_type", table_name="manifest_requests")
    op.drop_index("ix_manifest_requests_party_id", table_name="manifest_requests")
    op.drop_table("manifest_requests")

    op.drop_index("ix_garage_seen_codes_dtc_code", table_name="garage_seen_codes")
    op.drop_index("ix_garage_seen_codes_garage_party_id", table_name="garage_seen_codes")
    op.drop_table("garage_seen_codes")

    op.drop_index("ix_manufacturer_definitions_dtc_code", table_name="manufacturer_definitions")
    op.drop_table("manufacturer_definitions")

    op.drop_index("ix_claim_access_grants_claim", table_name="claim_access_grants")
    op.drop_index("ix_claim_access_grants_claim_id", table_name="claim_access_grants")
    op.drop_table("claim_access_grants")

    op.drop_index("ix_claim_vehicle_status", table_name="claims")
    op.drop_index("ix_claims_vehicle_id", table_name="claims")
    op.drop_index("ix_claims_insurer_party_id", table_name="claims")
    op.drop_table("claims")

    op.drop_index("ix_owner_consents_lookup", table_name="owner_consents")
    op.drop_index("ix_owner_consents_consent_type", table_name="owner_consents")
    op.drop_index("ix_owner_consents_vehicle_id", table_name="owner_consents")
    op.drop_table("owner_consents")

    op.drop_index("ix_diagnosis_vehicle_dtc_time", table_name="diagnosis_events")
    op.drop_index("ix_diagnosis_events_dtc_code", table_name="diagnosis_events")
    op.drop_index("ix_diagnosis_events_vehicle_id", table_name="diagnosis_events")
    op.drop_table("diagnosis_events")

    op.drop_index("ix_vehicles_external_vehicle_ref", table_name="vehicles")
    op.drop_index("ix_vehicles_garage_party_id", table_name="vehicles")
    op.drop_table("vehicles")

    op.drop_index("ix_parties_party_type", table_name="parties")
    op.drop_table("parties")
