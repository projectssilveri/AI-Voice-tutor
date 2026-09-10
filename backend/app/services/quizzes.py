"""Quiz logic: deterministic grading, unlimited retakes.

Grading is pure arithmetic against `quiz_questions.correct_answer` — no AI is
involved, so a score is reproducible and explainable.

There is NO attempt cap here and there must never be one. The spec is explicit
that quizzes are unlimited retakes; only certification exams are capped.
`attempt_number` is a sequence for display and history, not a limit.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.quiz import QuizAttempt, QuizQuestion
from app.services.concurrency import commit_with_retry


class NoQuestionsError(LookupError):
    """A module has no quiz yet."""


@dataclass(slots=True)
class GradedAnswer:
    question: QuizQuestion
    selected: int | None
    is_correct: bool


@dataclass(slots=True)
class GradedQuiz:
    answers: list[GradedAnswer]
    correct_count: int
    total: int

    @property
    def score(self) -> float:
        if self.total == 0:
            return 0.0
        # Two decimal places to match the NUMERIC(5,2) column.
        return round(self.correct_count / self.total * 100, 2)


async def list_questions(
    session: AsyncSession, module_id: uuid.UUID
) -> list[QuizQuestion]:
    result = await session.execute(
        select(QuizQuestion)
        .where(QuizQuestion.module_id == module_id)
        .order_by(QuizQuestion.created_at)
    )
    return list(result.scalars().all())


def grade(
    questions: list[QuizQuestion], submitted: dict[uuid.UUID, int]
) -> GradedQuiz:
    """Grade a submission against the answer key.

    Unanswered questions count as wrong rather than being skipped — otherwise
    a student could raise their percentage by answering only what they know.
    """
    answers: list[GradedAnswer] = []
    correct = 0

    for question in questions:
        selected = submitted.get(question.id)
        is_correct = selected is not None and selected == question.correct_answer
        if is_correct:
            correct += 1
        answers.append(
            GradedAnswer(question=question, selected=selected, is_correct=is_correct)
        )

    return GradedQuiz(answers=answers, correct_count=correct, total=len(questions))


async def next_attempt_number(
    session: AsyncSession, user_id: uuid.UUID, module_id: uuid.UUID
) -> int:
    highest = await session.scalar(
        select(func.max(QuizAttempt.attempt_number)).where(
            QuizAttempt.user_id == user_id, QuizAttempt.module_id == module_id
        )
    )
    return 1 if highest is None else highest + 1


async def record_attempt(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    module_id: uuid.UUID,
    score: float,
) -> QuizAttempt:
    # The attempt number is read then written, so two submissions racing would
    # both pick the same one and the unique constraint would surface as a 500.
    # Retrying re-reads the number. See services/concurrency.py.
    state: dict[str, QuizAttempt] = {}

    async def build() -> None:
        attempt = QuizAttempt(
            user_id=user_id,
            module_id=module_id,
            score=score,
            attempt_number=await next_attempt_number(session, user_id, module_id),
        )
        session.add(attempt)
        state["attempt"] = attempt

    await commit_with_retry(session, build, description="quiz attempt")

    attempt = state["attempt"]
    await session.refresh(attempt)
    return attempt


async def attempt_history(
    session: AsyncSession, user_id: uuid.UUID, module_id: uuid.UUID
) -> list[QuizAttempt]:
    result = await session.execute(
        select(QuizAttempt)
        .where(QuizAttempt.user_id == user_id, QuizAttempt.module_id == module_id)
        .order_by(QuizAttempt.attempt_number.desc())
    )
    return list(result.scalars().all())


async def best_score(
    session: AsyncSession, user_id: uuid.UUID, module_id: uuid.UUID
) -> float | None:
    value = await session.scalar(
        select(func.max(QuizAttempt.score)).where(
            QuizAttempt.user_id == user_id, QuizAttempt.module_id == module_id
        )
    )
    return float(value) if value is not None else None


async def attempts_taken(
    session: AsyncSession, user_id: uuid.UUID, module_id: uuid.UUID
) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(QuizAttempt)
        .where(QuizAttempt.user_id == user_id, QuizAttempt.module_id == module_id)
    )
    return count or 0
