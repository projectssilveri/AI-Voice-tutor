"""Organization, branch and department logic.

Business rules live here rather than in the routes, per the engineering
standards. Two of them are load-bearing:

  * A slug is an identity in the address bar, so it is normalised and validated
    once, here, rather than trusted from whatever the form sent.

  * An organization must keep at least two org admins. Enforced in
    `count_org_admins` / `assert_admin_floor_after_change` and tested at the
    exact boundary, because the failure mode — a customer locked out of their
    own tenant — is one only they can report and only we can fix.
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.organization import Branch, Department, Organization
from app.models.user import User, UserRole

# The minimum number of org admins an organization must always have.
#
# Two, not one: a single admin who leaves, is deactivated, or loses their
# password takes the whole tenant with them, and only platform staff can undo
# that. Config rather than a literal so it is one edit if a customer argues.
MIN_ORG_ADMINS = 2

# Lowercase letters, digits and single hyphens. No leading or trailing hyphen.
# Deliberately narrow: this goes in a URL path, and a slug that needs escaping
# is a slug that will eventually be escaped wrong somewhere.
_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Words that would collide with real routes under /org/... or read as ours.
_RESERVED_SLUGS = frozenset(
    {
        "admin",
        "api",
        "app",
        "auth",
        "dashboard",
        "login",
        "logout",
        "new",
        "org",
        "signin",
        "signup",
        "static",
        "support",
        "www",
    }
)


class OrganizationError(Exception):
    """Something the caller can fix — surfaced as a 4xx, not a 500."""


class SlugInvalidError(OrganizationError):
    pass


class SlugTakenError(OrganizationError):
    pass


class AdminFloorError(OrganizationError):
    """The change would drop the organization below its admin minimum."""


def normalise_slug(raw: str) -> str:
    """Trim and lowercase, then insist the result is URL-safe.

    Normalising rather than rejecting mixed case is deliberate: someone typing
    "Acme" means the same organization as "acme", and failing on it would be
    pedantry. Anything that is not a letter, digit or interior hyphen is a
    refusal, because silently rewriting it would mean the slug they were shown
    is not the slug they got.
    """
    slug = (raw or "").strip().lower()
    if not slug:
        raise SlugInvalidError("An organization needs a slug.")
    if len(slug) > 63:
        raise SlugInvalidError("A slug may be at most 63 characters.")
    if not _SLUG.match(slug):
        raise SlugInvalidError(
            "A slug may contain lowercase letters, numbers and hyphens only, "
            "and cannot start or end with a hyphen."
        )
    if slug in _RESERVED_SLUGS:
        raise SlugInvalidError(f'"{slug}" is reserved. Please choose another.')
    return slug


async def slug_is_free(
    session: AsyncSession, slug: str, *, exclude_id: uuid.UUID | None = None
) -> bool:
    """Is this slug available? `exclude_id` lets an org keep its own."""
    query = select(func.count()).select_from(Organization).where(
        Organization.slug == slug
    )
    if exclude_id is not None:
        query = query.where(Organization.id != exclude_id)
    return (await session.scalar(query) or 0) == 0


async def create_organization(
    session: AsyncSession, *, name: str, slug: str
) -> Organization:
    """Create a tenant. Does not commit — the caller owns the transaction."""
    normalised = normalise_slug(slug)
    if not await slug_is_free(session, normalised):
        raise SlugTakenError(f'The slug "{normalised}" is already in use.')

    organization = Organization(name=name.strip(), slug=normalised)
    session.add(organization)
    await session.flush()
    return organization


async def get_by_slug(session: AsyncSession, slug: str) -> Organization | None:
    """Resolve an organization from its URL slug.

    Lowercased on the way in so a link someone typed with a capital still
    works — the stored value is always lowercase.
    """
    return await session.scalar(
        select(Organization).where(Organization.slug == (slug or "").strip().lower())
    )


async def create_branch(
    session: AsyncSession, *, organization_id: uuid.UUID, name: str
) -> Branch:
    branch = Branch(organization_id=organization_id, name=name.strip())
    session.add(branch)
    await session.flush()
    return branch


async def create_department(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    name: str,
    branch_id: uuid.UUID | None = None,
) -> Department:
    """Create a department, under a branch or across the organization.

    `branch_id=None` is a company-wide function, not a mistake — see the
    partial unique index in migration 0009, which is what stops two of them
    sharing a name.
    """
    department = Department(
        organization_id=organization_id, branch_id=branch_id, name=name.strip()
    )
    session.add(department)
    await session.flush()
    return department


# ---------------------------------------------------------------------------
# The admin floor
# ---------------------------------------------------------------------------


async def count_org_admins(
    session: AsyncSession,
    organization_id: uuid.UUID,
    *,
    excluding: uuid.UUID | None = None,
) -> int:
    """How many active org admins this organization has.

    Only ACTIVE ones count. A deactivated admin cannot sign in, so counting
    them would let an organization satisfy the floor with two accounts that can
    do nothing — which is the lockout this rule exists to prevent, wearing a
    disguise.
    """
    query = (
        select(func.count())
        .select_from(User)
        .where(
            User.organization_id == organization_id,
            User.role == UserRole.ORG_ADMIN,
            User.is_active.is_(True),
        )
    )
    if excluding is not None:
        query = query.where(User.id != excluding)
    return await session.scalar(query) or 0


async def assert_admin_floor_after_change(
    session: AsyncSession, user: User, *, still_admin: bool
) -> None:
    """Refuse a change that would leave the organization below the floor.

    Called before demoting, deactivating or moving an org admin out. Recomputed
    from the database every time rather than trusted from the caller — the same
    rule as the certification allowance, and for the same reason: a count the
    client sends is a count the client can lie about.

    A public B2C user has no organization and no floor to breach.
    """
    if user.organization_id is None or user.role is not UserRole.ORG_ADMIN:
        return
    if still_admin:
        return

    remaining = await count_org_admins(
        session, user.organization_id, excluding=user.id
    )
    # `remaining` already excludes this user, so it IS the count after the
    # change. The comparison is against MIN_ORG_ADMINS directly — an earlier
    # draft used `MIN_ORG_ADMINS - 1` here, which would have permitted exactly
    # the drop from two admins to one that this rule exists to refuse.
    if remaining < MIN_ORG_ADMINS:
        raise AdminFloorError(
            f"An organization must keep at least {MIN_ORG_ADMINS} administrators. "
            "Promote someone else first."
        )
