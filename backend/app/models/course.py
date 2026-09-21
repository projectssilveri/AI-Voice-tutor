"""Courses and their modules."""

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
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from app.models.assignment import Assignment
    from app.models.certification import CertExam
    from app.models.enrollment import Enrollment, ModuleProgress
    from app.models.material import ModuleMaterial
    from app.models.organization import Organization
    from app.models.quiz import QuizAttempt, QuizQuestion
    from app.models.subscription import PlanCourse
    from app.models.voice import VoiceSession


class CourseReviewStatus(str, enum.Enum):
    """Where a course is in the approval it now needs before going on sale.

    DRAFT     an admin is still writing it.
    PENDING   sent to the super admin and waiting.
    APPROVED  the owner said yes. Only an approved course may be published.
    REJECTED  sent back with a note. The author edits and submits again.

    Separate from `is_published`, which stays one bit answering "is it on
    sale". The two are related in one direction only: publishing requires
    approval, and approval does not by itself put anything on sale.
    """

    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class Course(TimestampMixin, Base):
    __tablename__ = "courses"
    __table_args__ = (
        CheckConstraint("price_minor >= 0", name="ck_courses_price_non_negative"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # NULL means a public marketplace course — every course that exists today.
    # A non-NULL value makes this an organization's private training, which
    # only that organization may see. The rule itself lives in
    # `services/access.py`; this column is what it reads.
    #
    # RESTRICT: deleting an organization must not take its course content, and
    # the enrolments, attempts and certificates hanging off it, with it.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=True, index=True
    )

    # NARROWS AN ORG COURSE TO ONE DEPARTMENT. NULL means everyone in the
    # organization, which is what every existing org course is.
    #
    # Only meaningful alongside `organization_id`: a public marketplace course
    # belongs to no organization and so to no department. `services/access.py`
    # reads it; org admins, branch managers and anyone flagged
    # `sees_all_departments` see past it.
    #
    # SET NULL, matching `organization_documents`: closing a department must not
    # destroy the training written for it. It widens to organization-wide, which
    # is the recoverable direction — seen by more people than intended can be
    # put right, deleted cannot.
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Integer minor units (paise), never a float — binary floating point cannot
    # represent money exactly, and this is the number someone is charged.
    # 0 means free, which is a real state and not a missing price.
    price_minor: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default="INR", server_default="INR"
    )

    # WHAT THE COURSE USED TO COST, struck through beside the real price.
    #
    # Nullable, and NULL is the honest default: a course with no genuine
    # previous price shows one price and no comparison. Inventing a higher
    # "was" figure to make the real one look like a discount is a deceptive
    # pricing practice, so this is only ever set by an admin who is recording a
    # price the course actually carried.
    list_price_minor: Mapped[int | None] = mapped_column(Integer)

    # HOW LONG A PURCHASE LASTS, in days from the moment it is paid for.
    #
    # NULL means the older rule: bought outright, never expires. A value scales
    # with the size of the course — a three-module course is not worth the same
    # window as a twelve-module one — and `services/extensions.suggested_days`
    # holds the arithmetic so the admin screen and the seed agree on it.
    access_days: Mapped[int | None] = mapped_column(Integer)

    # HOW MANY TIMES THE TUTOR MAY BE PLAYED ON ONE MODULE, per student.
    #
    # Counted against `voice_sessions` rows for that student and module, so it
    # is a count of lessons actually delivered rather than of clicks.
    #
    # NULL DOES NOT MEAN UNLIMITED HERE, unlike everywhere in
    # `services/limits.py`. It means "the platform default for a course of this
    # kind", and free and paid courses have different ones — see
    # `limits.tutor_allowance_for`. 0 is a real value: a course with no tutor.
    ai_sessions_per_module: Mapped[int | None] = mapped_column(Integer)

    # HOW LONG ONE OF THOSE PLAYS MAY RUN, in minutes. Same NULL rule.
    #
    # Enforced by the voice endpoint, which closes the socket when the time is
    # up. Until this existed the only bound was Gemini's own ~10 minute
    # connection cap, which the app transparently resumes past — so a session
    # had no ceiling at all.
    ai_session_minutes: Mapped[int | None] = mapped_column(Integer)

    # Unpublished courses are invisible on the marketing site and cannot be
    # bought; authors need somewhere to write a course before it goes on sale.
    #
    # SUPER ADMIN ONLY, and that was already true before the review flow
    # existed: `CourseUpdate` — what an ordinary admin may send — has no
    # `is_published` field, so the route drops one even if it is in the body.
    is_published: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    # WHERE THE COURSE IS IN APPROVAL. An ordinary admin writes a course and
    # submits it; the super admin approves or sends it back. Nothing reaches
    # the catalogue without that, and `services/course_review.py` is the only
    # place the transitions are allowed to happen.
    review_status: Mapped[CourseReviewStatus] = mapped_column(
        Enum(
            CourseReviewStatus,
            native_enum=False,
            length=20,
            validate_strings=True,
            create_constraint=False,  # named CHECK in migration 0019 instead
            values_callable=lambda cls: [member.value for member in cls],
        ),
        nullable=False,
        default=CourseReviewStatus.DRAFT,
        server_default=CourseReviewStatus.DRAFT.value,
        index=True,
    )

    # Who asked, and who decided. RESTRICT on both: "who approved this course"
    # is exactly the question asked later, and an approval whose approver was
    # deleted answers nothing.
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: Why it was sent back. Shown to the author, so it is written for them.
    review_note: Mapped[str | None] = mapped_column(Text)

    organization: Mapped[Organization | None] = relationship(back_populates="courses")

    modules: Mapped[list[Module]] = relationship(
        back_populates="course",
        cascade="all, delete-orphan",
        order_by="Module.order",
    )
    enrollments: Mapped[list[Enrollment]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )
    cert_exams: Mapped[list[CertExam]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )
    plan_links: Mapped[list[PlanCourse]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Course {self.title!r}>"


class Module(TimestampMixin, Base):
    __tablename__ = "modules"
    __table_args__ = (
        # Two modules can't occupy the same slot in a course.
        UniqueConstraint("course_id", "order", name="uq_modules_course_order"),
        CheckConstraint('"order" >= 0', name="ck_modules_order_non_negative"),
        Index("ix_modules_course_id", "course_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)

    # `order` is a reserved word in SQL; SQLAlchemy quotes it automatically.
    order: Mapped[int] = mapped_column(Integer, nullable=False)

    # The text fed into the Gemini Live system instruction to ground the tutor
    # for this module. This is the single source of what the AI may teach and
    # answer from during a session.
    content: Mapped[str | None] = mapped_column(Text)

    course: Mapped[Course] = relationship(back_populates="modules")
    progress: Mapped[list[ModuleProgress]] = relationship(
        back_populates="module", cascade="all, delete-orphan"
    )
    voice_sessions: Mapped[list[VoiceSession]] = relationship(
        back_populates="module", cascade="all, delete-orphan"
    )
    quiz_questions: Mapped[list[QuizQuestion]] = relationship(
        back_populates="module", cascade="all, delete-orphan"
    )
    quiz_attempts: Mapped[list[QuizAttempt]] = relationship(
        back_populates="module", cascade="all, delete-orphan"
    )
    assignments: Mapped[list[Assignment]] = relationship(
        back_populates="module", cascade="all, delete-orphan"
    )
    materials: Mapped[list[ModuleMaterial]] = relationship(
        back_populates="module", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Module {self.order}: {self.title!r}>"
