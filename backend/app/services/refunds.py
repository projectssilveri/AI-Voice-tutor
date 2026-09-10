"""What a student is owed back, and how far through the course they got.

THE PUBLISHED POLICY, IN ONE PLACE. The tiers below are the same ones printed
on /terms:

    under 25% of the course   -> all of it back
    25% up to 50%             -> half back
    50% or more               -> nothing

`frontend/src/app/(marketing)/terms/page.tsx` states these in words for the
customer; this file is what support's screen computes with. They are pinned to
each other by a test, the same way `extensions.DAYS_PER_MODULE` is pinned to
the migration that used it — two copies of a rule drift, and when the rule is
about money the drift is the difference between what was promised and what was
paid.

MONEY IS INTEGER MINOR UNITS THROUGHOUT, and the fractions are exact rationals
rather than floats. Half of ₹1,799 is 89,950 paise exactly; half of an odd
number of paise is not an integer at all, and `0.5 * amount` in binary floating
point is the wrong tool for deciding what somebody is owed.

Where a half does not divide evenly the extra paisa goes to the CUSTOMER. It is
one hundredth of a rupee and it is not worth an argument, and rounding a refund
down in our own favour is the kind of small meanness that ends up in a review.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course, Module
from app.models.enrollment import ModuleProgress, ProgressStatus
from app.models.order import Order, OrderStatus
from app.models.user import User


@dataclass(frozen=True)
class Tier:
    """One band of the policy."""

    #: Stable identifier for the UI. Never shown to a person.
    key: str
    #: What support and the customer both read.
    label: str
    #: Highest progress this tier covers, exclusive. None means "and above".
    below_percent: int | None
    #: The share returned, as an exact fraction.
    numerator: int
    denominator: int

    def amount_for(self, paid_minor: int) -> int:
        """The refund on an order of this size, in minor units.

        Ceiling division, so a half that does not divide evenly rounds towards
        the customer. `paid * n / d` with integers only — no float ever touches
        a figure somebody is owed.
        """
        if self.numerator == 0:
            return 0
        total = paid_minor * self.numerator
        return -(-total // self.denominator)


#: In reading order: least progress first, which is how /terms lists them.
TIERS: tuple[Tier, ...] = (
    Tier("full", "Full refund", 25, 1, 1),
    Tier("half", "Half back", 50, 1, 2),
    Tier("none", "No refund", None, 0, 1),
)


def tier_for(percent_complete: int) -> Tier:
    """Which band a given progress falls in.

    The boundaries are the ones the page states: 25% exactly is already out of
    the full-refund band, and 50% exactly is already out of the half band. A
    policy that says "under 25%" has to mean under, or the two readings differ
    by a whole tier for the student sitting exactly on the line.
    """
    for tier in TIERS:
        if tier.below_percent is None or percent_complete < tier.below_percent:
            return tier
    return TIERS[-1]  # Unreachable: the last tier has no upper bound.


@dataclass(frozen=True)
class Progress:
    completed_modules: int
    total_modules: int

    @property
    def percent(self) -> int:
        """Modules complete over modules in the course, as a whole percent.

        THE SAME ARITHMETIC THE STUDENT SEES on their dashboard — `enrollments`
        rounds the same way — because /terms tells them they can check it
        themselves before writing in. A support screen quoting a different
        number from the one on the customer's own dashboard turns a refund into
        an argument.

        A course with no modules yet reads as 0%: nothing has been consumed, so
        nothing has been used up.
        """
        if self.total_modules == 0:
            return 0
        return round(self.completed_modules / self.total_modules * 100)


@dataclass(frozen=True)
class RefundQuote:
    """One paid order, how far through it the student is, and what that is worth."""

    order_id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    user_email: str
    course_id: uuid.UUID | None
    course_title: str
    plan_id: uuid.UUID | None
    amount_minor: int
    currency: str
    paid_at: datetime | None
    progress: Progress
    tier: Tier
    #: What the policy gives back. Zero in the top band, and on a subscription,
    #: where the policy deliberately says nothing (see `covered_by_policy`).
    refund_minor: int
    #: Already refunded, if it has been. None means it has not.
    refunded_amount_minor: int | None
    refunded_at: datetime | None
    status: str

    @property
    def covered_by_policy(self) -> bool:
        """Whether the tiers actually decide this one.

        A bundle or All Access order opens several courses at once, so there is
        no single "how far through" for it, and /terms says so rather than
        stretching the rule to fit. Support is shown the order and told the
        policy does not cover it — which is the honest prompt to go and ask,
        not a zero dressed up as a decision.
        """
        return self.course_id is not None


async def progress_for(
    session: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> Progress:
    """How far one student got through one course.

    Counts COMPLETED modules only. In-progress does not count: /terms says
    opening a module is not using it up, and a student who started module four
    and stopped has consumed three.
    """
    total = (
        await session.scalar(
            select(func.count(Module.id)).where(Module.course_id == course_id)
        )
    ) or 0
    completed = (
        await session.scalar(
            # `count()`, not `count(ModuleProgress.id)`: the table has a
            # COMPOSITE primary key of (user_id, module_id) and no `id` column
            # at all, so naming one is an AttributeError at query-build time.
            select(func.count())
            .select_from(ModuleProgress)
            .join(Module, Module.id == ModuleProgress.module_id)
            .where(
                Module.course_id == course_id,
                ModuleProgress.user_id == user_id,
                ModuleProgress.status == ProgressStatus.COMPLETED,
            )
        )
    ) or 0
    # Defensive: a module deleted after a student completed it would otherwise
    # let `completed` exceed `total` and quote a refund over 100%.
    return Progress(completed_modules=min(completed, total), total_modules=total)


async def quotes_for(
    session: AsyncSession, *, search: str | None = None, limit: int = 50
) -> list[RefundQuote]:
    """Every order a refund could be asked about, newest first.

    `search` matches an email or a name, case-insensitively and partially,
    because support arrives holding whatever the customer put in the ticket.
    Empty means the most recent orders, so the screen is useful before anybody
    has typed anything.

    PAID AND ALREADY-REFUNDED BOTH, deliberately. A refunded order is the one
    support most often needs to look at again — "did we already do this, and
    for how much" — and hiding it would send them to the database.

    A fixed number of queries: the orders, then the module totals and the
    progress counts for every course involved, grouped. Walking the orders and
    asking per course is the N+1 this codebase has already been bitten by
    twice.
    """
    conditions = [Order.status.in_([OrderStatus.PAID, OrderStatus.REFUNDED])]
    if search and search.strip():
        needle = f"%{search.strip().lower()}%"
        conditions.append(
            func.lower(User.email).like(needle) | func.lower(User.name).like(needle)
        )

    rows = (
        await session.execute(
            select(Order, User, Course)
            .join(User, User.id == Order.user_id)
            .outerjoin(Course, Course.id == Order.course_id)
            .where(*conditions)
            .order_by(Order.paid_at.desc().nullslast(), Order.created_at.desc())
            .limit(limit)
        )
    ).all()
    if not rows:
        return []

    course_ids = [order.course_id for order, _, _ in rows if order.course_id]
    user_ids = [order.user_id for order, _, _ in rows]

    totals: dict[uuid.UUID, int] = {}
    completed: dict[tuple[uuid.UUID, uuid.UUID], int] = {}

    if course_ids:
        totals = dict(
            (
                await session.execute(
                    select(Module.course_id, func.count(Module.id))
                    .where(Module.course_id.in_(course_ids))
                    .group_by(Module.course_id)
                )
            ).all()
        )
        # Keyed by (user, course): two different students can appear in the
        # same list, and a per-course count would quote one of them the
        # other's progress.
        completed = {
            (user_id, course_id): count
            for user_id, course_id, count in (
                await session.execute(
                    select(
                        ModuleProgress.user_id,
                        Module.course_id,
                        # Composite primary key; there is no `id` to count.
                        func.count(),
                    )
                    .select_from(ModuleProgress)
                    .join(Module, Module.id == ModuleProgress.module_id)
                    .where(
                        Module.course_id.in_(course_ids),
                        ModuleProgress.user_id.in_(user_ids),
                        ModuleProgress.status == ProgressStatus.COMPLETED,
                    )
                    .group_by(ModuleProgress.user_id, Module.course_id)
                )
            ).all()
        }

    quotes: list[RefundQuote] = []
    for order, user, course in rows:
        total_modules = totals.get(order.course_id, 0) if order.course_id else 0
        done = (
            min(completed.get((order.user_id, order.course_id), 0), total_modules)
            if order.course_id
            else 0
        )
        progress = Progress(completed_modules=done, total_modules=total_modules)
        tier = tier_for(progress.percent)

        quotes.append(
            RefundQuote(
                order_id=order.id,
                user_id=user.id,
                user_name=user.name,
                user_email=user.email,
                course_id=order.course_id,
                course_title=(
                    course.title
                    if course is not None
                    # A plan order names no course. Said plainly rather than
                    # left blank, so the row does not look like broken data.
                    else "Bundle or All Access subscription"
                ),
                plan_id=order.plan_id,
                amount_minor=order.amount_minor,
                currency=order.currency,
                paid_at=order.paid_at,
                progress=progress,
                tier=tier,
                refund_minor=(
                    tier.amount_for(order.amount_minor) if order.course_id else 0
                ),
                refunded_amount_minor=order.refunded_amount_minor,
                refunded_at=order.refunded_at,
                status=order.status.value,
            )
        )
    return quotes


async def quote_for_order(session: AsyncSession, order: Order) -> RefundQuote:
    """The same quote as in the list, for one order already in hand.

    Used after recording a refund, to hand the screen back the row it just
    changed. Doing that by re-running the list and searching it for the id was
    a page-size bug waiting to happen — the row would simply be missing once
    the order fell past the limit.
    """
    user = await session.get(User, order.user_id)
    course = (
        await session.get(Course, order.course_id)
        if order.course_id is not None
        else None
    )
    progress = (
        await progress_for(session, order.user_id, order.course_id)
        if order.course_id is not None
        else Progress(completed_modules=0, total_modules=0)
    )
    tier = tier_for(progress.percent)

    return RefundQuote(
        order_id=order.id,
        user_id=order.user_id,
        user_name=user.name if user else "",
        user_email=user.email if user else "",
        course_id=order.course_id,
        course_title=(
            course.title
            if course is not None
            else "Bundle or All Access subscription"
        ),
        plan_id=order.plan_id,
        amount_minor=order.amount_minor,
        currency=order.currency,
        paid_at=order.paid_at,
        progress=progress,
        tier=tier,
        refund_minor=(
            tier.amount_for(order.amount_minor) if order.course_id else 0
        ),
        refunded_amount_minor=order.refunded_amount_minor,
        refunded_at=order.refunded_at,
        status=order.status.value,
    )


class RefundError(ValueError):
    """The refund cannot be recorded as asked."""


async def record_refund(
    session: AsyncSession, *, order: Order, amount_minor: int
) -> Order:
    """Mark an order refunded for a given amount.

    RECORDS A REFUND; IT DOES NOT MAKE ONE. No money moves from here: Razorpay's
    refund API is not called, and deliberately — moving customer money on a
    button press is a different decision from writing down that it moved, and
    the second is what the product actually needs. Access is withdrawn the
    moment `status` leaves PAID, because `services/access.py` grants on PAID
    and nothing else, so this is the half that stops a refunded student keeping
    the course.

    Does not commit: the caller owns the transaction so the change and its
    audit record land together.
    """
    if order.status is OrderStatus.REFUNDED:
        raise RefundError("This order has already been refunded.")
    if order.status is not OrderStatus.PAID:
        raise RefundError("Only a paid order can be refunded.")
    if amount_minor < 0:
        raise RefundError("A refund cannot be negative.")
    if amount_minor > order.amount_minor:
        raise RefundError("A refund cannot be more than was paid.")

    order.status = OrderStatus.REFUNDED
    order.refunded_amount_minor = amount_minor
    order.refunded_at = datetime.now(tz=UTC)
    return order

