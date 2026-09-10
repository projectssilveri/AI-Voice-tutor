"""What an organization is allowed, and training scoped to a department.

Three things, one migration, because they are one sale: a business plan is
bought with a headcount and an AI budget attached, and the reason a customer
wants departments is so that payroll's training is not on show to the warehouse.

LIMITS ARE NULLABLE, AND NULL MEANS UNLIMITED. Every existing organization
therefore behaves exactly as it did before this ran. A limit of 0 is a real
limit meaning "none allowed", which is why the absent case cannot be 0.

Revision ID: 0013_org_limits
Revises: 0012_backfill_audit_org
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0013_org_limits"
down_revision = "0012_backfill_audit_org"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # What the customer bought
    # ------------------------------------------------------------------
    op.add_column(
        "organizations", sa.Column("max_members", sa.Integer(), nullable=True)
    )
    # AI is the one cost here that scales with use rather than with headcount:
    # a Gemini Live session is billed by the minute against our key. Capping it
    # per organization is what stops one customer's usage becoming everyone's
    # problem, and it is the number a business plan is actually sold on.
    op.add_column(
        "organizations",
        sa.Column("max_ai_minutes_per_month", sa.Integer(), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("max_modules_per_course", sa.Integer(), nullable=True),
    )
    # A note the platform owner writes when a customer negotiates something
    # off the standard plans. Free text on purpose: the whole point of custom
    # pricing is that it does not fit the columns.
    op.add_column(
        "organizations", sa.Column("plan_note", sa.String(length=500), nullable=True)
    )

    # ------------------------------------------------------------------
    # Training that belongs to one department
    # ------------------------------------------------------------------
    # SET NULL rather than CASCADE, matching `organization_documents`: closing a
    # department must not silently destroy the training written for it. It falls
    # back to organization-wide, which is the safe direction — visible to more
    # people than intended is recoverable, deleted is not.
    op.add_column("courses", sa.Column("department_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_courses_department_id_departments",
        "courses",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_courses_department_id", "courses", ["department_id"])

    # ------------------------------------------------------------------
    # Who may see across departments
    # ------------------------------------------------------------------
    # Org admins and branch managers see across departments by role. This flag
    # is for the person who is neither and still needs to: an HR or IT manager
    # sitting inside one department who has to see everyone's training.
    #
    # A flag rather than two new roles. `UserRole` already persists as VARCHAR
    # with a CHECK constraint (decision 55), so every added role means editing
    # that constraint, and "can this person see other departments" is one
    # question — not a rank.
    op.add_column(
        "users",
        sa.Column(
            "sees_all_departments",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "sees_all_departments")
    op.drop_index("ix_courses_department_id", table_name="courses")
    op.drop_constraint(
        "fk_courses_department_id_departments", "courses", type_="foreignkey"
    )
    op.drop_column("courses", "department_id")
    op.drop_column("organizations", "plan_note")
    op.drop_column("organizations", "max_modules_per_course")
    op.drop_column("organizations", "max_ai_minutes_per_month")
    op.drop_column("organizations", "max_members")
