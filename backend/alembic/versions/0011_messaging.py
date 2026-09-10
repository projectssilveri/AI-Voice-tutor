"""Private messages, and a reply on a contact message.

Two things, one migration, because they are one feature from the outside: the
admin console grows a Messages area with two inboxes in it.

`contact_messages` gains a phone number and the text of the reply that was
sent. It already had `handled` / `handled_by_user_id` / `handled_at`, which is
exactly "marked as replied" — so that is reused rather than duplicated with a
second near-identical set of columns that would immediately disagree with it.

Revision ID: 0011_messaging
Revises: 0010_org_documents
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0011_messaging"
down_revision = "0010_org_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # The public contact form
    # ------------------------------------------------------------------
    # Nullable, and no format check, for the reason decision 113 gives for
    # `users.phone`: E.164, national spacing and extensions are all legitimate,
    # and a pattern that guesses wrong rejects a real number. This one is typed
    # by a stranger, so it is even less predictable.
    op.add_column(
        "contact_messages", sa.Column("phone", sa.String(length=40), nullable=True)
    )
    # What was actually sent back. Without it the inbox can say a message was
    # handled but not what anybody said, which is the half that matters when
    # the same person writes in again a week later.
    op.add_column("contact_messages", sa.Column("reply_body", sa.Text(), nullable=True))

    # ------------------------------------------------------------------
    # Private messages between accounts
    # ------------------------------------------------------------------
    op.create_table(
        "direct_messages",
        sa.Column(
            "id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("sender_id", sa.Uuid(), nullable=False),
        sa.Column("recipient_id", sa.Uuid(), nullable=False),
        sa.Column("in_reply_to_id", sa.Uuid(), nullable=True),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["sender_id"],
            ["users.id"],
            name="fk_direct_messages_sender_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipient_id"],
            ["users.id"],
            name="fk_direct_messages_recipient_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["in_reply_to_id"],
            ["direct_messages.id"],
            name="fk_direct_messages_in_reply_to_id_direct_messages",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_direct_messages_sender_id", "direct_messages", ["sender_id"])
    op.create_index(
        "ix_direct_messages_recipient_id", "direct_messages", ["recipient_id"]
    )
    op.create_index("ix_direct_messages_created_at", "direct_messages", ["created_at"])
    op.create_index(
        "ix_direct_messages_recipient_created",
        "direct_messages",
        ["recipient_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_direct_messages_sender_created",
        "direct_messages",
        ["sender_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_direct_messages_sender_created", table_name="direct_messages")
    op.drop_index("ix_direct_messages_recipient_created", table_name="direct_messages")
    op.drop_index("ix_direct_messages_created_at", table_name="direct_messages")
    op.drop_index("ix_direct_messages_recipient_id", table_name="direct_messages")
    op.drop_index("ix_direct_messages_sender_id", table_name="direct_messages")
    op.drop_table("direct_messages")
    op.drop_column("contact_messages", "reply_body")
    op.drop_column("contact_messages", "phone")
