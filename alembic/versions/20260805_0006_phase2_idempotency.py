"""add idempotency keys for durable core mutations

Revision ID: 20260805_0006
Revises: 20260805_0005
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260805_0006"
down_revision = "20260805_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS factuur_number_seq START WITH 1 INCREMENT BY 1")
    op.execute(
        """
        SELECT setval(
            'factuur_number_seq',
            COALESCE(MAX(CAST(split_part(factuurnummer, '-', 2) AS BIGINT)), 1),
            COUNT(*) > 0
        )
        FROM facturen
        """
    )
    op.add_column("efl_cases", sa.Column("idempotency_key", sa.String(length=255), nullable=True))
    op.create_unique_constraint("uq_efl_case_idempotency", "efl_cases", ["garage_party_id", "idempotency_key"])
    op.add_column("werkbonnen", sa.Column("idempotency_key", sa.String(length=255), nullable=True))
    op.create_unique_constraint("uq_werkbonnen_idempotency_key", "werkbonnen", ["idempotency_key"])
    op.add_column("facturen", sa.Column("idempotency_key", sa.String(length=255), nullable=True))
    op.create_unique_constraint("uq_facturen_idempotency_key", "facturen", ["idempotency_key"])


def downgrade() -> None:
    op.drop_constraint("uq_facturen_idempotency_key", "facturen", type_="unique")
    op.drop_column("facturen", "idempotency_key")
    op.drop_constraint("uq_werkbonnen_idempotency_key", "werkbonnen", type_="unique")
    op.drop_column("werkbonnen", "idempotency_key")
    op.drop_constraint("uq_efl_case_idempotency", "efl_cases", type_="unique")
    op.drop_column("efl_cases", "idempotency_key")
    op.execute("DROP SEQUENCE IF EXISTS factuur_number_seq")
