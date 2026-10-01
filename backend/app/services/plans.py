"""Bundles and packages, from the super admin's side.

A "bundle" and a "package" are the same row: a `subscription_plans` record with
some courses linked to it. What separates a stack bundle from All Access is how
MANY of the catalogue it covers, and that is counted rather than stored — the
same rule `/public/plans` applies, for the same reason. A column saying "this
is a bundle" would be a second source of truth beside `plan_courses`, and
`plan_courses` is what actually grants the access.

WHAT THIS FILE IS CAREFUL ABOUT.

  Changing a plan's price never rewrites what anybody paid. `orders.amount_minor`
  is copied at purchase time precisely so that a price change is a change to
  what the NEXT person pays.

  Changing which courses a plan covers DOES change what existing subscribers
  can open, immediately, because access is a live join through `plan_courses`.
  That is not a bug to be papered over — it is the only sane behaviour for a
  subscription — but it is a real consequence, so the route says so and the
  screen warns before saving.

  An All Access plan (`all_access`) is still a list in `plan_courses`, not a
  special case in the access check. The flag only keeps that list complete:
  `fill_all_access` links every public course, and runs again whenever a
  public course is created, so "including new ones" stays true without anyone
  remembering to tick the new course.

  A plan is never deleted. `subscriptions.plan_id` and `orders.plan_id` are
  RESTRICT, deliberately: a receipt whose plan vanished is not a receipt.
  Retiring one sets `is_active = False`, which takes it off sale and leaves
  everyone who holds it exactly as they were.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, select, true
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course
from app.models.order import Order, OrderStatus
from app.models.subscription import (
    BillingInterval,
    PlanCourse,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
)
from app.models.user import User

#: Subscription states that still grant access. Kept identical to
#: `services/subscriptions.LIVE_STATUSES` — a plan screen that counted holders
#: differently from the code granting the access would be reporting fiction.
LIVE_STATUSES = (SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING)


class PlanError(ValueError):
    """The plan cannot be saved as asked."""


@dataclass(frozen=True)
class PlanCourseRow:
    id: uuid.UUID
    title: str
    price_minor: int
    is_published: bool


@dataclass(frozen=True)
class PlanSummary:
    """One bundle, with everything the owner's screen needs about it."""

    id: uuid.UUID
    name: str
    description: str | None
    price_minor: int
    currency: str
    billing_interval: str
    is_active: bool
    created_at: datetime

    courses: list[PlanCourseRow] = field(default_factory=list)

    #: Covers every published public course, so it is All Access rather than a
    #: stack bundle. Counted from the links, or true for a flagged plan.
    covers_everything: bool = False
    #: Flagged All Access: every public course is linked automatically,
    #: including ones created later. See `fill_all_access`.
    all_access: bool = False
    #: What the member courses cost bought one at a time, at today's prices.
    separate_total_minor: int = 0

    #: People holding it right now — live status AND an unexpired period.
    active_subscribers: int = 0
    #: Everyone who ever started one, including lapsed and cancelled.
    total_subscribers: int = 0
    #: Paid orders against this plan, and what they came to. Money TAKEN, so
    #: refunded orders are included; `refunded_minor` is what went back.
    paid_orders: int = 0
    gross_minor: int = 0
    refunded_minor: int = 0

    @property
    def net_minor(self) -> int:
        return self.gross_minor - self.refunded_minor


@dataclass(frozen=True)
class PlanHolder:
    """One person who bought a bundle, and where they stand with it."""

    user_id: uuid.UUID
    name: str
    email: str
    status: str
    started_at: datetime | None
    period_end: datetime | None
    cancelled: bool
    #: Whether the subscription is still granting access at this moment.
    live: bool
    #: What they have paid against this plan in total, in minor units.
    paid_minor: int
    orders: int


async def list_plans(session: AsyncSession) -> list[PlanSummary]:
    """Every bundle and package, active or retired, with its numbers.

    A fixed number of queries regardless of how many plans there are. The
    obvious version — walk the plans, then ask each one for its courses, its
    subscribers and its orders — is four queries per plan, and this screen
    exists to show them all at once.
    """
    plans = (
        (
            await session.execute(
                select(SubscriptionPlan).order_by(
                    SubscriptionPlan.is_active.desc(), SubscriptionPlan.price_minor
                )
            )
        )
        .scalars()
        .all()
    )
    if not plans:
        return []

    plan_ids = [plan.id for plan in plans]

    # The courses in each plan. PUBLIC courses only, matching `/public/plans`:
    # a plan that somehow linked an organization's private training must not
    # print its title on an owner's screen either, and counting it would make
    # "covers everything" wrong.
    members: dict[uuid.UUID, list[PlanCourseRow]] = {}
    for plan_id, course in (
        await session.execute(
            select(PlanCourse.plan_id, Course)
            .join(Course, Course.id == PlanCourse.course_id)
            .where(
                PlanCourse.plan_id.in_(plan_ids),
                Course.organization_id.is_(None),
            )
            .order_by(Course.price_minor, Course.title)
        )
    ).all():
        members.setdefault(plan_id, []).append(
            PlanCourseRow(
                id=course.id,
                title=course.title,
                price_minor=course.price_minor,
                is_published=course.is_published,
            )
        )

    catalogue_size = (
        await session.scalar(
            select(func.count(Course.id)).where(
                Course.is_published.is_(True), Course.organization_id.is_(None)
            )
        )
    ) or 0

    now = datetime.now(UTC)
    live_counts = dict(
        (
            await session.execute(
                select(Subscription.plan_id, func.count())
                .where(
                    Subscription.plan_id.in_(plan_ids),
                    Subscription.status.in_(LIVE_STATUSES),
                    Subscription.current_period_end > now,
                )
                .group_by(Subscription.plan_id)
            )
        ).all()
    )
    total_counts = dict(
        (
            await session.execute(
                select(Subscription.plan_id, func.count())
                .where(Subscription.plan_id.in_(plan_ids))
                .group_by(Subscription.plan_id)
            )
        ).all()
    )

    # Money. Gross counts everything ever paid INCLUDING orders since refunded,
    # and `refunded` is the amount actually returned — the same basis the
    # revenue dashboard uses, so the two screens reconcile.
    money: dict[uuid.UUID, tuple[int, int, int]] = {}
    for plan_id, orders, gross, refunded in (
        await session.execute(
            select(
                Order.plan_id,
                func.count(),
                func.coalesce(func.sum(Order.amount_minor), 0),
                func.coalesce(func.sum(Order.refunded_amount_minor), 0),
            )
            .where(
                Order.plan_id.in_(plan_ids),
                Order.status.in_([OrderStatus.PAID, OrderStatus.REFUNDED]),
            )
            .group_by(Order.plan_id)
        )
    ).all():
        money[plan_id] = (int(orders), int(gross), int(refunded))

    summaries: list[PlanSummary] = []
    for plan in plans:
        courses = members.get(plan.id, [])
        # Compared on PUBLISHED members. Counting every link set drafts against
        # a published-only catalogue, so a plan missing live courses could
        # still read as covering everything if it held enough drafts.
        published = sum(1 for row in courses if row.is_published)
        orders, gross, refunded = money.get(plan.id, (0, 0, 0))
        summaries.append(
            PlanSummary(
                id=plan.id,
                name=plan.name,
                description=plan.description,
                price_minor=plan.price_minor,
                currency=plan.currency,
                billing_interval=plan.billing_interval.value,
                is_active=plan.is_active,
                created_at=plan.created_at,
                courses=courses,
                covers_everything=plan.all_access
                or (catalogue_size > 0 and published >= catalogue_size),
                all_access=plan.all_access,
                separate_total_minor=sum(row.price_minor for row in courses),
                active_subscribers=int(live_counts.get(plan.id, 0)),
                total_subscribers=int(total_counts.get(plan.id, 0)),
                paid_orders=orders,
                gross_minor=gross,
                refunded_minor=refunded,
            )
        )
    return summaries


async def holders_of(session: AsyncSession, plan_id: uuid.UUID) -> list[PlanHolder]:
    """Who bought this bundle, and where each of them stands.

    Built from `subscriptions` — the thing that grants access — with the money
    joined on from `orders`. Somebody with a paid order and no subscription row
    would be a fulfilment failure, so they are included too rather than quietly
    dropped: that is exactly the case an owner needs to see.
    """
    now = datetime.now(UTC)

    paid_by_user: dict[uuid.UUID, tuple[int, int]] = {
        user_id: (int(total), int(count))
        for user_id, total, count in (
            await session.execute(
                select(
                    Order.user_id,
                    func.coalesce(func.sum(Order.amount_minor), 0),
                    func.count(),
                )
                .where(Order.plan_id == plan_id, Order.status == OrderStatus.PAID)
                .group_by(Order.user_id)
            )
        ).all()
    }

    holders: list[PlanHolder] = []
    seen: set[uuid.UUID] = set()

    for subscription, user in (
        await session.execute(
            select(Subscription, User)
            .join(User, User.id == Subscription.user_id)
            .where(Subscription.plan_id == plan_id)
            .order_by(Subscription.created_at.desc())
        )
    ).all():
        seen.add(user.id)
        paid, orders = paid_by_user.get(user.id, (0, 0))
        holders.append(
            PlanHolder(
                user_id=user.id,
                name=user.name,
                email=user.email,
                status=subscription.status.value,
                started_at=subscription.started_at,
                period_end=subscription.current_period_end,
                cancelled=subscription.cancelled_at is not None,
                live=(
                    subscription.status in LIVE_STATUSES
                    and subscription.current_period_end > now
                ),
                paid_minor=paid,
                orders=orders,
            )
        )

    # PAID BUT NOT SUBSCRIBED. Money taken and nothing granted — the exact
    # shape of the webhook bug that took a payment and never called
    # `fulfil_plan_order`. Surfaced rather than hidden, because the only way
    # anybody finds this class of failure is by looking.
    missing = [user_id for user_id in paid_by_user if user_id not in seen]
    if missing:
        for user in (
            await session.scalars(select(User).where(User.id.in_(missing)))
        ).all():
            paid, orders = paid_by_user[user.id]
            holders.append(
                PlanHolder(
                    user_id=user.id,
                    name=user.name,
                    email=user.email,
                    status="paid_not_granted",
                    started_at=None,
                    period_end=None,
                    cancelled=False,
                    live=False,
                    paid_minor=paid,
                    orders=orders,
                )
            )

    return holders


async def _apply_courses(
    session: AsyncSession, plan: SubscriptionPlan, course_ids: list[uuid.UUID]
) -> None:
    """Make the plan cover exactly these courses.

    Adds and REMOVES, because a bundle edited to drop a course must actually
    stop unlocking it — `plan_courses` is what grants the access, so a row left
    behind keeps the course open to every subscriber while the screen says it
    was removed.
    """
    wanted = set(course_ids)
    if wanted:
        found = set(
            (
                await session.scalars(select(Course.id).where(Course.id.in_(wanted)))
            ).all()
        )
        unknown = wanted - found
        if unknown:
            raise PlanError("One of those courses does not exist.")

    existing = set(
        (
            await session.scalars(
                select(PlanCourse.course_id).where(PlanCourse.plan_id == plan.id)
            )
        ).all()
    )

    for course_id in wanted - existing:
        session.add(PlanCourse(plan_id=plan.id, course_id=course_id))
    for course_id in existing - wanted:
        link = await session.get(PlanCourse, (plan.id, course_id))
        if link is not None:
            await session.delete(link)


async def _assert_price_buys_something(
    session: AsyncSession, plan: SubscriptionPlan
) -> None:
    """Refuse a price on a bundle whose every course is already free.

    Free courses are open to every signed-in student, so a bundle made only of
    them sells nothing: students reached its courses without paying, and the
    bundle page said "You have this" to people who had never bought it. A
    tester read that as the price not being enforced. The honest fix is not to
    take money for it, so the bundle has to hold a paid course or cost nothing.
    """
    if plan.price_minor <= 0:
        return
    await session.flush()
    total, paid = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(Course.price_minor > 0),
            )
            .select_from(PlanCourse)
            .join(Course, Course.id == PlanCourse.course_id)
            .where(PlanCourse.plan_id == plan.id)
        )
    ).one()
    if total and not paid:
        raise PlanError(
            "Every course in this bundle is already free, so the bundle cannot "
            "have a price. Add a paid course, or set the price to 0."
        )


async def fill_all_access(
    session: AsyncSession, plan_ids: list[uuid.UUID] | None = None
) -> None:
    """Link every public course to every All Access plan that lacks it.

    One INSERT ... SELECT, and a no-op when nothing is missing, so it is safe to
    call whenever a public course is created or a plan is saved as All Access.
    Drafts are linked too: a course published later is then already in, with
    no second hook to forget. Organisation courses never are; they belong to a
    customer. Does not commit.
    """
    # Pending changes first, so a plan flagged in this same transaction is seen.
    await session.flush()
    missing = (
        select(SubscriptionPlan.id, Course.id)
        .select_from(SubscriptionPlan)
        .join(Course, true())
        .where(
            SubscriptionPlan.all_access.is_(True),
            Course.organization_id.is_(None),
        )
    )
    if plan_ids is not None:
        missing = missing.where(SubscriptionPlan.id.in_(plan_ids))
    await session.execute(
        pg_insert(PlanCourse)
        .from_select(["plan_id", "course_id"], missing)
        .on_conflict_do_nothing()
    )


async def create_plan(
    session: AsyncSession,
    *,
    name: str,
    description: str | None,
    price_minor: int,
    currency: str,
    billing_interval: BillingInterval,
    course_ids: list[uuid.UUID],
    is_active: bool = True,
    all_access: bool = False,
) -> SubscriptionPlan:
    """Add a bundle. Does not commit — the caller owns the transaction."""
    clean = name.strip()
    if not clean:
        raise PlanError("A bundle needs a name.")

    clash = await session.scalar(
        select(SubscriptionPlan.id).where(SubscriptionPlan.name == clean)
    )
    if clash is not None:
        raise PlanError("A bundle with that name already exists.")

    plan = SubscriptionPlan(
        name=clean,
        description=(description or "").strip() or None,
        price_minor=price_minor,
        currency=currency.upper(),
        billing_interval=billing_interval,
        is_active=is_active,
        all_access=all_access,
    )
    session.add(plan)
    # Flushed rather than committed: `plan_courses` needs the id, and the whole
    # thing should still fail as one if a course id turns out to be wrong.
    await session.flush()
    await _apply_courses(session, plan, course_ids)
    if plan.all_access:
        await fill_all_access(session, [plan.id])
    await _assert_price_buys_something(session, plan)
    return plan


async def update_plan(
    session: AsyncSession,
    plan: SubscriptionPlan,
    *,
    changes: dict,
    course_ids: list[uuid.UUID] | None,
) -> SubscriptionPlan:
    """Change a bundle. Does not commit.

    `course_ids` of None leaves the membership alone; a list replaces it.
    """
    before = await _course_ids_of(session, plan.id)

    if "name" in changes:
        clean = str(changes["name"]).strip()
        if not clean:
            raise PlanError("A bundle needs a name.")
        clash = await session.scalar(
            select(SubscriptionPlan.id).where(
                SubscriptionPlan.name == clean, SubscriptionPlan.id != plan.id
            )
        )
        if clash is not None:
            raise PlanError("A bundle with that name already exists.")
        changes["name"] = clean

    if "description" in changes:
        description = changes["description"]
        changes["description"] = (description or "").strip() or None

    if changes.get("currency"):
        changes["currency"] = str(changes["currency"]).upper()

    # An explicit null would write NULL into a NOT NULL column.
    if "all_access" in changes and changes["all_access"] is None:
        del changes["all_access"]

    for attribute, value in changes.items():
        setattr(plan, attribute, value)

    if course_ids is not None:
        await _apply_courses(session, plan, course_ids)

    # Last, so it wins: while a plan is All Access its list is every public
    # course, and a course unticked in the same save comes straight back.
    if plan.all_access:
        await fill_all_access(session, [plan.id])

    await _assert_price_buys_something(session, plan)

    # WHAT WAS ADDED reaches the people who already hold the bundle. Only the
    # new courses: re-enrolling the whole plan on every save would put back a
    # course somebody had chosen to leave.
    from app.services import payments

    added = await _course_ids_of(session, plan.id) - before
    await payments.enrol_holders(session, added)
    return plan


async def _course_ids_of(session: AsyncSession, plan_id: uuid.UUID) -> set[uuid.UUID]:
    await session.flush()
    return set(
        (
            await session.scalars(
                select(PlanCourse.course_id).where(PlanCourse.plan_id == plan_id)
            )
        ).all()
    )
