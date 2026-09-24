"""Reading the audit trail.

Admin-gated, paginated, filterable. Named `audit_log` rather than `audit` so it
does not shadow `app.services.audit` at a glance in an import list.

This table grows faster than anything else in the schema — one row per mutating
request — so every read is bounded and there is no "give me everything"
endpoint. The composite indexes on (organization_id | actor_user_id | action,
created_at DESC) exist for exactly the queries below.

Every filter here is additive and optional, and every one is applied to the CSV
export as well. An export that quietly ignored the filters — or worse, the
tenancy scope — would undo decision 171 the moment somebody clicked it.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, or_, select

from app.deps import DbSession, RequireAdmin
from app.models.audit import AuditEvent
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.routers.admin_users import STAFF_ABOVE_PLATFORM_ADMIN

router = APIRouter(tags=["audit"])

# An export is a file, not a page, so it is not bound by the page size — but it
# is still bound. Without a cap, one click on a trail with a million rows builds
# the whole thing in memory and takes the process down with it.
EXPORT_LIMIT = 10_000


class AuditEventRow(BaseModel):
    id: uuid.UUID
    action: str
    created_at: datetime
    actor_user_id: uuid.UUID | None
    # Resolved for display so the console does not have to make a second call
    # per row. Null when the event had no signed-in actor.
    actor_name: str | None
    actor_email: str | None
    actor_role: str | None
    organization_id: uuid.UUID | None
    target_type: str | None
    target_id: uuid.UUID | None
    ip_address: str | None
    user_agent: str | None
    metadata: dict[str, Any] | None


class AuditPage(BaseModel):
    """One page, plus the total so the UI can say "1-50 of 2,431"."""

    events: list[AuditEventRow]
    total: int
    limit: int
    offset: int


class AuditActor(BaseModel):
    """One person who appears in the trail, with how often."""

    id: uuid.UUID
    name: str
    email: str
    role: str
    events: int


class AuditOrganizationFacet(BaseModel):
    id: uuid.UUID
    name: str
    slug: str


class AuditFacets(BaseModel):
    """What is actually present in the data, for building the filters.

    Built from the rows rather than from `AuditAction`'s constants and the
    `UserRole` enum, so the filters list what really happened instead of every
    name the code could theoretically write. A dropdown with forty options and
    thirty-six of them empty is worse than no dropdown.
    """

    actions: list[str]
    target_types: list[str]
    roles: list[str]
    organizations: list[AuditOrganizationFacet]


def _as_utc(moment: datetime) -> datetime:
    """Read a zone-less timestamp as UTC rather than as the server's clock."""
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _hidden_staff(admin: User) -> list[ColumnElement[bool]]:
    """The staff above a platform admin, kept out of their trail as well.

    `admin_users.can_see` hides super admins and other platform admins from a
    platform admin's Users screen. This trail named them anyway: the Person
    filter offered "Super Admin (owner@example.com)" with six thousand events,
    and every sign-in and change they made was listed with their address.
    Issue 62, "audit logs display activities of platform owners, super admins".

    Same rule, applied to whoever acted. A platform admin keeps their own
    events, and events nobody signed in for (a failed sign-in, the request
    net). A subquery rather than a condition on the joined user, so it works in
    the queries that never join `users` at all.
    """
    if admin.role is UserRole.SUPER_ADMIN:
        return []
    return [
        or_(
            AuditEvent.actor_user_id.is_(None),
            AuditEvent.actor_user_id == admin.id,
            AuditEvent.actor_user_id.notin_(
                select(User.id).where(
                    User.role.in_(tuple(STAFF_ABOVE_PLATFORM_ADMIN))
                )
            ),
        )
    ]


def _filters(
    admin: User,
    *,
    action: str | None,
    actor_user_id: uuid.UUID | None,
    actor_role: str | None,
    q: str | None,
    target_type: str | None,
    target_id: uuid.UUID | None,
    ip_address: str | None,
    path: str | None,
    organization_id: uuid.UUID | None,
    since: datetime | None,
    until: datetime | None,
) -> list[ColumnElement[bool]]:
    """The one place a filter becomes SQL.

    Shared by the listing, its count and the export, so the three can never
    disagree about what the caller asked for — and so the tenancy scope below
    cannot be present on one and missing from another.
    """
    filters: list[ColumnElement[bool]] = []

    # An ordinary platform admin reads PLATFORM activity only. Customer
    # organizations keep their own trail, and it names their staff, their
    # addresses and what they trained on — which decision 50 puts above
    # ordinary admin, alongside revenue and role management. Verified before
    # this line existed: an admin could read 123 events belonging to two
    # customers, naming seven of their people.
    #
    # A super admin still sees everything, for support; org admins read their
    # own organization's trail at /org/{slug}/audit.
    if admin.role is not UserRole.SUPER_ADMIN:
        filters.append(AuditEvent.organization_id.is_(None))
        filters.extend(_hidden_staff(admin))
    elif organization_id is not None:
        # Only meaningful for a super admin — an ordinary admin's rows are all
        # NULL, so offering them this filter would be offering them nothing.
        filters.append(AuditEvent.organization_id == organization_id)

    if action:
        # A trailing % turns this into a family query ("auth.%") without needing
        # a second parameter or a second endpoint.
        filters.append(
            AuditEvent.action.like(action)
            if action.endswith("%")
            else AuditEvent.action == action
        )
    if actor_user_id:
        filters.append(AuditEvent.actor_user_id == actor_user_id)
    if actor_role:
        filters.append(User.role == actor_role)
    if q:
        # Deliberately the ACTOR only, not the whole row. Matching on
        # user_agent or on the metadata blob would surface events for reasons
        # invisible on screen, and "why is this row here" is the one question a
        # compliance search must never leave unanswered.
        pattern = f"%{q.strip()}%"
        filters.append(or_(User.name.ilike(pattern), User.email.ilike(pattern)))
    if target_type:
        filters.append(AuditEvent.target_type == target_type)
    if target_id:
        filters.append(AuditEvent.target_id == target_id)
    if ip_address:
        filters.append(AuditEvent.ip_address.ilike(f"{ip_address.strip()}%"))
    if path:
        # The middleware net stores the path in metadata; this is how you ask
        # "who touched anything under /admin" without knowing the action names.
        filters.append(AuditEvent.meta["path"].astext.ilike(f"{path.strip()}%"))
    # A DATE WITH NO ZONE ON IT MEANS UTC.
    #
    # FastAPI parses `?since=2026-09-19` into a naive datetime. `created_at` is
    # TIMESTAMP WITH TIME ZONE, so asyncpg has to decide what zone the caller
    # meant and assumes the SERVER's. That makes the same query mean different
    # things in different places: midnight UTC on Render, half past six the
    # previous evening on a laptop in India. For a compliance trail, "which
    # events are inside this window" is the entire question.
    #
    # It also crashed. Midnight on 1 January 1970 local time, on any server
    # ahead of UTC, is before the epoch, and converting it raised
    # `[Errno 22] Invalid argument` out of the C library as a 500.
    #
    # An offset the caller supplied is left exactly as sent.
    if since:
        filters.append(AuditEvent.created_at >= _as_utc(since))
    if until:
        filters.append(AuditEvent.created_at <= _as_utc(until))

    return filters


#: Request plumbing, which is a debugging aid rather than an audit fact.
#: The console already drops these three from the details column and hides the
#: path filter from anybody but a super admin (issue 65), but it did that in
#: the browser, over a payload that still carried them, and the CSV export
#: wrote them out in full.
#:
#: That made it a tenancy hole as well as a tidiness one. The catch-all
#: `http.request` event has no organization_id, so the scope below never
#: touches it, and its path reads `/org/acme/members`. A platform admin
#: downloading the trail got 242 rows naming a customer by slug, and which of
#: their routes somebody had been poking at. Found by diffing the export
#: against the listing.
PLUMBING = frozenset({"method", "path", "status"})


def _details(meta: dict[str, Any] | None, admin: User) -> dict[str, Any]:
    """An event's details, with the plumbing kept for the owner only."""
    if admin.role is UserRole.SUPER_ADMIN:
        return meta or {}
    return {k: v for k, v in (meta or {}).items() if k not in PLUMBING}


def _row(event: AuditEvent, who: User | None, admin: User) -> AuditEventRow:
    """One event plus its actor.

    Split out of the comprehension it used to live in, where the loop variable
    was also called `actor` and shadowed the signed-in admin of the same name.
    It happened to be correct — a comprehension has its own scope — but a line
    whose correctness rests on that is a line waiting to be moved.
    """
    return AuditEventRow(
        id=event.id,
        action=event.action,
        created_at=event.created_at,
        actor_user_id=event.actor_user_id,
        actor_name=who.name if who else None,
        actor_email=who.email if who else None,
        actor_role=who.role.value if who else None,
        organization_id=event.organization_id,
        target_type=event.target_type,
        target_id=event.target_id,
        ip_address=event.ip_address,
        user_agent=event.user_agent,
        metadata=_details(event.meta, admin),
    )


@router.get("/admin/audit", response_model=AuditPage)
async def list_audit_events(
    session: DbSession,
    admin: RequireAdmin,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(
        default=None, description="Exact, or an 'auth.%' prefix"
    ),
    actor_user_id: uuid.UUID | None = None,
    actor_role: str | None = Query(default=None, description="Role of the actor"),
    q: str | None = Query(default=None, description="Actor name or email"),
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
    ip_address: str | None = Query(default=None, description="Exact or prefix"),
    path: str | None = Query(default=None, description="Request path prefix"),
    # Super admin only; an ordinary admin's rows are all NULL, so the filter
    # would be offering them nothing.
    organization_id: uuid.UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> AuditPage:
    """The platform-wide trail, newest first.

    Actor details are joined in rather than fetched per row — the same N+1 rule
    as decisions 29 and 45, and it matters more here because a page is 50 rows
    by default and could be 200.
    """
    filters = _filters(
        admin,
        action=action,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        q=q,
        target_type=target_type,
        target_id=target_id,
        ip_address=ip_address,
        path=path,
        organization_id=organization_id,
        since=since,
        until=until,
    )

    # The join is on the COUNT as well, not only on the page: `q` and
    # `actor_role` filter on the joined user, so a count without it would say
    # "247 results" over a page showing three.
    total = await session.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .outerjoin(User, User.id == AuditEvent.actor_user_id)
        .where(*filters)
    )

    rows = (
        await session.execute(
            select(AuditEvent, User)
            .outerjoin(User, User.id == AuditEvent.actor_user_id)
            .where(*filters)
            # A TOTAL ORDER. Every event written during one request shares
            # a timestamp, so without a tiebreaker LIMIT/OFFSET reshuffles
            # between pages and an auditor sees some rows twice and misses
            # others. `id` is a uuid4, which carries no meaning here and
            # does not need to: it only has to be stable and distinct.
            .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    return AuditPage(
        events=[_row(event, who, admin) for event, who in rows],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.get("/admin/audit/actions", response_model=AuditFacets)
async def list_audit_facets(session: DbSession, admin: RequireAdmin) -> AuditFacets:
    """Everything the filter bar needs, in one request.

    One call rather than four: these are four small DISTINCT queries and the
    console needs all of them before it can draw the filters, so four round
    trips would just be four chances to render half a filter bar.

    Kept at the original path so an existing client asking for `.actions` still
    gets it.
    """
    scope: list[ColumnElement[bool]] = (
        []
        if admin.role is UserRole.SUPER_ADMIN
        else [AuditEvent.organization_id.is_(None), *_hidden_staff(admin)]
    )

    actions = (
        await session.scalars(
            select(AuditEvent.action)
            .where(*scope)
            .distinct()
            .order_by(AuditEvent.action)
        )
    ).all()

    target_types = (
        await session.scalars(
            select(AuditEvent.target_type)
            .where(AuditEvent.target_type.is_not(None), *scope)
            .distinct()
            .order_by(AuditEvent.target_type)
        )
    ).all()

    roles = (
        await session.scalars(
            select(User.role)
            .join(AuditEvent, AuditEvent.actor_user_id == User.id)
            .where(*scope)
            .distinct()
            .order_by(User.role)
        )
    ).all()

    organizations: list[AuditOrganizationFacet] = []
    if admin.role is UserRole.SUPER_ADMIN:
        # Only the organizations that actually appear in the trail. An empty
        # filter option is a dead end dressed up as a choice.
        found = (
            await session.execute(
                select(Organization.id, Organization.name, Organization.slug)
                .join(AuditEvent, AuditEvent.organization_id == Organization.id)
                .distinct()
                .order_by(Organization.name)
            )
        ).all()
        organizations = [
            AuditOrganizationFacet(id=row.id, name=row.name, slug=row.slug)
            for row in found
        ]

    return AuditFacets(
        actions=list(actions),
        target_types=[value for value in target_types if value],
        roles=[role.value for role in roles],
        organizations=organizations,
    )


@router.get("/admin/audit/actors", response_model=list[AuditActor])
async def list_audit_actors(
    session: DbSession,
    admin: RequireAdmin,
    q: str | None = Query(default=None, description="Name or email"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[AuditActor]:
    """The people who appear in the trail, busiest first.

    This exists so "filter by user" is a picker rather than a box you paste a
    UUID into. Nobody knows a colleague's UUID, and a console whose headline
    filter needs one is a console nobody filters.

    Only people who actually have events, and only within the caller's scope —
    the same rule as the listing, or this would be a staff directory of every
    customer, handed to any platform admin.
    """
    scope: list[ColumnElement[bool]] = (
        []
        if admin.role is UserRole.SUPER_ADMIN
        else [AuditEvent.organization_id.is_(None), *_hidden_staff(admin)]
    )
    if q:
        pattern = f"%{q.strip()}%"
        scope.append(or_(User.name.ilike(pattern), User.email.ilike(pattern)))

    rows = (
        await session.execute(
            select(
                User.id,
                User.name,
                User.email,
                User.role,
                func.count(AuditEvent.id).label("events"),
            )
            .join(AuditEvent, AuditEvent.actor_user_id == User.id)
            .where(*scope)
            .group_by(User.id, User.name, User.email, User.role)
            .order_by(func.count(AuditEvent.id).desc(), User.name)
            .limit(limit)
        )
    ).all()

    return [
        AuditActor(
            id=row.id,
            name=row.name,
            email=row.email,
            role=row.role.value if hasattr(row.role, "value") else str(row.role),
            events=row.events,
        )
        for row in rows
    ]


@router.get("/admin/audit/export")
async def export_audit_events(
    session: DbSession,
    admin: RequireAdmin,
    action: str | None = None,
    actor_user_id: uuid.UUID | None = None,
    actor_role: str | None = None,
    q: str | None = None,
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
    ip_address: str | None = None,
    path: str | None = None,
    organization_id: uuid.UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> StreamingResponse:
    """The current view as a CSV file.

    Compliance work happens in a spreadsheet, not in a browser — being asked
    for "last quarter's sign-ins" and having to copy them off a paginated
    screen is why audit consoles grow an export.

    Same filters, same scope, same order as the listing. Capped, and the file
    says so in a trailing row rather than silently handing over a truncated
    export that reads as complete.
    """
    filters = _filters(
        admin,
        action=action,
        actor_user_id=actor_user_id,
        actor_role=actor_role,
        q=q,
        target_type=target_type,
        target_id=target_id,
        ip_address=ip_address,
        path=path,
        organization_id=organization_id,
        since=since,
        until=until,
    )

    rows = (
        await session.execute(
            select(AuditEvent, User)
            .outerjoin(User, User.id == AuditEvent.actor_user_id)
            .where(*filters)
            # A TOTAL ORDER. Every event written during one request shares
            # a timestamp, so without a tiebreaker LIMIT/OFFSET reshuffles
            # between pages and an auditor sees some rows twice and misses
            # others. `id` is a uuid4, which carries no meaning here and
            # does not need to: it only has to be stable and distinct.
            .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
            .limit(EXPORT_LIMIT)
        )
    ).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "timestamp",
            "action",
            "actor_name",
            "actor_email",
            "actor_role",
            "actor_id",
            "organization_id",
            "target_type",
            "target_id",
            "ip_address",
            "user_agent",
            "details",
        ]
    )
    for event, who in rows:
        writer.writerow(
            [
                event.created_at.isoformat(),
                event.action,
                who.name if who else "",
                who.email if who else "",
                who.role.value if who else "",
                str(event.actor_user_id) if event.actor_user_id else "",
                str(event.organization_id) if event.organization_id else "",
                event.target_type or "",
                str(event.target_id) if event.target_id else "",
                event.ip_address or "",
                event.user_agent or "",
                # Flattened rather than raw JSON: a spreadsheet cell holding
                # {"a": 1} is not something anyone can sort or filter on.
                "; ".join(
                    f"{k}={v}" for k, v in _details(event.meta, admin).items()
                ),
            ]
        )
    if len(rows) == EXPORT_LIMIT:
        writer.writerow([f"-- truncated at {EXPORT_LIMIT} rows; narrow the dates --"])

    stamp = datetime.now().strftime("%Y-%m-%d")
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="audit-trail-{stamp}.csv"'
        },
    )
