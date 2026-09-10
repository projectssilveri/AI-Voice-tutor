"""Quizzes: per-module question sets and student attempts.

Quizzes have UNLIMITED retakes. Nothing in this module caps anything —
`attempt_number` is a counter for reporting, not a limit. The attempt cap lives
only in `certification.py`.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from app.models.course import Module
    from app.models.user import User


class QuizQuestion(TimestampMixin, Base):
    __tablename__ = "quiz_questions"
    __table_args__ = (
        CheckConstraint(
            "correct_answer >= 0", name="ck_quiz_questions_correct_answer_valid"
        ),
        Index("ix_quiz_questions_module_id", "module_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    module_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("modules.id", ondelete="CASCADE"), nullable=False
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)

    # JSONB array of answer strings, e.g. ["useState", "useEffect", ...].
    options: Mapped[list[str]] = mapped_column(JSONB, nullable=False)

    # Zero-based index into `options`, not the answer text. Storing the index
    # means grading can't be broken by an editor fixing a typo in the option.
    correct_answer: Mapped[int] = mapped_column(Integer, nullable=False)

    module: Mapped[Module] = relationship(back_populates="quiz_questions")


class QuizAttempt(Base):
    """One submitted quiz attempt.

    The brief names the foreign key `quiz_id`, but there is no `quizzes` table
    — `quiz_questions` is keyed by module, so a quiz *is* the question set for
    a module. The column is therefore `module_id`, which points at something
    that actually exists. Flagged for confirmation.
    """

    __tablename__ = "quiz_attempts"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "module_id", "attempt_number", name="uq_quiz_attempts_sequence"
        ),
        CheckConstraint(
            "attempt_number >= 1", name="ck_quiz_attempts_attempt_number_positive"
        ),
        CheckConstraint(
            "score >= 0 AND score <= 100", name="ck_quiz_attempts_score_range"
        ),
        Index("ix_quiz_attempts_user_id", "user_id"),
        Index("ix_quiz_attempts_module_id", "module_id"),
        Index("ix_quiz_attempts_user_module", "user_id", "module_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    module_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("modules.id", ondelete="CASCADE"), nullable=False
    )

    # Percentage, 0-100.
    score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)

    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="quiz_attempts")
    module: Mapped[Module] = relationship(back_populates="quiz_attempts")
