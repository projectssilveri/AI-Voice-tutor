"""Subscription-based access to training.

Three tables:
  subscription_plans  what can be bought
  plan_courses        which courses a plan unlocks
  subscriptions       who currently holds what

Deliberately NOT here yet, pending decisions:
  - Payment provider. `provider` / `external_subscription_id` are nullable
    placeholders so wiring Stripe (or similar) later is a backfill rather than
    a schema change. No webhook, invoice, or payment-method tables exist.
  - How this composes with `enrollments`. Right now enrollment is a direct
    user-to-course row. Whether an active subscription grants enrollment
    automatically, or is checked alongside it at access time, is an
    authorisation decision for the step that builds course access.
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
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from app.models.course import Course
    from app.models.user import User


class BillingInterval(str, enum.Enum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


class SubscriptionStatus(str, enum.Enum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class SubscriptionPlan(TimestampMixin, Base):
    __tablename__ = "subscription_plans"
    __table_args__ = (
        CheckConstraint(
            "price_minor >= 0", name="ck_subscription_plans_price_non_negative"
        ),
        Index("ix_subscription_plans_is_active", "is_active"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)

    # Money is stored as an integer in the currency's minor unit (paise for
    # INR, cents for USD). Never a float: 0.1 + 0.2 != 0.3 in binary floating
    # point, and billing is the last place that should be approximate.
    price_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default="INR"
    )

    billing_interval: Mapped[BillingInterval] = mapped_column(
        Enum(
            BillingInterval,
            native_enum=False,
            length=20,
            validate_strings=True,
            create_constraint=True,
            name="ck_subscription_plans_billing_interval",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )

    # Retired plans stay in the table: existing subscriptions still reference
    # them, and deleting one would rewrite billing history.
    is_active: Mapped[bool] = mapped_column(
        nullable=False, default=True, server_default="true"
    )

    subscriptions: Mapped[list[Subscription]] = relationship(back_populates="plan")
    course_links: Mapped[list[PlanCourse]] = relationship(
        back_populates="plan", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<SubscriptionPlan {self.name!r}>"


class PlanCourse(Base):
    """Which courses a plan unlocks.

    A plan with no rows here grants no courses. An "everything" plan is
    represented by listing every course rather than by a magic flag, so access
    checks stay a single join with no special case.
    """

    __tablename__ = "plan_courses"
    __table_args__ = (
        Index("ix_plan_courses_plan_id", "plan_id"),
        Index("ix_plan_courses_course_id", "course_id"),
    )

    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("subscription_plans.id", ondelete="CASCADE"), primary_key=True
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True
    )

    plan: Mapped[SubscriptionPlan] = relationship(back_populates="course_links")
    course: Mapped[Course] = relationship(back_populates="plan_links")


class Subscription(TimestampMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        # A student can hold at most one subscription per plan. Sequential
        # renewals update the period columns on the same row; switching plans
        # creates a row against the new plan.
        UniqueConstraint("user_id", "plan_id", name="uq_subscriptions_user_plan"),
        CheckConstraint(
            "current_period_end > current_period_start",
            name="ck_subscriptions_period_ordered",
        ),
        Index("ix_subscriptions_user_id", "user_id"),
        Index("ix_subscriptions_plan_id", "plan_id"),
        # The access check asks "does this user have a live subscription right
        # now", which filters on user + status.
        Index("ix_subscriptions_user_status", "user_id", "status"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # RESTRICT: a plan that someone is subscribed to must not vanish. Deactivate
    # it with is_active instead.
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("subscription_plans.id", ondelete="RESTRICT"), nullable=False
    )

    status: Mapped[SubscriptionStatus] = mapped_column(
        Enum(
            SubscriptionStatus,
            native_enum=False,
            length=20,
            validate_strings=True,
            create_constraint=True,
            name="ck_subscriptions_status",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=SubscriptionStatus.ACTIVE,
        server_default=SubscriptionStatus.ACTIVE.value,
    )

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # The window access is granted for. Renewal moves both forward.
    current_period_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    current_period_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Placeholders for a payment provider. Null until one is wired.
    provider: Mapped[str | None] = mapped_column(String(50))
    external_subscription_id: Mapped[str | None] = mapped_column(String(255))

    user: Mapped[User] = relationship(back_populates="subscriptions")
    plan: Mapped[SubscriptionPlan] = relationship(back_populates="subscriptions")

    def __repr__(self) -> str:
        return f"<Subscription {self.user_id} {self.status.value}>"
