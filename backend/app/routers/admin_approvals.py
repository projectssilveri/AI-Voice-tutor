"""The super admin's queue of organisation administrators to approve.

A platform admin who makes somebody an organisation's administrator puts a row
here (`services/approvals`). A new account stays switched off and a promotion
stays unapplied until a super admin answers.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.deps import DbSession, RequireSuperAdmin
from app.models.approval import AccountApproval, ApprovalStatus
from app.models.organization import Organization
from app.models.user import User
from app.services import approvals, audit

router = APIRouter(prefix="/admin", tags=["admin"])


class ApprovalRow(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    requested_role: str
    requested_at: datetime
    user_id: uuid.UUID
    user_name: str
    user_email: str
    organization_id: uuid.UUID
    organization_name: str
    requested_by_name: str | None
    decided_by_name: str | None
    decided_at: datetime | None
    decision_note: str | None


class Decision(BaseModel):
    note: str | None = Field(default=None, max_length=2_000)


async def _rows(
    session: DbSession,
    *,
    wanted: ApprovalStatus | None = None,
    only: uuid.UUID | None = None,
) -> list[ApprovalRow]:
    Person = aliased(User, name="person")
    Requester = aliased(User, name="requester")
    Decider = aliased(User, name="decider")
    query = (
        select(AccountApproval, Person, Organization, Requester.name, Decider.name)
        .join(Person, Person.id == AccountApproval.user_id)
        .join(Organization, Organization.id == AccountApproval.organization_id)
        .outerjoin(Requester, Requester.id == AccountApproval.requested_by)
        .outerjoin(Decider, Decider.id == AccountApproval.decided_by)
        # Waiting first, then newest.
        .order_by(
            (AccountApproval.status != ApprovalStatus.PENDING),
            AccountApproval.requested_at.desc(),
        )
    )
    if wanted is not None:
        query = query.where(AccountApproval.status == wanted)
    if only is not None:
        query = query.where(AccountApproval.id == only)
    return [
        ApprovalRow(
            id=row.id,
            kind=row.kind.value,
            status=row.status.value,
            requested_role=row.requested_role,
            requested_at=row.requested_at,
            user_id=person.id,
            user_name=person.name,
            user_email=person.email,
            organization_id=organization.id,
            organization_name=organization.name,
            requested_by_name=requester_name,
            decided_by_name=decider_name,
            decided_at=row.decided_at,
            decision_note=row.decision_note,
        )
        for row, person, organization, requester_name, decider_name in (
            await session.execute(query)
        ).all()
    ]


@router.get("/approvals", response_model=list[ApprovalRow])
async def list_approvals(
    session: DbSession,
    _: RequireSuperAdmin,
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[ApprovalRow]:
    """The queue. Waiting first; decided ones stay for the record."""
    wanted: ApprovalStatus | None = None
    if status_filter:
        try:
            wanted = ApprovalStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unknown status.",
            ) from None
    return await _rows(session, wanted=wanted)


async def _decide(
    session: DbSession,
    approval_id: uuid.UUID,
    admin: User,
    *,
    approve: bool,
    note: str | None,
) -> ApprovalRow:
    approval = await session.get(AccountApproval, approval_id)
    if approval is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Request not found."
        )
    try:
        await approvals.decide(
            session, approval=approval, actor=admin, approve=approve, note=note
        )
    except approvals.ApprovalError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    person = await session.get(User, approval.user_id)
    await audit.record(
        session,
        action="admin.approval_granted" if approve else "admin.approval_declined",
        actor=admin,
        organization_id=approval.organization_id,
        target_type="user",
        target_id=approval.user_id,
        metadata={
            "name": person.name if person else None,
            "kind": approval.kind.value,
            "role": approval.requested_role,
        },
    )
    await session.commit()
    return (await _rows(session, only=approval.id))[0]


@router.post("/approvals/{approval_id}/approve", response_model=ApprovalRow)
async def approve_request(
    approval_id: uuid.UUID,
    payload: Decision,
    session: DbSession,
    admin: RequireSuperAdmin,
) -> ApprovalRow:
    """Yes: the account is switched on, or the promotion applied."""
    return await _decide(session, approval_id, admin, approve=True, note=payload.note)


@router.post("/approvals/{approval_id}/decline", response_model=ApprovalRow)
async def decline_request(
    approval_id: uuid.UUID,
    payload: Decision,
    session: DbSession,
    admin: RequireSuperAdmin,
) -> ApprovalRow:
    """No: a new account stays switched off, a member keeps their old role."""
    return await _decide(session, approval_id, admin, approve=False, note=payload.note)
