"""Assignment schemas.

The load-bearing detail, exactly as in `quiz.py`: there are two assignment
shapes. `AssignmentForStudent` has no `accepted_answers`, `AssignmentAdmin`
does. Keeping them as separate types means a student-facing route cannot leak
the answer key by accident — it would not type-check.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.assignment import MatchMode
from app.schemas import ORMModel


class AssignmentForStudent(BaseModel):
    """What a student sees. No accepted answers."""

    id: uuid.UUID
    module_id: uuid.UUID
    title: str
    prompt: str
    max_score: int


class AssignmentAdmin(ORMModel):
    """Author's view, including the answers that will be accepted."""

    id: uuid.UUID
    module_id: uuid.UUID
    title: str
    prompt: str
    accepted_answers: list[str]
    match_mode: MatchMode
    case_sensitive: bool
    max_score: int
    created_at: datetime
    updated_at: datetime


class AssignmentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    prompt: str = Field(min_length=1)
    accepted_answers: list[str] = Field(min_length=1, max_length=20)
    match_mode: MatchMode = MatchMode.EXACT
    case_sensitive: bool = False
    max_score: int = Field(default=100, gt=0, le=1000)

    @field_validator("accepted_answers")
    @classmethod
    def _answers_must_not_be_blank(cls, value: list[str]) -> list[str]:
        # A blank accepted answer would match an empty submission in EXACT
        # mode, and match everything in CONTAINS mode — either way it silently
        # marks every answer correct.
        cleaned = [answer.strip() for answer in value]
        if any(not answer for answer in cleaned):
            raise ValueError("Accepted answers cannot be blank.")
        return cleaned


class AssignmentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    prompt: str | None = Field(default=None, min_length=1)
    accepted_answers: list[str] | None = Field(
        default=None, min_length=1, max_length=20
    )
    match_mode: MatchMode | None = None
    case_sensitive: bool | None = None
    max_score: int | None = Field(default=None, gt=0, le=1000)

    @field_validator("accepted_answers")
    @classmethod
    def _answers_must_not_be_blank(
        cls, value: list[str] | None
    ) -> list[str] | None:
        if value is None:
            return None
        cleaned = [answer.strip() for answer in value]
        if any(not answer for answer in cleaned):
            raise ValueError("Accepted answers cannot be blank.")
        return cleaned


class SubmissionCreate(BaseModel):
    answer: str = Field(min_length=1, max_length=20_000)

    @field_validator("answer")
    @classmethod
    def _answer_must_not_be_blank(cls, value: str) -> str:
        """`min_length=1` alone lets a space through.

        The mirror of the rule on `accepted_answers`: a submission of "   "
        was accepted, stored verbatim, scored zero and numbered as an attempt,
        so a blank row appeared in the admin's review queue as if the student
        had answered. Outer whitespace is stripped on the way in — the grader
        already ignores it, so storing it only makes the two disagree about
        what was submitted.
        """
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Write an answer before submitting.")
        return cleaned


class SubmissionRead(ORMModel):
    """A student's own submission. Never carries the accepted answers."""

    id: uuid.UUID
    assignment_id: uuid.UUID
    attempt_number: int
    answer: str
    score: float
    is_correct: bool
    feedback: str | None
    graded_by: str
    submitted_at: datetime
    graded_at: datetime


class StudentAssignment(BaseModel):
    """One assignment plus this student's history with it."""

    assignment: AssignmentForStudent
    module_title: str
    course_id: uuid.UUID
    course_title: str
    submissions: list[SubmissionRead]
    best_score: float | None
    is_complete: bool


class AssignmentOverride(BaseModel):
    score: float = Field(ge=0)
    feedback: str | None = Field(default=None, max_length=5_000)


class AdminSubmissionRow(BaseModel):
    """The admin review queue."""

    id: uuid.UUID
    assignment_id: uuid.UUID
    assignment_title: str
    module_title: str
    course_title: str
    max_score: int
    user_id: uuid.UUID
    user_name: str
    user_email: str
    attempt_number: int
    answer: str
    score: float
    is_correct: bool
    feedback: str | None
    graded_by: str
    graded_by_name: str | None
    submitted_at: datetime
