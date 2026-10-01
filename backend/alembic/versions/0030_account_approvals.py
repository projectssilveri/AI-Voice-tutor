"""A platform admin's new organisation admin waits for the super admin.

Revision ID: 0030_account_approvals
Revises: 0029_all_access_plans
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0030_account_approvals"
down_revision = "0029_all_access_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The role model of 2026-10-01 gave platform admins the super admin's work,
    # except making somebody an organisation's administrator: that waits for a
    # super admin. One row per request, kept after the decision as the record
    # of who asked and who agreed. See app/models/approval.py.
    #
    # Nothing to backfill: every administrator that exists today was made under
    # the old rule, by somebody allowed to make them.
    op.create_table(
        "account_approvals",
        sa.Column(
            "id",
            sa.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("requested_role", sa.String(length=32), nullable=False),
        sa.Column(
            "requested_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "decided_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
    )
    op.create_check_constraint(
        "ck_account_approvals_status",
        "account_approvals",
        "status IN ('pending', 'approved', 'declined')",
    )
    op.create_check_constraint(
        "ck_account_approvals_kind",
        "account_approvals",
        "kind IN ('new_account', 'promotion')",
    )
    # One open request per person, so the queue never asks the same thing twice.
    op.create_index(
        "uq_account_approvals_one_open",
        "account_approvals",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_account_approvals_status",
        "account_approvals",
        ["status", "requested_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_account_approvals_status", table_name="account_approvals")
    op.drop_index("uq_account_approvals_one_open", table_name="account_approvals")
    op.drop_table("account_approvals")
