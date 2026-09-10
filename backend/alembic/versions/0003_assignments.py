"""assignments and their submissions

The project spec lists "tasks/assignments" on the student dashboard and "assignment
help" among the voice patterns, but never gave them a table or a build-order
step. Scope confirmed 2026-08-09: an admin authors an assignment against a
module together with the answers it accepts, and submissions are graded by a
deterministic match against those answers — no AI in the grading path.

Resubmission is unlimited; only certification exams are capped.

Revision ID: 0003_assignments
Revises: 0002_subscriptions
Create Date: 2026-08-09
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003_assignments"
down_revision: str | None = "0002_subscriptions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("module_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        # Every answer that counts as correct, as a JSONB array of strings.
        sa.Column(
            "accepted_answers", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "match_mode", sa.String(length=20), server_default="exact", nullable=False
        ),
        sa.Column(
            "case_sensitive",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("max_score", sa.Integer(), server_default="100", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_assignments"),
        sa.ForeignKeyConstraint(
            ["module_id"],
            ["modules.id"],
            name="fk_assignments_module_id_modules",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("max_score > 0", name="ck_assignments_max_score_positive"),
        # An assignment with no accepted answers could never be passed.
        sa.CheckConstraint(
            "jsonb_array_length(accepted_answers) >= 1",
            name="ck_assignments_has_accepted_answers",
        ),
        sa.CheckConstraint(
            "match_mode IN ('exact', 'contains')",
            name="ck_assignments_match_mode",
        ),
    )
    op.create_index("ix_assignments_module_id", "assignments", ["module_id"])

    op.create_table(
        "assignment_submissions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("assignment_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        # Absolute score, compared against assignments.max_score — not a
        # percentage. Never null: matching is synchronous, so a submission is
        # graded the moment it exists.
        sa.Column("score", sa.Numeric(precision=6, scale=2), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column(
            "graded_by", sa.String(length=20), server_default="auto", nullable=False
        ),
        sa.Column("graded_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "graded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_assignment_submissions"),
        sa.ForeignKeyConstraint(
            ["assignment_id"],
            ["assignments.id"],
            name="fk_assignment_submissions_assignment_id_assignments",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_assignment_submissions_user_id_users",
            ondelete="CASCADE",
        ),
        # RESTRICT, like attempt_grants.granted_by: who re-marked a student's
        # work must survive that admin's account being deleted.
        sa.ForeignKeyConstraint(
            ["graded_by_user_id"],
            ["users.id"],
            name="fk_assignment_submissions_graded_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "assignment_id",
            "user_id",
            "attempt_number",
            name="uq_assignment_submissions_sequence",
        ),
        sa.CheckConstraint(
            "attempt_number >= 1",
            name="ck_assignment_submissions_attempt_number_positive",
        ),
        sa.CheckConstraint(
            "score >= 0", name="ck_assignment_submissions_score_non_negative"
        ),
        sa.CheckConstraint(
            "graded_by IN ('auto', 'admin')",
            name="ck_assignment_submissions_graded_by",
        ),
        # An admin override must name the admin; automatic grading must not.
        sa.CheckConstraint(
            "(graded_by = 'admin' AND graded_by_user_id IS NOT NULL)"
            " OR (graded_by = 'auto' AND graded_by_user_id IS NULL)",
            name="ck_assignment_submissions_admin_grader_identified",
        ),
    )
    op.create_index(
        "ix_assignment_submissions_user_id", "assignment_submissions", ["user_id"]
    )
    op.create_index(
        "ix_assignment_submissions_assignment_id",
        "assignment_submissions",
        ["assignment_id"],
    )
    op.create_index(
        "ix_assignment_submissions_assignment_user",
        "assignment_submissions",
        ["assignment_id", "user_id"],
    )


def downgrade() -> None:
    for table in ("assignment_submissions", "assignments"):
        op.drop_table(table)
