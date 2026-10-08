"""The organization portal: /org/{slug}/...

Everything here is behind `require_org_scope`, which asserts the caller belongs
to the organization named in the URL. That check is the tenant boundary, and it
is deliberately not a role check: a perfectly valid org admin of Acme reaching
Globex's URL is the leak that matters, and "is this person an admin" would let
it straight through.

Roles inside an organization:

    ORG_ADMIN        the whole organization — people, structure, reports
    BRANCH_MANAGER   their own branch only
    DEPT_ADMIN       one department: its people and its training
    STUDENT          learns

Platform staff (a super admin or, since 2026-10-01, a platform admin) may enter
any tenant for support, and every such request is recorded: see
`AuditAction.PLATFORM_ACCESSED_ORG`. An administrator a platform admin makes
here waits for a super admin (`services/approvals`).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select

from app.core import passwords
from app.core.users import password_helper
from app.deps import (
    CurrentUser,
    DbSession,
    OrgAdminScope,
    OrgContext,
    OrgManagerScope,
    OrgScope,
)
from app.models.approval import ApprovalKind
from app.models.audit import AuditAction, AuditEvent
from app.models.deletion import DeletionRequest, DeletionStatus, DeletionTarget
from app.models.org_change import (
    ChangeAction,
    ChangeKind,
    ChangeStatus,
    OrgChangeRequest,
)
from app.models.organization import Branch, Department, Organization
from app.models.user import User, UserRole
from app.services import (
    access,
    accounts,
    approvals,
    audit,
    conflicts,
    deletions,
    limits,
    org_changes,
)
from app.services import organizations as org_service

router = APIRouter(prefix="/org/{slug}", tags=["organization portal"])

# Not under the {slug} prefix: this one answers "which organization am I in",
# so requiring the slug would be circular.
mine_router = APIRouter(prefix="/org", tags=["organization portal"])


class MyOrganization(BaseModel):
    id: uuid.UUID
    name: str
    slug: str


@mine_router.get("/mine", response_model=MyOrganization | None)
async def my_organization(
    session: DbSession, user: CurrentUser
) -> MyOrganization | None:
    """The caller's own organization, or null for a public B2C user.

    Returns null rather than 404 for the public case, the same shape as
    `/users/session` (decision 13): "nobody has one" is a normal answer here,
    not an error, and the sidebar asks on every load.
    """
    if user.organization_id is None:
        return None
    organization = await session.get(Organization, user.organization_id)
    if organization is None:
        return None
    return MyOrganization(
        id=organization.id, name=organization.name, slug=organization.slug
    )


# The roles an organization may hand out. Deliberately excludes ADMIN and
# SUPER_ADMIN: those are platform roles, and letting a customer mint one would
# hand them the whole product. Enforced by the schema below, not by a comment.
# TEACHER was here too, so "retired from the dropdown" was only ever true of
# the PLATFORM dropdown — a customer could still mint one, complete with the
# paywall bypass that came with it.
ORG_ASSIGNABLE_ROLES = (
    UserRole.STUDENT,
    UserRole.DEPT_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ORG_ADMIN,
)

# NOBODY HANDS OUT MORE POWER THAN THEY HOLD.
#
# Everybody may assign their own level and everything under it. An org admin
# may create users, managers and other admins. A branch manager runs the people
# in their branch, so they may create learners, department admins and a second
# manager for that branch, never an org admin. Without a rank, "assignable
# inside an organization" would let a branch manager promote themselves to org
# admin in one request.
ROLE_RANK = {
    # Platform staff, doing support inside a customer's tenant. Absent from
    # this table, `ROLE_RANK.get(SUPER_ADMIN, -1)` was -1 — BELOW a learner —
    # so `_assignable` told a platform super admin that "student" was a role
    # above their own and refused every member they tried to create or
    # re-role. Above ORG_ADMIN, because they can already do everything an org
    # admin can (`OrgContext.is_org_admin` returns True for them).
    UserRole.SUPER_ADMIN: 5,
    # A platform admin does the same support work since 2026-10-01. Their new
    # administrators wait for a super admin (`services/approvals`).
    UserRole.ADMIN: 5,
    UserRole.STUDENT: 0,
    # A department admin sits under a branch manager because a branch contains
    # departments: a branch manager may appoint the HR admin inside their site,
    # and the HR admin may never appoint the branch's manager.
    UserRole.DEPT_ADMIN: 2,
    UserRole.BRANCH_MANAGER: 3,
    UserRole.ORG_ADMIN: 4,
}


class OrgProfile(BaseModel):
    """What the portal shell needs to render itself."""

    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    # What the signed-in person may do here, so the UI can hide what they
    # cannot reach. Presentation only — every route re-checks server-side.
    my_role: str
    is_org_admin: bool
    is_platform_staff: bool
    branch_id: uuid.UUID | None
    branch_name: str | None

    # WHICH DEPARTMENT THEY RUN, and whether they run one at all. The portal
    # shell needs this to decide what to show a department admin: their nav,
    # and the name of the team every screen is scoped to, so "People" is
    # visibly "Sales" and not a company directory they are missing most of.
    is_dept_admin: bool = False
    department_id: uuid.UUID | None = None
    department_name: str | None = None

    # Two capabilities rather than a role test in the browser. Both cover an
    # org admin, a branch manager and a department admin; the managers' changes
    # wait for the org admin. Presentation only — every route re-checks
    # server-side — but keeping the rule in one place stops the UI drifting
    # from the API.
    can_manage_people: bool = False
    can_author: bool = False
    # A branch manager writes for their own branch only: their documents are
    # filed against it and their courses go to one of its departments.
    is_branch_manager: bool = False


class OrgMember(BaseModel):
    id: uuid.UUID
    name: str
    email: EmailStr
    role: str
    # Sees training scoped to OTHER departments. For the HR or IT manager who
    # sits inside one department and has to see everyone's — a flag rather than
    # a role, per decision 223.
    sees_all_departments: bool = False
    is_active: bool
    branch_id: uuid.UUID | None
    branch_name: str | None
    department_id: uuid.UUID | None
    department_name: str | None
    created_at: datetime
    # Made an administrator by a platform admin, and not approved yet by a
    # super admin (`services/approvals`). A new account stays switched off,
    # a promotion stays unapplied, until then.
    pending_approval: bool = False
    # A branch manager's or department admin's edit, waiting for the
    # organisation admin (Sir's rule of 2026-10-01, `services/org_changes`).
    # The row is returned UNCHANGED with this set, so the screen can say the
    # change was sent rather than applied.
    change_requested: bool = False


class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    # Set by the admin because there is no email transport to send an invite
    # through (password reset and verification are not mounted).
    # The person changes it from their profile afterwards.
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.STUDENT
    branch_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    # Why, when a branch manager or department admin adds somebody: their
    # creation waits for the org admin (Sir's rule, 2026-10-01). Ignored for an
    # org admin or platform staff, who act directly.
    reason: str | None = Field(default=None, max_length=2_000)


class MemberUpdate(BaseModel):
    # Not on MemberCreate: giving somebody sight of every department is a
    # decision worth making deliberately about somebody who already exists, not
    # a checkbox passed while typing their name.
    sees_all_departments: bool | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    role: UserRole | None = None
    is_active: bool | None = None
    branch_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    # Why, for a branch manager's or department admin's edit, which waits for
    # the org admin. Not a member field, so it is left out when applied.
    reason: str | None = Field(default=None, max_length=2_000)
    # `email` is absent: it is the sign-in identifier, globally unique, and
    # changing it silently locks someone out of an account they still hold.


class MemberCreateResult(BaseModel):
    """Added at once, or sent to the org admin to approve.

    A branch manager or department admin gets `requested=True` and no member:
    nothing exists until the org admin approves. An org admin or platform staff
    gets the new member.
    """

    requested: bool
    member: OrgMember | None = None
    message: str | None = None


class MemberList(BaseModel):
    members: list[OrgMember]
    total: int
    admin_count: int
    min_admins: int


class OrgStructure(BaseModel):
    branches: list[dict]
    departments: list[dict]


def _assignable(role: UserRole, by: UserRole | None = None) -> None:
    """Refuse a platform role, and any role above the caller's own.

    Two separate rules, both needed. The first stops a tenant minting platform
    power (decision 149). The second stops a branch manager writing
    `role: "org_admin"` into a request body and taking over the organization —
    the schema accepts the field, so the service has to decide what is legal.
    """
    if role not in ORG_ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="That role cannot be assigned inside an organization.",
        )
    if by is not None and ROLE_RANK.get(role, 99) > ROLE_RANK.get(by, -1):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot give someone a role above your own.",
        )


def _manageable(scope, member: User) -> None:
    """Whether this caller may act on this person at all.

    A branch manager runs THEIR branch; a department admin runs THEIR
    department. Someone outside it, or an admin sitting above them, is not
    theirs to edit — and each check is on the member's own placement rather
    than on the request, so it cannot be sidestepped by sending a different
    branch_id or department_id in the body.
    """
    if scope.is_org_admin:
        return

    if scope.is_dept_admin:
        # THE WALL. The sales admin does not edit, deactivate or read HR's
        # people. Their own department, and nothing else.
        scoped = scope.scoped_department_id()
        if scoped is None or member.department_id != scoped:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only manage people in your own department.",
            )
    else:
        scoped = scope.scoped_branch_id()
        if scoped is None or member.branch_id != scoped:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only manage people in your own branch.",
            )

    if ROLE_RANK.get(member.role, 99) > ROLE_RANK.get(scope.user.role, -1):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot manage someone senior to you.",
        )


async def _member_row(session: DbSession, user: User) -> OrgMember:
    branch = await session.get(Branch, user.branch_id) if user.branch_id else None
    department = (
        await session.get(Department, user.department_id)
        if user.department_id
        else None
    )
    return OrgMember(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role.value,
        sees_all_departments=user.sees_all_departments,
        is_active=user.is_active,
        branch_id=user.branch_id,
        branch_name=branch.name if branch else None,
        department_id=user.department_id,
        department_name=department.name if department else None,
        created_at=user.created_at,
        pending_approval=await approvals.open_for(session, user.id) is not None,
    )


async def _validate_placement(
    session: DbSession,
    organization_id: uuid.UUID,
    branch_id: uuid.UUID | None,
    department_id: uuid.UUID | None,
) -> None:
    """A person may only be placed in THIS organization's structure.

    Without this, knowing a branch or department id would be enough to attach
    one tenant's staff to another tenant's structure — a cross-tenant write
    dressed up as an ordinary edit.
    """
    if branch_id is not None:
        branch = await session.get(Branch, branch_id)
        if branch is None or branch.organization_id != organization_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found in this organization.",
            )
    if department_id is not None:
        department = await session.get(Department, department_id)
        if department is None or department.organization_id != organization_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Department not found in this organization.",
            )


# ---------------------------------------------------------------------------
# The shell
# ---------------------------------------------------------------------------


@router.get("", response_model=OrgProfile)
async def get_profile(session: DbSession, scope: OrgScope) -> OrgProfile:
    branch = (
        await session.get(Branch, scope.user.branch_id)
        if scope.user.branch_id
        else None
    )
    department = (
        await session.get(Department, scope.user.department_id)
        if scope.user.department_id
        else None
    )
    return OrgProfile(
        id=scope.organization.id,
        name=scope.organization.name,
        slug=scope.organization.slug,
        is_active=scope.organization.is_active,
        my_role=scope.user.role.value,
        is_org_admin=scope.is_org_admin,
        is_platform_staff=scope.is_platform_staff,
        branch_id=scope.user.branch_id,
        branch_name=branch.name if branch else None,
        is_dept_admin=scope.is_dept_admin,
        department_id=scope.user.department_id,
        department_name=department.name if department else None,
        can_manage_people=scope.can_manage_people,
        can_author=scope.can_author,
        is_branch_manager=scope.is_branch_manager,
    )


@router.get("/structure", response_model=OrgStructure)
async def get_structure(session: DbSession, scope: OrgScope) -> OrgStructure:
    """Branches and departments, for the forms that assign people to them."""
    branches = (
        await session.scalars(
            select(Branch)
            .where(Branch.organization_id == scope.organization.id)
            .order_by(Branch.name)
        )
    ).all()
    departments = (
        await session.execute(
            select(Department, Branch.name)
            .outerjoin(Branch, Branch.id == Department.branch_id)
            .where(Department.organization_id == scope.organization.id)
            .order_by(Department.name)
        )
    ).all()
    return OrgStructure(
        branches=[
            {"id": str(b.id), "name": b.name, "is_active": b.is_active}
            for b in branches
        ],
        departments=[
            {
                "id": str(d.id),
                "name": d.name,
                "branch_id": str(d.branch_id) if d.branch_id else None,
                "branch_name": branch_name,
            }
            for d, branch_name in departments
        ],
    )


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------


@router.get("/members", response_model=MemberList)
async def list_members(session: DbSession, scope: OrgScope) -> MemberList:
    """The organization's people. Staff only.

    A learner has no business enumerating their colleagues — their names,
    addresses, roles and branch are a staff directory, not course material.
    The first version of this gated on `OrgScope` alone, which let any student
    read their whole branch's roster. Caught by signing in as one.

    A branch manager sees their own branch and nobody else's, applied as a
    query filter rather than by hiding rows in the UI: the rows must never
    reach the browser in the first place.
    """
    if not scope.can_manage_people:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view the member list.",
        )

    filters = [User.organization_id == scope.organization.id]

    if scope.is_dept_admin:
        # THE WALL BETWEEN HR AND SALES, as a query filter. The sales admin's
        # member list contains their own department and nothing else — HR's
        # people never reach the browser to be hidden there.
        scoped_department = scope.scoped_department_id()
        if scoped_department is None:
            # No department to be the admin of. Sees only themselves, rather
            # than everybody: failing closed is the only safe direction.
            filters.append(User.id == scope.user.id)
        else:
            filters.append(User.department_id == scoped_department)
    else:
        scoped_branch = scope.scoped_branch_id()
        if scoped_branch is not None:
            filters.append(User.branch_id == scoped_branch)
        elif not scope.is_org_admin:
            # A branch manager with no branch assigned sees nobody, rather than
            # everybody. Failing closed is the only safe direction here.
            filters.append(User.id == scope.user.id)

    users = (
        await session.scalars(select(User).where(*filters).order_by(User.name))
    ).all()

    # The admin count is organization-wide even for a branch manager: it is
    # what the lockout warning is about, and scoping it to a branch would make
    # it wrong rather than private.
    admin_count = await org_service.count_org_admins(session, scope.organization.id)

    return MemberList(
        members=[await _member_row(session, u) for u in users],
        total=len(users),
        admin_count=admin_count,
        min_admins=org_service.MIN_ORG_ADMINS,
    )


@router.post(
    "/members",
    response_model=MemberCreateResult,
    status_code=status.HTTP_201_CREATED,
)
async def create_member(
    payload: MemberCreate, session: DbSession, scope: OrgManagerScope
) -> MemberCreateResult:
    """Create a person inside this organization.

    There is no public signup into an organization, by design: membership is
    granted by an admin, not claimed by anyone who knows the URL.

    Open to branch managers as well as org admins — running the people in a
    branch is what that role is for — but a manager may only create into their
    own branch, and only at or below their own level.
    """
    _assignable(payload.role, by=scope.user.role)

    # THE SEAT LIMIT. Recomputed from the database here rather than trusted
    # from the screen, which may have been open while a colleague filled the
    # last seat. 409 rather than 403: they are allowed to add people, the
    # organization's current state is what refuses.
    try:
        await limits.assert_can_add_member(session, scope.organization)
    except limits.LimitReached as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    branch_id = payload.branch_id
    department_id = payload.department_id

    if scope.is_dept_admin:
        scoped = scope.scoped_department_id()
        if scoped is None:
            # Fails closed, as the member list does: no department to be the
            # admin of means no department to add anyone to.
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You have no department assigned, so you cannot add people.",
            )
        # FORCED, NOT VALIDATED. A department admin does not choose which
        # department, so a department_id in the body is overridden rather than
        # rejected — otherwise the sales admin could file a new account into
        # HR and, from the next request, manage them.
        department_id = scoped
        # The branch follows the department: it is where that department sits,
        # not something a department admin picks.
        scoped_department = await session.get(Department, scoped)
        branch_id = scoped_department.branch_id if scoped_department else None
    elif not scope.is_org_admin:
        scoped = scope.scoped_branch_id()
        if scoped is None:
            # Fails closed, as the member list does: a manager with no branch
            # assigned has no branch to add anyone to.
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You have no branch assigned, so you cannot add people.",
            )
        # Forced, not validated: a manager does not choose which branch, so a
        # branch_id in the body is overridden rather than rejected.
        branch_id = scoped

    await _validate_placement(
        session, scope.organization.id, branch_id, department_id
    )

    email = payload.email.lower().strip()
    existing = await session.scalar(select(User).where(User.email == email))
    if existing is not None:
        # Deliberately does not say whether the address belongs to this
        # organization or another one — that would make this endpoint a way to
        # probe our whole customer base for a given person.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists.",
        )

    # THE SAME RULE AS PUBLIC SIGN-UP. `validate_password` on `UserManager`
    # only runs on the fastapi-users routes; this one builds the User itself,
    # so without this an org admin could set a one-character password on a
    # colleague's account, and that colleague has no way to know.
    try:
        passwords.check(payload.password, email=email, name=payload.name)
    except passwords.WeakPassword as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    # A BRANCH MANAGER OR DEPARTMENT ADMIN DOES NOT CREATE DIRECTLY. Sir's rule
    # of 2026-10-01: the account is not made until the org admin approves. The
    # password is stored already hashed on the request, so nothing is kept in
    # the clear, and the account is built from it at approval.
    if org_changes.needs_approval(scope.user):
        try:
            await org_changes.request(
                session,
                organization_id=scope.organization.id,
                kind=ChangeKind.MEMBER,
                action=ChangeAction.CREATE,
                target_id=None,
                label=f"{payload.name.strip()} ({email})",
                # Canned fallback, like a new course or document: adding someone
                # does not need a typed reason the way removing them does, and the
                # org admin sees who is being added when they decide.
                reason=payload.reason or "New member requested.",
                actor=scope.user,
                payload={
                    "name": payload.name.strip(),
                    "email": email,
                    "role": payload.role.value,
                    "branch_id": str(branch_id) if branch_id else None,
                    "department_id": str(department_id) if department_id else None,
                    "hashed_password": password_helper.hash(payload.password),
                },
            )
        except org_changes.ChangeError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        await session.commit()
        return MemberCreateResult(
            requested=True,
            message=(
                f"{payload.name.strip()} has not been added yet. The "
                "organisation administrator has to approve it."
            ),
        )

    # A PLATFORM ADMIN'S NEW ADMINISTRATOR WAITS for a super admin (role model
    # of 2026-10-01). Made switched off, so it cannot sign in until approved.
    waits = approvals.needs_approval(scope.user, payload.role)

    member = User(
        # Set here rather than at flush, so the audit row below can name it.
        id=uuid.uuid4(),
        name=payload.name.strip(),
        email=email,
        hashed_password=password_helper.hash(payload.password),
        role=payload.role,
        organization_id=scope.organization.id,
        branch_id=branch_id,
        department_id=department_id,
        is_active=not waits,
        is_verified=True,  # an admin vouched for them; there is no email to verify through
    )
    session.add(member)

    # `record`, not `record_safely`: creating an account with a role is the
    # class of event this trail exists for, and it shares the transaction so
    # the account and its record commit together or not at all.
    await audit.record(
        session,
        action=AuditAction.ORG_USER_CREATED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type="user",
        target_id=member.id,
        metadata={"role": member.role.value},
    )
    if waits:
        try:
            await approvals.request(
                session,
                user=member,
                organization_id=scope.organization.id,
                kind=ApprovalKind.NEW_ACCOUNT,
                actor=scope.user,
            )
        except approvals.ApprovalError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
    # THE FLOOR UNDER THE CHECK ABOVE. The address is looked up before this and
    # answers 409 cleanly; two administrators adding the same colleague at the
    # same moment both pass that lookup, and only `ix_users_email` can refuse
    # the second. Without this it refused with a 500.
    async with conflicts.as_conflict(
        session, default="An account with that email already exists."
    ):
        await session.commit()
    await session.refresh(member)
    return MemberCreateResult(requested=False, member=await _member_row(session, member))


@router.patch("/members/{member_id}", response_model=OrgMember)
async def update_member(
    member_id: uuid.UUID,
    payload: MemberUpdate,
    session: DbSession,
    scope: OrgManagerScope,
) -> OrgMember:
    """Edit a person: their name, role, placement or whether they can sign in."""
    member = await session.get(User, member_id)
    # The organization is checked as well as the id. Without it, knowing a user
    # id would be enough to edit somebody in another tenant.
    if member is None or member.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Member not found."
        )

    # NOT THE TENANT'S TO MANAGE. Membership of this organization is what the
    # check above establishes; it says nothing about what the person IS. A
    # platform role reached through a tenant is still a platform role, and an
    # org admin editing or switching one off is a tenant reaching upwards.
    #
    # 404 rather than 403, matching every other refusal on this boundary: the
    # existence of platform staff is not a fact this portal confirms.
    if member.role in access.STAFF_ROLES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Member not found."
        )

    _manageable(scope, member)
    if payload.role is not None:
        _assignable(payload.role, by=scope.user.role)

    # NOBODY LOCKS THEMSELVES OUT WITH ONE CLICK.
    #
    # The admin floor protects the organization from losing its last admins; it
    # does nothing for the person doing the demoting. With three admins, Ada
    # could deactivate herself, be 401'd on the next request, and be unable to
    # sign back in — only another admin could restore her. Verified: that is
    # exactly what happened.
    #
    # Refused rather than confirmed, because there is no legitimate reason to
    # remove your own access from this screen: someone leaving is deactivated
    # by a colleague, which also leaves an audit record naming who did it.
    if member.id == scope.user.id:
        # Compared against the role they CURRENTLY hold, not against ORG_ADMIN.
        # The old test read "any role but org admin is a demotion", which was
        # true when org admin was the only role that could reach this screen
        # and became wrong the moment branch managers and department admins
        # could: saving your own row with your own unchanged role tripped it,
        # and a 409 for a change that removes nothing is a refusal nobody can
        # act on.
        losing_own_access = payload.is_active is False or (
            payload.role is not None
            and ROLE_RANK.get(payload.role, 99) < ROLE_RANK.get(member.role, -1)
        )
        if losing_own_access:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "You cannot remove your own administrator access. "
                    "Ask another administrator to do it."
                ),
            )

    # A DEPARTMENT ADMIN CANNOT MOVE PEOPLE OUT OF THEIR DEPARTMENT.
    #
    # `_manageable` decides who they may touch, and it reads the member's
    # CURRENT department — so without this the sales admin could edit one of
    # their own people and set `department_id` to HR, pushing an account across
    # the wall and out of their own reach in a single request. Refused rather
    # than silently ignored: they meant to move somebody, and being told it did
    # not happen is better than believing it did.
    if scope.is_dept_admin and "department_id" in payload.model_fields_set:
        if payload.department_id != scope.scoped_department_id():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot move somebody out of your own department.",
            )

    # NOR A BRANCH MANAGER OUT OF THEIR BRANCH, and that includes their own
    # row. Their reach IS their own `branch_id`, so a London manager who moved
    # themselves to Leeds became Leeds's manager in one request. Same rule as
    # `create_member`, where a manager's branch is forced, not chosen.
    if scope.is_branch_manager and "branch_id" in payload.model_fields_set:
        if payload.branch_id != scope.scoped_branch_id():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot move somebody out of your own branch.",
            )

    # Nor hand one of their people sight of every other department. That flag
    # is how an HR or IT manager sees across the whole company (decision 223),
    # and letting a department admin set it would make the wall optional from
    # inside.
    if payload.sees_all_departments is not None and not scope.is_org_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Only an organization administrator can give somebody sight of "
                "every department."
            ),
        )

    await _validate_placement(
        session, scope.organization.id, payload.branch_id, payload.department_id
    )

    losing_admin = (
        payload.role is not None and payload.role is not UserRole.ORG_ADMIN
    ) or payload.is_active is False

    # THE ADMIN FLOOR. Recomputed from the database on every attempt rather
    # than trusted from the caller, exactly as the certification allowance is.
    if losing_admin:
        try:
            await org_service.assert_admin_floor_after_change(
                session, member, still_admin=False
            )
        except org_service.AdminFloorError as exc:
            # 409, not 403: the caller has the right to do this in principle,
            # the organization's current state is what forbids it.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None

    # NOBODY SWITCHES ON OR PROMOTES A PERSON A SUPER ADMIN HAS NOT APPROVED.
    # The account is only switched off while it waits, so any screen that can
    # switch an account on would otherwise make the approval a suggestion. A
    # declined one stays off for a platform admin as well.
    role_changes = payload.role is not None and payload.role is not member.role
    switching_on = payload.is_active is True and not member.is_active
    if switching_on or role_changes:
        try:
            if switching_on:
                await approvals.assert_may_switch_on(session, member, scope.user)
            else:
                await approvals.assert_not_waiting(session, member.id)
        except approvals.ApprovalError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None

    # A BRANCH MANAGER OR DEPARTMENT ADMIN DOES NOT EDIT DIRECTLY. Sir's rule
    # of 2026-10-01: their change waits for the organisation admin. The guards
    # above have already run, so this only proposes something they are allowed
    # to, and nothing on the member moves until the org admin approves. The
    # reason comes in on the payload.
    if org_changes.needs_approval(scope.user):
        fields = payload.model_dump(exclude_unset=True, exclude={"reason"})
        if not fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to change."
            )
        proposed = {
            key: (str(value) if isinstance(value, uuid.UUID) else value)
            for key, value in fields.items()
        }
        if "role" in proposed and payload.role is not None:
            proposed["role"] = payload.role.value
        try:
            await org_changes.request(
                session,
                organization_id=scope.organization.id,
                kind=ChangeKind.MEMBER,
                action=ChangeAction.EDIT,
                target_id=member.id,
                label=f"{member.name} ({member.email})",
                reason=payload.reason or "",
                actor=scope.user,
                payload=proposed,
            )
        except org_changes.ChangeError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        await session.commit()
        row = await _member_row(session, member)
        row.change_requested = True
        return row

    # A PLATFORM ADMIN RAISING SOMEBODY TO ADMINISTRATOR asks a super admin
    # first (role model of 2026-10-01). Their role stays as it is until then;
    # every other change in the same request still applies.
    promotion_waits = role_changes and approvals.needs_approval(
        scope.user, payload.role
    )

    changed: dict[str, object] = {}
    previous_role = member.role

    if payload.name is not None:
        member.name = payload.name.strip()
        changed["name"] = member.name
    if promotion_waits:
        try:
            await approvals.request(
                session,
                user=member,
                organization_id=scope.organization.id,
                kind=ApprovalKind.PROMOTION,
                actor=scope.user,
            )
        except approvals.ApprovalError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        changed["role_requested"] = UserRole.ORG_ADMIN.value
    elif payload.role is not None and payload.role is not member.role:
        member.role = payload.role
        changed["role"] = f"{previous_role.value} -> {member.role.value}"
    if payload.sees_all_departments is not None:
        member.sees_all_departments = payload.sees_all_departments
        changed["sees_all_departments"] = payload.sees_all_departments
    if payload.is_active is not None:
        member.is_active = payload.is_active
        changed["is_active"] = payload.is_active
    if payload.branch_id is not None or "branch_id" in payload.model_fields_set:
        member.branch_id = payload.branch_id
        changed["branch_id"] = str(payload.branch_id or "")
    if payload.department_id is not None or "department_id" in payload.model_fields_set:
        member.department_id = payload.department_id
        changed["department_id"] = str(payload.department_id or "")

    if changed:
        await audit.record(
            session,
            action=(
                AuditAction.ORG_ROLE_CHANGED
                if "role" in changed
                else AuditAction.ORG_USER_UPDATED
            ),
            actor=scope.user,
            organization_id=scope.organization.id,
            target_type="user",
            target_id=member.id,
            metadata=changed,
        )
    await session.commit()
    await session.refresh(member)
    return await _member_row(session, member)


class MemberRemoval(BaseModel):
    """What actually happened, so the screen can say so."""

    outcome: str
    explanation: str


@router.delete(
    "/members/{member_id}",
    response_model=MemberRemoval,
    responses={202: {"model": MemberRemoval}},
)
async def remove_member(
    member_id: uuid.UUID,
    session: DbSession,
    scope: OrgManagerScope,
    response: Response,
    reason: str = "",
) -> MemberRemoval:
    """Remove someone from the organization, or ask the org admin to.

    PLATFORM STAFF remove; an org admin removes directly; a branch manager or a
    department admin asks. The account is deleted outright when it has no
    history, and closed when it does. See `services/accounts.py` for why those
    are different operations and why the caller is told which one ran.

    A BRANCH MANAGER OR DEPARTMENT ADMIN REMOVING one of their people asks: 202,
    the account is untouched, and it waits for the organisation admin to
    approve (`services/org_changes.py`). `outcome` is "requested" in that case,
    which is how the screen knows to say so rather than announcing a removal
    that has not happened.

    Same guards as editing either way: a branch manager may only reach their own
    branch's people, nobody senior to them, and nobody may remove themselves.
    """
    member = await session.get(User, member_id)
    if member is None or member.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Member not found."
        )

    # NOT THE TENANT'S TO MANAGE. Membership of this organization is what the
    # check above establishes; it says nothing about what the person IS. A
    # platform role reached through a tenant is still a platform role, and an
    # org admin editing or switching one off is a tenant reaching upwards.
    #
    # 404 rather than 403, matching every other refusal on this boundary: the
    # existence of platform staff is not a fact this portal confirms.
    if member.role in access.STAFF_ROLES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Member not found."
        )

    # Decision 165, applied to the stronger action: removing yourself here has
    # no legitimate use, and it locks you out on the very next request.
    if member.id == scope.user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "You cannot remove your own account. "
                "Ask another administrator to do it."
            ),
        )

    _manageable(scope, member)

    # WHO REMOVES AT ONCE, AND WHO ASKS (Sir's rule of 2026-10-01). An org admin
    # removes directly, and so does platform staff acting in the tenant. A
    # branch manager or department admin asks, and the org admin approves.
    if org_changes.needs_approval(scope.user):
        try:
            await org_changes.request(
                session,
                organization_id=scope.organization.id,
                kind=ChangeKind.MEMBER,
                action=ChangeAction.DELETE,
                target_id=member.id,
                label=f"{member.name} ({member.email})",
                reason=reason,
                actor=scope.user,
            )
        except org_changes.ChangeError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        await session.commit()
        response.status_code = status.HTTP_202_ACCEPTED
        return MemberRemoval(
            outcome="requested",
            explanation=(
                f"{member.name} has not been removed. The organisation "
                "administrator has to approve it."
            ),
        )

    # THE ADMIN FLOOR applies to removal exactly as it does to demotion and
    # deactivation — an organization stranded with one admin does not care
    # which of the three routes got it there.
    if member.role is UserRole.ORG_ADMIN:
        try:
            await org_service.assert_admin_floor_after_change(
                session, member, still_admin=False
            )
        except org_service.AdminFloorError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None

    # The record of an administrator acting alone, written before the act so a
    # failure leaves no orphan. `pre_approved` is honest about what it is: one
    # person's decision, not two.
    try:
        await deletions.record_direct(
            session,
            organization=scope.organization,
            target_type=DeletionTarget.MEMBER,
            target_id=member.id,
            target_label=f"{member.name} ({member.email})",
            actor=scope.user,
            reason=reason
            or (
                "Removed by platform staff."
                if scope.user.role in deletions.DECIDERS
                else "Removed by an organisation administrator."
            ),
        )
    except deletions.DeletionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    removal = await accounts.remove_account(session, member)

    # Recorded BEFORE the commit and with `record`, not `record_safely`:
    # removing a person is the class of event this trail exists for, so a
    # failed write must fail the removal rather than quietly complete it.
    await audit.record(
        session,
        action=AuditAction.ORG_USER_UPDATED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type="user",
        target_id=member_id,
        metadata={"removed": removal.outcome, "role": member.role.value},
    )
    await session.commit()

    return MemberRemoval(outcome=removal.outcome, explanation=removal.explanation)


# ---------------------------------------------------------------------------
# Deletions waiting on this organization
# ---------------------------------------------------------------------------
#
# WHAT THIS ORGANIZATION HAS ASKED TO DELETE. Its admins, branch managers and
# department admins ask from inside the portal; a Platform Admin or Super Admin
# decides, here or from the console's Deletion requests page
# (`routers/admin_deletions.py`). The organization's admins see the queue and
# what was decided; they no longer decide it (2026-10-01).


class DeletionRequestRow(BaseModel):
    id: uuid.UUID
    #: member | training | document
    target_type: str
    target_id: uuid.UUID
    #: The name, captured when the request was raised. After an approval the id
    #: points at nothing, which is why this is stored rather than joined.
    target_label: str
    reason: str
    status: str
    requested_at: datetime
    requested_by_name: str | None
    requested_by_email: str | None
    #: True when the person reading this is the one who asked. They cannot
    #: decide their own request, and a disabled button with a reason beside it
    #: is clearer than a button that errors.
    requested_by_me: bool
    decided_at: datetime | None
    decided_by_name: str | None
    decision_note: str | None
    outcome: str | None


class Decision(BaseModel):
    """Why. Required on a decline, optional on an approval."""

    note: str | None = Field(default=None, max_length=2_000)


async def _deletion_rows(
    session: DbSession, requests: list[DeletionRequest], reader: User
) -> list[DeletionRequestRow]:
    """Name the people on each row, in one query rather than one per row."""
    ids = {r.requested_by for r in requests} | {
        r.decided_by for r in requests if r.decided_by
    }
    people: dict[uuid.UUID, User] = {}
    if ids:
        found = await session.scalars(select(User).where(User.id.in_(ids)))
        people = {person.id: person for person in found}

    def shown(person: User | None) -> tuple[str | None, str | None]:
        # A PLATFORM ADMIN DOES NOT SEE THE STAFF ABOVE THEM, here either: a
        # super admin, or another platform admin, is named by their tier only.
        if person is None:
            return None, None
        if (
            reader.role is UserRole.ADMIN
            and person.id != reader.id
            and person.role in access.STAFF_ROLES
        ):
            tier = "A Super Admin" if person.role is UserRole.SUPER_ADMIN else "Platform staff"
            return tier, None
        return person.name, person.email

    rows = []
    for request in requests:
        asked_name, asked_email = shown(people.get(request.requested_by))
        decided_name, _ = shown(
            people.get(request.decided_by) if request.decided_by else None
        )
        rows.append(
            DeletionRequestRow(
                id=request.id,
                target_type=request.target_type.value,
                target_id=request.target_id,
                target_label=request.target_label,
                reason=request.reason,
                status=request.status.value,
                requested_at=request.requested_at,
                requested_by_name=asked_name,
                requested_by_email=asked_email,
                requested_by_me=request.requested_by == reader.id,
                decided_at=request.decided_at,
                decided_by_name=decided_name,
                decision_note=request.decision_note,
                outcome=request.outcome,
            )
        )
    return rows


@router.get("/deletion-requests", response_model=list[DeletionRequestRow])
async def list_deletion_requests(
    session: DbSession,
    scope: OrgAdminScope,
    include_decided: bool = False,
) -> list[DeletionRequestRow]:
    """What this organization has asked to delete, and what was decided.

    ADMIN SCOPE, not manager scope. A branch manager who could read the queue
    could read every reason anybody gave for wanting anybody removed, which is
    a different thing from being able to ask for a removal themselves.
    """
    requests = await deletions.list_for_organization(
        session,
        scope.organization.id,
        status=None if include_decided else DeletionStatus.PENDING,
    )
    return await _deletion_rows(session, requests, scope.user)


async def _load_request(
    session: DbSession, scope: OrgContext, request_id: uuid.UUID
) -> DeletionRequest:
    """The request, LOCKED, so two administrators cannot decide it at once.

    WHY THE LOCK. Deciding is read-then-write: the status is read, the thing is
    destroyed, and only then is the status written. Nothing between those steps
    stopped a second request doing the same. Two Approves arriving together
    both saw `pending` and both ran the deletion; an Approve racing a Decline
    destroyed the thing AND recorded that it had been refused.

    `FOR UPDATE` makes the second transaction wait and then re-read, so it sees
    the world the first one left behind — which is the world it should have
    been deciding about. The same shape as `concurrency.lock_and_list`, which
    exists because the admin floor had this exact bug.

    One row, so there is no lock-ordering question to get wrong.
    """
    request = await session.get(DeletionRequest, request_id, with_for_update=True)
    # Scoped before it is returned: a request id from another organization must
    # not confirm that it exists.
    if request is None or request.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Request not found."
        )
    return request


@router.post("/deletion-requests/{request_id}/approve", response_model=DeletionRequestRow)
async def approve_deletion(
    request_id: uuid.UUID,
    payload: Decision,
    session: DbSession,
    scope: OrgAdminScope,
) -> DeletionRequestRow:
    """Agree, and the thing is destroyed in the same transaction.

    THE DELETION AND THE RECORD OF IT LAND TOGETHER. `services/deletions.py`
    performs the removal and marks the row, and neither is committed without the
    other — a crash between them would otherwise leave something gone with
    nothing to say who agreed to it.

    Everything that mattered when the request was raised is re-checked here: the
    member may have become this organization's second administrator since, and
    the admin floor is computed now rather than trusted from then.
    """
    request = await _load_request(session, scope, request_id)
    try:
        await deletions.approve(
            session, request=request, actor=scope.user, note=payload.note
        )
    except deletions.DeletionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    # `record`, not `record_safely`: agreeing to destroy a person's account is
    # exactly the class of event this trail exists for, so a failure to write it
    # must fail the approval rather than quietly complete it.
    await audit.record(
        session,
        action=AuditAction.DELETION_APPROVED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type=request.target_type.value,
        target_id=request.target_id,
        metadata={
            "label": request.target_label,
            "outcome": request.outcome,
            "requested_by": str(request.requested_by),
        },
    )
    await session.commit()
    rows = await _deletion_rows(session, [request], scope.user)
    return rows[0]


@router.post("/deletion-requests/{request_id}/decline", response_model=DeletionRequestRow)
async def decline_deletion(
    request_id: uuid.UUID,
    payload: Decision,
    session: DbSession,
    scope: OrgAdminScope,
) -> DeletionRequestRow:
    """Refuse. Nothing is touched, and the reason is stored.

    THE NOTE IS REQUIRED, for the same reason rejecting a course requires one: a
    refusal that says nothing tells the person who asked nothing they can act
    on, so they ask again next week and somebody decides it twice.
    """
    request = await _load_request(session, scope, request_id)
    try:
        await deletions.decline(
            session, request=request, actor=scope.user, note=payload.note
        )
    except deletions.DeletionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    await audit.record(
        session,
        action=AuditAction.DELETION_DECLINED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type=request.target_type.value,
        target_id=request.target_id,
        metadata={
            "label": request.target_label,
            "note": request.decision_note,
            "requested_by": str(request.requested_by),
        },
    )
    await session.commit()
    rows = await _deletion_rows(session, [request], scope.user)
    return rows[0]


# ---------------------------------------------------------------------------
# The organization's own audit trail
# ---------------------------------------------------------------------------


class OrgAuditRow(BaseModel):
    id: uuid.UUID
    action: str
    created_at: datetime
    actor_name: str | None
    actor_email: str | None
    target_type: str | None
    ip_address: str | None
    metadata: dict | None


class OrgAuditPage(BaseModel):
    events: list[OrgAuditRow]
    total: int
    limit: int
    offset: int


@router.get("/audit", response_model=OrgAuditPage)
async def org_audit(
    session: DbSession,
    scope: OrgAdminScope,
    limit: int = 50,
    offset: int = 0,
    action: str | None = None,
) -> OrgAuditPage:
    """This organization's activity, and nothing else.

    The `organization_id` filter is the whole point: an org admin reading their
    own trail must never see another tenant's, and platform-level events (which
    have no organization) are not theirs to read either.
    """
    limit = max(1, min(limit, 200))
    filters = [AuditEvent.organization_id == scope.organization.id]
    if action:
        filters.append(
            AuditEvent.action.like(action)
            if action.endswith("%")
            else AuditEvent.action == action
        )

    total = await session.scalar(
        select(func.count()).select_from(AuditEvent).where(*filters)
    )
    rows = (
        await session.execute(
            select(AuditEvent, User)
            .outerjoin(User, User.id == AuditEvent.actor_user_id)
            .where(*filters)
            # The same total order as the platform trail, for the same
            # reason. See routers/audit_log.py.
            .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    return OrgAuditPage(
        events=[
            OrgAuditRow(
                id=event.id,
                action=event.action,
                created_at=event.created_at,
                actor_name=actor.name if actor else None,
                actor_email=actor.email if actor else None,
                target_type=event.target_type,
                ip_address=event.ip_address,
                metadata=event.meta,
            )
            for event, actor in rows
        ],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


# ---------------------------------------------------------------------------
# Change requests a branch manager or department admin raised, for the
# organisation admin to approve. Sir's rule of 2026-10-01: the org admin runs
# their organisation and decides what the managers ask to do. See
# `services/org_changes.py`. The org admin and platform staff act directly and
# never appear here.
# ---------------------------------------------------------------------------


class OrgChangeRow(BaseModel):
    id: uuid.UUID
    #: member | training | document
    kind: str
    #: create | edit | delete
    action: str
    label: str
    reason: str
    status: str
    requested_at: datetime
    requested_by_name: str | None
    requested_by_email: str | None
    #: You raised this, so another administrator decides it.
    requested_by_me: bool
    decided_at: datetime | None
    decided_by_name: str | None
    decision_note: str | None
    outcome: str | None


async def _change_rows(
    session: DbSession, requests: list[OrgChangeRequest], reader: User
) -> list[OrgChangeRow]:
    ids = {r.requested_by for r in requests} | {
        r.decided_by for r in requests if r.decided_by
    }
    people: dict[uuid.UUID, User] = {}
    if ids:
        found = await session.scalars(select(User).where(User.id.in_(ids)))
        people = {person.id: person for person in found}
    rows = []
    for r in requests:
        asked = people.get(r.requested_by)
        decided = people.get(r.decided_by) if r.decided_by else None
        rows.append(
            OrgChangeRow(
                id=r.id,
                kind=r.kind.value,
                action=r.action.value,
                label=r.label,
                reason=r.reason,
                status=r.status.value,
                requested_at=r.requested_at,
                requested_by_name=asked.name if asked else None,
                requested_by_email=asked.email if asked else None,
                requested_by_me=r.requested_by == reader.id,
                decided_at=r.decided_at,
                decided_by_name=decided.name if decided else None,
                decision_note=r.decision_note,
                outcome=r.outcome,
            )
        )
    return rows


@router.get("/change-requests", response_model=list[OrgChangeRow])
async def list_change_requests(
    session: DbSession, scope: OrgAdminScope, include_decided: bool = False
) -> list[OrgChangeRow]:
    """What this organisation's managers have asked to change. Admin scope:
    only the org admin decides these, as only they decide deletions."""
    requests = await org_changes.list_for_org(
        session,
        scope.organization.id,
        status=None if include_decided else ChangeStatus.PENDING,
    )
    return await _change_rows(session, requests, scope.user)


async def _load_change(
    session: DbSession, scope: OrgContext, request_id: uuid.UUID
) -> OrgChangeRequest:
    # Locked, like the deletion queue: deciding is read-then-apply-then-write,
    # and two administrators must not both apply the same change.
    r = await session.get(OrgChangeRequest, request_id, with_for_update=True)
    if r is None or r.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Request not found."
        )
    return r


@router.post("/change-requests/{request_id}/approve", response_model=OrgChangeRow)
async def approve_change(
    request_id: uuid.UUID,
    payload: Decision,
    session: DbSession,
    scope: OrgAdminScope,
) -> OrgChangeRow:
    """Agree, and the change is applied in the same transaction."""
    r = await _load_change(session, scope, request_id)
    try:
        await org_changes.decide(
            session, request_row=r, actor=scope.user, approve=True, note=payload.note
        )
    except org_changes.ChangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None
    await audit.record(
        session,
        action="org.change_approved",
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type=r.kind.value,
        target_id=r.target_id or r.id,
        metadata={"action": r.action.value, "label": r.label, "outcome": r.outcome},
    )
    await session.commit()
    return (await _change_rows(session, [r], scope.user))[0]


@router.post("/change-requests/{request_id}/decline", response_model=OrgChangeRow)
async def decline_change(
    request_id: uuid.UUID,
    payload: Decision,
    session: DbSession,
    scope: OrgAdminScope,
) -> OrgChangeRow:
    """Refuse, with a reason. Nothing is applied."""
    r = await _load_change(session, scope, request_id)
    try:
        await org_changes.decide(
            session, request_row=r, actor=scope.user, approve=False, note=payload.note
        )
    except org_changes.ChangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None
    await audit.record(
        session,
        action="org.change_declined",
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type=r.kind.value,
        target_id=r.target_id or r.id,
        metadata={"action": r.action.value, "label": r.label},
    )
    await session.commit()
    return (await _change_rows(session, [r], scope.user))[0]
