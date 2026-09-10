"""contact messages from the public marketing form

Step 11 wires the Contact page's form to FastAPI. With no email
provider configured, messages land here and are read from the admin dashboard;
adding email later is a sender on top of this table rather than a schema change.

This is the only table an unauthenticated visitor can write to, so every text
column is length-capped here as well as in the router.

Revision ID: 0004_contact_messages
Revises: 0003_assignments
Create Date: 2026-08-11
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_contact_messages"
down_revision: str | None = "0003_assignments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "contact_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        # A reply-to address, not an identity: not unique, not verified.
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "handled", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("handled_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_contact_messages"),
        # RESTRICT, as elsewhere: who dealt with a message must survive that
        # admin's account being deleted.
        sa.ForeignKeyConstraint(
            ["handled_by_user_id"],
            ["users.id"],
            name="fk_contact_messages_handled_by_user_id_users",
            ondelete="RESTRICT",
        ),
    )
    # The inbox lists unhandled first, newest first.
    op.create_index(
        "ix_contact_messages_handled_created",
        "contact_messages",
        ["handled", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("contact_messages")
