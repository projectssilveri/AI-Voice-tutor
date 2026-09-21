"""Quizzes: multiple-choice, deterministic grading, UNLIMITED retakes.

Nothing in this file caps attempts, and nothing ever should. The original spec is
explicit that the certification cap applies only to `cert_exams`.

The student-facing route returns `QuizQuestionForStudent`, which has no
`correct_answer` field — so the answer key cannot leak from here even by
mistake.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import CurrentUser, DbSession, require_role
from app.models.user import UserRole
from app.schemas.quiz import (
    ModuleQuiz,
    QuizAnswerResult,
    QuizAttemptSummary,
    QuizQuestionAdmin,
    QuizQuestionCreate,
    QuizQuestionForStudent,
    QuizResult,
    QuizSubmission,
)
from app.services import access
from app.services import courses as course_service
from app.services import enrollments as enrollment_service
from app.services import quizzes as quiz_service

router = APIRouter(tags=["quizzes"])

staff_only = Depends(require_role(UserRole.ADMIN))


@router.get("/modules/{module_id}/quiz", response_model=ModuleQuiz)
async def get_module_quiz(
    module_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> ModuleQuiz:
    """The quiz as a student sees it — questions and options, no answers."""
    try:
        module = await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    # A quiz belongs to a module of a course that may be paid for. Reading the
    # module text is deliberately unlimited; the assessments are part of what
    # the course costs.
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

    questions = await quiz_service.list_questions(session, module_id)

    return ModuleQuiz(
        module_id=module.id,
        module_title=module.title,
        questions=[
            QuizQuestionForStudent(
                id=q.id, question=q.question, options=list(q.options)
            )
            for q in questions
        ],
        attempts_taken=await quiz_service.attempts_taken(session, user.id, module_id),
        best_score=await quiz_service.best_score(session, user.id, module_id),
    )


@router.post(
    "/modules/{module_id}/quiz/attempts",
    response_model=QuizResult,
    status_code=status.HTTP_201_CREATED,
)
async def submit_quiz(
    module_id: uuid.UUID,
    payload: QuizSubmission,
    session: DbSession,
    user: CurrentUser,
) -> QuizResult:
    """Grade and record an attempt.

    Unlimited retakes, but not unlimited access: the course still has to be one
    this student may use. Re-checked here rather than trusted from the fetch,
    because this is the call that writes a score.
    """
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

    questions = await quiz_service.list_questions(session, module_id)
    if not questions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This module has no quiz yet.",
        )

    # Later answers for the same question win, so a resubmitted duplicate does
    # not silently grade the first one.
    submitted = {answer.question_id: answer.selected for answer in payload.answers}
    graded = quiz_service.grade(questions, submitted)

    attempt = await quiz_service.record_attempt(
        session, user_id=user.id, module_id=module_id, score=graded.score
    )

    return QuizResult(
        attempt_id=attempt.id,
        attempt_number=attempt.attempt_number,
        score=graded.score,
        correct_count=graded.correct_count,
        total_questions=graded.total,
        # From the one constant that decides it. `module_requirements` gates
        # completion on exactly this, so answering anything else here would be
        # the screen and the gate disagreeing about the same quiz.
        passed=graded.score >= enrollment_service.QUIZ_PASS_MARK,
        pass_mark=enrollment_service.QUIZ_PASS_MARK,
        results=[
            QuizAnswerResult(
                question_id=answer.question.id,
                question=answer.question.question,
                options=list(answer.question.options),
                selected=answer.selected,
                correct_answer=answer.question.correct_answer,
                is_correct=answer.is_correct,
            )
            for answer in graded.answers
        ],
    )


@router.get(
    "/modules/{module_id}/quiz/attempts", response_model=list[QuizAttemptSummary]
)
async def list_my_quiz_attempts(
    module_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> list[QuizAttemptSummary]:
    attempts = await quiz_service.attempt_history(session, user.id, module_id)
    return [QuizAttemptSummary.model_validate(a) for a in attempts]


# --- Authoring -------------------------------------------------------------


@router.get(
    "/modules/{module_id}/quiz/questions",
    response_model=list[QuizQuestionAdmin],
    dependencies=[staff_only],
)
async def list_questions_with_answers(
    module_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> list[QuizQuestionAdmin]:
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

    questions = await quiz_service.list_questions(session, module_id)
    return [QuizQuestionAdmin.model_validate(q) for q in questions]


@router.post(
    "/modules/{module_id}/quiz/questions",
    response_model=QuizQuestionAdmin,
    status_code=status.HTTP_201_CREATED,
    dependencies=[staff_only],
)
async def create_question(
    module_id: uuid.UUID,
    payload: QuizQuestionCreate,
    session: DbSession,
    user: CurrentUser,
) -> QuizQuestionAdmin:
    from app.models.quiz import QuizQuestion

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

    question = QuizQuestion(
        module_id=module_id,
        question=payload.question,
        options=payload.options,
        correct_answer=payload.correct_answer,
    )
    session.add(question)
    await session.commit()
    await session.refresh(question)
    return QuizQuestionAdmin.model_validate(question)


@router.delete(
    "/quiz/questions/{question_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[staff_only],
)
async def delete_question(
    question_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> None:
    from app.models.quiz import QuizQuestion

    # Tenancy. `staff_only` says "you are staff"; it says nothing about WHOSE
    # course this question belongs to. Adding a question is addressed by module
    # and therefore checked a few lines above; deleting one is addressed by
    # question id and reached no check at all — so a platform admin could strip
    # a customer's private quiz one question at a time.
    try:
        await access.require_question_in_tenant(session, user, question_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Question not found."
        ) from None

    question = await session.get(QuizQuestion, question_id)
    if question is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Question not found."
        )
    await session.delete(question)
    await session.commit()
