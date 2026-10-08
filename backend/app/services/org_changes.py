"""Branch and department admin changes, waiting for the organisation admin.

Sir's rule of 2026-10-01: an organisation admin does everything in their own
organisation with no approval. A branch manager or department admin who
creates, edits or deletes a user, course or document raises a request here,
and the organisation admin approves it. Platform and super admins act
directly and never pass through this.

`needs_approval` is the one place the "who waits" rule is written. The route
runs its own scoping guards first (a manager still cannot propose something
outside their branch or above their level), then calls `request` instead of
applying. `decide` applies it with the organisation admin's authority.

Members and courses carry their proposed fields in `payload`; a member
create carries the password already hashed, so nothing is stored in the
clear. A document is stored at once with `pending_approval` set and its id in
`target_id`: approving clears the flag, declining deletes the row. A module
added, changed or removed is an edit of its course, with `module_op` and
`course_id` in the payload and the module's id, if it has one, in `target_id`.

Callers do not commit; they own the transaction.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.org_change import (
    ChangeAction,
    ChangeKind,
    ChangeStatus,
    OrgChangeRequest,
)
from app.models.user import User, UserRole

#: The roles whose changes wait for the organisation admin.
ASKERS = frozenset({UserRole.BRANCH_MANAGER, UserRole.DEPT_ADMIN})


class ChangeError(ValueError):
    """Refused. Carries the sentence to show."""


def needs_approval(user: User) -> bool:
    """A branch manager or department admin. Nobody else waits.

    An organisation admin, and platform staff acting inside the tenant, act
    directly (`OrgContext.is_org_admin` is true for platform staff too).
    """
    return user.role in ASKERS


async def open_for(
    session: AsyncSession,
    kind: ChangeKind,
    action: ChangeAction,
    target_id: uuid.UUID,
) -> OrgChangeRequest | None:
    return await session.scalar(
        select(OrgChangeRequest).where(
            OrgChangeRequest.kind == kind,
            OrgChangeRequest.action == action,
            OrgChangeRequest.target_id == target_id,
            OrgChangeRequest.status == ChangeStatus.PENDING,
        )
    )


async def list_for_org(
    session: AsyncSession,
    organization_id: uuid.UUID,
    *,
    status: ChangeStatus | None = ChangeStatus.PENDING,
    limit: int = 200,
) -> list[OrgChangeRequest]:
    query = select(OrgChangeRequest).where(
        OrgChangeRequest.organization_id == organization_id
    )
    if status is not None:
        query = query.where(OrgChangeRequest.status == status)
    query = query.order_by(OrgChangeRequest.requested_at.desc()).limit(limit)
    return list((await session.scalars(query)).all())


async def request(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    kind: ChangeKind,
    action: ChangeAction,
    target_id: uuid.UUID | None,
    label: str,
    reason: str,
    actor: User,
    payload: dict | None = None,
) -> OrgChangeRequest:
    """Put a change in the organisation admin's queue. Does not commit."""
    clean = (reason or "").strip()
    if not clean:
        raise ChangeError(
            "Say why. The administrator deciding this needs a reason, and so "
            "does whoever is affected."
        )
    row = OrgChangeRequest(
        organization_id=organization_id,
        kind=kind,
        action=action,
        target_id=target_id,
        label=(label or "Unnamed").strip()[:300],
        payload=payload or None,
        reason=clean[:2_000],
        requested_by=actor.id,
        status=ChangeStatus.PENDING,
    )
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise ChangeError(
            "Somebody has already asked for this, and the organisation "
            "administrator has not decided yet."
        ) from exc
    return row


def assert_may_decide(request_row: OrgChangeRequest, actor: User) -> None:
    """Only this organisation's own administrator decides.

    Not a branch manager or department admin: the point of the queue is that
    the person who asked is not the person who approves. Not platform staff
    either: Sir's rule put these in the organisation admin's hands, and
    platform staff act directly rather than through the queue.
    """
    if actor.role is not UserRole.ORG_ADMIN:
        raise ChangeError(
            "Only the organisation administrator can decide this."
        )
    if actor.organization_id != request_row.organization_id:
        raise ChangeError("That request belongs to another organisation.")
    if request_row.status is not ChangeStatus.PENDING:
        raise ChangeError("That request has already been decided.")
    if request_row.requested_by == actor.id:
        raise ChangeError("You raised this, so another administrator decides it.")


async def decide(
    session: AsyncSession,
    *,
    request_row: OrgChangeRequest,
    actor: User,
    approve: bool,
    note: str | None = None,
) -> OrgChangeRequest:
    """The organisation admin's answer. Applies the change. Does not commit."""
    assert_may_decide(request_row, actor)

    if approve:
        request_row.outcome = await _apply(session, request_row)
    else:
        clean = (note or "").strip()
        if not clean:
            raise ChangeError(
                "Say why you are declining, so the request is not just reopened."
            )
        await _undo_pending(session, request_row)

    request_row.status = ChangeStatus.APPROVED if approve else ChangeStatus.DECLINED
    request_row.decided_by = actor.id
    request_row.decided_at = datetime.now(UTC)
    request_row.decision_note = (note or "").strip() or None
    return request_row


# ---------------------------------------------------------------------------
# Applying an approved change, with the organisation admin's authority.
# ---------------------------------------------------------------------------


async def _apply(session: AsyncSession, r: OrgChangeRequest) -> str:
    if r.kind is ChangeKind.MEMBER:
        return await _apply_member(session, r)
    if r.kind is ChangeKind.TRAINING:
        return await _apply_training(session, r)
    return await _apply_document(session, r)


async def _undo_pending(session: AsyncSession, r: OrgChangeRequest) -> None:
    """A declined document create was stored hidden; drop it. Nothing else to undo."""
    if (
        r.kind is ChangeKind.DOCUMENT
        and r.action is ChangeAction.CREATE
        and r.target_id is not None
    ):
        from app.models.org_document import OrganizationDocument

        doc = await session.get(OrganizationDocument, r.target_id)
        if doc is not None and doc.pending_approval:
            await session.delete(doc)


async def _apply_member(session: AsyncSession, r: OrgChangeRequest) -> str:
    from app.services import accounts
    from app.services import organizations as org_service

    data = r.payload or {}
    if r.action is ChangeAction.CREATE:
        email = str(data["email"]).lower().strip()
        clash = await session.scalar(select(User.id).where(User.email == email))
        if clash is not None:
            raise ChangeError("An account with that email already exists now.")
        member = User(
            id=uuid.uuid4(),
            name=str(data["name"]).strip(),
            email=email,
            hashed_password=str(data["hashed_password"]),
            role=UserRole(data["role"]),
            organization_id=r.organization_id,
            branch_id=_as_uuid(data.get("branch_id")),
            department_id=_as_uuid(data.get("department_id")),
            is_active=True,
            is_verified=True,
        )
        session.add(member)
        return "created"

    member = await session.get(User, r.target_id)
    if member is None or member.organization_id != r.organization_id:
        raise ChangeError("That person is no longer in this organisation.")

    if r.action is ChangeAction.DELETE:
        if member.role is UserRole.ORG_ADMIN:
            await org_service.assert_admin_floor_after_change(
                session, member, still_admin=False
            )
        removal = await accounts.remove_account(session, member)
        return removal.outcome

    # EDIT. Apply only the keys the request carries.
    new_role = UserRole(data["role"]) if "role" in data else member.role
    losing_admin = member.role is UserRole.ORG_ADMIN and (
        (new_role is not UserRole.ORG_ADMIN) or data.get("is_active") is False
    )
    if losing_admin:
        await org_service.assert_admin_floor_after_change(
            session, member, still_admin=False
        )
    if "name" in data:
        member.name = str(data["name"]).strip()
    if "role" in data:
        member.role = new_role
    if "is_active" in data:
        member.is_active = bool(data["is_active"])
    if "sees_all_departments" in data:
        member.sees_all_departments = bool(data["sees_all_departments"])
    if "branch_id" in data:
        member.branch_id = _as_uuid(data.get("branch_id"))
    if "department_id" in data:
        member.department_id = _as_uuid(data.get("department_id"))
    return "updated"


async def _apply_training(session: AsyncSession, r: OrgChangeRequest) -> str:
    from app.models.course import Course

    data = r.payload or {}
    # A module added, rewritten or removed. Filed as an edit of its course
    # (`org_content._request_module_change`), and told apart by its payload.
    if "module_op" in data:
        return await _apply_module(session, r, data)
    if r.action is ChangeAction.CREATE:
        course = Course(
            title=str(data["title"]).strip(),
            description=(data.get("description") or None),
            organization_id=r.organization_id,
            department_id=_as_uuid(data.get("department_id")),
            is_published=False,
        )
        session.add(course)
        return "created"

    course = await session.get(Course, r.target_id)
    if course is None or course.organization_id != r.organization_id:
        raise ChangeError("That course no longer belongs to this organisation.")

    if r.action is ChangeAction.DELETE:
        await session.delete(course)
        return "deleted"

    # EDIT.
    if "title" in data:
        course.title = str(data["title"]).strip()
    if "description" in data:
        course.description = data.get("description") or None
    if "is_published" in data:
        course.is_published = bool(data["is_published"])
    if "department_id" in data:
        course.department_id = _as_uuid(data.get("department_id"))
    return "updated"


async def _apply_module(session: AsyncSession, r: OrgChangeRequest, data: dict) -> str:
    """Add, change or remove one module of an organisation course.

    Checked again here because the course may have changed while the request
    waited: it may have left the organisation, the module may be gone, or the
    course may have reached its module cap.
    """
    from app.models.course import Course, Module
    from app.services import courses as course_service
    from app.services import limits

    course = await session.get(Course, _as_uuid(data.get("course_id")))
    if course is None or course.organization_id != r.organization_id:
        raise ChangeError("That course no longer belongs to this organisation.")

    op = data["module_op"]
    if op == "create":
        try:
            await limits.assert_can_add_module(session, course)
        except limits.LimitReached as exc:
            raise ChangeError(str(exc)) from None
        order = data.get("order")
        if order is None:
            # Appended when approved, not when asked: other modules may have
            # been added in between.
            order = await course_service.next_module_order(session, course.id)
        session.add(
            Module(
                course_id=course.id,
                title=str(data["title"]).strip(),
                order=int(order),
                content=data.get("content"),
            )
        )
        await _flush_module(session, int(order))
        return "created"

    module = await session.get(Module, r.target_id)
    if module is None or module.course_id != course.id:
        raise ChangeError("That module is no longer in this course.")

    if op == "delete":
        await session.delete(module)
        return "deleted"

    # EDIT. The same rule as the direct route: a null leaves a field as it is.
    for key in ("title", "content", "order"):
        if data.get(key) is not None:
            setattr(module, key, data[key])
    await _flush_module(session, module.order)
    return "updated"


async def _flush_module(session: AsyncSession, order: int) -> None:
    """Write now, so a taken position is a sentence and not a 500 at commit."""
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ChangeError(
            f"The course already has a module at position {order}. "
            "Decline this, and ask for it at another position."
        ) from exc


async def _apply_document(session: AsyncSession, r: OrgChangeRequest) -> str:
    from app.models.org_document import OrganizationDocument

    doc = await session.get(OrganizationDocument, r.target_id)
    if doc is None or doc.organization_id != r.organization_id:
        raise ChangeError("That document is no longer here.")
    if r.action is ChangeAction.DELETE:
        await session.delete(doc)
        return "deleted"
    # CREATE: it was stored hidden; reveal it.
    doc.pending_approval = False
    return "created"


def _as_uuid(value: object) -> uuid.UUID | None:
    if value in (None, ""):
        return None
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
