"""Suspension requests: an admin asks, the super admin decides.

An ordinary admin used to be able to switch an account off alone — `is_active`
was on the ordinary user-update schema. Locking a paying customer out is not an
editing decision, so it goes the way publishing does: the admin raises it with
a reason, and the owner approves or declines. The account is untouched until
somebody approves.

    POST /admin/users/{id}/suspension-request   admin  — ask, with a reason
    GET  /admin/suspension-requests             owner  — the queue
    POST /admin/suspension-requests/{id}/approve   owner — switch it off
    POST /admin/suspension-requests/{id}/decline   owner — leave it alone
    POST /admin/users/{id}/active                  owner — act directly
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.deps import DbSession, RequireAdmin, RequireSuperAdmin
from app.models.suspension import SuspensionRequest, SuspensionStatus
from app.models.user import User
from app.routers.admin_users import _manageable
from app.services import approvals, audit, suspensions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


class SuspensionRow(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    user_email: str
    user_role: str
    user_is_active: bool

    reason: str
    status: str
    requested_at: datetime
    requested_by_name: str
    requested_by_email: str
    decided_at: datetime | None
    decided_by_name: str | None
    decision_note: str | None


class SuspensionAsk(BaseModel):
    #: Required, and the service refuses an empty one. The owner cannot act on
    #: "suspend this person", and neither can the person it is about.
    reason: str = Field(min_length=1, max_length=2_000)


class SuspensionDecision(BaseModel):
    note: str | None = Field(default=None, max_length=2_000)


class ActiveChange(BaseModel):
    """The owner acting directly, without waiting for a request."""

    active: bool
    reason: str | None = Field(default=None, max_length=2_000)


async def _rows(
    session,
    *,
    wanted: SuspensionStatus | None = None,
    only: uuid.UUID | None = None,
) -> list[SuspensionRow]:
    """The queue query, in one place — the list and single reads share it."""
    target = aliased(User)
    requester = aliased(User)
    decider = aliased(User)

    query = (
        select(SuspensionRequest, target, requester, decider.name)
        .join(target, target.id == SuspensionRequest.user_id)
        .join(requester, requester.id == SuspensionRequest.requested_by)
        .outerjoin(decider, decider.id == SuspensionRequest.decided_by)
    )
    if wanted is not None:
        query = query.where(SuspensionRequest.status == wanted)
    if only is not None:
        query = query.where(SuspensionRequest.id == only)

    rows = (
        await session.execute(
            query.order_by(
                # Undecided first whatever else is in the list, oldest at the
                # top: a queue ordered any other way hides the thing somebody
                # has been waiting longest on.
                (SuspensionRequest.status != SuspensionStatus.PENDING),
                SuspensionRequest.requested_at.asc(),
            )
        )
    ).all()

    return [
        SuspensionRow(
            id=request.id,
            user_id=person.id,
            user_name=person.name,
            user_email=person.email,
            user_role=person.role.value,
            user_is_active=person.is_active,
            reason=request.reason,
            status=request.status.value,
            requested_at=request.requested_at,
            requested_by_name=asker.name,
            requested_by_email=asker.email,
            decided_at=request.decided_at,
            decided_by_name=decided_name,
            decision_note=request.decision_note,
        )
        for request, person, asker, decided_name in rows
    ]


@router.post(
    "/users/{user_id}/suspension-request",
    response_model=SuspensionRow,
    status_code=status.HTTP_201_CREATED,
)
async def ask_to_suspend(
    user_id: uuid.UUID,
    payload: SuspensionAsk,
    session: DbSession,
    admin: RequireAdmin,
) -> SuspensionRow:
    """Ask the super admin to switch an account off.

    Nothing happens to the account here. That is the point of the request: an
    admin seeing a problem can raise it immediately without being able to lock
    a customer out on their own judgement.
    """
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )

    # THIS ROUTE NEVER CHECKED WHO THE TARGET WAS. It took any user id and
    # raised a request against it, which was survivable while a platform admin
    # could only see public accounts — they had no way to learn anybody else's
    # id from the product. Now that organisation admins appear in their list,
    # an unguarded id is an unguarded id, and "raise a suspension request
    # against the person who runs Acme" is exactly the reach the directory is
    # not meant to give.
    _manageable(admin, target)

    try:
        request = await suspensions.request_suspension(
            session, target=target, actor=admin, reason=payload.reason
        )
    except suspensions.SuspensionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    await audit.record(
        session,
        action="user.suspension_requested",
        actor=admin,
        target_type="user",
        target_id=target.id,
        metadata={"reason": request.reason, "target_email": target.email},
    )
    await session.commit()
    logger.info("Admin %s asked to suspend user %s", admin.id, target.id)
    return (await _rows(session, only=request.id))[0]


@router.get("/suspension-requests", response_model=list[SuspensionRow])
async def list_suspension_requests(
    session: DbSession,
    admin: RequireSuperAdmin,
    status_filter: str | None = None,
) -> list[SuspensionRow]:
    """The queue. Undecided first; decided ones stay for the record."""
    wanted: SuspensionStatus | None = None
    if status_filter:
        try:
            wanted = SuspensionStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unknown status.",
            ) from None
    return await _rows(session, wanted=wanted)


async def _decide(
    session, request_id: uuid.UUID, admin: User, approve: bool, note: str | None
) -> SuspensionRow:
    request = await session.get(SuspensionRequest, request_id)
    if request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Request not found."
        )

    action = suspensions.approve if approve else suspensions.decline
    try:
        await action(session, request=request, actor=admin, note=note)
    except suspensions.SuspensionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    await audit.record(
        session,
        action="user.suspension_approved" if approve else "user.suspension_declined",
        actor=admin,
        target_type="user",
        target_id=request.user_id,
        metadata={"reason": request.reason, "note": request.decision_note},
    )
    await session.commit()
    return (await _rows(session, only=request.id))[0]


@router.post("/suspension-requests/{request_id}/approve", response_model=SuspensionRow)
async def approve_suspension(
    request_id: uuid.UUID,
    payload: SuspensionDecision,
    session: DbSession,
    admin: RequireSuperAdmin,
) -> SuspensionRow:
    """Agree, and switch the account off."""
    return await _decide(session, request_id, admin, approve=True, note=payload.note)


@router.post("/suspension-requests/{request_id}/decline", response_model=SuspensionRow)
async def decline_suspension(
    request_id: uuid.UUID,
    payload: SuspensionDecision,
    session: DbSession,
    admin: RequireSuperAdmin,
) -> SuspensionRow:
    """Say no. The account is untouched."""
    return await _decide(session, request_id, admin, approve=False, note=payload.note)


@router.post("/users/{user_id}/active", response_model=SuspensionRow | None)
async def set_user_active(
    user_id: uuid.UUID,
    payload: ActiveChange,
    session: DbSession,
    admin: RequireAdmin,
) -> SuspensionRow | None:
    """Suspend or restore an account directly. Platform staff.

    They are the decider, so waiting for their own request would be theatre.
    Suspending this way still writes the record — raised and approved together
    — so an account's history has one shape however it was switched off.

    A platform admin acts here too since the role model of 2026-10-01, on the
    accounts they may manage: never the staff above them, which `_manageable`
    answers with a 404 as on every other write.
    """
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )
    _manageable(admin, target)

    # Switching on somebody who is waiting for a super admin's approval, or
    # whom one declined, would make that answer a suggestion
    # (`services/approvals`).
    if payload.active and not target.is_active:
        try:
            await approvals.assert_may_switch_on(session, target, admin)
        except approvals.ApprovalError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None

    try:
        request = await suspensions.set_active_directly(
            session,
            target=target,
            active=payload.active,
            actor=admin,
            reason=payload.reason or "",
        )
    except suspensions.SuspensionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    await audit.record(
        session,
        action="user.restored" if payload.active else "user.suspended",
        actor=admin,
        target_type="user",
        target_id=target.id,
        metadata={"reason": (payload.reason or "").strip() or None},
    )
    await session.commit()
    return (await _rows(session, only=request.id))[0] if request else None
