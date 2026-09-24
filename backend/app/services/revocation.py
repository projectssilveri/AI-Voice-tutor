"""Ending a session before its token expires.

Used by `core.users.RevocableJWTStrategy`, which is the strategy every route
and the voice WebSocket read the session through, so one check covers both.

Each call opens its own short session rather than borrowing the request's. The
strategy is built outside FastAPI's dependency graph (the WebSocket builds one
by hand), so there is no request session to borrow in every caller, and a
single primary-key lookup is cheap enough to pay for separately.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.core.config import settings
from app.db import session as db
from app.models.revoked_token import RevokedToken


def token_hash(token: str) -> str:
    """What is stored instead of the token, so the table grants nothing."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def is_revoked(token: str) -> bool:
    if db.SessionLocal is None:
        return False
    async with db.SessionLocal() as session:
        found = await session.scalar(
            select(RevokedToken.token_hash).where(
                RevokedToken.token_hash == token_hash(token)
            )
        )
        return found is not None


async def revoke(token: str) -> None:
    """Refuse this token from now on, and clear out rows nobody needs.

    `expires_at` is the latest this token could live: every token this server
    signs is given `jwt_lifetime_seconds`, so none outlives now plus that. The
    sweep is done here because signing out is rare and this is already a write,
    so the table stays the size of one day's sign-outs without a scheduled job.
    """
    if db.SessionLocal is None:
        return
    now = datetime.now(UTC)
    async with db.SessionLocal() as session:
        await session.execute(
            insert(RevokedToken)
            .values(
                token_hash=token_hash(token),
                expires_at=now + timedelta(seconds=settings.jwt_lifetime_seconds),
            )
            .on_conflict_do_nothing(index_elements=["token_hash"])
        )
        await session.execute(
            delete(RevokedToken).where(RevokedToken.expires_at < now)
        )
        await session.commit()
