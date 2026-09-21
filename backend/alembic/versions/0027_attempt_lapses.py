"""Leaving the exam is counted on the attempt, not in the browser.

Revision ID: 0027_lapses
Revises: 0026_open_costs
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0027_lapses"
down_revision = "0026_open_costs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # WHY THE COUNT MOVED OUT OF THE BROWSER
    # ------------------------------------------------------------------
    # The proctor counted lapses in a React ref, and reset that ref every time
    # a paper opened. That was defensible while opening a paper was a one-off:
    # you started, you left three times, it submitted for you.
    #
    # Migration 0026 made papers RESUMABLE, which turned the reset into a hole
    # wide enough to drive through. Leave twice, close the tab, come back to
    # the same attempt, and the warnings start again at zero. The budget was
    # per opening, and openings were now unlimited.
    #
    # So it belongs to the attempt, which is the thing being protected. It
    # survives a closed tab, a dead laptop and a different browser, because it
    # is a column rather than a variable.
    #
    # Still advisory. `useExamProctor` says at length that this is client-side
    # and defeated by disabling JavaScript; moving the COUNT server-side raises
    # the effort of the casual case and nothing more. Nothing here should be
    # described as proctoring in the exam-hall sense.
    op.add_column(
        "cert_attempts",
        sa.Column(
            "lapses",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.create_check_constraint(
        "ck_cert_attempts_lapses_non_negative", "cert_attempts", "lapses >= 0"
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_cert_attempts_lapses_non_negative", "cert_attempts", type_="check"
    )
    op.drop_column("cert_attempts", "lapses")
