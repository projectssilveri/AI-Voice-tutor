"""A branch manager's or department admin's change, waiting for the org admin.

Sir's rule of 2026-10-01: an organisation admin does everything inside their
own organisation with no approval from anyone. A branch manager or department
admin who wants to create, edit or delete a user, course or document does not
act at once: the change waits here until the organisation admin approves it.
Platform and super admins act directly and never appear here.

ONE TABLE FOR ALL OF IT, so the org admin opens one screen and sees everything
waiting, whatever it is about. The shape follows `deletion_requests` and
`account_approvals`: the request outlives the decision, and `label` holds a
human name captured when it was raised, so the queue reads even after the
thing it was about has changed.

WHAT IS PROPOSED lives in `payload`, a small JSON object:
  create  the fields for the new user / course (a document create carries no
          payload: the file is stored at once, hidden, and `target_id` points
          at it — approving reveals it, declining deletes it).
  edit    only the fields being changed, same keys the direct edit would send.
  delete  nothing; `target_id` says what.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.user import User


class ChangeKind(str, enum.Enum):
    """What the change is about, in the portal's own words."""

    MEMBER = "member"
    TRAINING = "training"
    DOCUMENT = "document"


class ChangeAction(str, enum.Enum):
    CREATE = "create"
    EDIT = "edit"
    DELETE = "delete"


class ChangeStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DECLINED = "declined"


def _enum(cls: type[enum.Enum]) -> Enum:
    return Enum(
        cls,
        native_enum=False,
        length=20,
        validate_strings=True,
        create_constraint=False,  # named CHECKs live in the migration
        values_callable=lambda members: [member.value for member in members],
    )


class OrgChangeRequest(Base):
    __tablename__ = "org_change_requests"
    __table_args__ = (
        # One open request per thing per action, so two managers asking the
        # same change do not queue it twice. Partial on pending, so a decided
        # one never blocks a later one. A create has no target yet, so it is
        # left out of the uniqueness (target_id is null there).
        Index(
            "uq_org_change_requests_one_open",
            "kind",
            "action",
            "target_id",
            unique=True,
            postgresql_where=text("status = 'pending' and target_id is not null"),
        ),
        Index("ix_org_change_requests_org_status", "organization_id", "status"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()

    #: WHOSE APPROVAL THIS NEEDS, and what scopes the queue. CASCADE: a request
    #: inside a deleted organisation is a decision nobody is left to make.
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )

    kind: Mapped[ChangeKind] = mapped_column(_enum(ChangeKind), nullable=False)
    action: Mapped[ChangeAction] = mapped_column(_enum(ChangeAction), nullable=False)

    #: Null for a create until the thing exists. Not a foreign key: it points at
    #: one of three tables, the same trade `deletion_requests` makes.
    target_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    #: A human name for the thing, captured now so the queue reads later.
    label: Mapped[str] = mapped_column(String(300), nullable=False)

    #: The proposed fields for a create or an edit. Null or {} for a delete.
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    #: Why, from the person asking. Required, as deletions already require: an
    #: org admin deciding from a name alone is not deciding.
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    #: RESTRICT: a change was made on somebody's say-so, and a record that
    #: cannot say whose is not a record.
    requested_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    status: Mapped[ChangeStatus] = mapped_column(
        _enum(ChangeStatus),
        nullable=False,
        default=ChangeStatus.PENDING,
        server_default=ChangeStatus.PENDING.value,
    )
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)
    #: What happened when it was applied, for the record ("created", "deleted").
    outcome: Mapped[str | None] = mapped_column(String(50))

    organization: Mapped[Organization] = relationship()
    requester: Mapped[User] = relationship(foreign_keys=[requested_by])
    decider: Mapped[User | None] = relationship(foreign_keys=[decided_by])

    def __repr__(self) -> str:
        return (
            f"<OrgChangeRequest {self.kind.value} {self.action.value} "
            f"{self.status.value}>"
        )
