"""Certification exams: attempt-gated, capped, and certificate-issuing.

Separate from quizzes specifically because of the cap. See
`app/services/certification.py` for the rule; the allowance is recomputed there
on every submission, so a caller cannot bypass it by forgetting to check.

Exam questions are drawn from the `quiz_questions` of every module in the
course. The brief defines no separate exam-question table, and a certification
exam over the course's own material is the reading that needs no new schema.
Flagged as a decision.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select

from app.deps import CurrentUser, DbSession, require_role
from app.models.audit import AuditAction
from app.models.certification import CertAttempt, CertExam, Certificate
from app.models.course import Course, Module
from app.models.quiz import QuizQuestion
from app.models.user import User, UserRole
from app.schemas.quiz import QuizQuestionForStudent, QuizSubmission
from app.services import access, audit, certificate_pdf, certification
from app.services import courses as course_service
from app.services import quizzes as quiz_service

router = APIRouter(tags=["certification"])

admin_only = Depends(require_role(UserRole.ADMIN))

_UNSAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(course_title: str) -> str:
    """Build a download filename that cannot break the header.

    A course title is author-supplied text. Unescaped, a quote or newline in it
    would let the author inject into the Content-Disposition header, so
    everything outside a known-safe set is collapsed to a hyphen.
    """
    slug = _UNSAFE_FILENAME.sub("-", course_title).strip("-")
    return f"{slug}-certificate.pdf" if slug else "certificate.pdf"


class CertExamRead(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    default_max_attempts: int


class AttemptStanding(BaseModel):
    """What the exam screen needs to decide whether to let a student start."""

    allowed_attempts: int
    used_attempts: int
    remaining_attempts: int
    can_attempt: bool
    base_attempts: int
    granted_attempts: int
    passed: bool
    certificate_issued_at: datetime | None


class CertExamDetail(CertExamRead):
    standing: AttemptStanding
    question_count: int


class CertAttemptRead(BaseModel):
    id: uuid.UUID
    attempt_number: int
    score: float
    passed: bool
    ts: datetime


class CertExamResult(BaseModel):
    attempt: CertAttemptRead
    standing: AttemptStanding
    certificate_issued: bool


class EarnedCertificate(BaseModel):
    """One row on the student's own certificates shelf."""

    id: uuid.UUID
    cert_exam_id: uuid.UUID
    exam_title: str
    course_id: uuid.UUID
    course_title: str
    issued_at: datetime
    score: float | None


class CertExamCreate(BaseModel):
    title: str
    default_max_attempts: int | None = None


async def _exam_questions(
    session: DbSession, course_id: uuid.UUID
) -> list[QuizQuestion]:
    result = await session.execute(
        select(QuizQuestion)
        .join(Module, Module.id == QuizQuestion.module_id)
        .where(Module.course_id == course_id)
        .order_by(Module.order, QuizQuestion.created_at)
    )
    return list(result.scalars().all())


async def _standing(
    session: DbSession, user_id: uuid.UUID, exam_id: uuid.UUID
) -> AttemptStanding:
    allowance = await certification.get_allowance(session, user_id, exam_id)
    certificate = await certification.get_certificate(session, user_id, exam_id)
    return AttemptStanding(
        allowed_attempts=allowance.allowed_attempts,
        used_attempts=allowance.used_attempts,
        remaining_attempts=allowance.remaining_attempts,
        can_attempt=allowance.can_attempt,
        base_attempts=allowance.base_attempts,
        granted_attempts=allowance.granted_attempts,
        passed=certificate is not None,
        certificate_issued_at=certificate.issued_at if certificate else None,
    )


@router.get("/courses/{course_id}/cert-exams", response_model=list[CertExamRead])
async def list_course_exams(
    course_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> list[CertExamRead]:
    # Ungated until now: any signed-in account could list any course's exams,
    # including another organization's private training. Decision 59 records the
    # same shape — the paywall covered the door and left the coursework open —
    # and `CourseCertificationCta` already carried a comment saying this route
    # "answers 402 for a locked course", which it did not.
    course = await session.get(Course, course_id)
    if course is None:
        return []
    try:
        await access.require_course_access(session, user, course)
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

    exams = await certification.list_exams_for_course(session, course_id)
    return [
        CertExamRead(
            id=e.id,
            course_id=e.course_id,
            title=e.title,
            default_max_attempts=e.default_max_attempts,
        )
        for e in exams
    ]


@router.get("/cert-exams/{exam_id}", response_model=CertExamDetail)
async def get_exam(
    exam_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> CertExamDetail:
    try:
        exam = await certification.get_exam(session, exam_id)
    except certification.ExamNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found."
        ) from None

    # The cover page, gated like the paper and the submit route below it.
    # Measured before this: an Acme org admin opened a PUBLIC course's exam and
    # read its title, its question count and her own attempt standing — the
    # walled garden refusing `/questions` while `/cert-exams/{id}` answered 200.
    # Three routes on one exam disagreeing about who may see it is how a leak
    # survives a review of any one of them.
    try:
        await access.require_access_to_exam(session, user, exam)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not found."
        ) from None
    except access.CourseLockedError as exc:
        # 402, not 403: this one IS for sale, and `PaywallNotice` turns it into
        # a Buy button rather than a red sentence (decision 60).
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=str(exc)
        ) from None

    questions = await _exam_questions(session, exam.course_id)
    return CertExamDetail(
        id=exam.id,
        course_id=exam.course_id,
        title=exam.title,
        default_max_attempts=exam.default_max_attempts,
        standing=await _standing(session, user.id, exam_id),
        question_count=len(questions),
    )


@router.get("/certificates/mine", response_model=list[EarnedCertificate])
async def list_my_certificates(
    session: DbSession, user: CurrentUser
) -> list[EarnedCertificate]:
    """Every certificate this student holds, newest first.

    One query with the titles joined in rather than a row per certificate
    followed by a lookup each — the same N+1 decision 45 removed elsewhere.
    The best passing score is folded in by a grouped subquery for the same
    reason.
    """
    best_score = (
        select(
            CertAttempt.cert_exam_id.label("cert_exam_id"),
            func.max(CertAttempt.score).label("best"),
        )
        .where(CertAttempt.user_id == user.id, CertAttempt.passed.is_(True))
        .group_by(CertAttempt.cert_exam_id)
        .subquery()
    )

    rows = (
        await session.execute(
            select(Certificate, CertExam, Course, best_score.c.best)
            .join(CertExam, CertExam.id == Certificate.cert_exam_id)
            .join(Course, Course.id == CertExam.course_id)
            .outerjoin(best_score, best_score.c.cert_exam_id == CertExam.id)
            .where(Certificate.user_id == user.id)
            .order_by(Certificate.issued_at.desc())
        )
    ).all()

    return [
        EarnedCertificate(
            id=certificate.id,
            cert_exam_id=exam.id,
            exam_title=exam.title,
            course_id=course.id,
            course_title=course.title,
            issued_at=certificate.issued_at,
            score=float(best) if best is not None else None,
        )
        for certificate, exam, course, best in rows
    ]


@router.get("/cert-exams/{exam_id}/certificate")
async def download_certificate(
    exam_id: uuid.UUID,
    session: DbSession,
    user: CurrentUser,
    user_id: uuid.UUID | None = None,
) -> Response:
    """The certificate as a PDF.

    `user_id` lets an admin fetch someone else's copy; a student may only ever
    fetch their own, and asking for another id is refused rather than silently
    ignored — quietly returning the caller's own certificate would make a
    permissions bug look like it worked.
    """
    # Tenancy first, for the CALLER. This refuses two things at once: a public
    # learner asking for an org exam id, and an ordinary platform admin asking
    # for a customer's student — decision 171 puts customer data with revenue
    # and role management, which only the super admin reaches.
    try:
        exam_for_scope = await certification.get_exam(session, exam_id)
    except certification.ExamNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found."
        ) from None
    try:
        await access.require_course_in_tenant(session, user, exam_for_scope.course_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not found."
        ) from None

    target_id = user.id
    if user_id is not None and user_id != user.id:
        # SUPER_ADMIN was excluded by the old `is not UserRole.ADMIN`, which
        # locked the platform owner out of a screen their own console links to.
        # Decision 50's rule is that ADMIN widens upwards; a raw comparison is
        # the one place it does not happen automatically.
        if user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only download your own certificate.",
            )
        target_id = user_id

    certificate = await certification.get_certificate(session, target_id, exam_id)
    if certificate is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No certificate has been issued for this exam yet.",
        )

    exam = await certification.get_exam(session, exam_id)
    course = await session.get(Course, exam.course_id)
    holder = await session.get(User, target_id)

    attempts = await certification.list_attempts(session, target_id, exam_id)
    best = max((float(a.score) for a in attempts if a.passed), default=None)

    pdf = certificate_pdf.render_certificate(
        certificate_id=certificate.id,
        student_name=holder.name if holder else "",
        course_title=course.title if course else "",
        exam_title=exam.title,
        score=best,
        issued_at=certificate.issued_at,
    )

    filename = _safe_filename(course.title if course else "certificate")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            # `inline` so a click opens it in the browser's viewer; the
            # filename is still used when the viewer's own save button is used.
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )


@router.get(
    "/cert-exams/{exam_id}/questions", response_model=list[QuizQuestionForStudent]
)
async def get_exam_questions(
    exam_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> list[QuizQuestionForStudent]:
    """Questions for an attempt. Refused once the allowance is exhausted.

    Gated as well as the submit route: handing out the paper to someone who can
    never submit it is a worse experience than saying so up front.
    """
    try:
        exam = await certification.get_exam(session, exam_id)
    except certification.ExamNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found."
        ) from None

    # The exam belongs to a course that may be paid for. Without this, someone
    # who never bought the course could pull the paper and — via the submit
    # route below — earn a certificate for it.
    try:
        await access.require_access_to_exam(session, user, exam)
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

    allowance = await certification.get_allowance(session, user.id, exam_id)
    if not allowance.can_attempt:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"You have used all {allowance.allowed_attempts} attempts for "
                "this exam. Contact an admin to request more."
            ),
        )

    questions = await _exam_questions(session, exam.course_id)
    if not questions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This exam has no questions yet.",
        )

    return [
        QuizQuestionForStudent(id=q.id, question=q.question, options=list(q.options))
        for q in questions
    ]


@router.post(
    "/cert-exams/{exam_id}/attempts",
    response_model=CertExamResult,
    status_code=status.HTTP_201_CREATED,
)
async def submit_exam(
    exam_id: uuid.UUID,
    payload: QuizSubmission,
    session: DbSession,
    user: CurrentUser,
) -> CertExamResult:
    """Submit an attempt. THIS is what consumes one."""
    try:
        exam = await certification.get_exam(session, exam_id)
    except certification.ExamNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found."
        ) from None

    # Checked again on submit, not only when the paper is fetched: this is the
    # call that consumes an attempt and can issue a CERTIFICATE, so it must not
    # rely on the earlier request having been made honestly.
    try:
        await access.require_access_to_exam(session, user, exam)
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

    questions = await _exam_questions(session, exam.course_id)
    if not questions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This exam has no questions yet.",
        )

    submitted = {answer.question_id: answer.selected for answer in payload.answers}
    graded = quiz_service.grade(questions, submitted)

    try:
        attempt, certificate = await certification.submit_attempt(
            session, user_id=user.id, exam_id=exam_id, score=graded.score
        )
    except certification.AttemptLimitReachedError as exc:
        # A refused attempt is recorded too. "Why does this student say they
        # could not sit the exam" is exactly the question this trail is asked,
        # and an audit log that only holds successes cannot answer it.
        await audit.record_safely(
            session,
            action=AuditAction.EXAM_SUBMITTED,
            actor=user,
            target_type="cert_exam",
            target_id=exam_id,
            metadata={"outcome": "refused", "reason": "attempt_limit_reached"},
        )
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)
        ) from None

    # The score and the pass flag, never the answers. `certification.submit_attempt`
    # has already committed the attempt, so this is its own write rather than a
    # participant in that transaction.
    await audit.record_safely(
        session,
        action=AuditAction.EXAM_SUBMITTED,
        actor=user,
        target_type="cert_exam",
        target_id=exam_id,
        metadata={
            "attempt_number": attempt.attempt_number,
            "score": float(attempt.score),
            "passed": attempt.passed,
            # How many times they left the exam window during this attempt, and
            # whether leaving is what ended it. Recorded because "why did I get
            # zero" is the question this screen generates, and an admin
            # answering it needs to see what happened rather than take the
            # student's word or ours.
            #
            # Absent for a normal submit, so a row without it means the student
            # stayed put — which is most of them.
            **(
                {
                    "lapses": payload.lapses,
                    "ended_by": (
                        "left_the_exam" if payload.ended_by_leaving else "student"
                    ),
                }
                if payload.lapses
                else {}
            ),
        },
    )
    if certificate is not None:
        await audit.record_safely(
            session,
            action=AuditAction.CERTIFICATE_ISSUED,
            actor=user,
            target_type="certificate",
            target_id=certificate.id,
            metadata={"cert_exam_id": str(exam_id)},
        )
    await session.commit()

    return CertExamResult(
        attempt=CertAttemptRead(
            id=attempt.id,
            attempt_number=attempt.attempt_number,
            score=float(attempt.score),
            passed=attempt.passed,
            ts=attempt.ts,
        ),
        standing=await _standing(session, user.id, exam_id),
        certificate_issued=certificate is not None,
    )


@router.get("/cert-exams/{exam_id}/attempts", response_model=list[CertAttemptRead])
async def list_my_attempts(
    exam_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> list[CertAttemptRead]:
    attempts = await certification.list_attempts(session, user.id, exam_id)
    return [
        CertAttemptRead(
            id=a.id,
            attempt_number=a.attempt_number,
            score=float(a.score),
            passed=a.passed,
            ts=a.ts,
        )
        for a in attempts
    ]


@router.post(
    "/courses/{course_id}/cert-exams",
    response_model=CertExamRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[admin_only],
)
async def create_exam(
    course_id: uuid.UUID,
    payload: CertExamCreate,
    session: DbSession,
    user: CurrentUser,
) -> CertExamRead:
    from app.core.config import settings
    from app.models.certification import CertExam

    # Tenancy, as on every other authoring route (decision 170). Creating an
    # exam on a customer's private course is a write across the wall.
    try:
        await access.require_course_in_tenant(session, user, course_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    try:
        await course_service.get_course(session, course_id)
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    exam = CertExam(
        course_id=course_id,
        title=payload.title,
        # Config, not a literal, so the default can change without a code edit.
        default_max_attempts=payload.default_max_attempts
        or settings.cert_default_max_attempts,
    )
    session.add(exam)
    await session.commit()
    await session.refresh(exam)
    return CertExamRead(
        id=exam.id,
        course_id=exam.course_id,
        title=exam.title,
        default_max_attempts=exam.default_max_attempts,
    )
