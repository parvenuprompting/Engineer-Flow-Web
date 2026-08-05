"""add correlation identifiers to audit events

Revision ID: 20260805_0008
Revises: 20260805_0007
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
import uuid


revision = "20260805_0008"
down_revision = "20260805_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("audit_events", sa.Column("correlation_id", sa.String(length=36), nullable=True))
    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id FROM audit_events WHERE correlation_id IS NULL")).fetchall()
    for row in rows:
        connection.execute(
            sa.text("UPDATE audit_events SET correlation_id = :value WHERE id = :id"),
            {"value": str(uuid.uuid4()), "id": row[0]},
        )
    op.alter_column("audit_events", "correlation_id", nullable=False)
    op.create_index("ix_audit_events_correlation_id", "audit_events", ["correlation_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_events_correlation_id", table_name="audit_events")
    op.drop_column("audit_events", "correlation_id")
