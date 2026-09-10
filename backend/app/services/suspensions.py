"""Asking for an account to be switched off, and deciding.

    admin ──request(reason)──> pending ──approve──> account suspended
                                  │
                                  └──decline(note)──> nothing happens

THE ACCOUNT IS NOT TOUCHED UNTIL APPROVAL. That is the whole point: a request
is a request, and an admin pressing the button must not be able to lock a
paying customer out on their own. `users.is_active` moves in exactly one place
for this flow — `approve` — and the ordinary user-update schema no longer
carries the field at all.

The platform owner does not need a request. They can suspend directly, and that
is recorded as a request they raised and approved in the same moment, so the
history reads the same either way rather than having a second shape.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.suspension import SuspensionRequest, SuspensionStatus
from app.models.user import User, UserRole


class SuspensionError(ValueError):
    """The request cannot be made or decided as asked."""


async def open_request_for(
    session: AsyncSession, user_id: uuid.UUID
) -> SuspensionRequest | None:
    """The pending request against this account, if there is one."""
    return await session.scalar(
        select(SuspensionRequest).where(
            SuspensionRequest.user_id == user_id,
            SuspensionRequest.status == SuspensionStatus.PENDING,
        )
    )


async def request_suspension(
    session: AsyncSession, *, target: User, actor: User, reason: str
) -> SuspensionRequest:
    """An admin asks for an account to be switched off. Does not commit."""
    clean = (reason or "").strip()
    if not clean:
        raise SuspensionError(
            "Say why. The platform owner cannot act on a request with no reason, "
            "and neither can the person it is about."
        )

    if target.id == actor.id:
        raise SuspensionError("You cannot ask for your own account to be suspended.")

    if not target.is_active:
        raise SuspensionError("That account is already suspended.")

    # A platform owner cannot be suspended by a request from below. Anyone who
    # could raise one against them could remove the only person able to decide
    # it, which is how an escalation becomes a lockout.
    if target.role is UserRole.SUPER_ADMIN:
        raise SuspensionError("A platform owner's account cannot be suspended here.")

    if await open_request_for(session, target.id) is not None:
        raise SuspensionError(
            "Somebody has already asked for this account to be suspended, and "
            "the platform owner has not decided yet."
        )

    request = SuspensionRequest(
        user_id=target.id,
        requested_by=actor.id,
        reason=clean[:2_000],
        status=SuspensionStatus.PENDING,
    )
    session.add(request)
    try:
        # Flushed here so the partial unique index has its say: the check above
        # still races two admins pressing at the same moment, and the database
        # is the only thing that cannot.
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise SuspensionError(
            "Somebody asked for this account to be suspended at the same moment."
        ) from exc
    return request


async def approve(
    session: AsyncSession,
    *,
    request: SuspensionRequest,
    actor: User,
    note: str | None = None,
) -> SuspensionRequest:
    """The owner agrees, and the account is switched off. Does not commit."""
    if actor.role is not UserRole.SUPER_ADMIN:
        raise SuspensionError("Only the platform owner can decide a suspension.")
    if request.status is not SuspensionStatus.PENDING:
        raise SuspensionError("That request has already been decided.")

    target = await session.get(User, request.user_id)
    if target is None:
        raise SuspensionError("That account no longer exists.")

    request.status = SuspensionStatus.APPROVED
    request.decided_by = actor.id
    request.decided_at = datetime.now(UTC)
    request.decision_note = (note or "").strip() or None

    # THE ONLY PLACE THIS MOVES for the request flow.
    target.is_active = False
    return request


async def decline(
    session: AsyncSession,
    *,
    request: SuspensionRequest,
    actor: User,
    note: str | None = None,
) -> SuspensionRequest:
    """The owner says no. The account is untouched. Does not commit."""
    if actor.role is not UserRole.SUPER_ADMIN:
        raise SuspensionError("Only the platform owner can decide a suspension.")
    if request.status is not SuspensionStatus.PENDING:
        raise SuspensionError("That request has already been decided.")

    request.status = SuspensionStatus.DECLINED
    request.decided_by = actor.id
    request.decided_at = datetime.now(UTC)
    request.decision_note = (note or "").strip() or None
    return request


async def set_active_directly(
    session: AsyncSession, *, target: User, active: bool, actor: User, reason: str
) -> SuspensionRequest | None:
    """The owner suspends or restores an account themselves. Does not commit.

    Suspending this way still writes a request row — raised and approved in the
    same moment — so the history of an account has one shape whoever acted.
    Restoring writes nothing new; it closes any request still open, because a
    pending "please suspend this person" against an account somebody has just
    switched back on is a decision nobody is going to make.
    """
    if actor.role is not UserRole.SUPER_ADMIN:
        raise SuspensionError("Only the platform owner can suspend an account.")
    if target.id == actor.id and not active:
        raise SuspensionError("You cannot suspend your own account.")

    open_request = await open_request_for(session, target.id)

    if active:
        target.is_active = True
        if open_request is not None:
            open_request.status = SuspensionStatus.DECLINED
            open_request.decided_by = actor.id
            open_request.decided_at = datetime.now(UTC)
            open_request.decision_note = "Account restored instead."
        return None

    if open_request is not None:
        return await approve(
            session, request=open_request, actor=actor, note=reason_note(reason)
        )

    request = SuspensionRequest(
        user_id=target.id,
        requested_by=actor.id,
        reason=(reason or "").strip()[:2_000] or "Suspended by the platform owner.",
        status=SuspensionStatus.APPROVED,
        decided_by=actor.id,
        decided_at=datetime.now(UTC),
    )
    session.add(request)
    target.is_active = False
    return request


def reason_note(reason: str | None) -> str | None:
    """Trim a note down to something worth storing."""
    return (reason or "").strip()[:2_000] or None
