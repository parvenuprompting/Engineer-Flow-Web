"""add werkbon and facturatie tables

Revision ID: 20260312_0002
Revises: 20260312_0001
Create Date: 2026-03-12 00:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260312_0002"
down_revision = "20260312_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "werkbonnen",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("voertuig_id", sa.String(length=36), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("garage_party_id", sa.String(length=36), sa.ForeignKey("parties.id"), nullable=False),
        sa.Column("root_cause", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("aangemaakt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("afgerond_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_werkbonnen_voertuig_id", "werkbonnen", ["voertuig_id"])
    op.create_index("ix_werkbonnen_garage_party_id", "werkbonnen", ["garage_party_id"])
    op.create_index("ix_werkbonnen_voertuig_status", "werkbonnen", ["voertuig_id", "status"])

    op.create_table(
        "werkbon_regels",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("werkbon_id", sa.String(length=36), sa.ForeignKey("werkbonnen.id"), nullable=False),
        sa.Column("omschrijving", sa.Text(), nullable=False),
        sa.Column("uren", sa.Numeric(10, 2), nullable=False),
        sa.Column("uurtarief", sa.Numeric(10, 2), nullable=False),
        sa.Column("onderdeel_code", sa.String(length=128), nullable=True),
        sa.Column("onderdeel_prijs", sa.Numeric(12, 2), nullable=False),
    )
    op.create_index("ix_werkbon_regels_werkbon_id", "werkbon_regels", ["werkbon_id"])

    op.create_table(
        "facturen",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("werkbon_id", sa.String(length=36), sa.ForeignKey("werkbonnen.id"), nullable=False),
        sa.Column("garage_party_id", sa.String(length=36), sa.ForeignKey("parties.id"), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("factuurnummer", sa.String(length=32), nullable=False),
        sa.Column("subtotaal", sa.Numeric(12, 2), nullable=False),
        sa.Column("btw", sa.Numeric(12, 2), nullable=False),
        sa.Column("totaal", sa.Numeric(12, 2), nullable=False),
        sa.Column("aangemaakt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("gefinaliseerd_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("werkbon_id", name="uq_facturen_werkbon"),
        sa.UniqueConstraint("factuurnummer", name="uq_facturen_factuurnummer"),
    )
    op.create_index("ix_facturen_werkbon_id", "facturen", ["werkbon_id"])
    op.create_index("ix_facturen_garage_party_id", "facturen", ["garage_party_id"])
    op.create_index("ix_facturen_factuurnummer", "facturen", ["factuurnummer"])

    op.create_table(
        "grootboek_posten",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("factuur_id", sa.String(length=36), sa.ForeignKey("facturen.id"), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("rekening", sa.String(length=64), nullable=False),
        sa.Column("bedrag", sa.Numeric(12, 2), nullable=False),
        sa.Column("geboekt_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_grootboek_posten_factuur_id", "grootboek_posten", ["factuur_id"])
    op.create_index("ix_grootboek_posten_factuur_type", "grootboek_posten", ["factuur_id", "type"])


def downgrade() -> None:
    op.drop_index("ix_grootboek_posten_factuur_type", table_name="grootboek_posten")
    op.drop_index("ix_grootboek_posten_factuur_id", table_name="grootboek_posten")
    op.drop_table("grootboek_posten")

    op.drop_index("ix_facturen_factuurnummer", table_name="facturen")
    op.drop_index("ix_facturen_garage_party_id", table_name="facturen")
    op.drop_index("ix_facturen_werkbon_id", table_name="facturen")
    op.drop_table("facturen")

    op.drop_index("ix_werkbon_regels_werkbon_id", table_name="werkbon_regels")
    op.drop_table("werkbon_regels")

    op.drop_index("ix_werkbonnen_voertuig_status", table_name="werkbonnen")
    op.drop_index("ix_werkbonnen_garage_party_id", table_name="werkbonnen")
    op.drop_index("ix_werkbonnen_voertuig_id", table_name="werkbonnen")
    op.drop_table("werkbonnen")
