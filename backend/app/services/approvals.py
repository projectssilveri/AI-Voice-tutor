"""A platform admin's new organisation admin, and the super admin's answer.

The role model of 2026-10-01: a platform admin does the super admin's work,
except that making somebody an organisation's administrator waits for a super
admin. `needs_approval` is the one place that rule is written.

Callers do not commit; they own the transaction, as with `suspensions`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.approval import AccountApproval, ApprovalKind, ApprovalStatus
from app.models.user import User, UserRole


class ApprovalError(ValueError):
    """Refused. Carries the sentence to show."""


def needs_approval(actor: User, role: UserRole | None) -> bool:
    """A platform admin making an organisation admin. Nobody else waits.

    A super admin approves their own decisions by making them, and an
    organisation's own admin appoints colleagues inside their company, which
    is theirs to run.
    """
    return actor.role is UserRole.ADMIN and role is UserRole.ORG_ADMIN


async def open_for(session: AsyncSession, user_id: uuid.UUID) -> AccountApproval | None:
    return await session.scalar(
        select(AccountApproval).where(
            AccountApproval.user_id == user_id,
            AccountApproval.status == ApprovalStatus.PENDING,
        )
    )


async def waiting_ids(
    session: AsyncSession, user_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of these people are waiting for a super admin. One query."""
    if not user_ids:
        return set()
    found = await session.scalars(
        select(AccountApproval.user_id).where(
            AccountApproval.user_id.in_(user_ids),
            AccountApproval.status == ApprovalStatus.PENDING,
        )
    )
    return set(found.all())


async def assert_not_waiting(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Refuse to switch on or promote somebody a super admin has not approved.

    Without this the approval is a suggestion: the account is only switched
    off, and any screen that can switch an account on would let it in.
    """
    if await open_for(session, user_id) is not None:
        raise ApprovalError(
            "This person is waiting for a super admin to approve them as an "
            "organisation administrator."
        )


async def assert_may_switch_on(session: AsyncSession, user: User, actor: User) -> None:
    """Refuse to switch on an administrator a super admin has not let in.

    `assert_not_waiting` covers a request still open. A declined new account
    needs the same lock: it stays switched off with the administrator role on
    it, so a platform admin pressing Reactivate afterwards let in the very
    person the super admin said no to. Whoever `needs_approval` never asks may
    still switch it on: a super admin, and the organisation's own
    administrator, who could appoint them anyway.
    """
    await assert_not_waiting(session, user.id)
    if not needs_approval(actor, user.role):
        return
    latest = await session.scalar(
        select(AccountApproval)
        .where(AccountApproval.user_id == user.id)
        .order_by(AccountApproval.requested_at.desc())
        .limit(1)
    )
    if (
        latest is not None
        and latest.kind == ApprovalKind.NEW_ACCOUNT
        and latest.status == ApprovalStatus.DECLINED
    ):
        raise ApprovalError(
            "A super admin declined this administrator, so only a super admin "
            "can switch the account on."
        )


async def request(
    session: AsyncSession,
    *,
    user: User,
    organization_id: uuid.UUID,
    kind: ApprovalKind,
    actor: User,
) -> AccountApproval:
    """Put one in the super admin's queue. Does not commit."""
    row = AccountApproval(
        user_id=user.id,
        organization_id=organization_id,
        kind=kind,
        requested_role=UserRole.ORG_ADMIN.value,
        requested_by=actor.id,
        status=ApprovalStatus.PENDING,
    )
    session.add(row)
    try:
        # Flushed here so the one-open index has its say, as with suspensions.
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise ApprovalError(
            "This person is already waiting for a super admin's approval."
        ) from exc
    return row


async def decide(
    session: AsyncSession,
    *,
    approval: AccountApproval,
    actor: User,
    approve: bool,
    note: str | None = None,
) -> AccountApproval:
    """The super admin's answer. Does not commit."""
    if actor.role is not UserRole.SUPER_ADMIN:
        raise ApprovalError("Only a super admin can decide this.")
    if approval.status is not ApprovalStatus.PENDING:
        raise ApprovalError("That request has already been decided.")

    user = await session.get(User, approval.user_id)
    if user is None:
        raise ApprovalError("That account no longer exists.")

    if approve:
        # RE-CHECKED AT THE END, not only when asked: somebody moved to another
        # organisation in between is not who this request was about.
        if user.organization_id != approval.organization_id:
            raise ApprovalError(
                "That person is no longer in the organisation this was asked for."
            )
        if approval.kind is ApprovalKind.NEW_ACCOUNT:
            user.is_active = True
        else:
            user.role = UserRole.ORG_ADMIN

    approval.status = ApprovalStatus.APPROVED if approve else ApprovalStatus.DECLINED
    approval.decided_by = actor.id
    approval.decided_at = datetime.now(UTC)
    approval.decision_note = (note or "").strip() or None
    return approval
