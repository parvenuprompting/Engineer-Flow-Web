"""add durable EFL case and diagnosis persistence

Revision ID: 20260312_0003
Revises: 20260312_0002
Create Date: 2026-03-12 01:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260312_0003"
down_revision = "20260312_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "efl_cases",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("garage_party_id", sa.String(length=36), sa.ForeignKey("parties.id"), nullable=False),
        sa.Column("owner_subject", sa.String(length=255), nullable=False),
        sa.Column("vehicle_ref", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("confirmed_failure_mode_id", sa.String(length=255), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_efl_cases_garage_party_id", "efl_cases", ["garage_party_id"])
    op.create_index("ix_efl_cases_owner_subject", "efl_cases", ["owner_subject"])
    op.create_index("ix_efl_cases_vehicle_ref", "efl_cases", ["vehicle_ref"])
    op.create_index("ix_efl_cases_garage_status", "efl_cases", ["garage_party_id", "status"])

    op.create_table(
        "efl_diagnoses",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("diagnosis_id", sa.String(length=255), nullable=False),
        sa.Column("case_id", sa.String(length=36), sa.ForeignKey("efl_cases.id"), nullable=False),
        sa.Column("garage_party_id", sa.String(length=36), sa.ForeignKey("parties.id"), nullable=False),
        sa.Column("owner_subject", sa.String(length=255), nullable=False),
        sa.Column("symptom_text", sa.Text(), nullable=False),
        sa.Column("engine_version", sa.String(length=128), nullable=True),
        sa.Column("response_payload", sa.JSON(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("diagnosis_id", name="uq_efl_diagnoses_diagnosis_id"),
        sa.UniqueConstraint("idempotency_key", name="uq_efl_diagnoses_idempotency_key"),
    )
    op.create_index("ix_efl_diagnoses_case_id", "efl_diagnoses", ["case_id"])
    op.create_index("ix_efl_diagnoses_garage_party_id", "efl_diagnoses", ["garage_party_id"])
    op.create_index("ix_efl_diagnoses_owner_subject", "efl_diagnoses", ["owner_subject"])
    op.create_index("ix_efl_diagnoses_case_created", "efl_diagnoses", ["case_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_efl_diagnoses_case_created", table_name="efl_diagnoses")
    op.drop_index("ix_efl_diagnoses_owner_subject", table_name="efl_diagnoses")
    op.drop_index("ix_efl_diagnoses_garage_party_id", table_name="efl_diagnoses")
    op.drop_index("ix_efl_diagnoses_case_id", table_name="efl_diagnoses")
    op.drop_table("efl_diagnoses")

    op.drop_index("ix_efl_cases_garage_status", table_name="efl_cases")
    op.drop_index("ix_efl_cases_vehicle_ref", table_name="efl_cases")
    op.drop_index("ix_efl_cases_owner_subject", table_name="efl_cases")
    op.drop_index("ix_efl_cases_garage_party_id", table_name="efl_cases")
    op.drop_table("efl_cases")
