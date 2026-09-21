"""Orders: what someone bought, and whether the money actually arrived.

One table covers both things that can be sold — a single course, or a
subscription plan — because the payment flow is identical and splitting it
would mean two of every query on the revenue dashboard. Exactly one of
`course_id` / `plan_id` is set, enforced by a CHECK.

ONE ROW PER THING BOUGHT, EVEN WHEN THEY WERE BOUGHT TOGETHER. Checking out a
cart of three courses writes three rows sharing an `order_group_id` and one
provider order id, because the customer paid once. It is tempting to write a
single row for the basket instead, and it would break two things that both read
an order as "one course, one price": `services/refunds.py` decides what to
return from this row's `amount_minor` and the buyer's progress through this
row's course, and access is granted per `course_id`.

The rule this table exists to serve: **access is granted by `status = 'paid'`,
never by the browser saying the payment worked.** Razorpay's checkout runs in
the client, so its success callback is a hint, not proof; the row only moves to
paid once the signature has been verified server-side against our key secret.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from app.models.course import Course
    from app.models.subscription import SubscriptionPlan
    from app.models.user import User


class OrderStatus(str, enum.Enum):
    """Where the money is.

    CREATED  — we asked the provider for an order; nothing has been paid.
    PAID     — signature verified server-side. This is the only state that
               grants access.
    FAILED   — the provider told us it did not go through.
    REFUNDED — money returned; access is withdrawn.
    """

    CREATED = "created"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        # Exactly one thing is being bought.
        CheckConstraint(
            "(course_id IS NOT NULL AND plan_id IS NULL)"
            " OR (course_id IS NULL AND plan_id IS NOT NULL)",
            name="ck_orders_exactly_one_target",
        ),
        CheckConstraint("amount_minor >= 0", name="ck_orders_amount_non_negative"),
        CheckConstraint(
            "status IN ('created', 'paid', 'failed', 'refunded')",
            name="ck_orders_status",
        ),
        # The provider's order id is how a webhook finds these rows. It used
        # to be unique on its own; a cart checkout means several rows share one
        # payment, so what must not repeat is the same COURSE (or plan) twice
        # against one payment — which would double-count revenue and issue two
        # receipts for one purchase. `coalesce` is safe: the CHECK above
        # guarantees exactly one of the pair is set.
        Index(
            "uq_orders_provider_order_target",
            "provider_order_id",
            text("coalesce(course_id, plan_id)"),
            unique=True,
            postgresql_where=text("provider_order_id IS NOT NULL"),
        ),
        Index("ix_orders_user_id", "user_id"),
        Index("ix_orders_course_id", "course_id"),
        Index("ix_orders_order_group_id", "order_group_id"),
        Index("ix_orders_status_created", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # RESTRICT: a course someone paid for must not be deletable out from under
    # the receipt. Unpublish it instead.
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("courses.id", ondelete="RESTRICT")
    )
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("subscription_plans.id", ondelete="RESTRICT")
    )

    # WHICH BASKET THIS CAME FROM. NULL for the ordinary case — one course, or
    # one plan, bought on its own. Set, and shared, by the rows a single cart
    # checkout produced. No foreign key: it points at nothing but its own
    # siblings, and inventing a `order_groups` table with no columns of its own
    # would be a join for the sake of a diagram.
    order_group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    # Copied from the course/plan at purchase time, not read back through the
    # foreign key. A later price change must not rewrite what somebody paid.
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default="INR", server_default="INR"
    )

    status: Mapped[OrderStatus] = mapped_column(
        Enum(
            OrderStatus,
            native_enum=False,
            length=20,
            validate_strings=True,
            create_constraint=False,  # named CHECK above instead
            values_callable=lambda cls: [member.value for member in cls],
        ),
        nullable=False,
        default=OrderStatus.CREATED,
        server_default=OrderStatus.CREATED.value,
    )

    provider: Mapped[str] = mapped_column(
        String(50), nullable=False, default="razorpay", server_default="razorpay"
    )
    provider_order_id: Mapped[str | None] = mapped_column(String(255))
    provider_payment_id: Mapped[str | None] = mapped_column(String(255))
    # Why a payment failed, for the support queue. Never holds card data.
    failure_reason: Mapped[str | None] = mapped_column(Text)

    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # HOW MUCH WAS GIVEN BACK, in the same minor units as `amount_minor`.
    #
    # NULL means no refund. A value means one was made, and it is frequently
    # LESS than `amount_minor`: the published policy returns everything under
    # 25% of the course, half up to 50%, and nothing after that. `status` alone
    # cannot carry that — REFUNDED is a flag, and a flag cannot say "half".
    #
    # A CHECK in migration 0017 keeps it inside [0, amount_minor], because a
    # refund larger than the order is a typo or a fraud and neither should be
    # storable.
    refunded_amount_minor: Mapped[int | None] = mapped_column(Integer)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="orders")
    course: Mapped[Course | None] = relationship()
    plan: Mapped[SubscriptionPlan | None] = relationship()

    def __repr__(self) -> str:
        return f"<Order {self.amount_minor} {self.currency} {self.status.value}>"
