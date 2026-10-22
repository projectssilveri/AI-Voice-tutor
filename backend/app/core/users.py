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
from fastapi_users.jwt import generate_jwt
from fastapi_users.password import PasswordHelper
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import passwords
from app.core.config import settings
from app.db.session import SessionLocal, get_session
from app.models.audit import AuditAction
from app.models.user import User
from app.services import audit, email, email_messages, revocation

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

    async def update(self, user_update, user, safe: bool = False, request=None):
        """A new password needs the current one on the account's own screen.

        `PATCH /users/me` took a new password on the strength of the session
        alone, so anyone at an unlocked, signed-in computer could take the
        account over. `safe` is True on that route only. The administrators'
        route passes False and never knows the old password, so it is left
        as it was.
        """
        if safe and user_update.password is not None:
            verified, _ = self.password_helper.verify_and_update(
                user_update.current_password or "", user.hashed_password
            )
            if not verified:
                raise InvalidPasswordException(
                    reason="Your current password is not right. Nothing was changed."
                )
        return await super().update(user_update, user, safe=safe, request=request)

    async def on_after_register(self, user: User, request: Request | None = None) -> None:
        # Log the id, never the email or any credential.
        logger.info("User registered: %s (role=%s)", user.id, user.role.value)
        await _audit(AuditAction.REGISTER, user, request)
        # Ask them to confirm their email. Only when mail is configured: with no
        # transport there is no link to send and verification is not enforced,
        # so a sign-up still completes exactly as before. This path runs for
        # self-registration only; admin and org-created accounts are made
        # verified and never reach here.
        if settings.email_enabled and not user.is_verified:
            try:
                await self.request_verify(user, request)
            except Exception:
                # A mail or token hiccup must not undo a completed registration.
                logger.exception("Could not start email verification for %s", user.id)

    async def on_after_request_verify(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        """Send the confirm-your-email link. Called by `request_verify`."""
        base = settings.frontend_base_url.rstrip("/")
        verify_url = f"{base}/verify-email?token={token}"
        subject, text, html = email_messages.verification_email(user.name, verify_url)
        await email.send_email(to=user.email, subject=subject, text=text, html=html)

    async def on_after_verify(
        self, user: User, request: Request | None = None
    ) -> None:
        """Their email is confirmed: send the short 'you are all set' welcome."""
        subject, text, html = email_messages.welcome_email(
            user.name, settings.frontend_base_url
        )
        await email.send_email(to=user.email, subject=subject, text=text, html=html)

    async def on_after_forgot_password(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        """Send the reset link. Called by `forgot_password`.

        The route answers the same whether or not an account exists, so this
        only runs for a real one and never confirms an address to a stranger.
        With no SMTP the send is a no-op, and the person simply gets no mail.
        """
        base = settings.frontend_base_url.rstrip("/")
        reset_url = f"{base}/reset-password?token={token}"
        subject, text, html = email_messages.reset_password_email(user.name, reset_url)
        await email.send_email(to=user.email, subject=subject, text=text, html=html)

    async def on_after_reset_password(
        self, user: User, request: Request | None = None
    ) -> None:
        """The password was changed: log it and tell the owner it happened."""
        logger.info("Password reset for user: %s", user.id)
        subject, text, html = email_messages.password_changed_email(user.name)
        await email.send_email(to=user.email, subject=subject, text=text, html=html)

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


# The account-invite link reuses the password-reset token (same audience and
# secret), so the /auth/reset-password route and the /reset-password page handle
# it with no new machinery. Longer-lived than a reset, because an invite may sit
# unopened for a few days.
_RESET_TOKEN_AUDIENCE = "fastapi-users:reset"
_INVITE_LIFETIME_SECONDS = 7 * 24 * 60 * 60


async def send_account_invite(user: User) -> None:
    """Email a staff-created user a link to set their own password.

    Admin and org-admin created accounts used to show the password once on
    screen for the admin to hand over. This emails the person their login and a
    set-password link instead, so no password is ever put in an email and the
    admin never has to invent one.

    Dormant without SMTP and best-effort: it never raises and never undoes the
    account, so callers invoke it AFTER the account is committed.
    """
    if not settings.email_enabled or not user.email:
        return
    try:
        token = generate_jwt(
            {
                "sub": str(user.id),
                "password_fgpt": password_helper.hash(user.hashed_password),
                "aud": _RESET_TOKEN_AUDIENCE,
            },
            settings.jwt_secret or "",
            _INVITE_LIFETIME_SECONDS,
        )
        base = settings.frontend_base_url.rstrip("/")
        link = f"{base}/reset-password?token={token}"
        subject, text, html = email_messages.account_invite_email(
            user.name, user.email, link
        )
        await email.send_email(to=user.email, subject=subject, text=text, html=html)
    except Exception:
        logger.exception("Could not send account invite to %s", user.id)


async def get_user_manager(
    user_db: Annotated[SQLAlchemyUserDatabase, Depends(get_user_db)],
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db, password_helper)


class RevocableJWTStrategy(JWTStrategy):
    """A JWT strategy whose tokens can be ended before they expire.

    `JWTStrategy.destroy_token` cannot do anything (a JWT the server never
    stored cannot be taken back), so signing out used to clear the browser's
    cookie and nothing else. A copy of that cookie kept anywhere went on
    working for its full 24 hours. Now signing out records the token in
    `revoked_tokens`, and reading one checks that list first.

    The voice WebSocket reads the session through `get_jwt_strategy()` too, so
    a signed-out cookie cannot open a tutor session either.
    """

    async def write_token(self, user) -> str:
        # A `jti` makes every sign-in its own token. Without one, two sign-ins
        # by the same person in the same second produced byte-identical JWTs
        # (same subject, same expiry), so signing out on one device would have
        # signed them out on the other as well.
        data = {"sub": str(user.id), "aud": self.token_audience, "jti": uuid.uuid4().hex}
        return generate_jwt(
            data, self.encode_key, self.lifetime_seconds, algorithm=self.algorithm
        )

    async def read_token(self, token, user_manager):
        if token is not None and await revocation.is_revoked(token):
            return None
        return await super().read_token(token, user_manager)

    async def destroy_token(self, token, user) -> None:
        await revocation.revoke(token)


def get_jwt_strategy() -> JWTStrategy:
    if not settings.jwt_secret:
        raise RuntimeError(
            "JWT_SECRET is not set. Generate one with "
            '`python -c "import secrets; print(secrets.token_urlsafe(48))"` '
            "and add it to backend/.env"
        )
    return RevocableJWTStrategy(
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
