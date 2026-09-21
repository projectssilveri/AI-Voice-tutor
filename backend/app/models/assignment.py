"""Assignments and their submissions.

The project spec lists "tasks/assignments" on the student dashboard and
"assignment help" as one of the voice patterns, but never gave them a
build-order step or a table. Scope confirmed 2026-08-09: an admin writes an
assignment against a module with the answers it will accept, the student
submits a text answer, and grading is a **deterministic match against those
accepted answers**.

No AI grades anything here. The original tech-stack listed an LLM for
"grading open-ended answers", but that was overridden on instruction: a
student's mark must be reproducible and explainable, and a model asked the same
question twice can disagree with itself. Matching is instant, free, and gives
the same answer every time, which is the reason the brief already specifies
deterministic grading for quizzes.

The SDK that line implied was removed once it became clear nothing had ever
imported it. The only model this product calls is Gemini Live, and it teaches;
it marks nothing.

Resubmission is UNLIMITED. The spec caps certification exams and nothing else,
so `attempt_number` here is a counter for display, never a limit — the same
rule quizzes follow.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
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


class MatchMode(str, enum.Enum):
    """How a submitted answer is compared with the accepted answers.

    EXACT   — the whole answer must equal an accepted answer once normalised.
              Right for short, factual answers.
    CONTAINS— the answer must contain every accepted answer as a substring.
              Right for "explain X" prompts where the student writes prose but
              must mention specific terms.
    """

    EXACT = "exact"
    CONTAINS = "contains"


class GradedBy(str, enum.Enum):
    AUTO = "auto"
    ADMIN = "admin"


def _enum_column(enum_cls: type[enum.Enum], constraint_name: str) -> Enum:
    """Enum stored as VARCHAR + CHECK, matching `users.role`.

    Same reasoning as there: a native Postgres ENUM turns "add one more value"
    into an ALTER TYPE that cannot run inside a transaction, and
    `values_callable` is required or SQLAlchemy persists the member *name*
    ("EXACT") instead of the lowercase value.
    """
    return Enum(
        enum_cls,
        native_enum=False,
        length=20,
        validate_strings=True,
        create_constraint=True,
        name=constraint_name,
        values_callable=lambda cls: [member.value for member in cls],
    )


class Assignment(TimestampMixin, Base):
    __tablename__ = "assignments"
    __table_args__ = (
        CheckConstraint("max_score > 0", name="ck_assignments_max_score_positive"),
        # An assignment with no accepted answers could never be passed, and the
        # database is the only place that can guarantee it.
        CheckConstraint(
            "jsonb_array_length(accepted_answers) >= 1",
            name="ck_assignments_has_accepted_answers",
        ),
        Index("ix_assignments_module_id", "module_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    module_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("modules.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)

    # What the student is asked to do, in prose.
    prompt: Mapped[str] = mapped_column(Text, nullable=False)

    # Every answer that counts as correct. A list rather than one string so an
    # author can accept the obvious variants ("useState", "the useState hook")
    # without needing a fuzzy matcher.
    accepted_answers: Mapped[list[str]] = mapped_column(JSONB, nullable=False)

    match_mode: Mapped[MatchMode] = mapped_column(
        _enum_column(MatchMode, "ck_assignments_match_mode"),
        nullable=False,
        default=MatchMode.EXACT,
        server_default=MatchMode.EXACT.value,
    )

    # Off by default: a student should not lose a mark for capitalisation.
    case_sensitive: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    max_score: Mapped[int] = mapped_column(
        Integer, nullable=False, default=100, server_default="100"
    )

    module: Mapped[Module] = relationship(back_populates="assignments")
    submissions: Mapped[list[AssignmentSubmission]] = relationship(
        back_populates="assignment",
        cascade="all, delete-orphan",
        order_by="AssignmentSubmission.submitted_at",
    )

    def __repr__(self) -> str:
        return f"<Assignment {self.title!r}>"


class AssignmentSubmission(Base):
    """One submitted answer, graded at the moment it is submitted.

    There is no "pending" state: matching is synchronous, so a submission
    always arrives with its score already decided.
    """

    __tablename__ = "assignment_submissions"
    __table_args__ = (
        UniqueConstraint(
            "assignment_id",
            "user_id",
            "attempt_number",
            name="uq_assignment_submissions_sequence",
        ),
        CheckConstraint(
            "attempt_number >= 1",
            name="ck_assignment_submissions_attempt_number_positive",
        ),
        CheckConstraint(
            "score >= 0", name="ck_assignment_submissions_score_non_negative"
        ),
        # An admin override must say which admin; automatic grading must not.
        CheckConstraint(
            "(graded_by = 'admin' AND graded_by_user_id IS NOT NULL)"
            " OR (graded_by = 'auto' AND graded_by_user_id IS NULL)",
            name="ck_assignment_submissions_admin_grader_identified",
        ),
        Index("ix_assignment_submissions_user_id", "user_id"),
        Index("ix_assignment_submissions_assignment_id", "assignment_id"),
        Index(
            "ix_assignment_submissions_assignment_user",
            "assignment_id",
            "user_id",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    answer: Mapped[str] = mapped_column(Text, nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Absolute, not a percentage — compared against assignments.max_score.
    score: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    feedback: Mapped[str | None] = mapped_column(Text)

    graded_by: Mapped[GradedBy] = mapped_column(
        _enum_column(GradedBy, "ck_assignment_submissions_graded_by"),
        nullable=False,
        default=GradedBy.AUTO,
        server_default=GradedBy.AUTO.value,
    )
    # RESTRICT, matching attempt_grants.granted_by: who re-marked a student's
    # work must survive that admin's account being deleted.
    graded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )

    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    graded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    assignment: Mapped[Assignment] = relationship(back_populates="submissions")
    user: Mapped[User] = relationship(
        back_populates="assignment_submissions", foreign_keys=[user_id]
    )

    def __repr__(self) -> str:
        return f"<AssignmentSubmission #{self.attempt_number} score={self.score}>"
