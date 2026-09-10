"""Extending how long somebody keeps a course.

A grant, not an edit. `access_extensions` records who gave the extension, when,
and why — modelled on `attempt_grants` (decision 24) for the same reason: "who
gave this student another three months" is asked afterwards, and a mutable
expiry column cannot answer it.

EXTENSIONS ACCUMULATE, THEY DO NOT REPLACE. The effective expiry is the LATEST
of what the purchase gave them and every grant since, so an admin who types a
shorter date by mistake cannot take time away that somebody already had.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profile import AccessExtension
from app.models.subscription import PlanCourse


async def latest_for_course(
    session: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> datetime | None:
    """The furthest-out extension covering this course, or None.

    Covers both shapes of grant: one aimed at the course directly, and one aimed
    at a plan that includes it. A customer extended at the plan level should not
    have to be extended again per course.
    """
    direct = await session.scalar(
        select(func.max(AccessExtension.extends_to)).where(
            AccessExtension.user_id == user_id,
            AccessExtension.course_id == course_id,
        )
    )
    via_plan = await session.scalar(
        select(func.max(AccessExtension.extends_to))
        .join(PlanCourse, PlanCourse.plan_id == AccessExtension.plan_id)
        .where(
            AccessExtension.user_id == user_id,
            PlanCourse.course_id == course_id,
        )
    )

    candidates = [value for value in (direct, via_plan) if value is not None]
    return max(candidates) if candidates else None


async def latest_for_courses(
    session: AsyncSession, user_id: uuid.UUID, course_ids: list[uuid.UUID]
) -> dict[uuid.UUID, datetime]:
    """The same thing for a whole list, in two queries rather than 2N.

    Used by the course LIST, which would otherwise issue a pair of queries per
    enrolment — the N+1 rule of decisions 29 and 45.
    """
    if not course_ids:
        return {}

    found: dict[uuid.UUID, datetime] = {}

    for course_id, extends_to in (
        await session.execute(
            select(AccessExtension.course_id, func.max(AccessExtension.extends_to))
            .where(
                AccessExtension.user_id == user_id,
                AccessExtension.course_id.in_(course_ids),
            )
            .group_by(AccessExtension.course_id)
        )
    ).all():
        found[course_id] = extends_to

    for course_id, extends_to in (
        await session.execute(
            select(PlanCourse.course_id, func.max(AccessExtension.extends_to))
            .join(AccessExtension, AccessExtension.plan_id == PlanCourse.plan_id)
            .where(
                AccessExtension.user_id == user_id,
                PlanCourse.course_id.in_(course_ids),
            )
            .group_by(PlanCourse.course_id)
        )
    ).all():
        existing = found.get(course_id)
        if existing is None or extends_to > existing:
            found[course_id] = extends_to

    return found


def apply(expires_at: datetime | None, extension: datetime | None) -> datetime | None:
    """Combine a purchase's expiry with any extension.

    None on either side means "no end", and no end always wins: an outright
    purchase does not become time-limited because somebody was also granted an
    extension, and an extension does not shorten a subscription that runs
    longer.
    """
    if expires_at is None:
        return None
    if extension is None:
        return expires_at
    return max(expires_at, extension)


#: Days of access earned per module. A three-module course is not worth the
#: same window as a twelve-module one, so the length of the course sets the
#: length of the entitlement. Mirrored in migration 0016, which cannot import
#: this module — a test pins the two together.
DAYS_PER_MODULE = 15

#: Nobody gets less than a month, however short the course. Somebody who buys
#: on a Friday and then travels for a fortnight has not bought anything.
MINIMUM_DAYS = 30


def suggested_days(module_count: int) -> int:
    """How long a purchase of a course this size should last.

    The default the admin screen offers and the migration backfilled with. It
    is a SUGGESTION: `courses.access_days` is what actually applies, so an
    author can price a short intensive course differently from a long one
    without arguing with a formula.
    """
    return max(MINIMUM_DAYS, DAYS_PER_MODULE * max(module_count, 0))


def expiry_for_purchase(paid_at: datetime, access_days: int | None) -> datetime | None:
    """When a purchase runs out. None means it never does.

    NULL `access_days` is the old rule — bought outright, kept for good — and
    it is deliberately still reachable: a course sold on those terms must keep
    them (migration 0016 grandfathers every purchase that existed at the time).
    """
    if not access_days:
        return None
    return paid_at + timedelta(days=access_days)


def resolve(
    *,
    price_minor: int,
    paid_at: datetime | None,
    subscription_started: datetime | None,
    subscription_ends: datetime | None,
    granted_until: datetime | None,
    access_days: int | None = None,
) -> tuple[datetime | None, datetime | None, str]:
    """The ONE rule for when access started, when it ends, and how it is held.

    Both callers use this — the course list and the course page — because they
    were computing it separately and had already diverged: a granted extension
    on a free course made the page say "expires 23 Nov, granted" while the list
    beside it said "never, free". Decision 201 exists precisely to stop two
    screens telling a student different dates, and two implementations of one
    rule is how that happens no matter how carefully each is written.

    The rule, in order:

      * A bought course runs for the window the course carries, and a grant
        extends it — the grant never SHORTENS, so `apply` takes the later of
        the two. A course with no window set is the older "bought outright"
        rule and still never expires, which is what grandfathers the purchases
        made before courses had one.
      * A subscription ends when it ends, or when a grant says, whichever is
        later. A grant never shortens.
      * A free course never expires either, so a grant is equally moot.
      * Otherwise they hold it only because somebody enrolled them, and a grant
        is the thing giving them a real end date — an extended trial.

    Returns (purchased_at, expires_at, access_via).
    """
    if paid_at is not None:
        return (
            paid_at,
            apply(expiry_for_purchase(paid_at, access_days), granted_until),
            "purchase",
        )

    if subscription_started is not None:
        return (
            subscription_started,
            apply(subscription_ends, granted_until),
            "subscription",
        )

    if not price_minor:
        return None, None, "free"

    if granted_until is not None:
        return None, granted_until, "granted"

    return None, None, "enrolled"
