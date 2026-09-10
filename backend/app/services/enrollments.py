"""Enrollment and progress logic.

Enrollment is student-initiated: a student enrols themselves from the course
page. The brief left this open; self-service is chosen because it is the
smaller change and an admin-assign route can be added later without altering
the schema.

Enrollment governs progress tracking and the voice tutor. It deliberately does
NOT gate reading course material — the spec is explicit that content can be
read without limit.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.course import Course, Module
from app.models.enrollment import Enrollment, ModuleProgress, ProgressStatus
from app.models.order import Order, OrderStatus
from app.models.subscription import PlanCourse, Subscription, SubscriptionStatus
from app.services import extensions as extension_service


class AlreadyEnrolledError(ValueError):
    pass


class NotEnrolledError(LookupError):
    pass


@dataclass(slots=True)
class CourseProgress:
    course: Course
    total_modules: int
    completed_modules: int
    in_progress_modules: int

    #: When they enrolled. Not the same as when they bought it — an admin can
    #: enrol somebody in a free course they never paid for.
    enrolled_at: datetime | None = None
    #: When they paid, if they did. None for a free course or a plain enrolment.
    purchased_at: datetime | None = None
    #: When access runs out. None on an outright purchase is not "unknown" —
    #: it genuinely never expires, and the UI says so in words.
    expires_at: datetime | None = None
    #: purchase | subscription | free | enrolled
    access_via: str = "enrolled"

    @property
    def percent_complete(self) -> int:
        if self.total_modules == 0:
            return 0
        return round(self.completed_modules / self.total_modules * 100)


@dataclass(slots=True)
class DashboardSummary:
    courses_enrolled: int
    modules_completed: int
    voice_seconds: int
    last_session_at: object | None


async def is_enrolled(
    session: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> bool:
    result = await session.execute(
        select(Enrollment.id).where(
            Enrollment.user_id == user_id, Enrollment.course_id == course_id
        )
    )
    return result.scalar_one_or_none() is not None


async def enroll(
    session: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> Enrollment:
    enrollment = Enrollment(user_id=user_id, course_id=course_id)
    session.add(enrollment)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        # uq_enrollments_user_course. Caught rather than pre-checked: a
        # SELECT-then-INSERT still races a double-click.
        raise AlreadyEnrolledError("Already enrolled in this course.") from exc
    await session.refresh(enrollment)
    return enrollment


async def unenroll(
    session: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> None:
    result = await session.execute(
        select(Enrollment).where(
            Enrollment.user_id == user_id, Enrollment.course_id == course_id
        )
    )
    enrollment = result.scalar_one_or_none()
    if enrollment is None:
        raise NotEnrolledError(str(course_id))
    # Progress rows are intentionally left in place: re-enrolling should not
    # erase what the student already did.
    await session.delete(enrollment)
    await session.commit()


async def list_enrolled_courses(
    session: AsyncSession, user_id: uuid.UUID
) -> list[CourseProgress]:
    """Enrolled courses with per-course progress counts.

    Three grouped queries rather than one per course, so the dashboard stays a
    fixed number of round trips regardless of how many courses a student takes.
    """
    enrolled = await session.execute(
        select(Course, Enrollment.enrolled_at)
        .join(Enrollment, Enrollment.course_id == Course.id)
        .where(Enrollment.user_id == user_id)
        .order_by(Course.title)
    )
    rows = enrolled.all()
    courses = [row[0] for row in rows]
    enrolled_at_by_course = {row[0].id: row[1] for row in rows}
    if not courses:
        return []

    course_ids = [course.id for course in courses]

    # WHEN THEY BOUGHT IT AND WHEN IT RUNS OUT.
    #
    # Two different sources, because there are two ways to hold a course. An
    # outright purchase has a payment date and genuinely never expires; a
    # subscription has both a start and an end. Neither is invented — a course
    # somebody was simply enrolled in has no purchase date, and says so.
    paid = {
        row.course_id: (row.paid_at or row.created_at)
        for row in (
            await session.scalars(
                select(Order)
                .where(
                    Order.user_id == user_id,
                    Order.status == OrderStatus.PAID,
                    Order.course_id.in_(course_ids),
                )
                .order_by(Order.paid_at.desc().nullslast())
            )
        ).all()
    }

    subscribed: dict[uuid.UUID, tuple[datetime, datetime | None]] = {}
    for subscription in (
        await session.scalars(
            select(Subscription).where(
                Subscription.user_id == user_id,
                Subscription.status == SubscriptionStatus.ACTIVE,
            )
        )
    ).all():
        for course_id in (
            await session.scalars(
                select(PlanCourse.course_id).where(
                    PlanCourse.plan_id == subscription.plan_id,
                    PlanCourse.course_id.in_(course_ids),
                )
            )
        ).all():
            subscribed.setdefault(
                course_id,
                (subscription.created_at, subscription.current_period_end),
            )

    totals = await session.execute(
        select(Module.course_id, func.count(Module.id))
        .where(Module.course_id.in_(course_ids))
        .group_by(Module.course_id)
    )
    total_by_course = dict(totals.all())

    progress = await session.execute(
        select(Module.course_id, ModuleProgress.status, func.count())
        .join(ModuleProgress, ModuleProgress.module_id == Module.id)
        .where(
            Module.course_id.in_(course_ids),
            ModuleProgress.user_id == user_id,
        )
        .group_by(Module.course_id, ModuleProgress.status)
    )
    completed: dict[uuid.UUID, int] = {}
    started: dict[uuid.UUID, int] = {}
    for course_id, status, count in progress.all():
        if status == ProgressStatus.COMPLETED:
            completed[course_id] = completed.get(course_id, 0) + count
        elif status == ProgressStatus.IN_PROGRESS:
            started[course_id] = started.get(course_id, 0) + count

    # Staff-granted extensions, two queries for the whole list rather than
    # a pair per course. They only ever push an expiry LATER (see
    # `extensions.apply`), so a mistyped grant cannot take time away.
    granted = await extension_service.latest_for_courses(session, user_id, course_ids)

    result: list[CourseProgress] = []
    for course in courses:
        # NOT `started` — that name is already the in-progress module counts a
        # few lines down, and shadowing it made every enrolment list 500.
        sub_started, sub_ends = subscribed.get(course.id, (None, None))
        purchased_at, expires_at, access_via = extension_service.resolve(
            price_minor=course.price_minor,
            paid_at=paid.get(course.id),
            subscription_started=sub_started,
            subscription_ends=sub_ends,
            granted_until=granted.get(course.id),
            # How long a purchase of THIS course lasts. NULL is the older
            # "bought outright" rule and still means never.
            access_days=course.access_days,
        )

        result.append(
            CourseProgress(
                course=course,
                total_modules=total_by_course.get(course.id, 0),
                completed_modules=completed.get(course.id, 0),
                in_progress_modules=started.get(course.id, 0),
                enrolled_at=enrolled_at_by_course.get(course.id),
                purchased_at=purchased_at,
                expires_at=expires_at,
                access_via=access_via,
            )
        )
    return result


async def get_module_progress(
    session: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> dict[uuid.UUID, ModuleProgress]:
    result = await session.execute(
        select(ModuleProgress)
        .join(Module, Module.id == ModuleProgress.module_id)
        .where(ModuleProgress.user_id == user_id, Module.course_id == course_id)
    )
    return {row.module_id: row for row in result.scalars().all()}


async def mark_module_started(
    session: AsyncSession, user_id: uuid.UUID, module_id: uuid.UUID
) -> ModuleProgress:
    """Upsert progress to in_progress, without demoting a completed module."""
    result = await session.execute(
        select(ModuleProgress).where(
            ModuleProgress.user_id == user_id,
            ModuleProgress.module_id == module_id,
        )
    )
    progress = result.scalar_one_or_none()

    if progress is None:
        progress = ModuleProgress(
            user_id=user_id,
            module_id=module_id,
            status=ProgressStatus.IN_PROGRESS,
        )
        session.add(progress)
    elif progress.status is ProgressStatus.NOT_STARTED:
        progress.status = ProgressStatus.IN_PROGRESS

    await session.commit()
    await session.refresh(progress)
    return progress


async def set_module_status(
    session: AsyncSession,
    user_id: uuid.UUID,
    module_id: uuid.UUID,
    status: ProgressStatus,
) -> ModuleProgress:
    """Set progress explicitly, creating the row if this is the first touch.

    Used both by the student's own "mark complete" control and by the rule
    that completes a module after a substantive tutoring session.
    """
    result = await session.execute(
        select(ModuleProgress).where(
            ModuleProgress.user_id == user_id,
            ModuleProgress.module_id == module_id,
        )
    )
    progress = result.scalar_one_or_none()

    if progress is None:
        progress = ModuleProgress(user_id=user_id, module_id=module_id, status=status)
        session.add(progress)
    else:
        progress.status = status

    await session.commit()
    await session.refresh(progress)
    return progress


async def complete_module_if_earned(
    session: AsyncSession,
    user_id: uuid.UUID,
    module_id: uuid.UUID,
    *,
    seconds_listened: float,
    tutor_turns: int,
) -> bool:
    """Mark a module complete after a real tutoring session.

    Nothing marked a module complete before this: `mark_module_started` was the
    only write, so every module a student ever opened sat at "in progress"
    forever, and course percentages never moved.

    "Real" is deliberately not "the session ended" — opening the tutor and
    closing it two seconds later must not count. It needs both a minimum
    listening time and at least one tutor turn that actually finished, so a
    session that failed to produce a lecture cannot complete anything.

    Returns whether the module was newly completed.
    """
    if seconds_listened < settings.module_complete_min_seconds:
        return False
    if tutor_turns < settings.module_complete_min_turns:
        return False

    result = await session.execute(
        select(ModuleProgress).where(
            ModuleProgress.user_id == user_id,
            ModuleProgress.module_id == module_id,
        )
    )
    progress = result.scalar_one_or_none()
    if progress is not None and progress.status is ProgressStatus.COMPLETED:
        return False

    await set_module_status(session, user_id, module_id, ProgressStatus.COMPLETED)
    return True


async def entitlement_dates(
    session: AsyncSession, user_id: uuid.UUID, course: Course
) -> tuple[datetime | None, datetime | None, str]:
    """When one course was paid for, when it runs out, and how it is held.

    The single-course version of what `list_enrolled_courses` computes in bulk.
    Two callers, one rule: the course list and the course page must not be able
    to disagree about when somebody's access ends.

    Returns (purchased_at, expires_at, access_via). A None expiry on a
    "purchase" means never — the caller says so in words rather than printing a
    dash the reader has to interpret.
    """
    order = await session.scalar(
        select(Order)
        .where(
            Order.user_id == user_id,
            Order.status == OrderStatus.PAID,
            Order.course_id == course.id,
        )
        .order_by(Order.paid_at.desc().nullslast())
        .limit(1)
    )
    subscription = await session.scalar(
        select(Subscription)
        .join(PlanCourse, PlanCourse.plan_id == Subscription.plan_id)
        .where(
            Subscription.user_id == user_id,
            Subscription.status == SubscriptionStatus.ACTIVE,
            PlanCourse.course_id == course.id,
        )
        .order_by(Subscription.current_period_end.desc().nullslast())
        .limit(1)
    )
    granted = await extension_service.latest_for_course(session, user_id, course.id)

    # THE SAME FUNCTION THE LIST USES. These were two implementations of one
    # rule and had already drifted: a grant on a free course made this page say
    # "expires, granted" while the course list said "never, free".
    return extension_service.resolve(
        price_minor=course.price_minor,
        paid_at=(order.paid_at or order.created_at) if order is not None else None,
        subscription_started=subscription.created_at if subscription else None,
        subscription_ends=subscription.current_period_end if subscription else None,
        granted_until=granted,
        access_days=course.access_days,
    )
