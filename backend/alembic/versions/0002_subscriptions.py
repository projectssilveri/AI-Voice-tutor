"""subscription-based training access

Adds subscription_plans, plan_courses, and subscriptions.

Payment-provider integration is deliberately absent: `provider` and
`external_subscription_id` are nullable placeholders so wiring Stripe (or
similar) later is a backfill rather than a schema change.

Revision ID: 0002_subscriptions
Revises: 0001_initial_schema
Create Date: 2026-08-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002_subscriptions"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "subscription_plans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        # Integer minor units (paise / cents), never a float — binary floating
        # point cannot represent money exactly and this is a billing column.
        sa.Column("price_minor", sa.Integer(), nullable=False),
        sa.Column(
            "currency", sa.String(length=3), server_default="INR", nullable=False
        ),
        sa.Column("billing_interval", sa.String(length=20), nullable=False),
        # Retired plans stay: existing subscriptions still reference them.
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
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
        sa.PrimaryKeyConstraint("id", name="pk_subscription_plans"),
        sa.UniqueConstraint("name", name="uq_subscription_plans_name"),
        sa.CheckConstraint(
            "price_minor >= 0", name="ck_subscription_plans_price_non_negative"
        ),
        sa.CheckConstraint(
            "billing_interval IN ('monthly', 'yearly')",
            name="ck_subscription_plans_billing_interval",
        ),
    )
    op.create_index(
        "ix_subscription_plans_is_active", "subscription_plans", ["is_active"]
    )

    op.create_table(
        "plan_courses",
        sa.Column("plan_id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("plan_id", "course_id", name="pk_plan_courses"),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["subscription_plans.id"],
            name="fk_plan_courses_plan_id_subscription_plans",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name="fk_plan_courses_course_id_courses",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_plan_courses_plan_id", "plan_courses", ["plan_id"])
    op.create_index("ix_plan_courses_course_id", "plan_courses", ["course_id"])

    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status", sa.String(length=20), server_default="active", nullable=False
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        # Null until a payment provider is wired.
        sa.Column("provider", sa.String(length=50), nullable=True),
        sa.Column(
            "external_subscription_id", sa.String(length=255), nullable=True
        ),
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
        sa.PrimaryKeyConstraint("id", name="pk_subscriptions"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_subscriptions_user_id_users",
            ondelete="CASCADE",
        ),
        # RESTRICT: a plan somebody is subscribed to must not disappear.
        # Deactivate it via is_active instead.
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["subscription_plans.id"],
            name="fk_subscriptions_plan_id_subscription_plans",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("user_id", "plan_id", name="uq_subscriptions_user_plan"),
        sa.CheckConstraint(
            "current_period_end > current_period_start",
            name="ck_subscriptions_period_ordered",
        ),
        sa.CheckConstraint(
            "status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')",
            name="ck_subscriptions_status",
        ),
    )
    op.create_index("ix_subscriptions_user_id", "subscriptions", ["user_id"])
    op.create_index("ix_subscriptions_plan_id", "subscriptions", ["plan_id"])
    # The access check filters on user + status.
    op.create_index(
        "ix_subscriptions_user_status", "subscriptions", ["user_id", "status"]
    )


def downgrade() -> None:
    for table in ("subscriptions", "plan_courses", "subscription_plans"):
        op.drop_table(table)
