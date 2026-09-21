"""Enrollments: a student's courses, their progress, and the dashboard summary."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.deps import CurrentUser, DbSession
from app.models.enrollment import ProgressStatus
from app.services import access
from app.services import courses as course_service
from app.services import enrollments as enrollment_service

router = APIRouter(tags=["enrollments"])


class EnrolledCourse(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    total_modules: int
    completed_modules: int
    in_progress_modules: int
    percent_complete: int

    # When they enrolled, when they paid, and when it runs out. Null expiry on
    # an outright purchase means "never", not "unknown" — `access_via` is what
    # lets the UI tell those apart and say so in words.
    enrolled_at: datetime | None
    purchased_at: datetime | None
    expires_at: datetime | None
    access_via: str


class DashboardSummaryOut(BaseModel):
    courses_enrolled: int
    modules_completed: int
    voice_minutes: int
    last_session_at: datetime | None


class ModuleProgressUpdate(BaseModel):
    # Only these two are settable by a student: "not started" is the absence of
    # progress, not something to move back to.
    status: Literal[ProgressStatus.COMPLETED, ProgressStatus.IN_PROGRESS]


@router.get("/enrollments", response_model=list[EnrolledCourse])
async def list_my_enrollments(
    session: DbSession, user: CurrentUser
) -> list[EnrolledCourse]:
    rows = await enrollment_service.list_enrolled_courses(session, user.id)
    return [
        EnrolledCourse(
            id=row.course.id,
            title=row.course.title,
            description=row.course.description,
            total_modules=row.total_modules,
            completed_modules=row.completed_modules,
            in_progress_modules=row.in_progress_modules,
            percent_complete=row.percent_complete,
            enrolled_at=row.enrolled_at,
            purchased_at=row.purchased_at,
            expires_at=row.expires_at,
            access_via=row.access_via,
        )
        for row in rows
    ]


class ModuleProgressOut(BaseModel):
    module_id: uuid.UUID
    status: str


@router.put("/modules/{module_id}/progress", response_model=ModuleProgressOut)
async def set_my_module_progress(
    module_id: uuid.UUID,
    payload: ModuleProgressUpdate,
    session: DbSession,
    user: CurrentUser,
) -> ModuleProgressOut:
    """Let a student mark a module complete, or reopen it.

    The automatic rule (a long enough tutoring session) covers the normal case,
    but a student who read the material rather than listening to it, or who
    finished across two shorter sessions, would otherwise have no way to say so.

    Marking a module complete does not lock it. The project spec is explicit that
    reading course material is unlimited, and re-opening the tutor on a
    completed module leaves it completed rather than demoting it.
    """
    try:
        module = await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    # Tenancy. Writing a progress row against another organization's module is
    # a write across the wall, and it puts their course into the student's own
    # "modules completed" figure. Decision 44 already scoped that KPI to
    # enrolled courses; this stops the row being written at all.
    try:
        await access.require_module_in_tenant(session, user, module_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    # THE BUTTON IS A CLAIM, NOT A DECISION. It used to write COMPLETED
    # straight through, which is how a course reached 100% with every quiz
    # untouched — issues 24, 27 and 28, and the mechanism behind the
    # certificate-without-studying hole in 13 and 14.
    #
    # Only completing is checked. Re-opening a module is always allowed: a
    # student saying "I need to go over this again" is never something to argue
    # with.
    if payload.status is ProgressStatus.COMPLETED:
        requirements = await enrollment_service.module_requirements(
            session, user.id, module.id, lesson_done=True
        )
        if not requirements.met:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(
                    enrollment_service.RequirementsNotMetError(requirements)
                ),
            )

    progress = await enrollment_service.set_module_status(
        session, user.id, module.id, payload.status
    )
    return ModuleProgressOut(module_id=progress.module_id, status=progress.status.value)


class ModuleRequirementsOut(BaseModel):
    """What is left before this module counts as done.

    A student who presses "mark complete" and is refused needs to see WHY
    before pressing it, not after. One request for the module on screen rather
    than a field on every module in the course listing — the course page does
    not need this, and an N+1 across twelve modules to render one badge is a
    poor trade.
    """

    needs_quiz: bool
    quiz_passed: bool
    best_quiz_score: float | None
    needs_assignment: bool
    assignment_submitted: bool
    #: Whether everything except the lesson itself is done, so the screen can
    #: offer "mark complete" rather than dangling a button that will be refused.
    ready_to_complete: bool
    outstanding: list[str]


@router.get(
    "/modules/{module_id}/requirements", response_model=ModuleRequirementsOut
)
async def my_module_requirements(
    module_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> ModuleRequirementsOut:
    """The quiz and assignment standing for one module."""
    try:
        module = await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    try:
        await access.require_module_in_tenant(session, user, module_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    # `lesson_done=True` here on purpose: this answers "what ELSE is left", and
    # the lesson is the one part the student can see for themselves.
    requirements = await enrollment_service.module_requirements(
        session, user.id, module.id, lesson_done=True
    )
    return ModuleRequirementsOut(
        needs_quiz=requirements.needs_quiz,
        quiz_passed=requirements.quiz_passed,
        best_quiz_score=requirements.best_quiz_score,
        needs_assignment=requirements.needs_assignment,
        assignment_submitted=requirements.assignment_submitted,
        ready_to_complete=requirements.met,
        outstanding=requirements.outstanding,
    )


@router.post("/courses/{course_id}/enroll", status_code=status.HTTP_201_CREATED)
async def enroll_in_course(
    course_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> dict[str, str]:
    try:
        course = await course_service.get_course(session, course_id)
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    # A course that is off sale takes no NEW enrolments. Existing ones are
    # untouched on purpose: a student mid-way through a course must not lose it
    # because the catalogue changed. Staff still enrol, to check a draft works
    # before publishing it.
    if (
        not course.is_published
        and user.role not in access.STAFF_ROLES
        and not await access.has_paid_for_course(session, user.id, course_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )

    # THE paywall. A free course enrols straight away; a paid one needs a
    # verified order or a live subscription. Without this the whole payment
    # system is decoration — anyone could enrol in a ₹2,999 course and use it.
    try:
        await access.require_course_access(session, user, course)
    except access.CourseOutsideTenantError:
        # Caught BEFORE CourseLockedError, which it subclasses. 404 rather than
        # 402: another organization's training is not for sale, and a Buy
        # button would both mislead the learner and confirm the course exists.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None
    except access.CourseLockedError:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Buy this course, or subscribe, to enrol.",
        ) from None

    try:
        await enrollment_service.enroll(session, user.id, course_id)
    except enrollment_service.AlreadyEnrolledError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    return {"status": "enrolled"}


@router.delete("/courses/{course_id}/enroll", status_code=status.HTTP_204_NO_CONTENT)
async def unenroll_from_course(
    course_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> None:
    try:
        await enrollment_service.unenroll(session, user.id, course_id)
    except enrollment_service.NotEnrolledError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not enrolled in this course.",
        ) from None
