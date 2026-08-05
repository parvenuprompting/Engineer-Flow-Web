"""link work orders to durable EFL cases

Revision ID: 20260805_0007
Revises: 20260805_0006
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260805_0007"
down_revision = "20260805_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("werkbonnen", sa.Column("case_id", sa.String(length=36), sa.ForeignKey("efl_cases.id"), nullable=True))
    op.create_index("ix_werkbonnen_case_id", "werkbonnen", ["case_id"])


def downgrade() -> None:
    op.drop_index("ix_werkbonnen_case_id", table_name="werkbonnen")
    op.drop_column("werkbonnen", "case_id")
