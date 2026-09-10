"""The compliance audit trail.

One row per recorded action. Append-only by design — no updated_at, and nothing
in the application updates a row once written.

`actor_user_id` is RESTRICT rather than SET NULL, matching
attempt_grants.granted_by: an audit record that has forgotten who acted is not
an audit record. The consequence, deliberately accepted and flagged, is that a
user who has done anything cannot be hard-deleted without a retention policy
deciding what happens to their trail first.

Revision ID: 0008_audit_events
Revises: 0007_user_phone
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0008_audit_events"
down_revision = "0007_user_phone"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        # No FK yet: `organizations` does not exist until migration 0009. The
        # column is created now so events recorded between these two
        # migrations are not lost, and the constraint is added there.
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=64), nullable=True),
        sa.Column("target_id", sa.Uuid(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=400), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_audit_events_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_events"),
    )

    op.create_index(
        "ix_audit_events_organization_id", "audit_events", ["organization_id"]
    )
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"])

    # Every read is "most recent first, filtered by one of these three".
    op.create_index(
        "ix_audit_events_org_created",
        "audit_events",
        ["organization_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_audit_events_actor_created",
        "audit_events",
        ["actor_user_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_audit_events_action_created",
        "audit_events",
        ["action", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_events_action_created", table_name="audit_events")
    op.drop_index("ix_audit_events_actor_created", table_name="audit_events")
    op.drop_index("ix_audit_events_org_created", table_name="audit_events")
    op.drop_index("ix_audit_events_created_at", table_name="audit_events")
    op.drop_index("ix_audit_events_organization_id", table_name="audit_events")
    op.drop_table("audit_events")
