"""Opening an exam paper spends an attempt, not submitting it.

Revision ID: 0026_open_costs
Revises: 0025_no_teacher
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0026_open_costs"
down_revision = "0025_no_teacher"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # WHAT CHANGED, AND WHY
    # ------------------------------------------------------------------
    # An attempt used to be spent on SUBMIT. Opening a paper cost nothing, so
    # the ten questions could be read as many times as somebody liked: open,
    # read, walk away, look the answers up, come back to a fresh paper. The
    # cap limited how often you could be MARKED, not how often you could read.
    #
    # It also made the screen incoherent. "Attempt 1 of 3" sat next to
    # "3 attempts left", both true, and a student who opened a paper and left
    # reported the counter as broken because nothing moved.
    #
    # Asked for directly: opening one should cost an attempt. So the row is
    # written when the paper is handed over.
    #
    # AN OPEN ATTEMPT IS RESUMABLE, which is the part that makes this fair. A
    # misclick would otherwise burn a third of somebody's allowance. Coming
    # back to an exam you have not submitted returns THE SAME attempt rather
    # than starting another, so the cost of opening is paid once.
    op.add_column(
        "cert_attempts",
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    # NULL means "open". Everything already in the table was submitted, by
    # definition: a row could not exist any other way before this migration.
    op.add_column(
        "cert_attempts",
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE cert_attempts SET started_at = ts, submitted_at = ts")

    # Written at open, before anything has been marked. They stay NOT NULL —
    # an unsubmitted attempt has genuinely scored nothing.
    op.alter_column("cert_attempts", "score", server_default=sa.text("0"))
    op.alter_column("cert_attempts", "passed", server_default=sa.text("false"))

    # ONE OPEN ATTEMPT AT A TIME. Two tabs pressing Start together would
    # otherwise spend two, and the second would be unreachable: the page only
    # ever resumes one. The database refuses rather than the service checking
    # and hoping.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_cert_attempts_one_open
            ON cert_attempts (user_id, cert_exam_id)
            WHERE submitted_at IS NULL
        """
    )


def downgrade() -> None:
    # Open attempts have no score and never will. Deleting them is the only
    # honest way back: leaving them would count against an allowance under a
    # rule where only submitted attempts are supposed to.
    op.execute("DELETE FROM cert_attempts WHERE submitted_at IS NULL")
    op.drop_index("uq_cert_attempts_one_open", table_name="cert_attempts")
    op.alter_column("cert_attempts", "passed", server_default=None)
    op.alter_column("cert_attempts", "score", server_default=None)
    op.drop_column("cert_attempts", "submitted_at")
    op.drop_column("cert_attempts", "started_at")
