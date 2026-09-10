"""Assignments: authoring, submission, and deterministic grading.

Grading here compares the submitted answer with the answers the author listed
as acceptable. It does not call an LLM. That is a deliberate instruction
(2026-08-09) overriding the tech-stack line about the Anthropic API grading
open-ended answers: a mark a student can appeal has to be reproducible, and the
same model asked the same question twice can disagree with itself. This gives
the same result every time, costs nothing, and returns instantly.

Normalisation before comparison is what stops the match being pedantic —
trailing whitespace, doubled spaces, a full stop at the end, or capitalisation
must not cost a student the mark. Anything beyond that is a real difference in
the answer, and an author who wants to accept it can add it to
`accepted_answers`.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.assignment import (
    Assignment,
    AssignmentSubmission,
    GradedBy,
    MatchMode,
)
from app.services.concurrency import commit_with_retry

# Punctuation that carries no meaning at the end of a short answer.
_TRAILING_PUNCTUATION = ".,;:!?"

_WHITESPACE = re.compile(r"\s+")


class AssignmentNotFoundError(LookupError):
    pass


class SubmissionNotFoundError(LookupError):
    pass


def normalise(text: str, *, case_sensitive: bool = False) -> str:
    """Reduce an answer to the form comparisons happen on.

    NFKC first so that visually identical characters typed from different
    keyboards (a full-width bracket, a non-breaking space) compare equal —
    otherwise a student on a phone keyboard can be marked wrong for something
    invisible on screen.
    """
    cleaned = unicodedata.normalize("NFKC", text).strip()
    cleaned = _WHITESPACE.sub(" ", cleaned)
    cleaned = cleaned.rstrip(_TRAILING_PUNCTUATION).strip()
    if not case_sensitive:
        cleaned = cleaned.casefold()
    return cleaned


@dataclass(frozen=True)
class GradeResult:
    is_correct: bool
    score: float
    feedback: str


def grade_answer(assignment: Assignment, answer: str) -> GradeResult:
    """Match `answer` against the assignment's accepted answers.

    EXACT    — the normalised answer must equal one accepted answer.
    CONTAINS — the normalised answer must contain *every* accepted answer,
               which is how an author requires several terms to be mentioned in
               a longer written response.
    """
    case_sensitive = assignment.case_sensitive
    submitted = normalise(answer, case_sensitive=case_sensitive)
    accepted = [
        normalise(candidate, case_sensitive=case_sensitive)
        for candidate in assignment.accepted_answers
    ]

    if assignment.match_mode is MatchMode.CONTAINS:
        missing = [
            original
            for original, candidate in zip(
                assignment.accepted_answers, accepted, strict=True
            )
            if candidate and candidate not in submitted
        ]
        is_correct = not missing
        if is_correct:
            feedback = "Correct — your answer covers everything this asked for."
        else:
            # Naming the count, not the terms: saying which are missing would
            # hand over the answer, and resubmission is unlimited.
            feedback = (
                f"Not quite. Your answer is missing {len(missing)} of the "
                f"{len(accepted)} things this question asks you to cover. "
                "Revisit the module and try again."
            )
    else:
        is_correct = submitted in accepted
        feedback = (
            "Correct."
            if is_correct
            else "That does not match the expected answer. "
            "Revisit the module and try again — there is no limit on attempts."
        )

    return GradeResult(
        is_correct=is_correct,
        score=float(assignment.max_score) if is_correct else 0.0,
        feedback=feedback,
    )


async def get_assignment(
    session: AsyncSession, assignment_id: uuid.UUID
) -> Assignment:
    assignment = await session.get(Assignment, assignment_id)
    if assignment is None:
        raise AssignmentNotFoundError(str(assignment_id))
    return assignment


async def list_for_module(
    session: AsyncSession, module_id: uuid.UUID
) -> list[Assignment]:
    result = await session.execute(
        select(Assignment)
        .where(Assignment.module_id == module_id)
        .order_by(Assignment.created_at)
    )
    return list(result.scalars())


async def submissions_by_assignment(
    session: AsyncSession,
    assignment_ids: Sequence[uuid.UUID],
    user_id: uuid.UUID,
) -> dict[uuid.UUID, list[AssignmentSubmission]]:
    """Every submission for a set of assignments, grouped by assignment.

    One query for the whole page. Calling `list_submissions` in a loop is an
    N+1 that costs a round trip per assignment — invisible with the four in the
    seed data, and the reason the dashboard slows down once a course has fifty.
    """
    if not assignment_ids:
        return {}

    result = await session.execute(
        select(AssignmentSubmission)
        .where(
            AssignmentSubmission.assignment_id.in_(assignment_ids),
            AssignmentSubmission.user_id == user_id,
        )
        .order_by(AssignmentSubmission.attempt_number)
    )

    grouped: dict[uuid.UUID, list[AssignmentSubmission]] = {}
    for submission in result.scalars():
        grouped.setdefault(submission.assignment_id, []).append(submission)
    return grouped


async def submit(
    session: AsyncSession,
    *,
    assignment_id: uuid.UUID,
    user_id: uuid.UUID,
    answer: str,
) -> AssignmentSubmission:
    """Grade and record one answer.

    Resubmission is unlimited — `attempt_number` counts, it does not cap.
    """
    assignment = await get_assignment(session, assignment_id)
    result = grade_answer(assignment, answer)

    # The attempt number is counted then written, so two submissions racing
    # would both claim the same one and the unique constraint would surface as
    # a 500 on the submit button. Retrying re-counts it. Grading is pure and
    # deterministic, so it is computed once outside the retry.
    state: dict[str, AssignmentSubmission] = {}

    async def build() -> None:
        used = await session.scalar(
            select(func.count())
            .select_from(AssignmentSubmission)
            .where(
                AssignmentSubmission.assignment_id == assignment_id,
                AssignmentSubmission.user_id == user_id,
            )
        )
        submission = AssignmentSubmission(
            assignment_id=assignment_id,
            user_id=user_id,
            answer=answer,
            attempt_number=(used or 0) + 1,
            score=result.score,
            is_correct=result.is_correct,
            feedback=result.feedback,
            graded_by=GradedBy.AUTO,
        )
        session.add(submission)
        state["submission"] = submission

    await commit_with_retry(session, build, description="assignment submission")

    submission = state["submission"]
    await session.refresh(submission)
    return submission


async def override_grade(
    session: AsyncSession,
    *,
    submission_id: uuid.UUID,
    admin_id: uuid.UUID,
    score: float,
    feedback: str | None,
) -> AssignmentSubmission:
    """An admin re-marks a submission.

    Matching cannot judge an answer that is right in a way the author did not
    anticipate, so an admin must be able to correct it. The override records
    *which* admin — this is a change to a student's mark, and an unattributed
    one is not defensible.
    """
    submission = await session.get(
        AssignmentSubmission,
        submission_id,
        options=[selectinload(AssignmentSubmission.assignment)],
    )
    if submission is None:
        raise SubmissionNotFoundError(str(submission_id))

    max_score = float(submission.assignment.max_score)
    if score < 0 or score > max_score:
        raise ValueError(f"Score must be between 0 and {max_score:g}.")

    submission.score = score
    submission.is_correct = score >= max_score
    submission.feedback = feedback
    submission.graded_by = GradedBy.ADMIN
    submission.graded_by_user_id = admin_id
    submission.graded_at = func.now()

    await session.commit()
    await session.refresh(submission)
    return submission
