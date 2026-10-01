"""Deletion requests from every customer, decided by platform staff.

Since 2026-10-01 a Platform Admin or Super Admin approves what anybody inside
a customer asks to delete: an organisation admin removing a learner or
another admin, and any course or document deleted from inside the customer
(`services/deletions.acts_directly` is the rule). Branch managers and
department admins remove their own people at once. This page shows every
request at once; each organisation's portal still shows its own.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.deps import DbSession, RequireAdmin
from app.models.audit import AuditAction
from app.models.deletion import DeletionRequest, DeletionStatus
from app.models.organization import Organization
from app.models.user import User
from app.routers.org_portal import Decision, DeletionRequestRow, _deletion_rows
from app.services import audit, deletions

router = APIRouter(prefix="/admin", tags=["admin"])


class StaffDeletionRow(DeletionRequestRow):
    """One request, with the customer it belongs to."""

    organization_id: uuid.UUID
    organization_name: str
    organization_slug: str


async def _rows(
    session: DbSession, requests: list[DeletionRequest], reader: User
) -> list[StaffDeletionRow]:
    base = await _deletion_rows(session, requests, reader)
    ids = {request.organization_id for request in requests}
    orgs = (
        {
            org.id: org
            for org in (
                await session.scalars(select(Organization).where(Organization.id.in_(ids)))
            ).all()
        }
        if ids
        else {}
    )
    rows = []
    for request, row in zip(requests, base, strict=True):
        org = orgs.get(request.organization_id)
        rows.append(
            StaffDeletionRow(
                **row.model_dump(),
                organization_id=request.organization_id,
                organization_name=org.name if org else "An organisation",
                organization_slug=org.slug if org else "",
            )
        )
    return rows


@router.get("/deletion-requests", response_model=list[StaffDeletionRow])
async def list_deletion_requests(
    session: DbSession, admin: RequireAdmin, include_decided: bool = False
) -> list[StaffDeletionRow]:
    """Waiting first, newest first. Decided ones only when asked for."""
    query = select(DeletionRequest)
    if not include_decided:
        query = query.where(DeletionRequest.status == DeletionStatus.PENDING)
    query = query.order_by(DeletionRequest.requested_at.desc()).limit(200)
    requests = list((await session.scalars(query)).all())
    return await _rows(session, requests, admin)


async def _locked(session: DbSession, request_id: uuid.UUID) -> DeletionRequest:
    """The request, locked, so two people cannot decide it at once.

    The same reason as the portal's `_load_request`: deciding is read, then
    destroy, then write, and two approvals arriving together both ran the
    deletion before the lock existed.
    """
    request = await session.get(DeletionRequest, request_id, with_for_update=True)
    if request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Request not found."
        )
    return request


@router.post(
    "/deletion-requests/{request_id}/approve", response_model=StaffDeletionRow
)
async def approve_deletion(
    request_id: uuid.UUID,
    payload: Decision,
    session: DbSession,
    admin: RequireAdmin,
) -> StaffDeletionRow:
    """Agree, and the thing is destroyed in the same transaction."""
    request = await _locked(session, request_id)
    try:
        await deletions.approve(
            session, request=request, actor=admin, note=payload.note
        )
    except deletions.DeletionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None
    await audit.record(
        session,
        action=AuditAction.DELETION_APPROVED,
        actor=admin,
        organization_id=request.organization_id,
        target_type=request.target_type.value,
        target_id=request.target_id,
        metadata={
            "label": request.target_label,
            "outcome": request.outcome,
            "requested_by": str(request.requested_by),
        },
    )
    await session.commit()
    return (await _rows(session, [request], admin))[0]


@router.post(
    "/deletion-requests/{request_id}/decline", response_model=StaffDeletionRow
)
async def decline_deletion(
    request_id: uuid.UUID,
    payload: Decision,
    session: DbSession,
    admin: RequireAdmin,
) -> StaffDeletionRow:
    """Refuse, with a reason. Nothing is touched."""
    request = await _locked(session, request_id)
    try:
        await deletions.decline(
            session, request=request, actor=admin, note=payload.note
        )
    except deletions.DeletionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None
    await audit.record(
        session,
        action=AuditAction.DELETION_DECLINED,
        actor=admin,
        organization_id=request.organization_id,
        target_type=request.target_type.value,
        target_id=request.target_id,
        metadata={
            "label": request.target_label,
            "note": request.decision_note,
            "requested_by": str(request.requested_by),
        },
    )
    await session.commit()
    return (await _rows(session, [request], admin))[0]
