"""Private messages between a person and platform staff.

Deliberately separate from `contact_messages`. A contact message comes from a
stranger on the public form — no account, no thread, and the only reply channel
is the email address they typed. A direct message is between two accounts we
already know, so it threads, it can be marked read, and it needs no reply-to
address at all.

Merging the two would mean one table where half the rows have a user and half
have a typed email, and every query would carry a branch. Two tables, two
inboxes, two nav items.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from app.models.user import User


class DirectMessage(Base):
    """One message from one account to another.

    No `updated_at`: a sent message is not edited. Correcting it means sending
    another one, which is what happens in every real inbox.
    """

    __tablename__ = "direct_messages"

    id: Mapped[uuid.UUID] = uuid_pk()

    # RESTRICT on both sides, as everywhere else a person is named in a record
    # someone may later be asked about: an inbox where the sender has become
    # "(deleted)" cannot answer who said what.
    sender_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    # Set when this is a reply, so a thread can be assembled without a separate
    # threads table. Self-referential and SET NULL: deleting a parent must not
    # take its replies with it.
    in_reply_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("direct_messages.id", ondelete="SET NULL"), nullable=True
    )

    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    # Null until the recipient opens it. A timestamp rather than a boolean
    # because "when did they see this" is the question that actually gets asked.
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    sender: Mapped[User] = relationship(foreign_keys=[sender_id], lazy="raise")
    recipient: Mapped[User] = relationship(foreign_keys=[recipient_id], lazy="raise")

    __table_args__ = (
        # The two queries this table exists for: my inbox, and my sent items.
        Index(
            "ix_direct_messages_recipient_created", "recipient_id", created_at.desc()
        ),
        Index("ix_direct_messages_sender_created", "sender_id", created_at.desc()),
    )

    def __repr__(self) -> str:
        return f"<DirectMessage {self.subject!r}>"
