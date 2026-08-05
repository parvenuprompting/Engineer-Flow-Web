"""add feedback events and vehicle superstructure

Revision ID: 20260805_0009
Revises: 20260805_0008
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260805_0009"
down_revision = "20260805_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vehicles", sa.Column("superstructure_id", sa.String(length=128), nullable=True))
    op.create_index("ix_vehicles_superstructure_id", "vehicles", ["superstructure_id"])
    op.create_table(
        "feedback_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("case_id", sa.String(length=255), nullable=True),
        sa.Column("failure_mode_id", sa.String(length=255), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("garage_party_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_feedback_events_case_id", "feedback_events", ["case_id"])
    op.create_index("ix_feedback_events_failure_mode_id", "feedback_events", ["failure_mode_id"])
    op.create_index("ix_feedback_events_garage_party_id", "feedback_events", ["garage_party_id"])
    op.create_index("ix_feedback_events_processed", "feedback_events", ["processed"])


def downgrade() -> None:
    op.drop_index("ix_feedback_events_processed", table_name="feedback_events")
    op.drop_index("ix_feedback_events_garage_party_id", table_name="feedback_events")
    op.drop_index("ix_feedback_events_failure_mode_id", table_name="feedback_events")
    op.drop_index("ix_feedback_events_case_id", table_name="feedback_events")
    op.drop_table("feedback_events")
    op.drop_index("ix_vehicles_superstructure_id", table_name="vehicles")
    op.drop_column("vehicles", "superstructure_id")
