"""A cart, and orders that can be paid for together.

Revision ID: 0024_cart
Revises: 0023_deletions
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0024_cart"
down_revision = "0023_deletions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # THE CART
    # ------------------------------------------------------------------
    # Courses somebody means to buy, kept server-side so the basket survives
    # closing the tab and moving to another device. See `app/models/cart.py`
    # for why there is no price and no quantity on a cart line.
    op.create_table(
        "cart_items",
        sa.Column(
            "id",
            sa.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # CASCADE, unlike `orders.course_id` which is RESTRICT. Nothing has been
        # paid for a cart line, so there is no receipt to protect — a deleted
        # course should take the unbought lines with it rather than leave
        # baskets that cannot be checked out.
        sa.Column(
            "course_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    # The same course twice in one basket is meaningless, and the service
    # relies on the database to say so rather than on a read-then-write.
    op.create_index(
        "uq_cart_items_user_course",
        "cart_items",
        ["user_id", "course_id"],
        unique=True,
    )
    op.create_index("ix_cart_items_user_id", "cart_items", ["user_id"])

    # ------------------------------------------------------------------
    # ONE PAYMENT, SEVERAL ORDERS
    # ------------------------------------------------------------------
    # Checking out a basket of three courses is ONE payment and THREE order
    # rows. Not one row for the basket: `services/refunds.py` works out what to
    # return from a single order's `amount_minor` and the buyer's progress
    # through that one course, and access is granted per `orders.course_id`.
    # Collapsing a basket into one row would take both of those away.
    #
    # So the rows share a group id, and they share the provider's order id —
    # because the customer paid once and Razorpay only ever heard about one
    # order.
    op.add_column(
        "orders",
        sa.Column("order_group_id", sa.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_orders_order_group_id", "orders", ["order_group_id"])

    # The old index said a provider order id appears at most once in this
    # table. That was right when every payment bought exactly one thing, and it
    # is what has to give now.
    #
    # What replaces it still forbids the thing that index existed to forbid:
    # the SAME course (or plan) recorded twice against one payment, which would
    # double-count revenue and hand out two receipts for one purchase.
    # `coalesce` is safe because a CHECK constraint already guarantees exactly
    # one of the two is set.
    op.drop_index("uq_orders_provider_order_id", table_name="orders")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_orders_provider_order_target
            ON orders (provider_order_id, coalesce(course_id, plan_id))
            WHERE provider_order_id IS NOT NULL
        """
    )


def downgrade() -> None:
    # Reinstating the old unique index will fail if any basket has been paid
    # for, which is correct: those rows genuinely share a provider order id and
    # there is no honest way to squeeze them back into the old shape. Delete
    # the grouped orders first if this really has to go back.
    op.drop_index("uq_orders_provider_order_target", table_name="orders")
    op.create_index(
        "uq_orders_provider_order_id",
        "orders",
        ["provider_order_id"],
        unique=True,
        postgresql_where=sa.text("provider_order_id IS NOT NULL"),
    )
    op.drop_index("ix_orders_order_group_id", table_name="orders")
    op.drop_column("orders", "order_group_id")

    op.drop_index("ix_cart_items_user_id", table_name="cart_items")
    op.drop_index("uq_cart_items_user_course", table_name="cart_items")
    op.drop_table("cart_items")
