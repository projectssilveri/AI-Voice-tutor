"""Signing out ends the session on the server, not only in the browser.

Revision ID: 0028_revoked_tokens
Revises: 0027_lapses
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0028_revoked_tokens"
down_revision = "0027_lapses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The session cookie is a JWT the server never stored, so signing out could
    # only ask the browser to forget it. A copy kept anywhere else worked until
    # it expired. This table is the list of tokens that were signed out early.
    # See app/models/revoked_token.py.
    #
    # Nothing to backfill: every token issued before this migration is still
    # valid, exactly as it was, and nobody is signed out by the deploy.
    op.create_table(
        "revoked_tokens",
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("token_hash", name="pk_revoked_tokens"),
    )
    op.create_index(
        "ix_revoked_tokens_expires_at", "revoked_tokens", ["expires_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_revoked_tokens_expires_at", table_name="revoked_tokens")
    op.drop_table("revoked_tokens")
