"""Suspending an account now goes past the platform owner first.

Revision ID: 0020_suspensions
Revises: 0019_course_review
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0020_suspensions"
down_revision = "0019_course_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # WHY A TABLE AND NOT A FLAG ON `users`
    # ------------------------------------------------------------------
    # A request is not a property of the person. It has an author, a reason, a
    # decision, a decider and two timestamps, and there can be more than one
    # over an account's life — somebody suspended, restored, and asked about
    # again a year later. All of that on `users` would be six columns that are
    # NULL for everybody who has never been reported.
    #
    # It is also the record that answers "who asked for this and why", which is
    # the question that gets asked after an account is switched off.
    op.create_table(
        "suspension_requests",
        sa.Column(
            "id",
            sa.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        # WHOSE ACCOUNT. CASCADE: a request about a deleted account is about
        # nobody. That differs from the two admin columns below, and
        # deliberately — see there.
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # WHO ASKED and WHO DECIDED. RESTRICT on both, matching
        # `attempt_grants` and the course review columns: an account was
        # switched off on somebody's say-so, and a record that cannot say
        # whose is not a record.
        sa.Column(
            "requested_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # REQUIRED. "Suspend this person" with no reason is not something a
        # platform owner can act on, and it is not something the person can be
        # told either.
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "decided_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
    )

    op.create_check_constraint(
        "ck_suspension_requests_status",
        "suspension_requests",
        "status IN ('pending', 'approved', 'declined')",
    )

    # ONE OPEN REQUEST PER ACCOUNT. Two admins reporting the same person would
    # otherwise put the same decision in the owner's queue twice, and approving
    # one would leave the other pending against an account already suspended.
    # A partial index, so a closed request never blocks a later one.
    op.create_index(
        "uq_suspension_requests_one_open",
        "suspension_requests",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_suspension_requests_status",
        "suspension_requests",
        ["status", "requested_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_suspension_requests_status", table_name="suspension_requests")
    op.drop_index("uq_suspension_requests_one_open", table_name="suspension_requests")
    op.drop_constraint(
        "ck_suspension_requests_status", "suspension_requests", type_="check"
    )
    op.drop_table("suspension_requests")
