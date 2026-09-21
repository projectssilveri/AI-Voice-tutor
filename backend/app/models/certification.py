"""Certification exams, attempts, admin-granted extra attempts, certificates.

This is the only place in the schema with an attempt cap. The rule:

    allowed = cert_exams.default_max_attempts
            + SUM(attempt_grants.extra_attempts_granted for this user + exam)
    used    = COUNT(cert_attempts for this user + exam)
    block when used >= allowed

AN ATTEMPT IS CONSUMED ON OPEN, as of migration 0026. It used to be consumed
on submit, and opening a paper cost nothing: the questions could be read as
often as anybody liked, so the cap limited how many times they could be MARKED
rather than how many times they could be seen.

A row is therefore inserted when the paper is handed over, with `submitted_at`
NULL. Submitting fills that in and scores it. An open row still counts against
the allowance, which is the whole point.

RESUMABLE, so that a misclick does not cost a third of somebody's allowance.
Returning to an unsubmitted paper reopens the SAME row; only submitting it, or
running out, moves you on. `uq_cert_attempts_one_open` is what makes "the same
row" true under two tabs.

`allowed` is recomputed server-side on every attempt request (step 8). A count
sent by the frontend is never trusted.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from app.models.course import Course
    from app.models.user import User


class CertExam(TimestampMixin, Base):
    __tablename__ = "cert_exams"
    __table_args__ = (
        CheckConstraint(
            "default_max_attempts >= 1",
            name="ck_cert_exams_default_max_attempts_positive",
        ),
        Index("ix_cert_exams_course_id", "course_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)

    # Per-exam baseline. The default comes from CERT_DEFAULT_MAX_ATTEMPTS in
    # config so the number can change without a code edit; it is stored per row
    # so changing the config never retroactively alters existing exams.
    default_max_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="3"
    )

    course: Mapped[Course] = relationship(back_populates="cert_exams")
    attempts: Mapped[list[CertAttempt]] = relationship(
        back_populates="cert_exam", cascade="all, delete-orphan"
    )
    grants: Mapped[list[AttemptGrant]] = relationship(
        back_populates="cert_exam", cascade="all, delete-orphan"
    )
    certificates: Mapped[list[Certificate]] = relationship(
        back_populates="cert_exam", cascade="all, delete-orphan"
    )


class CertAttempt(Base):
    """One sitting of an exam: inserted when the paper opens, scored on submit.

    `submitted_at` is NULL while it is open. Both an open and a submitted row
    count against the allowance, because opening is what now costs.
    """

    __tablename__ = "cert_attempts"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "cert_exam_id",
            "attempt_number",
            name="uq_cert_attempts_sequence",
        ),
        CheckConstraint(
            "attempt_number >= 1", name="ck_cert_attempts_attempt_number_positive"
        ),
        CheckConstraint(
            "score >= 0 AND score <= 100", name="ck_cert_attempts_score_range"
        ),
        CheckConstraint("lapses >= 0", name="ck_cert_attempts_lapses_non_negative"),
        Index("ix_cert_attempts_user_id", "user_id"),
        Index("ix_cert_attempts_cert_exam_id", "cert_exam_id"),
        # The attempt-limit check counts by (user, exam) on every request, so
        # this index is on the hot path of the gate.
        Index("ix_cert_attempts_user_exam", "user_id", "cert_exam_id"),
        # AT MOST ONE OPEN PAPER per student per exam. Two tabs pressing Start
        # together would otherwise spend two attempts, and only one of them
        # could ever be reached again. Created in migration 0026 as a partial
        # index, which is the only shape that expresses "unique among the open
        # ones".
        Index(
            "uq_cert_attempts_one_open",
            "user_id",
            "cert_exam_id",
            unique=True,
            postgresql_where=text("submitted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    cert_exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cert_exams.id", ondelete="CASCADE"), nullable=False
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # Zero until it is marked. NOT NULL either way: an unsubmitted paper has
    # genuinely scored nothing, and a null there would have every caller
    # deciding for itself what that meant.
    score: Mapped[float] = mapped_column(
        Numeric(5, 2), nullable=False, default=0, server_default="0"
    )
    passed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    #: When the paper was handed over. This is the moment the attempt is spent.
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    #: NULL while the paper is open. Set when it is marked.
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: How many times they left the exam during THIS attempt.
    #:
    #: On the row rather than in the browser, because papers are resumable: a
    #: count held in a React ref reset every time one was reopened, so the
    #: warning budget was per opening and openings are unlimited.
    lapses: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    @property
    def is_open(self) -> bool:
        return self.submitted_at is None

    user: Mapped[User] = relationship(back_populates="cert_attempts")
    cert_exam: Mapped[CertExam] = relationship(back_populates="attempts")


class AttemptGrant(Base):
    """Extra attempts granted to one student for one exam by an admin."""

    __tablename__ = "attempt_grants"
    __table_args__ = (
        CheckConstraint(
            "extra_attempts_granted >= 1",
            name="ck_attempt_grants_extra_attempts_positive",
        ),
        Index("ix_attempt_grants_user_id", "user_id"),
        Index("ix_attempt_grants_cert_exam_id", "cert_exam_id"),
        Index("ix_attempt_grants_user_exam", "user_id", "cert_exam_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    cert_exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cert_exams.id", ondelete="CASCADE"), nullable=False
    )
    extra_attempts_granted: Mapped[int] = mapped_column(Integer, nullable=False)

    # The admin who granted it. RESTRICT rather than CASCADE: deleting an admin
    # must not silently revoke attempts students were already given.
    granted_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    reason: Mapped[str | None] = mapped_column(Text)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(
        back_populates="attempt_grants", foreign_keys=[user_id]
    )
    granter: Mapped[User] = relationship(foreign_keys=[granted_by])
    cert_exam: Mapped[CertExam] = relationship(back_populates="grants")


class Certificate(Base):
    """Issued once a student passes. One per (student, exam)."""

    __tablename__ = "certificates"
    __table_args__ = (
        UniqueConstraint("user_id", "cert_exam_id", name="uq_certificates_user_exam"),
        Index("ix_certificates_user_id", "user_id"),
        Index("ix_certificates_cert_exam_id", "cert_exam_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    cert_exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cert_exams.id", ondelete="CASCADE"), nullable=False
    )
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="certificates")
    cert_exam: Mapped[CertExam] = relationship(back_populates="certificates")
