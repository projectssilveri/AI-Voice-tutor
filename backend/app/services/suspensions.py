"""Asking for an account to be switched off, and deciding.

    admin ──request(reason)──> pending ──approve──> account suspended
                                  │
                                  └──decline(note)──> nothing happens

THE ACCOUNT IS NOT TOUCHED UNTIL APPROVAL. That is the whole point: a request
is a request, and an admin pressing the button must not be able to lock a
paying customer out on their own. `users.is_active` moves in exactly one place
for this flow — `approve` — and the ordinary user-update schema no longer
carries the field at all.

The super admin does not need a request. They can suspend directly, and that
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
            "Say why. The super admin cannot act on a request with no reason, "
            "and neither can the person it is about."
        )

    if target.id == actor.id:
        raise SuspensionError("You cannot ask for your own account to be suspended.")

    if not target.is_active:
        raise SuspensionError("That account is already suspended.")

    # A super admin cannot be suspended by a request from below. Anyone who
    # could raise one against them could remove the only person able to decide
    # it, which is how an escalation becomes a lockout.
    if target.role is UserRole.SUPER_ADMIN:
        raise SuspensionError("A super admin's account cannot be suspended here.")

    if await open_request_for(session, target.id) is not None:
        raise SuspensionError(
            "Somebody has already asked for this account to be suspended, and "
            "the super admin has not decided yet."
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
        raise SuspensionError("Only the super admin can decide a suspension.")
    if request.status is not SuspensionStatus.PENDING:
        raise SuspensionError("That request has already been decided.")

    target = await session.get(User, request.user_id)
    if target is None:
        raise SuspensionError("That account no longer exists.")

    # RE-CHECKED HERE, not only when the request was raised.
    #
    # `request_suspension` refuses to raise one against a super admin, and
    # `set_active_directly` now refuses to switch one off. This was the third
    # door and it had no lock: a request raised while somebody was an ordinary
    # user stays pending, and if they are promoted before it is decided,
    # approving it suspends a super admin — through a path that never asked
    # what they had become.
    #
    # The gap between raising and deciding is the whole point of the request
    # flow, so the role has to be checked at the end of it and not only at the
    # start.
    if target.role is UserRole.SUPER_ADMIN:
        raise SuspensionError(
            "That account is a super admin now. Change their role first if "
            "they should no longer hold it."
        )
    await _keep_admin_floor(session, target)

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
        raise SuspensionError("Only the super admin can decide a suspension.")
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
    if actor.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        raise SuspensionError("Only platform staff can suspend an account.")
    if target.id == actor.id and not active:
        raise SuspensionError("You cannot suspend your own account.")
    # A platform admin acts on the accounts below them only. The route checks
    # this too; here it holds whoever calls the service.
    if actor.role is UserRole.ADMIN and target.role in (
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
    ):
        raise SuspensionError("Only a super admin can change a staff account.")

    # A SUPER ADMIN MAY SUSPEND ANOTHER SUPER ADMIN since 2026-10-01, the
    # user's decision, as long as one active super admin is left: with none,
    # nobody could approve admins or courses or change a role again. It was
    # refused outright before (issues 3 and 5). Only a super admin gets this
    # far with a super admin as the target; a platform admin was refused above.
    #
    # ONLY WHEN SUSPENDING. Restoring has to stay open.
    if not active and target.role is UserRole.SUPER_ADMIN:
        await _keep_super_admin_floor(session, target)

    open_request = await open_request_for(session, target.id)

    if active:
        target.is_active = True
        if open_request is not None:
            open_request.status = SuspensionStatus.DECLINED
            open_request.decided_by = actor.id
            open_request.decided_at = datetime.now(UTC)
            open_request.decision_note = "Account restored instead."
        return None

    await _keep_admin_floor(session, target)

    # AN OPEN REQUEST IS CLOSED BY WHOEVER ACTED, not passed to `approve`.
    # That is the super admin's queue decision and refuses anybody else, so a
    # platform admin suspending somebody with a request still open was told
    # "Only the super admin can decide a suspension" for a decision that has
    # been theirs since 2026-10-01.
    if open_request is not None:
        open_request.status = SuspensionStatus.APPROVED
        open_request.decided_by = actor.id
        open_request.decided_at = datetime.now(UTC)
        open_request.decision_note = reason_note(reason)
        target.is_active = False
        return open_request

    request = SuspensionRequest(
        user_id=target.id,
        requested_by=actor.id,
        reason=(reason or "").strip()[:2_000] or "Suspended by the super admin.",
        status=SuspensionStatus.APPROVED,
        decided_by=actor.id,
        decided_at=datetime.now(UTC),
    )
    session.add(request)
    target.is_active = False
    return request


async def _keep_super_admin_floor(session: AsyncSession, target: User) -> None:
    """Refuse to switch off the last active super admin.

    Locked rather than counted, the same as `admin_users.assert_super_admin_floor`:
    two super admins suspending each other at the same moment would otherwise
    both see one left and leave none.
    """
    from app.services import concurrency

    held = await concurrency.lock_and_list(
        session,
        select(User.id)
        .where(User.role == UserRole.SUPER_ADMIN, User.is_active.is_(True))
        .order_by(User.id),
    )
    if not [row for row in held if row != target.id]:
        raise SuspensionError(
            "That is the last active super admin. Make somebody else a super "
            "admin first, or nobody could approve or promote anyone again."
        )


async def _keep_admin_floor(session: AsyncSession, target: User) -> None:
    """Refuse to switch off one of an organisation's last administrators.

    The floor belongs to the organisation, whichever screen is used. The portal,
    a deletion and closing your own account all held it, and suspending from
    the Users screen did not: a platform admin or a super admin could leave a
    customer with one administrator, the lockout the floor exists to prevent.
    """
    from app.services import organizations as org_service

    try:
        await org_service.assert_admin_floor_after_change(
            session, target, still_admin=False
        )
    except org_service.AdminFloorError as exc:
        raise SuspensionError(str(exc)) from None


def reason_note(reason: str | None) -> str | None:
    """Trim a note down to something worth storing."""
    return (reason or "").strip()[:2_000] or None
