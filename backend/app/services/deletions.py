"""Destroying a customer's people, training or documents, and who says yes.

    org admin ──────┐
    branch / dept  ─┼─request(reason)─> pending ─approve─> it is deleted
    manager         ┘   (staff decide)      │
                                            └─decline(note)─> nothing happens

    platform admin / super admin ─────> deleted at once
    org admin removing a branch manager or department admin ─> at once
    branch manager or department admin removing their own people ─> at once

THE RULE SINCE 2026-10-01, decided by the user: platform staff (a platform
admin or a super admin) delete inside a customer at once, and they are the
ones who approve what anybody inside the customer asks to delete. An
organisation admin removes their branch managers and department admins
themselves, and those managers remove the people in their own branch or
department themselves. Everything else waits for staff: the organisation
admin removing a learner or another admin, and any course or document
deleted from inside the customer. It reverses the earlier rule, where the
customer's own administrator decided.

`acts_directly` is the one place that rule is written.

A request is never decided by the person who raised it, and nobody approves
the removal of their own account.

Every deletion leaves a request row, raised and approved in the same moment
when somebody acted directly, so the history has one shape whoever acted.

Nothing here commits. The caller owns the transaction, so the deletion, the
request row and the audit record land together or not at all.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course
from app.models.deletion import DeletionRequest, DeletionStatus, DeletionTarget
from app.models.org_document import OrganizationDocument
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.services import accounts
from app.services import organizations as org_service


class DeletionError(ValueError):
    """The request cannot be made or decided as asked."""


#: What a request can say about itself when the thing is already gone. Kept as a
#: constant because two call sites compare against it.
GONE = "already gone"

#: Platform staff: they delete inside a customer at once, and decide requests.
DECIDERS = frozenset({UserRole.ADMIN, UserRole.SUPER_ADMIN})

#: The people an organisation admin removes without asking anybody.
ORG_ADMIN_REMOVES_FREELY = frozenset({UserRole.BRANCH_MANAGER, UserRole.DEPT_ADMIN})


#: Managers who look after the people in their own branch or department.
MAINTAIN_THEIR_OWN_PEOPLE = frozenset({UserRole.BRANCH_MANAGER, UserRole.DEPT_ADMIN})


def acts_directly(actor: User, *, member: User | None = None) -> bool:
    """Whether this deletion happens at once rather than waiting for staff.

    Platform staff, always. When the thing is a person (`member`): an
    organisation admin removing a branch manager or a department admin, and a
    branch manager or department admin removing somebody in their own branch
    or department, who maintain their own people (the user, 2026-10-01). WHICH
    people a manager reaches is the portal's `_manageable`: their own branch
    or department, and nobody senior. Courses and documents they still ask.
    """
    if actor.role in DECIDERS:
        return True
    if member is None:
        return False
    if actor.role is UserRole.ORG_ADMIN:
        return member.role in ORG_ADMIN_REMOVES_FREELY
    return actor.role in MAINTAIN_THEIR_OWN_PEOPLE


async def open_request_for(
    session: AsyncSession, target_type: DeletionTarget, target_id: uuid.UUID
) -> DeletionRequest | None:
    """The pending request against this thing, if there is one."""
    return await session.scalar(
        select(DeletionRequest).where(
            DeletionRequest.target_type == target_type,
            DeletionRequest.target_id == target_id,
            DeletionRequest.status == DeletionStatus.PENDING,
        )
    )


async def pending_ids(
    session: AsyncSession, target_type: DeletionTarget
) -> set[uuid.UUID]:
    """Every id of this kind with a request waiting.

    One query for a whole list rather than one per row: the users console asks
    this to put "Deletion requested" on the right rows, and a query per row is
    how a list of fifty becomes fifty-one round trips.
    """
    rows = await session.scalars(
        select(DeletionRequest.target_id).where(
            DeletionRequest.target_type == target_type,
            DeletionRequest.status == DeletionStatus.PENDING,
        )
    )
    return set(rows.all())


async def list_for_organization(
    session: AsyncSession,
    organization_id: uuid.UUID,
    *,
    status: DeletionStatus | None = DeletionStatus.PENDING,
    limit: int = 100,
) -> list[DeletionRequest]:
    """The queue for one organisation, newest first."""
    query = select(DeletionRequest).where(
        DeletionRequest.organization_id == organization_id
    )
    if status is not None:
        query = query.where(DeletionRequest.status == status)
    query = query.order_by(DeletionRequest.requested_at.desc()).limit(limit)
    return list((await session.scalars(query)).all())


async def request_deletion(
    session: AsyncSession,
    *,
    organization: Organization,
    target_type: DeletionTarget,
    target_id: uuid.UUID,
    target_label: str,
    actor: User,
    reason: str,
    pre_approved: bool = False,
) -> DeletionRequest:
    """Ask for something to be destroyed. Does not commit.

    `pre_approved` is somebody acting on their own authority (`acts_directly`):
    the row is written approved so the history has one shape. The CALLER then
    performs the deletion, because only it knows what deleting that kind of
    thing means; `approve` below does the same for the queued path.
    """
    clean = (reason or "").strip()
    if not clean:
        raise DeletionError(
            "Say why. An administrator cannot agree to destroy something on the "
            "strength of 'delete this', and the people affected cannot be told "
            "anything either."
        )

    if await open_request_for(session, target_type, target_id) is not None:
        raise DeletionError(
            "Somebody has already asked for this to be deleted, and a Platform "
            "Admin or Super Admin has not decided yet."
        )

    now = datetime.now(UTC)
    request = DeletionRequest(
        organization_id=organization.id,
        target_type=target_type,
        target_id=target_id,
        target_label=(target_label or "Unnamed").strip()[:300],
        requested_by=actor.id,
        reason=clean[:2_000],
        status=DeletionStatus.APPROVED if pre_approved else DeletionStatus.PENDING,
        decided_by=actor.id if pre_approved else None,
        decided_at=now if pre_approved else None,
    )
    session.add(request)
    try:
        # Flushed here so the partial unique index has its say: the check above
        # still races two people pressing at the same moment, and the database
        # is the only thing that cannot.
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise DeletionError(
            "Somebody asked for this to be deleted at the same moment."
        ) from exc
    return request


async def record_direct(
    session: AsyncSession,
    *,
    organization: Organization,
    target_type: DeletionTarget,
    target_id: uuid.UUID,
    target_label: str,
    actor: User,
    reason: str,
) -> DeletionRequest:
    """The record for somebody deleting at once (`acts_directly`). Does not commit.

    A request already waiting for the same thing is closed as approved by them,
    rather than refusing them: they may do it outright, and doing it answers
    the request. Otherwise a row is written raised and approved together, so
    the history has one shape whoever acted. The CALLER performs the deletion.
    """
    waiting = await open_request_for(session, target_type, target_id)
    if waiting is not None:
        waiting.status = DeletionStatus.APPROVED
        waiting.decided_by = actor.id
        waiting.decided_at = datetime.now(UTC)
        waiting.decision_note = (reason or "").strip()[:2_000] or None
        return waiting
    return await request_deletion(
        session,
        organization=organization,
        target_type=target_type,
        target_id=target_id,
        target_label=target_label,
        actor=actor,
        reason=reason,
        pre_approved=True,
    )


def assert_may_decide(request: DeletionRequest, actor: User) -> None:
    """Platform staff only: a platform admin or a super admin."""
    if actor.role not in DECIDERS:
        raise DeletionError(
            "Only a Platform Admin or Super Admin can decide a deletion."
        )
    if request.status is not DeletionStatus.PENDING:
        raise DeletionError("That request has already been decided.")
    # NOR YOUR OWN ACCOUNT, through this door either.
    #
    # `remove_member` has refused self-removal since decision 165 — it has no
    # legitimate use and it locks you out on the very next request. This path
    # did not, so the guard was simply missing from the second door: an
    # administrator could approve a request whose target was themselves. The
    # admin floor caught it only when they happened to be one of exactly two;
    # with three or more it went straight through.
    if (
        request.target_type is DeletionTarget.MEMBER
        and request.target_id == actor.id
    ):
        raise DeletionError(
            "You cannot approve the removal of your own account. "
            "Ask another administrator to decide it."
        )
    if request.requested_by == actor.id:
        # They raised it, so approving it would be nobody checking anybody. The
        # shortcut for an admin acting alone is `pre_approved` at request time,
        # which is honest about being one person's decision; this path is for
        # requests that came from somewhere else.
        raise DeletionError(
            "You raised this request, so somebody else has to decide it."
        )


async def approve(
    session: AsyncSession, *, request: DeletionRequest, actor: User, note: str | None = None
) -> DeletionRequest:
    """Platform staff agree, and the thing is destroyed. Does not commit."""
    assert_may_decide(request, actor)

    outcome = await _destroy(session, request)

    request.status = DeletionStatus.APPROVED
    request.decided_by = actor.id
    request.decided_at = datetime.now(UTC)
    request.decision_note = (note or "").strip() or None
    request.outcome = outcome
    return request


async def decline(
    session: AsyncSession, *, request: DeletionRequest, actor: User, note: str | None = None
) -> DeletionRequest:
    """Platform staff say no. Nothing is touched. Does not commit."""
    assert_may_decide(request, actor)

    clean = (note or "").strip()
    if not clean:
        # The same rule rejecting a course carries: a refusal with no reason
        # tells the person who asked nothing they can act on, so they ask again.
        raise DeletionError("Say why you are declining, so the request is not just reopened.")

    request.status = DeletionStatus.DECLINED
    request.decided_by = actor.id
    request.decided_at = datetime.now(UTC)
    request.decision_note = clean[:2_000]
    return request


async def _destroy(session: AsyncSession, request: DeletionRequest) -> str:
    """Actually remove the thing. Returns what happened, for the record.

    RE-CHECKED AT APPROVAL TIME, not trusted from when the request was raised.
    The gap between asking and deciding is the whole point of this flow, and
    everything that mattered when it was raised can have changed inside it —
    the member could have been promoted to the organisation's second admin, the
    training could already be gone. `suspensions.approve` learned the same
    lesson the hard way.
    """
    if request.target_type is DeletionTarget.MEMBER:
        return await _destroy_member(session, request)
    if request.target_type is DeletionTarget.TRAINING:
        return await _destroy_training(session, request)
    return await _destroy_document(session, request)


async def _destroy_member(session: AsyncSession, request: DeletionRequest) -> str:
    member = await session.get(User, request.target_id)
    if member is None:
        return GONE
    if member.organization_id != request.organization_id:
        # Moved to another company, or out of one entirely, since the request.
        raise DeletionError(
            f"{member.name} is no longer in this organisation, so this request "
            "is not yours to decide."
        )

    # THE ADMIN FLOOR, RECOMPUTED NOW. An organisation must keep two
    # administrators; whether removing this person breaks that depends on who
    # else has been promoted or demoted since the request was raised.
    if member.role is UserRole.ORG_ADMIN:
        try:
            await org_service.assert_admin_floor_after_change(
                session, member, still_admin=False
            )
        except org_service.AdminFloorError as exc:
            raise DeletionError(str(exc)) from None

    removal = await accounts.remove_account(session, member)
    return removal.outcome


async def _destroy_training(session: AsyncSession, request: DeletionRequest) -> str:
    course = await session.get(Course, request.target_id)
    if course is None:
        return GONE
    if course.organization_id != request.organization_id:
        raise DeletionError("That training no longer belongs to this organisation.")

    # `session.delete` rather than `services.courses.delete_course`, which
    # commits internally. A commit in the middle of this would land the deletion
    # before the request row saying it was agreed to, and a crash in between
    # would leave the course gone with nothing recording why.
    await session.delete(course)
    return "deleted"


async def _destroy_document(session: AsyncSession, request: DeletionRequest) -> str:
    document = await session.get(OrganizationDocument, request.target_id)
    if document is None:
        return GONE
    if document.organization_id != request.organization_id:
        raise DeletionError("That document no longer belongs to this organisation.")
    await session.delete(document)
    return "deleted"
