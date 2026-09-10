"""Enrollments and per-module progress."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from app.models.course import Course, Module
    from app.models.user import User


class ProgressStatus(str, enum.Enum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_enrollments_user_course"),
        Index("ix_enrollments_user_id", "user_id"),
        Index("ix_enrollments_course_id", "course_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="enrollments")
    course: Mapped[Course] = relationship(back_populates="enrollments")


class ModuleProgress(Base):
    """One row per (student, module).

    The brief lists no `id` for this table, so the natural key is the primary
    key. That also makes "one progress row per student per module" a database
    guarantee rather than something application code has to remember.
    """

    __tablename__ = "module_progress"
    __table_args__ = (
        CheckConstraint(
            "last_position >= 0", name="ck_module_progress_last_position_non_negative"
        ),
        Index("ix_module_progress_user_id", "user_id"),
        Index("ix_module_progress_module_id", "module_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    module_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("modules.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[ProgressStatus] = mapped_column(
        # See the note in models/user.py — values_callable keeps the stored
        # value lowercase so it matches server_default and the CHECK.
        Enum(
            ProgressStatus,
            native_enum=False,
            length=20,
            validate_strings=True,
            create_constraint=True,
            name="ck_module_progress_status",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=ProgressStatus.NOT_STARTED,
        server_default=ProgressStatus.NOT_STARTED.value,
    )

    # Seconds into the module's voice lecture, so a student can resume where
    # they stopped.
    last_position: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user: Mapped[User] = relationship(back_populates="module_progress")
    module: Mapped[Module] = relationship(back_populates="progress")
