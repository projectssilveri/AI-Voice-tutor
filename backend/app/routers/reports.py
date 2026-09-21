"""Training reports, and getting them into a spreadsheet.

The question this answers is the one every training manager asks and no screen
in the product could: WHO HAS DONE THE TRAINING, and who has not. The dashboard
showed aggregate numbers, the dossier showed one person completely, and neither
answers "give me the list of people who still have not finished the compliance
module".

Every figure comes from grouped queries — never one per row. A report over five
hundred people that issued five hundred queries would be the slowest screen in
the product and would arrive that way on the day it mattered.

SCOPING. An organization admin gets their own organization and nothing else. A
platform admin gets public B2C activity. A super admin gets everything, and may
narrow to one organization. Same rule as the audit trail (decision 171),
because this names exactly the same people.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import CurrentUser, DbSession
from app.models.certification import CertAttempt, CertExam, Certificate
from app.models.course import Course, Module
from app.models.enrollment import Enrollment, ModuleProgress, ProgressStatus
from app.models.organization import Organization
from app.models.quiz import QuizAttempt
from app.models.user import User, UserRole
from app.models.voice import VoiceSession

router = APIRouter(tags=["reports"])

Status = Literal["completed", "in_progress", "not_started"]


class TrainingRow(BaseModel):
    """One person on one course. The unit the whole report is built from."""

    user_id: uuid.UUID
    user_name: str
    user_email: str
    user_role: str
    organization_name: str | None
    branch_name: str | None
    department_name: str | None

    course_id: uuid.UUID
    course_title: str

    status: Status
    modules_total: int
    modules_completed: int
    percent: int

    enrolled_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None

    #: How many times they opened the AI tutor on this course, and how many of
    #: those sessions actually finished. The gap between the two is the
    #: interesting number: sessions started and abandoned.
    sessions_started: int
    sessions_ended: int
    tutor_minutes: int

    quiz_attempts: int
    best_quiz_score: float | None

    exam_attempts: int
    exam_passed: bool
    certificate_issued_at: datetime | None


class TrainingSummary(BaseModel):
    people: int
    courses: int
    completed: int
    in_progress: int
    not_started: int
    #: Whole-number percentage of rows that are complete, for the headline.
    completion_rate: int


class TrainingReport(BaseModel):
    summary: TrainingSummary
    rows: list[TrainingRow]
    truncated: bool


#: A report is read on screen; beyond this it is a spreadsheet's job. The cap
#: exists so one click cannot build a hundred thousand rows in memory.
MAX_ROWS = 5_000


async def _scope(
    session: AsyncSession,
    user: User,
    organization_id: uuid.UUID | None,
    public_only: bool = False,
):
    """Which people this caller may see, as a filter on `User`.

    Returns (filters, label). Refuses rather than silently narrowing when
    somebody asks for an organization that is not theirs — quietly returning
    their own data instead would make the report look wrong rather than refused.

    `public_only` is the third thing a super admin can ask for and could not.
    The choice used to be every person on the platform, or one named customer;
    our own B2C learners had no option of their own, so reading our own numbers
    meant reading a list with every customer's staff mixed into it. It is
    ignored for anybody else, because nobody else can see across the line in
    the first place.
    """
    filters: list[ColumnElement[bool]] = [User.closed_at.is_(None)]

    if user.organization_id is not None:
        # An organization's own staff. Learners never reach this router at all
        # — see the gate in each endpoint.
        if organization_id is not None and organization_id != user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Not found."
            )
        filters.append(User.organization_id == user.organization_id)
        organization = await session.get(Organization, user.organization_id)
        return filters, (organization.name if organization else None)

    if user.role is UserRole.SUPER_ADMIN:
        if organization_id is not None:
            filters.append(User.organization_id == organization_id)
            organization = await session.get(Organization, organization_id)
            return filters, (organization.name if organization else None)
        if public_only:
            filters.append(User.organization_id.is_(None))
            return filters, "Our own learners"
        return filters, None

    # An ordinary platform admin: public B2C accounts only (decision 171).
    filters.append(User.organization_id.is_(None))
    return filters, None


def _require_reporter(user: User) -> None:
    """Who may read a report about other people.

    A learner may not, for the same reason decision 150 closed the member list:
    names, addresses and what everyone has failed is a staff view, not course
    material.
    """
    allowed = {
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
        UserRole.ORG_ADMIN,
        UserRole.BRANCH_MANAGER,
    }
    if user.role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to read training reports.",
        )


async def _build(
    session: AsyncSession,
    user: User,
    *,
    organization_id: uuid.UUID | None,
    public_only: bool = False,
    course_id: uuid.UUID | None,
    status_filter: Status | None,
    search: str | None,
) -> TrainingReport:
    people_filters, _ = await _scope(session, user, organization_id, public_only)

    # A branch manager reports on their own branch. Failing closed as the
    # member list does: no branch assigned means themselves, not everyone.
    if user.role is UserRole.BRANCH_MANAGER:
        people_filters.append(
            User.branch_id == user.branch_id if user.branch_id else User.id == user.id
        )

    if search:
        pattern = f"%{search.strip()}%"
        people_filters.append(
            func.lower(User.name).like(pattern.lower())
            | func.lower(User.email).like(pattern.lower())
        )

    # ---- the rows: every enrolment in scope -----------------------------
    enrolment_q = (
        select(Enrollment.user_id, Enrollment.course_id, Enrollment.enrolled_at)
        .join(User, User.id == Enrollment.user_id)
        .where(*people_filters)
    )
    if course_id is not None:
        enrolment_q = enrolment_q.where(Enrollment.course_id == course_id)
    enrolments = (await session.execute(enrolment_q)).all()
    if not enrolments:
        return TrainingReport(
            summary=TrainingSummary(
                people=0,
                courses=0,
                completed=0,
                in_progress=0,
                not_started=0,
                completion_rate=0,
            ),
            rows=[],
            truncated=False,
        )

    user_ids = {row.user_id for row in enrolments}
    course_ids = {row.course_id for row in enrolments}

    # ---- everything else, one grouped query each ------------------------
    people = {
        row.id: row
        for row in (
            await session.execute(
                select(
                    User.id,
                    User.name,
                    User.email,
                    User.role,
                    User.organization_id,
                    User.branch_id,
                    User.department_id,
                ).where(User.id.in_(user_ids))
            )
        ).all()
    }

    courses = {
        row.id: row.title
        for row in (
            await session.execute(
                select(Course.id, Course.title).where(Course.id.in_(course_ids))
            )
        ).all()
    }

    org_names = {
        row.id: row.name
        for row in (
            await session.execute(select(Organization.id, Organization.name))
        ).all()
    }
    from app.models.organization import Branch, Department

    branch_names = {
        row.id: row.name
        for row in (await session.execute(select(Branch.id, Branch.name))).all()
    }
    dept_names = {
        row.id: row.name
        for row in (await session.execute(select(Department.id, Department.name))).all()
    }

    module_totals = {
        row[0]: row[1]
        for row in (
            await session.execute(
                select(Module.course_id, func.count())
                .where(Module.course_id.in_(course_ids))
                .group_by(Module.course_id)
            )
        ).all()
    }

    progress = {}
    for row in (
        await session.execute(
            select(
                ModuleProgress.user_id,
                Module.course_id,
                func.count().filter(ModuleProgress.status == ProgressStatus.COMPLETED),
                func.min(ModuleProgress.updated_at),
                func.max(ModuleProgress.updated_at),
                func.count(),
            )
            .join(Module, Module.id == ModuleProgress.module_id)
            .where(
                ModuleProgress.user_id.in_(user_ids),
                Module.course_id.in_(course_ids),
            )
            .group_by(ModuleProgress.user_id, Module.course_id)
        )
    ).all():
        progress[(row[0], row[1])] = row[2:]

    sessions = {}
    for row in (
        await session.execute(
            select(
                VoiceSession.user_id,
                Module.course_id,
                func.count(),
                func.count().filter(VoiceSession.ended_at.is_not(None)),
                func.coalesce(
                    func.sum(
                        func.extract(
                            "epoch",
                            func.coalesce(
                                VoiceSession.ended_at, VoiceSession.started_at
                            ),
                        )
                        - func.extract("epoch", VoiceSession.started_at)
                    ),
                    0,
                ),
            )
            .join(Module, Module.id == VoiceSession.module_id)
            .where(
                VoiceSession.user_id.in_(user_ids),
                Module.course_id.in_(course_ids),
            )
            .group_by(VoiceSession.user_id, Module.course_id)
        )
    ).all():
        sessions[(row[0], row[1])] = (row[2], row[3], int(row[4] or 0) // 60)

    quizzes = {}
    for row in (
        await session.execute(
            select(
                QuizAttempt.user_id,
                Module.course_id,
                func.count(),
                func.max(QuizAttempt.score),
            )
            .join(Module, Module.id == QuizAttempt.module_id)
            .where(QuizAttempt.user_id.in_(user_ids), Module.course_id.in_(course_ids))
            .group_by(QuizAttempt.user_id, Module.course_id)
        )
    ).all():
        quizzes[(row[0], row[1])] = (
            row[2],
            float(row[3]) if row[3] is not None else None,
        )

    exams = {}
    for row in (
        await session.execute(
            select(
                CertAttempt.user_id,
                CertExam.course_id,
                func.count(),
                func.bool_or(CertAttempt.passed),
            )
            .join(CertExam, CertExam.id == CertAttempt.cert_exam_id)
            .where(
                CertAttempt.user_id.in_(user_ids), CertExam.course_id.in_(course_ids)
            )
            .group_by(CertAttempt.user_id, CertExam.course_id)
        )
    ).all():
        exams[(row[0], row[1])] = (row[2], bool(row[3]))

    certificates = {
        (row[0], row[1]): row[2]
        for row in (
            await session.execute(
                select(Certificate.user_id, CertExam.course_id, Certificate.issued_at)
                .join(CertExam, CertExam.id == Certificate.cert_exam_id)
                .where(
                    Certificate.user_id.in_(user_ids),
                    CertExam.course_id.in_(course_ids),
                )
            )
        ).all()
    }

    # ---- assemble --------------------------------------------------------
    rows: list[TrainingRow] = []
    for enrolment in enrolments:
        key = (enrolment.user_id, enrolment.course_id)
        person = people.get(enrolment.user_id)
        if person is None:
            continue

        total = module_totals.get(enrolment.course_id, 0)
        done, first_touch, last_touch, touched = progress.get(key, (0, None, None, 0))
        percent = round(done * 100 / total) if total else 0

        if total and done >= total:
            state: Status = "completed"
        elif touched:
            state = "in_progress"
        else:
            state = "not_started"

        if status_filter and state != status_filter:
            continue

        started, ended, minutes = sessions.get(key, (0, 0, 0))
        attempts, best = quizzes.get(key, (0, None))
        exam_count, passed = exams.get(key, (0, False))

        rows.append(
            TrainingRow(
                user_id=person.id,
                user_name=person.name,
                user_email=person.email,
                user_role=person.role.value,
                organization_name=org_names.get(person.organization_id),
                branch_name=branch_names.get(person.branch_id),
                department_name=dept_names.get(person.department_id),
                course_id=enrolment.course_id,
                course_title=courses.get(enrolment.course_id, "(deleted course)"),
                status=state,
                modules_total=total,
                modules_completed=done,
                percent=percent,
                enrolled_at=enrolment.enrolled_at,
                started_at=first_touch,
                # Only meaningful once every module is done; the last progress
                # update before that is not a completion date.
                completed_at=last_touch if state == "completed" else None,
                sessions_started=started,
                sessions_ended=ended,
                tutor_minutes=minutes,
                quiz_attempts=attempts,
                best_quiz_score=best,
                exam_attempts=exam_count,
                exam_passed=passed,
                certificate_issued_at=certificates.get(key),
            )
        )

    rows.sort(key=lambda r: (r.course_title, r.user_name))
    truncated = len(rows) > MAX_ROWS

    completed = sum(1 for r in rows if r.status == "completed")
    in_progress = sum(1 for r in rows if r.status == "in_progress")
    not_started = sum(1 for r in rows if r.status == "not_started")

    return TrainingReport(
        summary=TrainingSummary(
            people=len({r.user_id for r in rows}),
            courses=len({r.course_id for r in rows}),
            completed=completed,
            in_progress=in_progress,
            not_started=not_started,
            completion_rate=round(completed * 100 / len(rows)) if rows else 0,
        ),
        rows=rows[:MAX_ROWS],
        truncated=truncated,
    )


@router.get("/reports/training", response_model=TrainingReport)
async def training_report(
    session: DbSession,
    user: CurrentUser,
    organization_id: uuid.UUID | None = None,
    public_only: bool = False,
    course_id: uuid.UUID | None = None,
    status_filter: Annotated[Status | None, Query(alias="status")] = None,
    search: str | None = None,
) -> TrainingReport:
    """Who has done the training, and who has not."""
    _require_reporter(user)
    return await _build(
        session,
        user,
        organization_id=organization_id,
        public_only=public_only,
        course_id=course_id,
        status_filter=status_filter,
        search=search,
    )


@router.get("/reports/training/export")
async def export_training_report(
    session: DbSession,
    user: CurrentUser,
    organization_id: uuid.UUID | None = None,
    public_only: bool = False,
    course_id: uuid.UUID | None = None,
    status_filter: Annotated[Status | None, Query(alias="status")] = None,
    search: str | None = None,
) -> StreamingResponse:
    """The same report as a spreadsheet.

    CSV, not .xlsx. Excel opens it directly, every other spreadsheet reads it,
    and it needs no dependency — `openpyxl` would be a whole library so that the
    header row could be bold. The BOM below is what makes Excel on Windows read
    it as UTF-8 rather than mangling any name with an accent in it, which is the
    one real problem with handing Excel a CSV.

    Same filters and the same scope as the screen: an export that ignored either
    would be the leak decision 182 was written about.
    """
    _require_reporter(user)
    report = await _build(
        session,
        user,
        organization_id=organization_id,
        public_only=public_only,
        course_id=course_id,
        status_filter=status_filter,
        search=search,
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "Name",
            "Email",
            "Role",
            "Organisation",
            "Branch",
            "Department",
            "Course",
            "Status",
            "Modules completed",
            "Modules total",
            "Percent complete",
            "Enrolled",
            "First activity",
            "Completed",
            "Tutor sessions started",
            "Tutor sessions ended",
            "Tutor minutes",
            "Quiz attempts",
            "Best quiz score",
            "Exam attempts",
            "Exam passed",
            "Certificate issued",
        ]
    )
    for row in report.rows:
        writer.writerow(
            [
                row.user_name,
                row.user_email,
                row.user_role,
                row.organization_name or "",
                row.branch_name or "",
                row.department_name or "",
                row.course_title,
                {
                    "completed": "Completed",
                    "in_progress": "In progress",
                    "not_started": "Not started",
                }[row.status],
                row.modules_completed,
                row.modules_total,
                row.percent,
                row.enrolled_at.date().isoformat() if row.enrolled_at else "",
                row.started_at.date().isoformat() if row.started_at else "",
                row.completed_at.date().isoformat() if row.completed_at else "",
                row.sessions_started,
                row.sessions_ended,
                row.tutor_minutes,
                row.quiz_attempts,
                "" if row.best_quiz_score is None else row.best_quiz_score,
                row.exam_attempts,
                "Yes" if row.exam_passed else "No",
                row.certificate_issued_at.date().isoformat()
                if row.certificate_issued_at
                else "",
            ]
        )
    if report.truncated:
        writer.writerow([f"-- truncated at {MAX_ROWS} rows; narrow the filters --"])

    stamp = datetime.now().strftime("%Y-%m-%d")
    return StreamingResponse(
        # utf-8-sig: the byte-order mark is what tells Excel on Windows this is
        # UTF-8. Without it "Ramírez" arrives as "RamÃ­rez".
        iter([buffer.getvalue().encode("utf-8-sig")]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="training-report-{stamp}.csv"'
        },
    )


class ReportCourse(BaseModel):
    id: uuid.UUID
    title: str
    enrolled: int


@router.get("/reports/courses", response_model=list[ReportCourse])
async def reportable_courses(
    session: DbSession,
    user: CurrentUser,
    organization_id: uuid.UUID | None = None,
    public_only: bool = False,
) -> list[ReportCourse]:
    """Courses with anybody enrolled, for the report's course filter.

    Built from the data rather than from the whole catalogue, so the dropdown
    lists courses that would actually produce rows.
    """
    _require_reporter(user)
    people_filters, _ = await _scope(session, user, organization_id, public_only)

    rows = (
        await session.execute(
            select(Course.id, Course.title, func.count(Enrollment.user_id))
            .join(Enrollment, Enrollment.course_id == Course.id)
            .join(User, and_(User.id == Enrollment.user_id, *people_filters))
            .group_by(Course.id, Course.title)
            .order_by(Course.title)
        )
    ).all()
    return [ReportCourse(id=row[0], title=row[1], enrolled=row[2]) for row in rows]
