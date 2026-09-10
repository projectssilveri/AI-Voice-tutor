"""A course an admin writes now goes to the super admin before it is sold.

Revision ID: 0019_course_review
Revises: 0018_tutor_limits
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0019_course_review"
down_revision = "0018_tutor_limits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # WHY THIS IS SEPARATE FROM `is_published`
    # ------------------------------------------------------------------
    # `is_published` is one bit and it answers "is this on sale". It cannot
    # also carry "an admin thinks this is ready", "the owner has looked at it",
    # or "the owner sent it back and said why" — and those are now three
    # different states an author needs to see.
    #
    # So review status sits beside it, and the rule between them is one way:
    # a course can only be published once it has been APPROVED. Publishing
    # remains the super admin's alone, which it already was — the schema for an
    # ordinary admin's update has no `is_published` field at all, so the route
    # would drop one even if it were sent.
    op.add_column(
        "courses",
        sa.Column(
            "review_status",
            sa.String(length=20),
            nullable=False,
            server_default="draft",
        ),
    )
    op.create_check_constraint(
        "ck_courses_review_status",
        "courses",
        "review_status IN ('draft', 'pending', 'approved', 'rejected')",
    )

    # WHO ASKED AND WHO DECIDED. RESTRICT on both, matching `attempt_grants`
    # (decision 24): "who approved this course" is exactly the question asked
    # afterwards, and an approval with a deleted approver answers nothing.
    op.add_column(
        "courses",
        sa.Column(
            "submitted_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.add_column(
        "courses", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "courses",
        sa.Column(
            "reviewed_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.add_column(
        "courses", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True)
    )
    # Why it was sent back. Shown to the author, so it has to be written for
    # them rather than for a log.
    op.add_column("courses", sa.Column("review_note", sa.Text(), nullable=True))

    # ------------------------------------------------------------------
    # EVERYTHING ALREADY ON SALE IS ALREADY APPROVED
    # ------------------------------------------------------------------
    # Leaving live courses at 'draft' would say the catalogue had never been
    # reviewed, and the first thing anybody did with the new screen would be to
    # approve eleven courses that have been selling for months. `reviewed_by`
    # stays NULL on those: nobody actually reviewed them under this process,
    # and inventing an approver would be worse than an honest blank.
    op.execute(
        sa.text(
            "UPDATE courses SET review_status = 'approved' WHERE is_published = true"
        )
    )

    op.create_index(
        "ix_courses_review_status", "courses", ["review_status"]
    )


def downgrade() -> None:
    op.drop_index("ix_courses_review_status", table_name="courses")
    op.drop_column("courses", "review_note")
    op.drop_column("courses", "reviewed_at")
    op.drop_column("courses", "reviewed_by")
    op.drop_column("courses", "submitted_at")
    op.drop_column("courses", "submitted_by")
    op.drop_constraint("ck_courses_review_status", "courses", type_="check")
    op.drop_column("courses", "review_status")
