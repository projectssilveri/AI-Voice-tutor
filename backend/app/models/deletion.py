"""Destroying something that belongs to a customer, and who agreed to it.

THE RULE SINCE 2026-10-01 (`services/deletions.acts_directly`): platform
staff delete inside a customer at once, and decide what anybody inside the
customer asks to delete. An organization admin removes branch managers and
department admins at once, and those managers remove the people in their own
branch or department at once. Everything else (the org admin removing a
learner or another admin, any course or document) is a request with a
reason, and a Platform Admin or Super Admin decides.

    org admin    ─┐
    branch/dept  ─┼─request(reason)─> pending ─approve─> the thing is deleted
    manager       ┘  (staff decide)        │
                                           └─decline(note)─> nothing happens

Acting at once still writes a row, raised and approved in the same moment.

The row outlives the decision on purpose. "Who asked for this, when, why, and
who agreed" is the question that gets asked after something is gone, and by then
the thing itself cannot answer it.

WHY THE TARGET IS POLYMORPHIC rather than three tables. The three things a
customer owns — members, training, documents — differ in what deleting them
means and in nothing else about this flow. One queue is also the point: the
person deciding should open one screen and see everything waiting, not three.

The trade is that `target_id` carries no foreign key, so nothing at the database
level stops a request outliving its target. `target_label` is the answer to
that: the name is copied in at request time, so a row can always say what it was
about even after the thing is gone or was removed another way. The audit trail
records a name on delete for exactly the same reason (issue 66).
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
    from app.models.organization import Organization
    from app.models.user import User


class DeletionTarget(str, enum.Enum):
    """What is being asked for, in the customer's words rather than ours.

    MEMBER, not "user": inside an organization the word for a person is member.
    TRAINING, not "course": the org portal calls it training throughout, and a
    queue that says "course" about a thing the screen beside it calls training
    is a queue somebody has to translate.
    """

    MEMBER = "member"
    TRAINING = "training"
    DOCUMENT = "document"


class DeletionStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DECLINED = "declined"


class DeletionRequest(Base):
    __tablename__ = "deletion_requests"
    __table_args__ = (
        # ONE OPEN REQUEST PER THING. Two people asking to remove the same
        # member would otherwise queue the same decision twice, and approving
        # one would leave the other pending against something already gone.
        # Partial, so a decided request never blocks a later one — somebody
        # declined today can be asked about again next year.
        #
        # Copied from `uq_suspension_requests_one_open`, which exists because
        # the application-level check races two admins pressing at once and the
        # database is the only thing that cannot.
        Index(
            "uq_deletion_requests_one_open",
            "target_type",
            "target_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_deletion_requests_org_status", "organization_id", "status"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()

    #: WHOSE APPROVAL THIS NEEDS, and what scopes the queue. CASCADE: a request
    #: against a deleted organization is a decision nobody is left to make.
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    target_type: Mapped[DeletionTarget] = mapped_column(
        Enum(
            DeletionTarget,
            native_enum=False,
            length=20,
            validate_strings=True,
            create_constraint=False,  # named CHECK in the migration instead
            values_callable=lambda cls: [member.value for member in cls],
        ),
        nullable=False,
    )
    #: DELIBERATELY NOT A FOREIGN KEY — it points at one of three tables. See
    #: the module docstring for the trade and for why `target_label` exists.
    target_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    #: The name, copied in when the request is raised. After the deletion the
    #: id points at nothing, and a queue that can only say "a member" is a
    #: queue nobody can decide from.
    target_label: Mapped[str] = mapped_column(String(300), nullable=False)

    #: RESTRICT on both: something was destroyed on somebody's say-so, and a
    #: record that cannot say whose is not a record.
    requested_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    #: Required. An administrator cannot agree to destroy something on the
    #: strength of "delete this", and the people affected cannot be told
    #: anything either.
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[DeletionStatus] = mapped_column(
        Enum(
            DeletionStatus,
            native_enum=False,
            length=20,
            validate_strings=True,
            create_constraint=False,
            values_callable=lambda cls: [member.value for member in cls],
        ),
        nullable=False,
        default=DeletionStatus.PENDING,
        server_default=DeletionStatus.PENDING.value,
    )

    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
    #: What actually happened on approval — `accounts.remove_account` deletes an
    #: account with no history and closes one that has any, and which of those
    #: ran is the thing the person who asked wants to know.
    outcome: Mapped[str | None] = mapped_column(String(40))

    organization: Mapped[Organization] = relationship()
    requester: Mapped[User] = relationship(foreign_keys=[requested_by])
    decider: Mapped[User | None] = relationship(foreign_keys=[decided_by])

    def __repr__(self) -> str:
        return (
            f"<DeletionRequest {self.target_type.value} "
            f"{self.target_id} {self.status.value}>"
        )
