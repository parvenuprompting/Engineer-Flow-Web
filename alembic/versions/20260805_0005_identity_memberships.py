"""add users and garage memberships

Revision ID: 20260805_0005
Revises: 20260312_0004
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260805_0005"
down_revision = "20260312_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("firebase_uid", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("firebase_uid", name="uq_users_firebase_uid"),
    )
    op.create_index("ix_users_firebase_uid", "users", ["firebase_uid"])
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "garage_memberships",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("garage_party_id", sa.String(length=36), sa.ForeignKey("parties.id"), nullable=False),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("garage_party_id", "user_id", name="uq_garage_membership_user"),
    )
    op.create_index("ix_garage_memberships_garage_party_id", "garage_memberships", ["garage_party_id"])
    op.create_index("ix_garage_memberships_user_id", "garage_memberships", ["user_id"])
    op.create_index("ix_garage_memberships_user_status", "garage_memberships", ["user_id", "status"])
    op.create_index("ix_garage_memberships_garage_status", "garage_memberships", ["garage_party_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_garage_memberships_garage_status", table_name="garage_memberships")
    op.drop_index("ix_garage_memberships_user_status", table_name="garage_memberships")
    op.drop_index("ix_garage_memberships_user_id", table_name="garage_memberships")
    op.drop_index("ix_garage_memberships_garage_party_id", table_name="garage_memberships")
    op.drop_table("garage_memberships")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_index("ix_users_firebase_uid", table_name="users")
    op.drop_table("users")
