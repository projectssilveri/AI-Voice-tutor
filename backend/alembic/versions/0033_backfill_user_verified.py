"""Backfill existing users as email-verified before verification is enforced.

Revision ID: 0033_backfill_user_verified
Revises: 0032_org_catalogue_access

Email verification gates sign-in once SMTP is configured
(`settings.require_email_verification`). Everyone who registered before this
never had a way to confirm their email, so they would be locked out the moment
mail is switched on. They are marked verified here. New self-sign-ups are
created unverified and confirm by email; admin and org-created accounts are
already made verified at creation.
"""

from __future__ import annotations

from alembic import op

revision = "0033_backfill_user_verified"
down_revision = "0032_org_catalogue_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE users SET is_verified = true WHERE is_verified = false")


def downgrade() -> None:
    # No safe inverse: which rows were unverified before cannot be recovered,
    # and un-verifying everyone would lock real accounts out. Left as is.
    pass
