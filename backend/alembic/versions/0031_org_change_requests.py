"""A branch manager's or department admin's change waits for the org admin.

Revision ID: 0031_org_change_requests
Revises: 0030_account_approvals
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0031_org_change_requests"
down_revision = "0030_account_approvals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Sir's rule of 2026-10-01: an organisation admin does everything in their
    # own organisation with no approval, and a branch manager or department
    # admin who creates, edits or deletes a user, course or document sends it
    # here for the organisation admin to approve. One row per request, kept
    # after the decision. See app/models/org_change.py.
    #
    # Nothing to backfill: every change made so far was made by somebody who was
    # allowed to make it at the time.
    op.create_table(
        "org_change_requests",
        sa.Column(
            "id",
            sa.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "organization_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("label", sa.String(length=300), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
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
            "status", sa.String(length=20), nullable=False, server_default="pending"
        ),
        sa.Column(
            "decided_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("outcome", sa.String(length=50), nullable=True),
    )
    op.create_check_constraint(
        "ck_org_change_requests_kind",
        "org_change_requests",
        "kind IN ('member', 'training', 'document')",
    )
    op.create_check_constraint(
        "ck_org_change_requests_action",
        "org_change_requests",
        "action IN ('create', 'edit', 'delete')",
    )
    op.create_check_constraint(
        "ck_org_change_requests_status",
        "org_change_requests",
        "status IN ('pending', 'approved', 'declined')",
    )
    # One open request per thing per action. A create has no target yet, so it
    # is left out of the uniqueness.
    op.create_index(
        "uq_org_change_requests_one_open",
        "org_change_requests",
        ["kind", "action", "target_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending' and target_id is not null"),
    )
    op.create_index(
        "ix_org_change_requests_org_status",
        "org_change_requests",
        ["organization_id", "status"],
    )

    # A document a branch or department admin uploaded is stored at once but
    # hidden until the org admin approves it. This flag is what hides it; the
    # listings and the file fetch filter on it. Default false, so every
    # document that exists today stays visible.
    op.add_column(
        "organization_documents",
        sa.Column(
            "pending_approval",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("organization_documents", "pending_approval")
    op.drop_index(
        "ix_org_change_requests_org_status", table_name="org_change_requests"
    )
    op.drop_index(
        "uq_org_change_requests_one_open", table_name="org_change_requests"
    )
    op.drop_table("org_change_requests")
