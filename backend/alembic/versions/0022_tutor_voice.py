"""Which voice the tutor speaks in, chosen by the student.

Everybody heard the same man, because nothing in the code ever picked a voice
and Gemini used its own default. One nullable column is the whole schema change:
NULL means "whatever the platform default is", so every account that existed
before this keeps behaving exactly as it did, and changing the default later
moves all of them at once.

Not an enum. The set of prebuilt voices belongs to Gemini and grows without
asking us; a CHECK constraint here would turn their next addition into a
migration. `app/services/gemini_live.TUTOR_VOICES` is the list the API
validates against, and an unknown value falls back to the default rather than
breaking a lesson.

Revision ID: 0022_tutor_voice
Revises: 0021_dept_admin
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0022_tutor_voice"
down_revision = "0021_dept_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("tutor_voice", sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "tutor_voice")
