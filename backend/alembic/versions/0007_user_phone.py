"""An optional phone number on a user.

Nullable and unconstrained beyond a length cap, deliberately. Phone numbers are
not unique in practice — a shared office line, a parent's number on a student
account — and a UNIQUE index would refuse the second person to enter one with
an error nobody could act on. Format is not validated in SQL either: E.164,
national forms and extensions are all legitimate, and a CHECK constraint that
guesses wrong locks someone out of their own profile.

Revision ID: 0007_user_phone
Revises: 0006_module_materials
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0007_user_phone"
down_revision = "0006_module_materials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "phone")
