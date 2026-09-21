"""Assignments: the "tasks/assignments" the spec puts on the student dashboard.

Grading is deterministic matching, not AI — see `services/assignments.py` for
why. Submissions are unlimited, like quizzes; only certification exams are
capped.

The student-facing routes return `AssignmentForStudent`, which has no
`accepted_answers` field, so the answer key cannot leak from here even by
mistake. Authoring routes are staff-only and return `AssignmentAdmin`.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.deps import CurrentUser, DbSession, RequireAdmin, require_role
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.course import Course, Module
from app.models.enrollment import Enrollment
from app.models.user import User, UserRole
from app.schemas.assignment import (
    AdminSubmissionRow,
    AssignmentAdmin,
    AssignmentCreate,
    AssignmentForStudent,
    AssignmentOverride,
    AssignmentUpdate,
    StudentAssignment,
    SubmissionCreate,
    SubmissionRead,
)
from app.services import access
from app.services import assignments as assignment_service
from app.services import courses as course_service

router = APIRouter(tags=["assignments"])

staff_only = Depends(require_role(UserRole.ADMIN))


def _for_student(assignment: Assignment) -> AssignmentForStudent:
    return AssignmentForStudent(
        id=assignment.id,
        module_id=assignment.module_id,
        title=assignment.title,
        prompt=assignment.prompt,
        max_score=assignment.max_score,
    )


def _to_student_row(
    assignment: Assignment,
    submissions: list[AssignmentSubmission],
    *,
    module_title: str,
    course_id: uuid.UUID,
    course_title: str,
) -> StudentAssignment:
    scores = [float(s.score) for s in submissions]
    return StudentAssignment(
        assignment=_for_student(assignment),
        module_title=module_title,
        course_id=course_id,
        course_title=course_title,
        submissions=[SubmissionRead.model_validate(s) for s in submissions],
        best_score=max(scores) if scores else None,
        is_complete=any(s.is_correct for s in submissions),
    )


# --- Student ---------------------------------------------------------------


@router.get(
    "/modules/{module_id}/assignments", response_model=list[StudentAssignment]
)
async def list_module_assignments(
    module_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> list[StudentAssignment]:
    """This module's assignments, each with the student's own history."""
    try:
        module = await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    # Assignments are part of what a paid course sells. Reading the module text
    # stays unlimited; the graded work does not.
    try:
        await access.require_access_to_module(session, user, module_id)
    except access.CourseOutsideTenantError:
        # Before CourseLockedError, which it subclasses. Another organization's
        # material is not for sale, so 404 rather than a Buy button.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not found."
        ) from None
    except access.CourseLockedError as exc:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(exc)
        ) from None

    course = await session.get(Course, module.course_id)
    assignments = await assignment_service.list_for_module(session, module_id)

    # One query for every assignment's submissions, not one per assignment.
    by_assignment = await assignment_service.submissions_by_assignment(
        session, [a.id for a in assignments], user.id
    )

    return [
        _to_student_row(
            assignment,
            by_assignment.get(assignment.id, []),
            module_title=module.title,
            course_id=module.course_id,
            course_title=course.title if course else "",
        )
        for assignment in assignments
    ]


@router.get("/assignments/mine", response_model=list[StudentAssignment])
async def list_my_assignments(
    session: DbSession, user: CurrentUser
) -> list[StudentAssignment]:
    """Every assignment across the courses this student is enrolled in.

    This is what the dashboard's tasks section reads. Scoped to enrolments so
    it is a to-do list rather than a catalogue of everything on the platform.
    """
    result = await session.execute(
        select(Assignment)
        .join(Module, Module.id == Assignment.module_id)
        .join(Course, Course.id == Module.course_id)
        .join(Enrollment, Enrollment.course_id == Course.id)
        .where(Enrollment.user_id == user.id)
        .order_by(Course.title, Module.order, Assignment.created_at)
        .options(selectinload(Assignment.module).selectinload(Module.course))
    )
    assignments = list(result.scalars())

    # One query for every assignment's submissions. This endpoint feeds the
    # dashboard, so it runs on every page load — a round trip per assignment
    # would scale with the size of the student's course list.
    by_assignment = await assignment_service.submissions_by_assignment(
        session, [a.id for a in assignments], user.id
    )

    return [
        _to_student_row(
            assignment,
            by_assignment.get(assignment.id, []),
            module_title=assignment.module.title,
            course_id=assignment.module.course_id,
            course_title=assignment.module.course.title,
        )
        for assignment in assignments
    ]


@router.post(
    "/assignments/{assignment_id}/submissions",
    response_model=SubmissionRead,
    status_code=status.HTTP_201_CREATED,
)
async def submit_assignment(
    assignment_id: uuid.UUID,
    payload: SubmissionCreate,
    session: DbSession,
    user: CurrentUser,
) -> SubmissionRead:
    """Grade and record an answer.

    Resubmission is unlimited, but the course still has to be one this student
    may use — re-checked here because this is the call that writes a mark.
    """
    try:
        assignment = await assignment_service.get_assignment(session, assignment_id)
    except assignment_service.AssignmentNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found."
        ) from None

    try:
        await access.require_access_to_module(session, user, assignment.module_id)
    except access.CourseOutsideTenantError:
        # Before CourseLockedError, which it subclasses. Another organization's
        # material is not for sale, so 404 rather than a Buy button.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not found."
        ) from None
    except access.CourseLockedError as exc:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(exc)
        ) from None

    try:
        submission = await assignment_service.submit(
            session,
            assignment_id=assignment_id,
            user_id=user.id,
            answer=payload.answer,
        )
    except assignment_service.AssignmentNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found."
        ) from None

    return SubmissionRead.model_validate(submission)


# --- Authoring (staff) -----------------------------------------------------


@router.get(
    "/modules/{module_id}/assignments/admin",
    response_model=list[AssignmentAdmin],
    dependencies=[staff_only],
)
async def list_module_assignments_admin(
    module_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> list[AssignmentAdmin]:
    # Tenancy. `staff_only` says "you are staff"; it says nothing about WHOSE
    # module this is. Measured live before this: an ordinary platform admin read
    # an Acme private course's quiz answer key and its assignments — decision
    # 170's leak, in the routes that fix did not reach.
    try:
        await access.require_module_in_tenant(session, user, module_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    # AND THAT IT EXISTS. `require_module_in_tenant` returns early for a module
    # that is not there, on the grounds that "the caller's own 404 is the
    # better error" — and this caller had no 404, so it answered an empty list
    # instead. A module that was deleted and a module with nothing in it read
    # the same, which is the one difference an authoring screen needs.
    try:
        await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    assignments = await assignment_service.list_for_module(session, module_id)
    return [AssignmentAdmin.model_validate(a) for a in assignments]


@router.post(
    "/modules/{module_id}/assignments",
    response_model=AssignmentAdmin,
    status_code=status.HTTP_201_CREATED,
    dependencies=[staff_only],
)
async def create_assignment(
    module_id: uuid.UUID,
    payload: AssignmentCreate,
    session: DbSession,
    user: CurrentUser,
) -> AssignmentAdmin:
    # Tenancy. `staff_only` says "you are staff"; it says nothing about WHOSE
    # module this is. Measured live before this: an ordinary platform admin read
    # an Acme private course's quiz answer key and its assignments — decision
    # 170's leak, in the routes that fix did not reach.
    try:
        await access.require_module_in_tenant(session, user, module_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    try:
        await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    assignment = Assignment(module_id=module_id, **payload.model_dump())
    session.add(assignment)
    await session.commit()
    await session.refresh(assignment)
    return AssignmentAdmin.model_validate(assignment)


@router.patch(
    "/assignments/{assignment_id}",
    response_model=AssignmentAdmin,
    dependencies=[staff_only],
)
async def update_assignment(
    assignment_id: uuid.UUID,
    payload: AssignmentUpdate,
    session: DbSession,
    user: CurrentUser,
) -> AssignmentAdmin:
    # Tenancy. `staff_only` says "you are staff"; it says nothing about WHOSE
    # course this belongs to. Creating one of these is addressed by module and
    # therefore checked; editing is addressed by assignment id, and reached no
    # check at all.
    try:
        await access.require_assignment_in_tenant(session, user, assignment_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found."
        ) from None

    try:
        assignment = await assignment_service.get_assignment(session, assignment_id)
    except assignment_service.AssignmentNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found."
        ) from None

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(assignment, field, value)

    await session.commit()
    await session.refresh(assignment)
    return AssignmentAdmin.model_validate(assignment)


@router.delete(
    "/assignments/{assignment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[staff_only],
)
async def delete_assignment(
    assignment_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> None:
    # Tenancy. `staff_only` says "you are staff"; it says nothing about WHOSE
    # course this belongs to. Creating one of these is addressed by module and
    # therefore checked; deleting is addressed by assignment id, and reached no
    # check at all.
    try:
        await access.require_assignment_in_tenant(session, user, assignment_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found."
        ) from None

    try:
        assignment = await assignment_service.get_assignment(session, assignment_id)
    except assignment_service.AssignmentNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found."
        ) from None

    await session.delete(assignment)
    await session.commit()


# --- Review (admin) --------------------------------------------------------


@router.get(
    "/admin/submissions",
    response_model=list[AdminSubmissionRow],
)
async def list_all_submissions(
    session: DbSession, admin: RequireAdmin, limit: int = 200
) -> list[AdminSubmissionRow]:
    """Every submission IN SCOPE, newest first, for the review queue.

    `staff_only` said "you are staff" and nothing about whose learners these
    are, so this handed a customer's people, by name and email, together with
    the work they wrote, to any platform admin. `override_submission` below has
    checked tenancy since the day it was written; the listing that feeds it
    never did, which is the same gap issues 46 and 58 report on the other
    screens.

    A super admin still reads across tenants, for support. An organisation
    marks its own people's work in its own portal.
    """
    grader = User.__table__.alias("grader")

    course_scope = (
        ()
        if admin.role is UserRole.SUPER_ADMIN
        else (Course.organization_id.is_(None),)
    )

    result = await session.execute(
        select(
            AssignmentSubmission,
            Assignment.title,
            Assignment.max_score,
            Module.title,
            Course.title,
            User.name,
            User.email,
            grader.c.name,
        )
        .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
        .join(Module, Module.id == Assignment.module_id)
        .join(Course, Course.id == Module.course_id)
        .join(User, User.id == AssignmentSubmission.user_id)
        .outerjoin(grader, grader.c.id == AssignmentSubmission.graded_by_user_id)
        .where(*course_scope)
        .order_by(AssignmentSubmission.submitted_at.desc())
        .limit(min(limit, 500))
    )

    return [
        AdminSubmissionRow(
            id=submission.id,
            assignment_id=submission.assignment_id,
            assignment_title=assignment_title,
            module_title=module_title,
            course_title=course_title,
            max_score=max_score,
            user_id=submission.user_id,
            user_name=user_name,
            user_email=user_email,
            attempt_number=submission.attempt_number,
            answer=submission.answer,
            score=float(submission.score),
            is_correct=submission.is_correct,
            feedback=submission.feedback,
            graded_by=submission.graded_by.value,
            graded_by_name=grader_name,
            submitted_at=submission.submitted_at,
        )
        for (
            submission,
            assignment_title,
            max_score,
            module_title,
            course_title,
            user_name,
            user_email,
            grader_name,
        ) in result.all()
    ]


@router.post(
    "/admin/submissions/{submission_id}/override",
    response_model=SubmissionRead,
)
async def override_submission(
    submission_id: uuid.UUID,
    payload: AssignmentOverride,
    session: DbSession,
    admin: RequireAdmin,
) -> SubmissionRead:
    """Re-mark a submission by hand.

    Matching cannot recognise an answer that is right in a way the author did
    not anticipate. The override records which admin made it — changing a
    student's mark anonymously is not defensible.
    """
    # Tenancy. `RequireAdmin` says "you are staff"; it says nothing about WHOSE
    # course this belongs to. Creating one of these is addressed by module and
    # therefore checked; overriding a mark is addressed by submission id, and reached no
    # check at all.
    try:
        await access.require_submission_in_tenant(session, admin, submission_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found."
        ) from None

    try:
        submission = await assignment_service.override_grade(
            session,
            submission_id=submission_id,
            admin_id=admin.id,
            score=payload.score,
            feedback=payload.feedback,
        )
    except assignment_service.SubmissionNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found."
        ) from None
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    return SubmissionRead.model_validate(submission)
