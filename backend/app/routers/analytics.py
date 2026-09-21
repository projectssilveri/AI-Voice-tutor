"""Numbers for the dashboards.

Split by who may see what:

  /analytics/me       any signed-in student — their own progress only
  /analytics/platform admin — learners, enrolments, completions, AI usage
  /analytics/revenue  SUPER ADMIN ONLY — money

The revenue split is the whole point of the super-admin role, so it is a
separate route with its own gate rather than a field an admin might see by
asking for a wider date range.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select

from app.deps import (
    CurrentUser,
    DbSession,
    RequireAdmin,
    RequireSuperAdmin,
    require_role,
)
from app.models.certification import CertAttempt, Certificate
from app.models.course import Course, Module
from app.models.enrollment import Enrollment, ModuleProgress, ProgressStatus
from app.models.order import Order, OrderStatus
from app.models.quiz import QuizAttempt
from app.models.user import User, UserRole
from app.models.voice import Transcript, VoiceSession

router = APIRouter(prefix="/analytics", tags=["analytics"])

admin_only = Depends(require_role(UserRole.ADMIN))


class DayPoint(BaseModel):
    day: date
    value: float


class NamedValue(BaseModel):
    label: str
    value: float


# --- Student ---------------------------------------------------------------


class LastModule(BaseModel):
    """The module this student touched most recently.

    Drives "Continue learning" — the reason most people open the dashboard is
    to resume, and hunting for where you were is friction the product can
    remove.
    """

    course_id: uuid.UUID
    course_title: str
    module_id: uuid.UUID
    module_title: str
    status: str
    module_number: int
    module_count: int


class MyProgress(BaseModel):
    """The student's own dashboard."""

    modules_completed: int
    modules_in_progress: int
    modules_total: int
    courses_enrolled: int
    voice_minutes: int
    questions_asked: int
    quizzes_taken: int
    best_quiz_score: float | None
    certificates_earned: int
    current_streak_days: int
    activity: list[DayPoint]
    minutes_per_course: list[NamedValue]
    # None for someone who has enrolled but not opened anything yet.
    last_module: LastModule | None = None


@router.get("/me", response_model=MyProgress)
async def my_analytics(
    session: DbSession, user: CurrentUser, days: int = Query(default=30, ge=7, le=180)
) -> MyProgress:
    since = datetime.now(UTC) - timedelta(days=days)

    enrolled_course_ids = (
        await session.scalars(
            select(Enrollment.course_id).where(Enrollment.user_id == user.id)
        )
    ).all()

    modules_total = 0
    if enrolled_course_ids:
        modules_total = await session.scalar(
            select(func.count())
            .select_from(Module)
            .where(Module.course_id.in_(enrolled_course_ids))
        ) or 0

    # Progress counted only for enrolled courses, so these agree with the
    # course list on the same screen.
    status_counts = dict(
        (
            await session.execute(
                select(ModuleProgress.status, func.count())
                .join(Module, Module.id == ModuleProgress.module_id)
                .where(
                    ModuleProgress.user_id == user.id,
                    Module.course_id.in_(enrolled_course_ids or [uuid.uuid4()]),
                )
                .group_by(ModuleProgress.status)
            )
        ).all()
    )

    voice_seconds = await session.scalar(
        select(
            func.coalesce(
                func.sum(
                    func.extract(
                        "epoch", VoiceSession.ended_at - VoiceSession.started_at
                    )
                ),
                0,
            )
        ).where(
            VoiceSession.user_id == user.id, VoiceSession.ended_at.is_not(None)
        )
    )

    # A "question asked" is a student turn in a transcript — the honest count
    # of how much they actually spoke to the tutor.
    questions = await session.scalar(
        select(func.count())
        .select_from(Transcript)
        .join(VoiceSession, VoiceSession.id == Transcript.session_id)
        .where(VoiceSession.user_id == user.id, Transcript.role == "user")
    ) or 0

    quizzes_taken = await session.scalar(
        select(func.count())
        .select_from(QuizAttempt)
        .where(QuizAttempt.user_id == user.id)
    ) or 0
    best_quiz = await session.scalar(
        select(func.max(QuizAttempt.score)).where(QuizAttempt.user_id == user.id)
    )

    certificates = await session.scalar(
        select(func.count())
        .select_from(Certificate)
        .where(Certificate.user_id == user.id)
    ) or 0

    # Minutes of tutoring per day, for the activity chart.
    rows = (
        await session.execute(
            select(
                cast(VoiceSession.started_at, Date),
                func.coalesce(
                    func.sum(
                        func.extract(
                            "epoch", VoiceSession.ended_at - VoiceSession.started_at
                        )
                    ),
                    0,
                ),
            )
            .where(
                VoiceSession.user_id == user.id,
                VoiceSession.started_at >= since,
                VoiceSession.ended_at.is_not(None),
            )
            .group_by(cast(VoiceSession.started_at, Date))
            .order_by(cast(VoiceSession.started_at, Date))
        )
    ).all()
    activity = [
        DayPoint(day=day, value=round(float(seconds) / 60, 1))
        for day, seconds in rows
    ]

    per_course = (
        await session.execute(
            select(
                Course.title,
                func.coalesce(
                    func.sum(
                        func.extract(
                            "epoch", VoiceSession.ended_at - VoiceSession.started_at
                        )
                    ),
                    0,
                ),
            )
            .join(Module, Module.id == VoiceSession.module_id)
            .join(Course, Course.id == Module.course_id)
            .where(
                VoiceSession.user_id == user.id, VoiceSession.ended_at.is_not(None)
            )
            .group_by(Course.title)
            .order_by(func.sum(
                func.extract(
                    "epoch", VoiceSession.ended_at - VoiceSession.started_at
                )
            ).desc())
        )
    ).all()

    # The module touched most recently, for "Continue learning". Ordered by
    # module_progress.updated_at, which moves both when a session starts and
    # when progress is marked — so it tracks "where I was", not merely "what I
    # finished".
    last_row = (
        await session.execute(
            select(
                Course.id,
                Course.title,
                Module.id,
                Module.title,
                ModuleProgress.status,
                Module.order,
            )
            .join(Module, Module.id == ModuleProgress.module_id)
            .join(Course, Course.id == Module.course_id)
            .where(
                ModuleProgress.user_id == user.id,
                # Only courses they are still enrolled in: resuming a course
                # they left would be a dead end.
                Course.id.in_(enrolled_course_ids or [uuid.uuid4()]),
            )
            .order_by(ModuleProgress.updated_at.desc())
            .limit(1)
        )
    ).first()

    last_module = None
    if last_row is not None:
        course_id, course_title, module_id, module_title, prog_status, order = last_row

        # If the module they last touched is finished, resuming it is a dead
        # end — "continue" means the next thing they have not done. An
        # outer join finds the first module in that course with no progress
        # row or an unfinished one; falling out of it means the whole course
        # is complete, and the banner then offers the last module as review.
        next_row = (
            await session.execute(
                select(Module.id, Module.title, ModuleProgress.status, Module.order)
                .outerjoin(
                    ModuleProgress,
                    (ModuleProgress.module_id == Module.id)
                    & (ModuleProgress.user_id == user.id),
                )
                .where(
                    Module.course_id == course_id,
                    (ModuleProgress.status.is_(None))
                    | (ModuleProgress.status != ProgressStatus.COMPLETED),
                )
                .order_by(Module.order)
                .limit(1)
            )
        ).first()
        if next_row is not None:
            module_id, module_title, next_status, order = next_row
            prog_status = next_status or ProgressStatus.NOT_STARTED

        sibling_count = await session.scalar(
            select(func.count()).select_from(Module).where(Module.course_id == course_id)
        ) or 0
        last_module = LastModule(
            course_id=course_id,
            course_title=course_title,
            module_id=module_id,
            module_title=module_title,
            status=prog_status.value if hasattr(prog_status, "value") else str(prog_status),
            module_number=order + 1,
            module_count=sibling_count,
        )

    return MyProgress(
        modules_completed=status_counts.get(ProgressStatus.COMPLETED, 0),
        modules_in_progress=status_counts.get(ProgressStatus.IN_PROGRESS, 0),
        modules_total=modules_total,
        courses_enrolled=len(enrolled_course_ids),
        voice_minutes=int((voice_seconds or 0) // 60),
        questions_asked=questions,
        quizzes_taken=quizzes_taken,
        best_quiz_score=float(best_quiz) if best_quiz is not None else None,
        certificates_earned=certificates,
        current_streak_days=_streak_from([point.day for point in activity]),
        activity=activity,
        minutes_per_course=[
            NamedValue(label=title, value=round(float(seconds) / 60, 1))
            for title, seconds in per_course
        ],
        last_module=last_module,
    )


def _streak_from(days: list[date]) -> int:
    """Consecutive days of study ending today or yesterday.

    Yesterday counts so the number does not reset at midnight on someone who is
    mid-streak and has not studied yet today.
    """
    if not days:
        return 0

    seen = set(days)
    today = datetime.now(UTC).date()
    cursor = today if today in seen else today - timedelta(days=1)
    if cursor not in seen:
        return 0

    streak = 0
    while cursor in seen:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


# --- Admin -----------------------------------------------------------------


class LeaderboardRow(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    modules_completed: int
    voice_minutes: int
    certificates: int
    # A single sortable figure so the table has an obvious default order.
    score: float


class PlatformAnalytics(BaseModel):
    total_students: int
    active_students_30d: int
    students_who_used_tutor: int
    total_enrolments: int
    modules_completed: int
    certificates_issued: int
    cert_pass_rate: float
    total_voice_minutes: int
    total_interruptions: int
    signups_per_day: list[DayPoint]
    voice_minutes_per_day: list[DayPoint]
    enrolments_per_course: list[NamedValue]
    completion_rate_per_course: list[NamedValue]
    leaderboard: list[LeaderboardRow]


@router.get("/platform", response_model=PlatformAnalytics)
async def platform_analytics(
    session: DbSession,
    actor: RequireAdmin,
    days: int = Query(default=30, ge=7, le=365),
) -> PlatformAnalytics:
    """Platform-wide figures.

    The per-course charts name courses, and a customer's private course title
    is exactly the thing the walled garden exists to keep off other people's
    screens. `_public_only` scopes them for an ordinary admin — the course
    listing already hides those courses, so a chart naming them beside it was
    both a leak and a contradiction.
    """
    since = datetime.now(UTC) - timedelta(days=days)

    # A super admin sees across tenants for support; nobody else does.
    # Spread into each `.where()` so an empty tuple is a no-op for them.
    course_scope = (
        ()
        if actor.role is UserRole.SUPER_ADMIN
        else (Course.organization_id.is_(None),)
    )

    # AND THE PEOPLE, which was the half that leaked. Only the per-course charts
    # below were ever scoped; every headline number on this page — students,
    # enrolments, modules completed, certificates, attempts, tutor minutes —
    # counted the whole database, customers' private training included. An
    # ordinary admin saw a total they had no business seeing, sitting directly
    # above a chart that had been carefully filtered. Reported as issues 42, 43
    # and 44.
    #
    # `None` for a super admin, who genuinely does see across tenants for
    # support. Everyone else counts public B2C accounts only — the same rule
    # `admin.list_users` has always applied to the Users screen, so the two
    # screens finally agree.
    visible_people = (
        None
        if actor.role is UserRole.SUPER_ADMIN
        else select(User.id).where(User.organization_id.is_(None)).scalar_subquery()
    )

    def mine(column):
        """Constrain a user_id column to the people this admin may count."""
        return () if visible_people is None else (column.in_(visible_people),)

    student_filter = User.role == UserRole.STUDENT
    people_scope = (
        () if visible_people is None else (User.organization_id.is_(None),)
    )

    total_students = await session.scalar(
        select(func.count()).select_from(User).where(student_filter, *people_scope)
    ) or 0

    active_students = await session.scalar(
        select(func.count(func.distinct(VoiceSession.user_id))).where(
            VoiceSession.started_at >= since, *mine(VoiceSession.user_id)
        )
    ) or 0

    used_tutor = await session.scalar(
        select(func.count(func.distinct(VoiceSession.user_id))).where(
            *mine(VoiceSession.user_id)
        )
    ) or 0

    total_enrolments = await session.scalar(
        select(func.count())
        .select_from(Enrollment)
        .where(*mine(Enrollment.user_id))
    ) or 0

    modules_completed = await session.scalar(
        select(func.count())
        .select_from(ModuleProgress)
        .where(
            ModuleProgress.status == ProgressStatus.COMPLETED,
            *mine(ModuleProgress.user_id),
        )
    ) or 0

    certificates_issued = await session.scalar(
        select(func.count())
        .select_from(Certificate)
        .where(*mine(Certificate.user_id))
    ) or 0

    attempts_total = await session.scalar(
        select(func.count()).select_from(CertAttempt).where(*mine(CertAttempt.user_id))
    ) or 0
    attempts_passed = await session.scalar(
        select(func.count())
        .select_from(CertAttempt)
        .where(CertAttempt.passed, *mine(CertAttempt.user_id))
    ) or 0

    voice_seconds = await session.scalar(
        select(
            func.coalesce(
                func.sum(
                    func.extract(
                        "epoch", VoiceSession.ended_at - VoiceSession.started_at
                    )
                ),
                0,
            )
        ).where(VoiceSession.ended_at.is_not(None), *mine(VoiceSession.user_id))
    ) or 0

    interruptions = await session.scalar(
        select(func.count())
        .select_from(Transcript)
        .join(VoiceSession, VoiceSession.id == Transcript.session_id)
        .where(Transcript.is_interruption.is_(True), *mine(VoiceSession.user_id))
    ) or 0

    signup_rows = (
        await session.execute(
            select(cast(User.created_at, Date), func.count())
            .where(User.created_at >= since, student_filter, *people_scope)
            .group_by(cast(User.created_at, Date))
            .order_by(cast(User.created_at, Date))
        )
    ).all()

    minute_rows = (
        await session.execute(
            select(
                cast(VoiceSession.started_at, Date),
                func.coalesce(
                    func.sum(
                        func.extract(
                            "epoch", VoiceSession.ended_at - VoiceSession.started_at
                        )
                    ),
                    0,
                ),
            )
            .where(
                VoiceSession.started_at >= since,
                VoiceSession.ended_at.is_not(None),
                *mine(VoiceSession.user_id),
            )
            .group_by(cast(VoiceSession.started_at, Date))
            .order_by(cast(VoiceSession.started_at, Date))
        )
    ).all()

    enrolment_rows = (
        await session.execute(
            select(Course.title, func.count(Enrollment.id))
            .outerjoin(Enrollment, Enrollment.course_id == Course.id)
            .where(*course_scope)
            .group_by(Course.title)
            .order_by(func.count(Enrollment.id).desc())
        )
    ).all()

    # Completion rate per course = completed module-progress rows as a share of
    # everything enrolled learners *could* have completed.
    #
    # Counted in three separate queries rather than one clever join: joining
    # modules, enrolments and progress at once multiplies the rows together, so
    # the counts come out as products of each other rather than the truth.
    module_counts = dict(
        (
            await session.execute(
                select(Course.title, func.count(Module.id))
                .outerjoin(Module, Module.course_id == Course.id)
                .where(*course_scope)
                .group_by(Course.title)
            )
        ).all()
    )
    learner_counts = dict(
        (
            await session.execute(
                select(Course.title, func.count(func.distinct(Enrollment.user_id)))
                .outerjoin(Enrollment, Enrollment.course_id == Course.id)
                .where(*course_scope)
                .group_by(Course.title)
            )
        ).all()
    )
    # THE NUMERATOR AND THE DENOMINATOR HAVE TO DESCRIBE THE SAME PEOPLE.
    #
    # This counted every completed module row on the course; `possible` below
    # counts modules times CURRENTLY ENROLLED learners. Somebody who finished
    # four modules and was then unenrolled stayed in the top half and vanished
    # from the bottom — so the share went over 100%. Measured live at 125% on
    # a course with four modules, one enrolled learner and five completed rows.
    #
    # The join to `enrollments` is what fixes it: progress only counts while
    # the person it belongs to is still on the course.
    completed_counts = dict(
        (
            await session.execute(
                select(Course.title, func.count())
                .select_from(ModuleProgress)
                .join(Module, Module.id == ModuleProgress.module_id)
                .join(Course, Course.id == Module.course_id)
                .join(
                    Enrollment,
                    (Enrollment.course_id == Course.id)
                    & (Enrollment.user_id == ModuleProgress.user_id),
                )
                .where(
                    ModuleProgress.status == ProgressStatus.COMPLETED,
                    *course_scope,
                )
                .group_by(Course.title)
            )
        ).all()
    )

    completion_rate = []
    for title, module_count in module_counts.items():
        possible = (module_count or 0) * learner_counts.get(title, 0)
        # NOTHING TO REPORT, so nothing is reported. A course with no learners
        # on it was being drawn as a 0% bar, which reads as "everybody is
        # failing this one" when it means "nobody has started it". Nine of
        # fifteen bars on this chart were that lie.
        if not possible:
            continue
        done = completed_counts.get(title, 0)
        # Clamped as well as fixed. The join above is what stops this going
        # over 100; the clamp is here so that a future query which forgets the
        # same thing produces a wrong number rather than an impossible one.
        rate = min(done / possible * 100, 100.0)
        completion_rate.append(NamedValue(label=title, value=round(rate, 1)))

    # Highest first. A ranked comparison the reader has to sort themselves is a
    # table with the sorting taken away.
    completion_rate.sort(key=lambda row: row.value, reverse=True)

    return PlatformAnalytics(
        total_students=total_students,
        active_students_30d=active_students,
        students_who_used_tutor=used_tutor,
        total_enrolments=total_enrolments,
        modules_completed=modules_completed,
        certificates_issued=certificates_issued,
        cert_pass_rate=(
            round(attempts_passed / attempts_total * 100, 1)
            if attempts_total
            else 0.0
        ),
        total_voice_minutes=int(voice_seconds // 60),
        total_interruptions=interruptions,
        signups_per_day=[
            DayPoint(day=day, value=float(count)) for day, count in signup_rows
        ],
        voice_minutes_per_day=[
            DayPoint(day=day, value=round(float(seconds) / 60, 1))
            for day, seconds in minute_rows
        ],
        # COURSES NOBODY IS ON ARE LEFT OUT, for the same reason as the
        # completion chart above: a row of empty bars is not information, and
        # with fifteen courses it was most of the chart. The count stays an
        # integer on the way out — a whole number of people — so the axis can
        # be told not to invent 0.2 of a person.
        enrolments_per_course=[
            NamedValue(label=title, value=float(int(count)))
            for title, count in enrolment_rows
            if count
        ],
        completion_rate_per_course=completion_rate,
        leaderboard=await _leaderboard(session, visible_people=visible_people),
    )


async def _leaderboard(
    session: DbSession, limit: int = 10, *, visible_people=None
) -> list[LeaderboardRow]:
    """Ranking students by what they have actually finished.

    Weighted towards completion rather than time spent: sitting in a session
    should not outrank finishing modules and passing an exam.

    SCOPED, which it was not. This ranked every learner on the platform for
    every admin, so an ordinary admin read the names of another customer's
    staff off their own dashboard. Issue 43.
    """
    completed = (
        select(
            ModuleProgress.user_id.label("user_id"),
            func.count().label("completed"),
        )
        .where(ModuleProgress.status == ProgressStatus.COMPLETED)
        .group_by(ModuleProgress.user_id)
        .subquery()
    )
    minutes = (
        select(
            VoiceSession.user_id.label("user_id"),
            func.coalesce(
                func.sum(
                    func.extract(
                        "epoch", VoiceSession.ended_at - VoiceSession.started_at
                    )
                ),
                0,
            ).label("seconds"),
        )
        .where(VoiceSession.ended_at.is_not(None))
        .group_by(VoiceSession.user_id)
        .subquery()
    )
    certs = (
        select(
            Certificate.user_id.label("user_id"),
            func.count().label("certificates"),
        )
        .group_by(Certificate.user_id)
        .subquery()
    )

    rows = (
        await session.execute(
            select(
                User.id,
                User.name,
                User.email,
                func.coalesce(completed.c.completed, 0),
                func.coalesce(minutes.c.seconds, 0),
                func.coalesce(certs.c.certificates, 0),
            )
            .outerjoin(completed, completed.c.user_id == User.id)
            .outerjoin(minutes, minutes.c.user_id == User.id)
            .outerjoin(certs, certs.c.user_id == User.id)
            .where(
                User.role == UserRole.STUDENT,
                *(
                    ()
                    if visible_people is None
                    else (User.id.in_(visible_people),)
                ),
            )
            .order_by(
                (
                    func.coalesce(completed.c.completed, 0) * 10
                    + func.coalesce(certs.c.certificates, 0) * 50
                    + func.coalesce(minutes.c.seconds, 0) / 600
                ).desc()
            )
            .limit(limit)
        )
    ).all()

    ranked = [
        LeaderboardRow(
            user_id=user_id,
            name=name,
            email=email,
            modules_completed=int(completed_count),
            voice_minutes=int(float(seconds) // 60),
            certificates=int(cert_count),
            score=round(
                completed_count * 10 + cert_count * 50 + float(seconds) / 600, 1
            ),
        )
        for user_id, name, email, completed_count, seconds, cert_count in rows
    ]

    # A RANKING OF NOTHING IS NOT A RANKING. When a row scores zero the place
    # it is given is whatever the database happened to return, presented as
    # though somebody were ahead — issue 31, where the tester saw learners
    # ranked with 0 modules, 0 certificates, 0 minutes and 0 score.
    #
    # Dropped per row, not only when the whole table is zero. Six learners who
    # have finished nothing, sitting at ranks three to eight under two who
    # have, is the same complaint in miniature: they are not top learners, and
    # the order among them means nothing. With them gone the list is the real
    # ranking, and when nobody has done anything it is empty and the screen
    # says so.
    return [row for row in ranked if row.score > 0]


# --- Revenue (super admin only) --------------------------------------------


class RevenueAnalytics(BaseModel):
    """Money. Deliberately unreachable by an ordinary admin."""

    currency: str
    gross_minor: int
    refunded_minor: int
    net_minor: int
    paid_orders: int
    failed_orders: int
    conversion_rate: float
    revenue_per_day: list[DayPoint]
    revenue_per_course: list[NamedValue]
    recent_orders: list[dict]


@router.get("/revenue", response_model=RevenueAnalytics)
async def revenue_analytics(
    session: DbSession,
    admin: RequireSuperAdmin,
    days: int = Query(default=30, ge=7, le=365),
) -> RevenueAnalytics:
    since = datetime.now(UTC) - timedelta(days=days)

    # MONEY TAKEN: everything that was ever paid for, INCLUDING orders since
    # refunded. Gross used to count PAID only, while `refunded` counted the
    # full amount of every REFUNDED order and `net` subtracted it — so a
    # refunded order was left out of gross and then deducted from it as well,
    # and net came out understated by the whole order. Harmless while nothing
    # in the product could set REFUNDED; wrong the day the refunds screen
    # started setting it.
    took = [OrderStatus.PAID, OrderStatus.REFUNDED]
    gross = await session.scalar(
        select(func.coalesce(func.sum(Order.amount_minor), 0)).where(
            Order.status.in_(took)
        )
    ) or 0
    # MONEY GIVEN BACK: the amount actually returned, which the published
    # policy makes a PARTIAL amount most of the time — full under 25% of the
    # course, half up to 50%. Summing `amount_minor` here counted a half
    # refund as a whole one.
    refunded = await session.scalar(
        select(func.coalesce(func.sum(Order.refunded_amount_minor), 0)).where(
            Order.status == OrderStatus.REFUNDED
        )
    ) or 0

    paid_count = await session.scalar(
        select(func.count()).select_from(Order).where(Order.status == OrderStatus.PAID)
    ) or 0
    failed_count = await session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.status == OrderStatus.FAILED)
    ) or 0
    started_count = await session.scalar(
        select(func.count()).select_from(Order)
    ) or 0

    # `paid_at` is set everywhere an order becomes PAID, but the column is
    # nullable, and a PAID row without one used to disappear from this series
    # while still counting towards the gross figure above it — the KPI and the
    # chart beside it disagreeing, with nothing on screen to explain why.
    # Falling back to `created_at` keeps a paid order visible either way.
    paid_on = func.coalesce(Order.paid_at, Order.created_at)
    day_rows = (
        await session.execute(
            select(
                cast(paid_on, Date),
                func.coalesce(func.sum(Order.amount_minor), 0),
            )
            # Same basis as `gross` above, so the chart totals reconcile with
            # the KPI beside it. Filtering to PAID here would drop a refunded
            # order out of the series while it still counted towards gross.
            .where(Order.status.in_(took), paid_on >= since)
            .group_by(cast(paid_on, Date))
            .order_by(cast(paid_on, Date))
        )
    ).all()

    course_rows = (
        await session.execute(
            select(Course.title, func.coalesce(func.sum(Order.amount_minor), 0))
            .join(Order, Order.course_id == Course.id)
            .where(Order.status.in_(took))
            .group_by(Course.title)
            .order_by(func.sum(Order.amount_minor).desc())
        )
    ).all()

    recent = (
        await session.execute(
            select(Order, User.name, User.email, Course.title)
            .join(User, User.id == Order.user_id)
            .outerjoin(Course, Course.id == Order.course_id)
            .order_by(Order.created_at.desc())
            .limit(20)
        )
    ).all()

    return RevenueAnalytics(
        currency="INR",
        gross_minor=int(gross),
        refunded_minor=int(refunded),
        net_minor=int(gross) - int(refunded),
        paid_orders=paid_count,
        failed_orders=failed_count,
        conversion_rate=(
            round(paid_count / started_count * 100, 1) if started_count else 0.0
        ),
        revenue_per_day=[
            DayPoint(day=day, value=float(amount) / 100) for day, amount in day_rows
        ],
        revenue_per_course=[
            NamedValue(label=title, value=float(amount) / 100)
            for title, amount in course_rows
        ],
        recent_orders=[
            {
                "id": str(order.id),
                "user_name": name,
                "user_email": email,
                "item": course_title or "Subscription plan",
                "amount_minor": order.amount_minor,
                "currency": order.currency,
                "status": order.status.value,
                "created_at": order.created_at.isoformat(),
            }
            for order, name, email, course_title in recent
        ],
    )
