"""Messages sent from the public contact form.

The project spec's page list includes a Contact page and step 11 says its form is
wired to FastAPI. A form needs somewhere for the message to land: no email
provider is configured, so messages are stored and read from the admin
dashboard. Wiring email later is a sender on top of this table, not a schema
change.

This is the one table anyone on the internet can write to without an account,
which is why the columns are length-capped and the router caps them again.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from app.models.user import User


class ContactMessage(Base):
    __tablename__ = "contact_messages"
    __table_args__ = (
        # The admin inbox lists unhandled first, newest first.
        Index("ix_contact_messages_handled_created", "handled", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Not validated as deliverable and not unique: this is whatever the sender
    # typed, and it is a reply-to address, not an identity.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    # Optional, unvalidated and not unique, for the reason decision 113 gives
    # for users.phone — and more so here, because a stranger typed it.
    phone: Mapped[str | None] = mapped_column(String(40))
    subject: Mapped[str | None] = mapped_column(String(255))
    message: Mapped[str] = mapped_column(Text, nullable=False)

    handled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # RESTRICT, as elsewhere: who dealt with a message must survive that
    # admin's account being deleted.
    handled_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # What was actually said back. `handled` alone records that somebody dealt
    # with it, which is no use at all when the same person writes in again.
    reply_body: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    handled_by: Mapped[User | None] = relationship(foreign_keys=[handled_by_user_id])

    def __repr__(self) -> str:
        return f"<ContactMessage from {self.email!r}>"
