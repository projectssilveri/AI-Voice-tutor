"""A user's profile photo, and grants that extend their access.

Two small tables that both hang off `users` but for opposite reasons: one holds
something disposable, the other holds a record somebody may be asked about.
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
    LargeBinary,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from app.models.course import Course
    from app.models.subscription import SubscriptionPlan
    from app.models.user import User


class UserAvatar(Base):
    """A profile photo.

    ITS OWN TABLE, not a column on `users`. Every request in the product loads a
    user row — auth resolves one on every call, the member list loads dozens,
    the audit trail joins one per event — and a LargeBinary column on that table
    would drag image bytes into all of it. This is read only when somebody
    actually asks for the picture.

    Bytes in Postgres, per decision 95: the deploy targets have ephemeral
    filesystems, so anything written to disk is gone on the next deploy.
    `services/avatars.py` is the seam if this ever moves to object storage.
    """

    __tablename__ = "user_avatars"

    # The user IS the key. One photo per person, and no way to accumulate
    # orphaned rows every time somebody changes it.
    user_id: Mapped[uuid.UUID] = mapped_column(
        # CASCADE, unlike almost everything else here. A photo is not a record
        # anyone has to answer for later; keeping a picture of someone after
        # their account is gone would be keeping personal data for no reason.
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(lazy="raise")


class AccessExtension(Base):
    """More time on a course or a plan, granted by staff.

    Modelled on `attempt_grants` (decision 24) rather than on a mutable expiry
    column: who extended somebody's access, when, and why is exactly what gets
    asked afterwards, and a column that is simply overwritten cannot answer it.

    Extensions accumulate rather than replace. The effective expiry is the
    latest `extends_to` across every grant plus whatever the original purchase
    gave them, so granting a shorter one by mistake cannot take time away.
    """

    __tablename__ = "access_extensions"

    id: Mapped[uuid.UUID] = uuid_pk()

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    # Exactly one of these, enforced below. A course grant covers one course; a
    # plan grant covers everything the plan unlocks.
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=True
    )
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("subscription_plans.id", ondelete="CASCADE"), nullable=True
    )

    extends_to: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # RESTRICT, as everywhere a person is named in a record someone may be
    # asked about: "who gave this student another three months" must survive
    # that admin's account being tidied away.
    granted_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    reason: Mapped[str | None] = mapped_column(String(500))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    course: Mapped[Course | None] = relationship(lazy="raise")
    plan: Mapped[SubscriptionPlan | None] = relationship(lazy="raise")

    __table_args__ = (
        # Without this a row could name both targets, or neither, and the
        # access check would have to guess which was meant.
        CheckConstraint(
            "(course_id IS NOT NULL) <> (plan_id IS NOT NULL)",
            name="ck_access_extensions_one_target",
        ),
        Index("ix_access_extensions_user_course", "user_id", "course_id"),
        Index("ix_access_extensions_user_plan", "user_id", "plan_id"),
    )
