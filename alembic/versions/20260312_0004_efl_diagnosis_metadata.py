"""add metadata to durable EFL diagnoses

Revision ID: 20260312_0004
Revises: 20260312_0003
Create Date: 2026-03-12 01:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260312_0004"
down_revision = "20260312_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "efl_diagnoses",
        sa.Column("case_metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column("efl_diagnoses", "case_metadata")
