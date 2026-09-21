"""Destroying a customer's people, training or documents — with their consent.

    platform staff ─┐
                    ├─request(reason)─> pending ─approve─> it is deleted
    branch / dept  ─┘                      │
    manager                                └─decline(note)─> nothing happens

NOTHING IS TOUCHED UNTIL AN ORGANISATION ADMIN APPROVES. That is the whole
point, and it is the counterweight to a platform admin now being able to see a
customer's data in full: sight runs down the ladder, destruction does not. The
data belongs to the customer even though the platform holds it.

WHO CAN DECIDE: only `UserRole.ORG_ADMIN`, and only for their own organisation.
Not a branch manager and not a department admin — both of those can ASK, and a
person who can approve their own request has not been checked by anybody. Not
platform staff either, including a super admin: an approval a super admin could
grant themselves is not consent, it is a longer way of writing DELETE.

THE ONE SHORTCUT, and it is the same one suspensions take: an organisation
admin removing something themselves is already the decider, so the row is
written raised-and-approved in the same moment. The history then has one shape
whoever acted, instead of two.

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

    `pre_approved` is the organisation admin acting on their own authority —
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
            "Somebody has already asked for this to be deleted, and the "
            "organisation's administrator has not decided yet."
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


def assert_may_decide(request: DeletionRequest, actor: User) -> None:
    """Only this organisation's own administrator, and nobody else at all."""
    if actor.role is not UserRole.ORG_ADMIN:
        raise DeletionError(
            "Only an organisation administrator can approve a deletion."
        )
    if actor.organization_id != request.organization_id:
        raise DeletionError("That request belongs to another organisation.")
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
    """The organisation agrees, and the thing is destroyed. Does not commit."""
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
    """The organisation says no. Nothing is touched. Does not commit."""
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
