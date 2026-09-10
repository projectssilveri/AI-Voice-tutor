"""Creating and structuring organizations. Platform super admin only.

Behind `RequireSuperAdmin`, not `RequireAdmin`. Decision 50 established that
gate as the one an ordinary admin must not pass: it guards revenue and role
management. Creating a tenant belongs with those — it decides who exists on the
platform at all, and later phases hang paid training off it.

Phase 2 scope: the structure. Nothing here reads the tenancy columns for access
control yet; that rule lands in `services/access.py` in phase 4. Until then no
organization content should be created, because it would not be isolated.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.deps import DbSession, RequireSuperAdmin
from app.models.audit import AuditAction
from app.models.organization import Branch, Department, Organization
from app.models.user import User, UserRole
from app.services import audit
from app.services import organizations as org_service

router = APIRouter(prefix="/admin/organizations", tags=["organizations"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # Validated and normalised in the service, not here: a Pydantic pattern
    # would reject "Acme" outright, where the rule is to lowercase it.
    slug: str = Field(min_length=1, max_length=63)


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None
    # `slug` is deliberately absent. It is an organization's URL identity, and
    # changing it silently breaks every bookmark and link their staff hold.
    # A rename needs a redirect story before it needs an endpoint.


class BranchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class BranchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # None means a company-wide department rather than a missing value.
    branch_id: uuid.UUID | None = None


class DepartmentRead(BaseModel):
    id: uuid.UUID
    name: str
    branch_id: uuid.UUID | None
    branch_name: str | None


class BranchRead(BaseModel):
    id: uuid.UUID
    name: str
    is_active: bool
    user_count: int


class OrganizationRead(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    branch_count: int
    department_count: int
    user_count: int
    admin_count: int
    course_count: int


class OrganizationDetail(OrganizationRead):
    branches: list[BranchRead]
    departments: list[DepartmentRead]
    # Surfaced so the console can warn before a tenant is handed over, rather
    # than letting them discover the lockout risk themselves.
    meets_admin_minimum: bool
    min_admins: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fail(exc: org_service.OrganizationError) -> HTTPException:
    """A caller mistake is a 409, not a 500.

    409 rather than 400 for a taken slug specifically: the request was
    well-formed, it conflicts with something that already exists.
    """
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


async def _load(session: DbSession, organization_id: uuid.UUID) -> Organization:
    organization = await session.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found."
        )
    return organization


async def _counts(session: DbSession) -> dict[uuid.UUID, dict[str, int]]:
    """Branch, department, user, admin and course counts for every org.

    Five grouped queries rather than five per organization — the N+1 rule from
    decisions 29 and 45. The listing is small today and will not stay that way.
    """
    tallies: dict[uuid.UUID, dict[str, int]] = {}

    async def tally(key: str, query) -> None:
        for org_id, count in (await session.execute(query)).all():
            tallies.setdefault(org_id, {})[key] = count

    await tally(
        "branch_count",
        select(Branch.organization_id, func.count()).group_by(Branch.organization_id),
    )
    await tally(
        "department_count",
        select(Department.organization_id, func.count()).group_by(
            Department.organization_id
        ),
    )
    await tally(
        "user_count",
        select(User.organization_id, func.count())
        .where(User.organization_id.is_not(None))
        .group_by(User.organization_id),
    )
    await tally(
        "admin_count",
        select(User.organization_id, func.count())
        .where(
            User.organization_id.is_not(None),
            User.role == UserRole.ORG_ADMIN,
            User.is_active.is_(True),
        )
        .group_by(User.organization_id),
    )
    from app.models.course import Course  # local: avoids a circular import

    await tally(
        "course_count",
        select(Course.organization_id, func.count())
        .where(Course.organization_id.is_not(None))
        .group_by(Course.organization_id),
    )
    return tallies


def _row(organization: Organization, counts: dict[str, int]) -> OrganizationRead:
    return OrganizationRead(
        id=organization.id,
        name=organization.name,
        slug=organization.slug,
        is_active=organization.is_active,
        branch_count=counts.get("branch_count", 0),
        department_count=counts.get("department_count", 0),
        user_count=counts.get("user_count", 0),
        admin_count=counts.get("admin_count", 0),
        course_count=counts.get("course_count", 0),
    )


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------


@router.get("", response_model=list[OrganizationRead])
async def list_organizations(
    session: DbSession, _: RequireSuperAdmin
) -> list[OrganizationRead]:
    organizations = (
        await session.scalars(select(Organization).order_by(Organization.name))
    ).all()
    counts = await _counts(session)
    return [_row(org, counts.get(org.id, {})) for org in organizations]


@router.post("", response_model=OrganizationRead, status_code=status.HTTP_201_CREATED)
async def create_organization(
    payload: OrganizationCreate, session: DbSession, actor: RequireSuperAdmin
) -> OrganizationRead:
    try:
        organization = await org_service.create_organization(
            session, name=payload.name, slug=payload.slug
        )
    except org_service.OrganizationError as exc:
        raise _fail(exc) from None

    # `record`, not `record_safely`: creating a tenant is a structural change to
    # who exists on the platform, so it shares this transaction and fails with
    # it rather than being created unrecorded.
    await audit.record(
        session,
        action=AuditAction.ORG_CREATED,
        actor=actor,
        organization_id=organization.id,
        target_type="organization",
        target_id=organization.id,
        metadata={"name": organization.name, "slug": organization.slug},
    )
    await session.commit()
    return _row(organization, {})


@router.get("/{organization_id}", response_model=OrganizationDetail)
async def get_organization(
    organization_id: uuid.UUID, session: DbSession, _: RequireSuperAdmin
) -> OrganizationDetail:
    organization = await _load(session, organization_id)
    counts = (await _counts(session)).get(organization_id, {})

    branches = (
        await session.scalars(
            select(Branch)
            .where(Branch.organization_id == organization_id)
            .order_by(Branch.name)
        )
    ).all()

    per_branch = dict(
        (
            await session.execute(
                select(User.branch_id, func.count())
                .where(User.branch_id.is_not(None))
                .group_by(User.branch_id)
            )
        ).all()
    )

    department_rows = (
        await session.execute(
            select(Department, Branch.name)
            .outerjoin(Branch, Branch.id == Department.branch_id)
            .where(Department.organization_id == organization_id)
            .order_by(Department.name)
        )
    ).all()

    admin_count = counts.get("admin_count", 0)
    base = _row(organization, counts)
    return OrganizationDetail(
        **base.model_dump(),
        branches=[
            BranchRead(
                id=b.id,
                name=b.name,
                is_active=b.is_active,
                user_count=per_branch.get(b.id, 0),
            )
            for b in branches
        ],
        departments=[
            DepartmentRead(
                id=d.id, name=d.name, branch_id=d.branch_id, branch_name=branch_name
            )
            for d, branch_name in department_rows
        ],
        meets_admin_minimum=admin_count >= org_service.MIN_ORG_ADMINS,
        min_admins=org_service.MIN_ORG_ADMINS,
    )


@router.patch("/{organization_id}", response_model=OrganizationRead)
async def update_organization(
    organization_id: uuid.UUID,
    payload: OrganizationUpdate,
    session: DbSession,
    actor: RequireSuperAdmin,
) -> OrganizationRead:
    organization = await _load(session, organization_id)

    changed: dict[str, object] = {}
    if payload.name is not None:
        organization.name = payload.name.strip()
        changed["name"] = organization.name
    if payload.is_active is not None:
        organization.is_active = payload.is_active
        changed["is_active"] = payload.is_active

    if changed:
        await audit.record(
            session,
            action=AuditAction.ORG_UPDATED,
            actor=actor,
            organization_id=organization.id,
            target_type="organization",
            target_id=organization.id,
            metadata=changed,
        )
    await session.commit()
    counts = (await _counts(session)).get(organization_id, {})
    return _row(organization, counts)


# ---------------------------------------------------------------------------
# Branches and departments
# ---------------------------------------------------------------------------


@router.post(
    "/{organization_id}/branches",
    response_model=BranchRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_branch(
    organization_id: uuid.UUID,
    payload: BranchCreate,
    session: DbSession,
    actor: RequireSuperAdmin,
) -> BranchRead:
    await _load(session, organization_id)
    branch = await org_service.create_branch(
        session, organization_id=organization_id, name=payload.name
    )
    await audit.record_safely(
        session,
        action=AuditAction.BRANCH_CREATED,
        actor=actor,
        organization_id=organization_id,
        target_type="branch",
        target_id=branch.id,
        metadata={"name": branch.name},
    )
    await session.commit()
    return BranchRead(
        id=branch.id, name=branch.name, is_active=branch.is_active, user_count=0
    )


@router.patch("/{organization_id}/branches/{branch_id}", response_model=BranchRead)
async def update_branch(
    organization_id: uuid.UUID,
    branch_id: uuid.UUID,
    payload: BranchUpdate,
    session: DbSession,
    _: RequireSuperAdmin,
) -> BranchRead:
    branch = await session.get(Branch, branch_id)
    # The organization is checked as well as the id: without it, knowing a
    # branch id would be enough to edit it from any organization's URL.
    if branch is None or branch.organization_id != organization_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found."
        )
    if payload.name is not None:
        branch.name = payload.name.strip()
    if payload.is_active is not None:
        branch.is_active = payload.is_active
    await session.commit()

    user_count = await session.scalar(
        select(func.count()).select_from(User).where(User.branch_id == branch.id)
    )
    return BranchRead(
        id=branch.id,
        name=branch.name,
        is_active=branch.is_active,
        user_count=user_count or 0,
    )


@router.post(
    "/{organization_id}/departments",
    response_model=DepartmentRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_department(
    organization_id: uuid.UUID,
    payload: DepartmentCreate,
    session: DbSession,
    actor: RequireSuperAdmin,
) -> DepartmentRead:
    await _load(session, organization_id)

    branch_name: str | None = None
    if payload.branch_id is not None:
        branch = await session.get(Branch, payload.branch_id)
        # A department may only sit under a branch of its OWN organization.
        # Without this check a caller could graft one tenant's department onto
        # another tenant's branch, which is a cross-tenant write.
        if branch is None or branch.organization_id != organization_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found in this organization.",
            )
        branch_name = branch.name

    department = await org_service.create_department(
        session,
        organization_id=organization_id,
        name=payload.name,
        branch_id=payload.branch_id,
    )
    await audit.record_safely(
        session,
        action=AuditAction.DEPARTMENT_CREATED,
        actor=actor,
        organization_id=organization_id,
        target_type="department",
        target_id=department.id,
        metadata={"name": department.name, "branch_id": str(payload.branch_id or "")},
    )
    await session.commit()
    return DepartmentRead(
        id=department.id,
        name=department.name,
        branch_id=department.branch_id,
        branch_name=branch_name,
    )


# ---------------------------------------------------------------------------
# Customer training, across every tenant
# ---------------------------------------------------------------------------


class CustomerCourseRow(BaseModel):
    """One organization's private course, as platform support sees it."""

    id: uuid.UUID
    title: str
    description: str | None
    is_published: bool
    module_count: int
    enrolled: int
    created_at: datetime
    updated_at: datetime

    organization_id: uuid.UUID
    organization_name: str
    organization_slug: str
    department_name: str | None


@router.get("/courses/all", response_model=list[CustomerCourseRow])
async def list_customer_courses(
    session: DbSession,
    admin: RequireSuperAdmin,
    organization_id: uuid.UUID | None = None,
) -> list[CustomerCourseRow]:
    """Every organization's own training, in one list.

    SUPER ADMIN ONLY, and read-only. This exists so support can answer "what has
    Acme actually built" without signing in as one of their admins — and it is
    deliberately separate from `/courses`, which is OUR catalogue.

    Keeping the two in one screen is what let an ordinary admin rename and then
    delete a customer's course (decision 170). They are different things: one we
    own and sell, the other belongs to a customer and we can see for support.

    Registered at `/courses/all` rather than `/courses` so it cannot be confused
    with the platform course routes, and above `/{organization_id}` would be a
    problem if that route were less specific — it is not, since this path has
    two segments.
    """
    from app.models.course import Course, Module
    from app.models.enrollment import Enrollment

    filters = [Course.organization_id.is_not(None)]
    if organization_id is not None:
        filters.append(Course.organization_id == organization_id)

    courses = (
        await session.scalars(select(Course).where(*filters).order_by(Course.title))
    ).all()
    if not courses:
        return []

    course_ids = [course.id for course in courses]

    # Grouped, not one query per course — the same rule as decisions 29 and 45.
    module_counts = dict(
        (
            await session.execute(
                select(Module.course_id, func.count())
                .where(Module.course_id.in_(course_ids))
                .group_by(Module.course_id)
            )
        ).all()
    )
    enrolled_counts = dict(
        (
            await session.execute(
                select(Enrollment.course_id, func.count())
                .where(Enrollment.course_id.in_(course_ids))
                .group_by(Enrollment.course_id)
            )
        ).all()
    )
    organizations = {
        row.id: row
        for row in (
            await session.execute(
                select(Organization.id, Organization.name, Organization.slug)
            )
        ).all()
    }
    departments = {
        row.id: row.name
        for row in (await session.execute(select(Department.id, Department.name))).all()
    }

    rows: list[CustomerCourseRow] = []
    for course in courses:
        organization = organizations.get(course.organization_id)
        if organization is None:
            continue
        rows.append(
            CustomerCourseRow(
                id=course.id,
                title=course.title,
                description=course.description,
                is_published=course.is_published,
                module_count=module_counts.get(course.id, 0),
                enrolled=enrolled_counts.get(course.id, 0),
                created_at=course.created_at,
                updated_at=course.updated_at,
                organization_id=organization.id,
                organization_name=organization.name,
                organization_slug=organization.slug,
                department_name=departments.get(course.department_id),
            )
        )
    return rows


# ---------------------------------------------------------------------------
# What a customer is allowed
# ---------------------------------------------------------------------------


class OrganizationLimits(BaseModel):
    """The numbers a business plan is actually sold on.

    All optional, and null means UNLIMITED — the state every organization was
    in before these existed, which is why the absent case cannot be zero. Zero
    is a real limit meaning "none allowed".
    """

    max_members: int | None = Field(default=None, ge=0, le=100_000)
    max_ai_minutes_per_month: int | None = Field(default=None, ge=0, le=1_000_000)
    max_modules_per_course: int | None = Field(default=None, ge=1, le=200)
    plan_note: str | None = Field(default=None, max_length=500)


class OrganizationUsage(BaseModel):
    """Used against allowed, as a screen would draw it."""

    members_used: int
    members_allowed: int | None
    members_remaining: int | None
    ai_minutes_used: int
    ai_minutes_allowed: int | None
    ai_minutes_remaining: int | None
    max_modules_per_course: int
    plan_note: str | None


@router.get("/{organization_id}/limits", response_model=OrganizationUsage)
async def get_limits(
    organization_id: uuid.UUID, session: DbSession, admin: RequireSuperAdmin
) -> OrganizationUsage:
    """What they may have, and what they have used this month."""
    from app.core.config import settings
    from app.services import limits as limit_service

    organization = await session.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found."
        )

    usage = await limit_service.usage_for(session, organization)
    return OrganizationUsage(
        members_used=usage.members_used,
        members_allowed=usage.members_allowed,
        members_remaining=usage.members_remaining,
        ai_minutes_used=usage.ai_minutes_used,
        ai_minutes_allowed=usage.ai_minutes_allowed,
        ai_minutes_remaining=usage.ai_minutes_remaining,
        max_modules_per_course=(
            organization.max_modules_per_course or settings.max_modules_per_course
        ),
        plan_note=organization.plan_note,
    )


@router.patch("/{organization_id}/limits", response_model=OrganizationUsage)
async def set_limits(
    organization_id: uuid.UUID,
    payload: OrganizationLimits,
    session: DbSession,
    admin: RequireSuperAdmin,
) -> OrganizationUsage:
    """Set what a customer is allowed.

    SUPER ADMIN ONLY. These are the terms of a commercial agreement, which
    decision 50 keeps with revenue and role management rather than with
    ordinary platform administration.

    A limit is allowed to be BELOW current use. An organization that has
    twenty-five people and renews for twenty needs the smaller number recorded
    now, and `assert_can_add_member` simply refuses the twenty-sixth rather
    than throwing anybody out — nobody loses an account because a contract
    changed.

    Only fields actually sent are applied, so setting a seat count does not
    silently clear the AI budget beside it.
    """
    organization = await session.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found."
        )

    changed: dict[str, object] = {}
    for field in (
        "max_members",
        "max_ai_minutes_per_month",
        "max_modules_per_course",
    ):
        if field in payload.model_fields_set:
            value = getattr(payload, field)
            setattr(organization, field, value)
            changed[field] = value if value is not None else "unlimited"

    if "plan_note" in payload.model_fields_set:
        organization.plan_note = (payload.plan_note or "").strip() or None
        changed["plan_note"] = "set" if organization.plan_note else "cleared"

    if changed:
        # `record`, not `record_safely`: what a customer is entitled to is a
        # commercial fact, and it shares the transaction so the change and its
        # record land together or not at all.
        await audit.record(
            session,
            action=AuditAction.ORG_UPDATED,
            actor=admin,
            organization_id=organization.id,
            target_type="organization",
            target_id=organization.id,
            metadata=changed,
        )
    await session.commit()
    await session.refresh(organization)

    return await get_limits(organization_id, session, admin)
