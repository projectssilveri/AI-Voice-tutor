"""Shared FastAPI dependencies.

`require_role` is the gate that stops a student reaching an admin endpoint by
guessing the URL. Every route touching student or admin data depends on it (or
on `current_active_user`) — never on the frontend having hidden the link.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.users import current_active_user, current_user_optional
from app.db.session import get_session
from app.models.organization import Organization
from app.models.user import User, UserRole

DbSession = Annotated[AsyncSession, Depends(get_session)]


async def _remember_actor(
    request: Request, user: Annotated[User, Depends(current_active_user)]
) -> User:
    """Resolve the signed-in user and stash it on the request.

    The audit middleware runs after the response is produced, by which point
    the dependency graph is gone — so the actor has to be left somewhere it can
    find. `request.state` is that place. Without this the trail would record
    every action as anonymous, which is the one thing an audit log cannot do.

    Wrapping rather than replacing `current_active_user` keeps fastapi-users'
    own behaviour intact: this adds a side effect and changes nothing else.
    """
    request.state.user = user
    return user


async def _remember_actor_optional(
    request: Request, user: Annotated[User | None, Depends(current_user_optional)]
) -> User | None:
    if user is not None:
        request.state.user = user
    return user


CurrentUser = Annotated[User, Depends(_remember_actor)]
OptionalUser = Annotated[User | None, Depends(_remember_actor_optional)]


def require_role(*allowed: UserRole):
    """Dependency factory enforcing role-based access on a route.

    Usage:
        @router.get("/users", dependencies=[Depends(require_role(UserRole.ADMIN))])

    Returns 403, not 404: the caller is authenticated, they simply are not
    permitted. Hiding the route's existence buys nothing here and makes real
    permission bugs harder to diagnose.

    SUPER_ADMIN satisfies any gate that ADMIN satisfies. It is defined as
    strictly above admin, so making every `require_role(ADMIN)` route spell out
    both would be a list that someone eventually forgets to update — and the
    failure mode of forgetting is a super admin locked out of the product they
    are supposed to run.
    """
    permitted = set(allowed)
    if UserRole.ADMIN in permitted:
        permitted.add(UserRole.SUPER_ADMIN)

    async def guard(user: CurrentUser) -> User:
        if user.role not in permitted:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource.",
            )
        return user

    return guard


# Convenience aliases for the gates used most.
RequireAdmin = Annotated[User, Depends(require_role(UserRole.ADMIN))]
# TEACHER used to be the other half of "staff". With it retired this is the
# same set as RequireAdmin, and is kept as a separate name because the routes
# that use it mean "may author content" rather than "may administer people" —
# a distinction worth keeping a word for when the two diverge again.
RequireStaff = Annotated[User, Depends(require_role(UserRole.ADMIN))]

# Money and role management. Deliberately NOT widened by the rule above: this
# is the one gate an ordinary admin must not pass.
RequireSuperAdmin = Annotated[User, Depends(require_role(UserRole.SUPER_ADMIN))]


# ---------------------------------------------------------------------------
# Organization scope
# ---------------------------------------------------------------------------


class OrgContext:
    """Who is acting, inside which organization, and with what reach.

    Resolved once per request by `require_org_scope` so routes do not each
    re-derive it — and, more importantly, so the "does this person belong to
    this tenant" question is answered in exactly one place.
    """

    def __init__(self, organization: Organization, user: User) -> None:
        self.organization = organization
        self.user = user

    @property
    def is_platform_staff(self) -> bool:
        """A platform super admin acting inside a customer's tenant.

        Allowed, because support work is real — and recorded, because a
        customer is entitled to know when we looked. `require_org_scope`
        writes the audit event.
        """
        return self.user.organization_id != self.organization.id

    @property
    def is_org_admin(self) -> bool:
        return self.is_platform_staff or self.user.role is UserRole.ORG_ADMIN

    @property
    def is_branch_manager(self) -> bool:
        return self.user.role is UserRole.BRANCH_MANAGER

    @property
    def is_dept_admin(self) -> bool:
        """The HR admin, the sales admin: one department and nothing else."""
        return self.user.role is UserRole.DEPT_ADMIN

    @property
    def can_manage_people(self) -> bool:
        """May add, edit and remove members — of some subset of the org.

        WHICH people is a different question, answered by the two scope
        methods below. This one only says the role administers somebody.
        """
        return self.is_org_admin or self.is_branch_manager or self.is_dept_admin

    @property
    def can_author(self) -> bool:
        """May write training. WHOSE is decided by `scoped_department_id`."""
        return self.is_org_admin or self.is_dept_admin

    def scoped_branch_id(self) -> uuid.UUID | None:
        """The branch this person's view is limited to, or None for all of it.

        A branch manager sees their own branch. Anyone above them sees the
        whole organization.

        A DEPARTMENT ADMIN IS NOT SCOPED BY BRANCH. Their wall is the
        department, and a department may sit under a branch or directly under
        the organization — so returning their branch here would either widen
        them to a whole site or, for an org-wide department, to nothing at all.
        `scoped_department_id` is their wall; this returns None for them and
        the caller applies both.
        """
        if self.is_org_admin or self.is_dept_admin:
            return None
        return self.user.branch_id

    def scoped_department_id(self) -> uuid.UUID | None:
        """The department this person is confined to, or None for all of them.

        THE WALL BETWEEN HR AND SALES. A department admin manages the people in
        their own department and writes that department's training; the sales
        admin does not see HR's people, HR's courses or HR's drafts, and the
        filter is applied in SQL rather than in the UI so those rows never
        reach the browser.

        None for an org admin and a branch manager, who are above it by role.
        None for everybody else too — they do not manage anyone, and the staff
        gates refuse them before this is consulted.

        A department admin with no department returns None here, which would
        read as "everything". Callers must treat that as "nobody": there is no
        department to be the admin of, and failing closed is the only safe
        direction. `list_members` and `create_member` both do.
        """
        if self.is_dept_admin:
            return self.user.department_id
        return None


def require_org_scope(
    *,
    admin_only: bool = False,
    staff_only: bool = False,
    author_only: bool = False,
):
    """Resolve `{slug}` and assert the caller belongs to that organization.

    THE TENANT BOUNDARY. Every organization route depends on this, and the
    check is deliberately not "is this person an admin" but "is this person's
    organization the one in the URL" — a perfectly valid org admin of Acme
    reaching Globex's URL is the leak that matters, and a role check alone
    would let it through.

    A platform SUPER_ADMIN passes for support access, and that access is
    recorded. Nobody else crosses a tenant line, ever.

    404 rather than 403 for a non-member: whether a given organization exists
    is not a stranger's business, and confirming it would turn this into a
    directory of our customers.
    """

    async def guard(
        request: Request,
        slug: str,
        session: DbSession,
        user: CurrentUser,
    ) -> OrgContext:
        # Imported here rather than at module scope: `app.services.audit`
        # imports models that import this module, and a top-level import would
        # close the cycle.
        from app.models.audit import AuditAction
        from app.services import audit
        from app.services import organizations as org_service

        organization = await org_service.get_by_slug(session, slug)
        if organization is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found.",
            )

        platform_staff = user.role is UserRole.SUPER_ADMIN
        belongs = user.organization_id == organization.id

        if not belongs and not platform_staff:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found.",
            )

        # A suspended tenant is closed to its own people but still reachable by
        # platform staff, who may be suspending it or sorting out why.
        if not organization.is_active and not platform_staff:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This organization is suspended. Contact your administrator.",
            )

        # THE TENANT A REQUEST ACTS ON, not the one its actor belongs to.
        #
        # The audit middleware runs after the dependency graph is gone, and it
        # was falling back to the actor's own organization_id — which is NULL
        # for platform staff. So a super admin working inside a customer's
        # portal produced a platform-level event whose recorded PATH named the
        # customer: "/org/globex/members". An ordinary platform admin then read
        # that in the platform trail and learned both that the customer exists
        # and what was being done there — the leak decision 171 closed, coming
        # back in through the middleware net.
        #
        # Found by exporting the CSV as an ordinary admin and grepping it for
        # customer names, not by reading the code: the filter is correct, it
        # was the column being filtered on that was never populated.
        request.state.organization_id = organization.id

        context = OrgContext(organization, user)

        if admin_only and not context.is_org_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only an organization administrator can do that.",
            )

        # Wider than admin_only: an IT or branch manager runs the people in
        # their own branch — adding them, editing them, removing them — which
        # is the whole point of the role. A department admin runs the people in
        # their department for the same reason. The branch and department
        # filters are applied by the route, because "which people" is a
        # different question from "may they manage people at all".
        if staff_only and not context.can_manage_people:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only an administrator or manager can do that.",
            )

        # Writing training. An org admin writes for the whole company; a
        # department admin writes for their department and may touch nothing
        # else. A branch manager is deliberately NOT here: they run people, not
        # content, and widening that is the customer's decision to ask for.
        if author_only and not context.can_author:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Only an organization or department administrator "
                    "can manage training."
                ),
            )

        if not belongs:
            # Support access into a customer's tenant. Recorded on every
            # request rather than only on writes: reading a customer's people
            # and their training is the thing they would want to know about.
            #
            # ADDRESS, DEVICE AND AGENT, which this call left out for as long
            # as it existed. The middleware collects all three on every other
            # event; a hand-written record stores only what it is handed, so
            # every row about an outsider reading a customer's data showed
            # "Not recorded" where the address goes. That is the first thing
            # the customer would want to know and it was the one field
            # missing.
            await audit.record_safely(
                session,
                action=AuditAction.PLATFORM_ACCESSED_ORG,
                actor=user,
                organization_id=organization.id,
                target_type="organization",
                target_id=organization.id,
                ip_address=audit.client_ip(request.headers, request.client),
                device_id=audit.device_id(request.headers, request.cookies),
                user_agent=request.headers.get("user-agent"),
                metadata={"path": request.url.path, "method": request.method},
            )
            await session.commit()

        return context

    return guard


# The gates every organization route uses, widest first.
OrgScope = Annotated[OrgContext, Depends(require_org_scope())]
OrgAdminScope = Annotated[OrgContext, Depends(require_org_scope(admin_only=True))]
OrgManagerScope = Annotated[OrgContext, Depends(require_org_scope(staff_only=True))]
#: Writes training: an org admin, or a department admin within their department.
OrgAuthorScope = Annotated[OrgContext, Depends(require_org_scope(author_only=True))]
