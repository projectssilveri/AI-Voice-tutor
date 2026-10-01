"""What a student's subscriptions actually give them.

A subscription row says which plan somebody holds and until when. That is not
what a learner wants to see. They bought "the Java stack" and want the four
courses in it, with their progress on each — so this assembles that view once,
here, rather than leaving the dashboard to fetch a plan, then its course links,
then a course, then its modules, then their progress, one call at a time.

TWO RULES THIS FILE KEEPS.

  * ACTIVE MEANS LIVE. A cancelled subscription still runs until its period
    ends, and an 'active' row whose period has passed does not grant anything.
    Both halves are checked, exactly as `access.subscription_covers_course`
    checks them — a bundle listed on the dashboard that the paywall then
    refuses would be worse than not listing it.

  * PUBLIC COURSES ONLY. Marketplace plans are a public-catalogue thing; an
    organization's learner has no marketplace (decision 178). The filter is
    here as well as in `access.accessible_course_ids` because a listing that
    disagrees with the paywall is the failure this codebase has hit before.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course, Module
from app.models.enrollment import Enrollment, ModuleProgress, ProgressStatus
from app.models.subscription import (
    PlanCourse,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
)
from app.models.user import User

#: Statuses that still grant access. Trialing counts; past due, cancelled and
#: expired do not — a cancelled subscription is handled by its period end,
#: which is checked separately.
LIVE_STATUSES = (SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING)


@dataclass(slots=True)
class BundleCourse:
    """One course inside a bundle, with this student's progress on it."""

    course: Course
    total_modules: int = 0
    completed_modules: int = 0
    in_progress_modules: int = 0
    #: Whether they have started it. A bundle unlocks a course; enrolling is
    #: still a separate act, and the dashboard says "Start" rather than
    #: "Continue" when they have not.
    enrolled: bool = False

    @property
    def percent_complete(self) -> int:
        if self.total_modules == 0:
            return 0
        return round(self.completed_modules / self.total_modules * 100)


@dataclass(slots=True)
class HeldPlan:
    """A subscription the student holds, and everything it opens."""

    subscription_id: uuid.UUID
    plan_id: uuid.UUID
    name: str
    description: str | None
    price_minor: int
    currency: str
    billing_interval: str
    status: str
    started_at: datetime
    renews_at: datetime
    cancelled: bool
    #: True when the plan covers the whole public catalogue. Derived by
    #: counting rather than stored, so it cannot disagree with the course links
    #: that actually grant the access.
    covers_everything: bool
    courses: list[BundleCourse] = field(default_factory=list)

    @property
    def completed_courses(self) -> int:
        return sum(
            1
            for row in self.courses
            if row.total_modules > 0 and row.completed_modules >= row.total_modules
        )


async def public_course_count(session: AsyncSession) -> int:
    """How many published marketplace courses exist.

    The denominator for "does this plan cover everything". Counted, not
    configured — a new course published tomorrow turns an all-access plan back
    into a bundle if its links were never updated, which is the truth and worth
    seeing.
    """
    return (
        await session.scalar(
            select(func.count(Course.id)).where(
                Course.is_published.is_(True),
                Course.organization_id.is_(None),
            )
        )
    ) or 0


async def list_held_plans(session: AsyncSession, user: User) -> list[HeldPlan]:
    """Every live subscription this student holds, with its courses.

    A fixed number of queries regardless of how many plans or courses are
    involved: the plans, their courses, the module totals, the progress rows,
    and the enrolments. The obvious version of this — walk the plans, then walk
    each plan's courses — is the N+1 that decisions 29 and 45 already caught
    twice.
    """
    # An organization's learner has no marketplace to subscribe to. Returning
    # their employer's courses under a "bundle" heading would be inventing a
    # purchase that never happened.
    if user.organization_id is not None:
        return []

    now = datetime.now(UTC)

    rows = (
        await session.execute(
            select(Subscription, SubscriptionPlan)
            .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
            .where(
                Subscription.user_id == user.id,
                Subscription.status.in_(LIVE_STATUSES),
                Subscription.current_period_end > now,
            )
            .order_by(SubscriptionPlan.price_minor)
        )
    ).all()
    if not rows:
        return []

    plan_ids = [plan.id for _, plan in rows]

    # Which courses each plan opens. Published public courses only, for the
    # reason in the module docstring.
    links = (
        await session.execute(
            select(PlanCourse.plan_id, Course)
            .join(Course, Course.id == PlanCourse.course_id)
            .where(
                PlanCourse.plan_id.in_(plan_ids),
                Course.is_published.is_(True),
                Course.organization_id.is_(None),
            )
            .order_by(Course.price_minor, Course.title)
        )
    ).all()

    courses_by_plan: dict[uuid.UUID, list[Course]] = {}
    for plan_id, course in links:
        courses_by_plan.setdefault(plan_id, []).append(course)

    course_ids = {course.id for _, course in links}

    totals: dict[uuid.UUID, int] = {}
    completed: dict[uuid.UUID, int] = {}
    started: dict[uuid.UUID, int] = {}
    enrolled: set[uuid.UUID] = set()

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

        for course_id, status, count in (
            await session.execute(
                select(Module.course_id, ModuleProgress.status, func.count())
                .join(ModuleProgress, ModuleProgress.module_id == Module.id)
                .where(
                    Module.course_id.in_(course_ids),
                    ModuleProgress.user_id == user.id,
                )
                .group_by(Module.course_id, ModuleProgress.status)
            )
        ).all():
            if status is ProgressStatus.COMPLETED:
                completed[course_id] = completed.get(course_id, 0) + count
            elif status is ProgressStatus.IN_PROGRESS:
                started[course_id] = started.get(course_id, 0) + count

        enrolled = set(
            (
                await session.scalars(
                    select(Enrollment.course_id).where(
                        Enrollment.user_id == user.id,
                        Enrollment.course_id.in_(course_ids),
                    )
                )
            ).all()
        )

    catalogue_size = await public_course_count(session)

    held: list[HeldPlan] = []
    for subscription, plan in rows:
        members = courses_by_plan.get(plan.id, [])
        held.append(
            HeldPlan(
                subscription_id=subscription.id,
                plan_id=plan.id,
                name=plan.name,
                description=plan.description,
                price_minor=plan.price_minor,
                currency=plan.currency,
                billing_interval=plan.billing_interval.value,
                status=subscription.status.value,
                started_at=subscription.started_at,
                renews_at=subscription.current_period_end,
                # Cancelled but not yet expired: they keep it until the period
                # ends, and saying "renews" would be a lie.
                cancelled=subscription.cancelled_at is not None,
                covers_everything=plan.all_access
                or (catalogue_size > 0 and len(members) >= catalogue_size),
                courses=[
                    BundleCourse(
                        course=course,
                        total_modules=totals.get(course.id, 0),
                        completed_modules=completed.get(course.id, 0),
                        in_progress_modules=started.get(course.id, 0),
                        enrolled=course.id in enrolled,
                    )
                    for course in members
                ],
            )
        )
    return held
