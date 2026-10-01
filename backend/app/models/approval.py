"""A new organisation administrator, waiting for the super admin.

The role model of 2026-10-01 gave a platform admin the super admin's work with
one exception: making somebody an organisation's administrator. That hands a
person a whole customer, so when a platform admin does it the super admin
approves first.

Two ways in, one row each:

  NEW_ACCOUNT  the platform admin created the person. The account exists but
               is switched off (`is_active = false`), so it cannot sign in.
               Approving switches it on; declining leaves it off.
  PROMOTION    the platform admin raised an existing member to administrator.
               Their role is unchanged until approval sets it.

The row outlives the decision on purpose, as `suspension_requests` does: "who
made this person an administrator, and who agreed" is asked afterwards.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from app.models.user import User


class ApprovalStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DECLINED = "declined"


class ApprovalKind(str, enum.Enum):
    NEW_ACCOUNT = "new_account"
    PROMOTION = "promotion"


def _enum(cls: type[enum.Enum]) -> Enum:
    return Enum(
        cls,
        native_enum=False,
        length=20,
        validate_strings=True,
        create_constraint=False,  # named CHECKs in migration 0030 instead
        values_callable=lambda members: [member.value for member in members],
    )


class AccountApproval(Base):
    __tablename__ = "account_approvals"
    __table_args__ = (
        # ONE OPEN REQUEST PER PERSON, so the queue never shows the same
        # decision twice. Partial, so a decided one never blocks a later one.
        Index(
            "uq_account_approvals_one_open",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_account_approvals_status", "status", "requested_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()

    # CASCADE: a request about a deleted account is about nobody.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[ApprovalKind] = mapped_column(_enum(ApprovalKind), nullable=False)
    #: The role being granted. Organisation admin today; kept as a column so the
    #: row says what was asked for in its own words.
    requested_role: Mapped[str] = mapped_column(String(32), nullable=False)

    # RESTRICT, as on every other "who did this" column: a record that cannot
    # say whose say-so it was is not a record.
    requested_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    status: Mapped[ApprovalStatus] = mapped_column(
        _enum(ApprovalStatus),
        nullable=False,
        default=ApprovalStatus.PENDING,
        server_default=ApprovalStatus.PENDING.value,
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
        return f"<AccountApproval {self.user_id} {self.kind.value} {self.status.value}>"
