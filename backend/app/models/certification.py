"""Certification exams, attempts, admin-granted extra attempts, certificates.

This is the only place in the schema with an attempt cap. The rule:

    allowed = cert_exams.default_max_attempts
            + SUM(attempt_grants.extra_attempts_granted for this user + exam)
    used    = COUNT(cert_attempts for this user + exam)
    block when used >= allowed

CONFIRMED: an attempt is consumed on SUBMIT — every submitted attempt counts,
pass or fail. Opening an exam and abandoning it costs nothing, so a row is
inserted here at submission time, never at start.

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
    """A submitted certification attempt. Inserted on submit, pass or fail."""

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
        Index("ix_cert_attempts_user_id", "user_id"),
        Index("ix_cert_attempts_cert_exam_id", "cert_exam_id"),
        # The attempt-limit check counts by (user, exam) on every request, so
        # this index is on the hot path of the gate.
        Index("ix_cert_attempts_user_exam", "user_id", "cert_exam_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    cert_exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cert_exams.id", ondelete="CASCADE"), nullable=False
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

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
