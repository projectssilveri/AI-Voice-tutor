"""Quiz schemas.

The load-bearing detail here is that there are two question shapes:
`QuizQuestionForStudent` has no `correct_answer`, `QuizQuestionAdmin` does.
Keeping them as separate types means a student-facing route cannot leak the
answer key by accident — it would not type-check.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas import ORMModel
from app.schemas.text import NonBlankText, OptionalNonBlankText


class QuizQuestionForStudent(BaseModel):
    """What a student sees while taking a quiz. No answer key."""

    id: uuid.UUID
    question: str
    options: list[str]


class QuizQuestionAdmin(ORMModel):
    """The authoring view, including the answer."""

    id: uuid.UUID
    module_id: uuid.UUID
    question: str
    options: list[str]
    correct_answer: int
    created_at: datetime
    updated_at: datetime


class QuizQuestionCreate(BaseModel):
    question: NonBlankText
    options: list[str] = Field(min_length=2, max_length=10)
    correct_answer: int = Field(ge=0)

    @field_validator("correct_answer")
    @classmethod
    def _answer_must_index_an_option(cls, value: int, info) -> int:
        options = info.data.get("options")
        # Rejected here as well as by the DB check constraint, because the
        # constraint only knows the index is non-negative — it cannot know how
        # many options this particular question has.
        if options is not None and value >= len(options):
            raise ValueError(
                f"correct_answer {value} is out of range for {len(options)} options"
            )
        return value


class QuizQuestionUpdate(BaseModel):
    question: OptionalNonBlankText
    options: list[str] | None = Field(default=None, min_length=2, max_length=10)
    correct_answer: int | None = Field(default=None, ge=0)


class QuizAnswer(BaseModel):
    question_id: uuid.UUID
    # Index into that question's options.
    selected: int = Field(ge=0)


class QuizSubmission(BaseModel):
    answers: list[QuizAnswer]

    # How many times the student left the exam window during this attempt.
    # Optional, and only ever sent by the certification screen — a quiz is
    # unlimited and not worth watching.
    #
    # Recorded against the attempt so an admin can see it when a mark is
    # queried, which is the whole reason the count is kept. It is NOT trusted
    # as a control: the consequence is applied client-side and a student who
    # disables JavaScript defeats it, so treating this number as an
    # enforcement signal would be pretending to a rigour the mechanism does
    # not have.
    lapses: int | None = Field(default=None, ge=0, le=100)

    # Whether leaving is what ended the attempt, as opposed to the student
    # pressing Submit. Sent rather than re-derived from `lapses` against a
    # threshold: the allowance lives in one place, on the screen that enforces
    # it, and a second copy here is how the two come to disagree. Audit
    # metadata only — nothing about the mark depends on it.
    ended_by_leaving: bool = False


class QuizAnswerResult(BaseModel):
    """One question, as the student is shown it back after grading.

    CARRIES THE ANSWER, and only on a PRACTICE quiz. Retakes are unlimited and
    the quiz exists to teach, so telling somebody what the right answer was is
    most of the point of them taking it.

    The certification exam does not do this and never has: `CertExamResult` is
    an attempt, a standing and a flag, and the paper itself comes back as
    `QuizQuestionForStudent`, which has no answer field. That is the assessment
    where revealing would matter, and it is already silent.
    """

    question_id: uuid.UUID
    question: str
    options: list[str]
    selected: int | None
    correct_answer: int
    is_correct: bool


class QuizResult(BaseModel):
    """Returned after submitting.

    The answer key is included *here* deliberately, and only for a practice
    quiz: the attempt is already recorded, retakes are unlimited, and a quiz a
    student can learn nothing from is a quiz that only measures. The
    certification exam reveals nothing, at any point.
    """

    attempt_id: uuid.UUID
    attempt_number: int
    score: float
    correct_count: int
    total_questions: int
    #: WHETHER THAT WAS A PASS, which this did not say. The screen printed a
    #: percentage and a Retake button, and the student found out they had
    #: failed later, from a different screen, when the module refused to tick
    #: off. The server has always known; it just never answered the question.
    passed: bool
    #: The bar, sent rather than assumed. A second copy of 70 in the browser is
    #: a copy that goes stale the day the mark moves.
    pass_mark: float
    results: list[QuizAnswerResult]


class QuizAttemptSummary(ORMModel):
    id: uuid.UUID
    module_id: uuid.UUID
    score: float
    attempt_number: int
    ts: datetime


class ModuleQuiz(BaseModel):
    module_id: uuid.UUID
    module_title: str
    questions: list[QuizQuestionForStudent]
    # Unlimited retakes — this is a counter for display, never a limit.
    attempts_taken: int
    best_score: float | None
