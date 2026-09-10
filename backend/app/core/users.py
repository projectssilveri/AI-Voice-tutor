"""Authentication wiring: fastapi-users, argon2, and JWT in a cookie.

Deviation from the original spec's "Clerk or NextAuth" line, confirmed earlier:
auth stays inside FastAPI so there is one backend and one place that enforces
roles, and `users.password_hash` is used as the schema intends. fastapi-users
is a maintained, audited library — this is not hand-rolled auth.

Tokens ride in an httpOnly cookie rather than a bearer header the frontend has
to store. A token in localStorage is readable by any script that gets injected
into the page; an httpOnly cookie is not.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    CookieTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users.exceptions import InvalidPasswordException
from fastapi_users.password import PasswordHelper
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import passwords
from app.core.config import settings
from app.db.session import SessionLocal, get_session
from app.models.audit import AuditAction
from app.models.user import User
from app.services import audit

logger = logging.getLogger(__name__)

# Argon2id rather than fastapi-users' bcrypt default: it is the current
# password-hashing recommendation, and it matches app/core/security.py so a
# hash written by either path verifies with the other.
password_helper = PasswordHelper(PasswordHash((Argon2Hasher(),)))


async def get_user_db(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AsyncGenerator[SQLAlchemyUserDatabase, None]:
    yield SQLAlchemyUserDatabase(session, User)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.jwt_secret or ""
    verification_token_secret = settings.jwt_secret or ""

    async def validate_password(self, password: str, user) -> None:
        """The password rule, on the server where it belongs.

        This was never overridden, so fastapi-users' default ran: it accepts
        anything. The sign-up form asked for eight characters and the API
        accepted one — `POST /auth/register` with a single-character password
        created a real account. Client-side validation is a courtesy to
        someone typing; it is not a rule.

        `user` is the schema on register and the User row on reset, so the
        email and name are read defensively — the rule still applies when
        neither is available.
        """
        try:
            passwords.check(
                password,
                email=getattr(user, "email", None),
                name=getattr(user, "name", None),
            )
        except passwords.WeakPassword as exc:
            # fastapi-users turns this into 400 with `reason` in the body,
            # which is what the sign-up form already renders.
            raise InvalidPasswordException(reason=str(exc)) from None

    async def on_after_register(self, user: User, request: Request | None = None) -> None:
        # Log the id, never the email or any credential.
        logger.info("User registered: %s (role=%s)", user.id, user.role.value)
        await _audit(AuditAction.REGISTER, user, request)

    async def on_after_login(
        self, user: User, request: Request | None = None, response=None
    ) -> None:
        logger.info("User logged in: %s", user.id)
        await _audit(AuditAction.LOGIN, user, request)


async def _audit(action: str, user: User, request: Request | None) -> None:
    """Record a sign-in or registration on the audit trail.

    Its own session, not the request's. fastapi-users calls these hooks inside
    its own transaction and commits afterwards; joining that would tie the
    audit write to library internals, and a failure there would fail the login
    itself. A sign-in someone could not perform because the trail was
    unavailable is worse than a sign-in with no trail — so `record_safely`.

    This is the reason `/auth/login` is excluded from the middleware net: the
    net cannot see *who* signed in, because the actor is only known once
    fastapi-users has resolved the credentials. Here it is known.
    """
    if SessionLocal is None:
        return
    async with SessionLocal() as session:
        await audit.record_safely(
            session,
            action=action,
            actor=user,
            target_type="user",
            target_id=user.id,
            ip_address=(
                audit.client_ip(request.headers, request.client) if request else None
            ),
            user_agent=request.headers.get("user-agent") if request else None,
            metadata={"role": user.role.value},
        )
        await session.commit()


async def get_user_manager(
    user_db: Annotated[SQLAlchemyUserDatabase, Depends(get_user_db)],
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db, password_helper)


def get_jwt_strategy() -> JWTStrategy:
    if not settings.jwt_secret:
        raise RuntimeError(
            "JWT_SECRET is not set. Generate one with "
            '`python -c "import secrets; print(secrets.token_urlsafe(48))"` '
            "and add it to backend/.env"
        )
    return JWTStrategy(
        secret=settings.jwt_secret,
        lifetime_seconds=settings.jwt_lifetime_seconds,
    )


cookie_transport = CookieTransport(
    cookie_name="vtlms_session",
    cookie_max_age=settings.jwt_lifetime_seconds,
    # Not readable from JavaScript.
    cookie_httponly=True,
    # Only sent over HTTPS in production; localhost is plain HTTP in dev.
    cookie_secure=settings.is_production,
    # "none" is required when frontend (Vercel) and backend (Render) are on
    # different domains, so modern browsers accept and send the cross-site session cookie.
    cookie_samesite="none" if settings.is_production else "lax",
)

auth_backend = AuthenticationBackend(
    name="cookie",
    transport=cookie_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

# Any authenticated, active user.
current_active_user = fastapi_users.current_user(active=True)
# Returns None instead of 401 when signed out — used by /me so the frontend can
# ask "am I logged in?" without treating a normal signed-out state as an error.
current_user_optional = fastapi_users.current_user(active=True, optional=True)
