"""course pricing, orders, and the super_admin role

Three related changes, all needed before anything can be sold:

  * `users.role` gains `super_admin` — strictly above admin, allowed to manage
    admins and see revenue.
  * `courses` gains a price, a currency and a published flag.
  * `orders` records what was bought and whether the money arrived. Access is
    granted by `status = 'paid'` and never by the browser.

The role CHECK is dropped and recreated rather than altered: it is a VARCHAR +
CHECK by design (see models/user.py), precisely so that adding a role is an
ordinary migration instead of an ALTER TYPE that cannot run in a transaction.

Revision ID: 0005_pricing_and_super_admin
Revises: 0004_contact_messages
Create Date: 2026-08-11
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_pricing_and_super_admin"
down_revision: str | None = "0004_contact_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- roles ---------------------------------------------------------
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint(
        "ck_users_role",
        "users",
        "role IN ('student', 'teacher', 'admin', 'super_admin')",
    )

    # --- course pricing ------------------------------------------------
    op.add_column(
        "courses",
        sa.Column(
            "price_minor", sa.Integer(), server_default="0", nullable=False
        ),
    )
    op.add_column(
        "courses",
        sa.Column(
            "currency", sa.String(length=3), server_default="INR", nullable=False
        ),
    )
    # Existing courses were visible before this column existed, so defaulting
    # them to unpublished would silently empty the catalogue. New ones default
    # to false at the model level.
    op.add_column(
        "courses",
        sa.Column(
            "is_published",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_courses_price_non_negative", "courses", "price_minor >= 0"
    )

    # --- orders --------------------------------------------------------
    op.create_table(
        "orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=True),
        sa.Column("plan_id", sa.Uuid(), nullable=True),
        # Copied at purchase time: a later price change must not rewrite what
        # somebody actually paid.
        sa.Column("amount_minor", sa.Integer(), nullable=False),
        sa.Column(
            "currency", sa.String(length=3), server_default="INR", nullable=False
        ),
        sa.Column(
            "status", sa.String(length=20), server_default="created", nullable=False
        ),
        sa.Column(
            "provider", sa.String(length=50), server_default="razorpay", nullable=False
        ),
        sa.Column("provider_order_id", sa.String(length=255), nullable=True),
        sa.Column("provider_payment_id", sa.String(length=255), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name="pk_orders"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_orders_user_id_users",
            ondelete="CASCADE",
        ),
        # RESTRICT: something someone paid for must not vanish from under the
        # receipt. Unpublish it instead.
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name="fk_orders_course_id_courses",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["subscription_plans.id"],
            name="fk_orders_plan_id_subscription_plans",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "(course_id IS NOT NULL AND plan_id IS NULL)"
            " OR (course_id IS NULL AND plan_id IS NOT NULL)",
            name="ck_orders_exactly_one_target",
        ),
        sa.CheckConstraint("amount_minor >= 0", name="ck_orders_amount_non_negative"),
        sa.CheckConstraint(
            "status IN ('created', 'paid', 'failed', 'refunded')",
            name="ck_orders_status",
        ),
    )
    op.create_index("ix_orders_user_id", "orders", ["user_id"])
    op.create_index("ix_orders_course_id", "orders", ["course_id"])
    op.create_index("ix_orders_status_created", "orders", ["status", "created_at"])
    # Partial: the provider id is how a webhook finds the row, so it must be
    # unique — but it is null until the provider has been called.
    op.create_index(
        "uq_orders_provider_order_id",
        "orders",
        ["provider_order_id"],
        unique=True,
        postgresql_where=sa.text("provider_order_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_table("orders")

    op.drop_constraint("ck_courses_price_non_negative", "courses", type_="check")
    op.drop_column("courses", "is_published")
    op.drop_column("courses", "currency")
    op.drop_column("courses", "price_minor")

    # Anyone already promoted would violate the narrower constraint.
    op.execute("UPDATE users SET role = 'admin' WHERE role = 'super_admin'")
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint(
        "ck_users_role", "users", "role IN ('student', 'teacher', 'admin')"
    )
