"""How many times the tutor may be played on a module, and for how long.

Revision ID: 0018_tutor_limits
Revises: 0017_order_refunds
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0018_tutor_limits"
down_revision = "0017_order_refunds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # WHAT WAS THERE BEFORE: nothing.
    # ------------------------------------------------------------------
    # A student could open the voice tutor on the same module as many times as
    # they liked, for as long as Gemini would hold the connection. The only cap
    # anywhere was `organizations.max_ai_minutes_per_month`, which covers a
    # customer's whole account and does not exist at all for a public learner.
    # So the free course — the one deliberately given away to bring people in —
    # had unmetered access to the most expensive thing the product does.
    #
    # BOTH COLUMNS ARE NULLABLE, AND NULL IS THE INTERESTING CASE. It does NOT
    # mean unlimited here, which is what NULL means in `services/limits.py`.
    # It means "use the platform default for a course of this kind", and the
    # defaults differ for free and paid courses (see `core/config.py`).
    #
    # That is a deliberate difference and it is why these columns are not
    # backfilled. Backfilling would freeze today's default into every existing
    # course, so changing the free-course allowance later would silently apply
    # to new courses only — and the operator changing it would have no way to
    # tell from the screen. Leaving NULL means the default is read at the
    # moment it is used, which is the only way one setting can govern the
    # catalogue.
    op.add_column(
        "courses", sa.Column("ai_sessions_per_module", sa.Integer(), nullable=True)
    )
    op.add_column(
        "courses", sa.Column("ai_session_minutes", sa.Integer(), nullable=True)
    )

    # Zero is a REAL value on the session count: "this course has no tutor",
    # which is a coherent thing for a super admin to want on a reading-only
    # course. Zero minutes is not — a session that may run for no time is a
    # session that cannot start, and an operator typing 0 there means "no
    # limit" far more often than they mean "instantly cut off". Refused, so
    # they have to say which they meant.
    op.create_check_constraint(
        "ck_courses_ai_sessions_non_negative",
        "courses",
        "ai_sessions_per_module IS NULL OR ai_sessions_per_module >= 0",
    )
    op.create_check_constraint(
        "ck_courses_ai_minutes_positive",
        "courses",
        "ai_session_minutes IS NULL OR ai_session_minutes > 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_courses_ai_minutes_positive", "courses", type_="check")
    op.drop_constraint("ck_courses_ai_sessions_non_negative", "courses", type_="check")
    op.drop_column("courses", "ai_session_minutes")
    op.drop_column("courses", "ai_sessions_per_module")
