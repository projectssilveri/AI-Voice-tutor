"""Asking for an account to be switched off.

An ordinary admin can see a problem — somebody abusing the tutor, a shared
login, a chargeback — and could previously act on it alone: `is_active` was on
the ordinary user-update schema. Switching off a paying customer's account is
not an authoring decision, so it now goes the same way publishing does: the
admin asks, with a reason, and the platform owner decides.

The row is the record of that. It outlives the decision on purpose — "who
asked for this, when, and what did they say" is the question that comes up
afterwards, and a flag on `users` could not answer it.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from app.models.user import User


class SuspensionStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DECLINED = "declined"


class SuspensionRequest(Base):
    __tablename__ = "suspension_requests"
    __table_args__ = (
        # One OPEN request per account. Two admins reporting the same person
        # would otherwise queue the same decision twice, and approving one
        # would leave the other pending against an already-suspended account.
        # Partial, so a closed request never blocks a later one.
        Index(
            "uq_suspension_requests_one_open",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_suspension_requests_status", "status", "requested_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()

    #: Whose account. CASCADE — a request about a deleted account is about
    #: nobody, which is not true of the two admins below.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    #: RESTRICT: an account was switched off on somebody's say-so, and a
    #: record that cannot say whose is not a record.
    requested_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    #: Required. The owner cannot act on "suspend this person" alone, and the
    #: person cannot be told anything either.
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[SuspensionStatus] = mapped_column(
        Enum(
            SuspensionStatus,
            native_enum=False,
            length=20,
            validate_strings=True,
            create_constraint=False,  # named CHECK in migration 0020 instead
            values_callable=lambda cls: [member.value for member in cls],
        ),
        nullable=False,
        default=SuspensionStatus.PENDING,
        server_default=SuspensionStatus.PENDING.value,
    )

    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)

    user: Mapped[User] = relationship(foreign_keys=[user_id])
    requester: Mapped[User] = relationship(foreign_keys=[requested_by])
    decider: Mapped[User | None] = relationship(foreign_keys=[decided_by])

    def __repr__(self) -> str:
        return f"<SuspensionRequest {self.user_id} {self.status.value}>"
