"""A session that was signed out before it expired.

The session cookie is a JWT, and the server keeps no copy of it: a JWT is good
until its `exp` whatever happens in between. Signing out only asked the browser
to forget the cookie, so any copy taken earlier (a shared computer, a proxy
log, a stolen cookie) went on working for the rest of its 24 hours. Verified
against the running API: after `POST /auth/logout`, replaying the old cookie
still answered `/users/session` as the person who had signed out.

A row here is a token that must no longer be accepted. It is keyed by a hash of
the token rather than the token itself, so reading this table gives nobody a
session. `expires_at` is the latest the token could have lived anyway; after
that the row is dead weight and `services/revocation.py` clears it.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    __table_args__ = (
        # For the sweep in `revocation.revoke`, which deletes by age.
        Index("ix_revoked_tokens_expires_at", "expires_at"),
    )

    #: sha256 of the token, hex. 64 characters, always.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
