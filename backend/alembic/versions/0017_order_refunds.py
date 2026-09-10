"""How much of an order was actually given back.

Revision ID: 0017_order_refunds
Revises: 0016_course_validity
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0017_order_refunds"
down_revision = "0016_course_validity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # WHY A COLUMN AND NOT JUST THE STATUS
    # ------------------------------------------------------------------
    # `orders.status` already has a REFUNDED value, and until now that was the
    # whole record of a refund: the order moved to REFUNDED and the amount was
    # assumed to be the full one. The published refund policy is tiered — full
    # under 25% of the course, half up to 50%, nothing after that — so most
    # refunds are PARTIAL, and "refunded" on its own cannot say how much.
    #
    # Without this, a ₹1,799 course refunded at half would be recorded as
    # ₹1,799 returned. The customer would have had ₹900 and the revenue screen
    # would show ₹1,799 gone.
    op.add_column(
        "orders", sa.Column("refunded_amount_minor", sa.Integer(), nullable=True)
    )
    op.add_column(
        "orders",
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Never more than was paid, and never negative. A refund larger than the
    # order is either a typo or a fraud, and both are worth refusing in the
    # database rather than only in the route that happens to be written today.
    op.create_check_constraint(
        "ck_orders_refund_within_amount",
        "orders",
        "refunded_amount_minor IS NULL"
        " OR (refunded_amount_minor >= 0"
        " AND refunded_amount_minor <= amount_minor)",
    )

    # NO BACKFILL, and none is needed: nothing in the product could set
    # REFUNDED before now, so there is no history to interpret. Were there any,
    # guessing "they must have had all of it" is exactly the assumption this
    # column exists to stop.


def downgrade() -> None:
    op.drop_constraint("ck_orders_refund_within_amount", "orders", type_="check")
    op.drop_column("orders", "refunded_at")
    op.drop_column("orders", "refunded_amount_minor")
