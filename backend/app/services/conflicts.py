"""Turning a database refusal into an answer somebody can act on.

THE PROBLEM THIS EXISTS FOR. A unique index is the only thing that can decide a
duplicate under concurrency — an application check races two requests, and the
database does not. So every write that can collide ends in one of two places:
an `IntegrityError` nobody caught, which FastAPI reports as
`{"detail": "Internal server error."}`, or a message that names the thing.

Three routes were reaching the first one, and none of them were exotic:

  * creating a branch whose name the organisation already uses — 500
  * creating a department whose name it already uses — 500
  * two admins creating the same email at the same moment — 500 for the loser

The first two have no check at all. The third HAS one, and the check is where
the bug is: two requests both read "that email is free", both insert, and the
unique index refuses the second. A pre-check narrows the window; it cannot
close it, which is exactly why the index exists.

SO THE INDEX BECOMES THE ANSWER RATHER THAN THE ACCIDENT. `as_conflict` catches
the refusal, rolls back, and raises a 409 naming what collided. Routes keep
their pre-checks, because a friendly message without a round trip is worth
having — this is the floor underneath them, not a replacement.

WHY 409 AND NOT 400. The request was well-formed and would have worked a
moment earlier. That is the definition of a conflict, and it tells a client it
is worth retrying with a different value rather than that it sent nonsense.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

#: Constraint name -> what to tell the person who pressed the button.
#:
#: Keyed on the name Postgres reports, so adding a constraint without adding it
#: here degrades to the generic message rather than to a 500. Every one of these
#: is reachable by an ordinary mistake or an ordinary double-click.
MESSAGES: dict[str, str] = {
    "ix_users_email": "An account with that email already exists.",
    "ix_organizations_slug": "That web address is already taken.",
    "uq_branches_organization_id_name": (
        "This organisation already has a branch with that name."
    ),
    "uq_departments_organization_id_branch_id_name": (
        "That branch already has a department with that name."
    ),
    "uq_departments_org_wide_name": (
        "This organisation already has a company-wide department with that name."
    ),
    "uq_enrollments_user_course": "They are already enrolled in that course.",
    "uq_organization_documents_org_title": (
        "A document with that title already exists."
    ),
    "uq_modules_course_order": "Another module already sits in that position.",
    "uq_subscription_plans_name": "A plan with that name already exists.",
    "uq_subscriptions_user_plan": "They are already on that plan.",
    "uq_certificates_user_exam": "A certificate for that exam already exists.",
    "uq_orders_provider_order_id": "That payment has already been recorded.",
    "uq_suspension_requests_one_open": (
        "Somebody has already asked for this account to be suspended, and it "
        "has not been decided yet."
    ),
    "uq_deletion_requests_one_open": (
        "Somebody has already asked for this to be deleted, and it has not "
        "been decided yet."
    ),
}


def constraint_name(exc: IntegrityError) -> str | None:
    """The constraint Postgres named, if it named one.

    asyncpg hangs its own error off `orig.__cause__`; psycopg puts the same
    thing somewhere else. Both are tried rather than assuming the driver, so
    this keeps working if the driver is ever swapped.
    """
    orig = getattr(exc, "orig", None)
    for candidate in (getattr(orig, "__cause__", None), orig):
        name = getattr(candidate, "constraint_name", None)
        if name:
            return str(name)
        diag = getattr(candidate, "diag", None)
        name = getattr(diag, "constraint_name", None)
        if name:
            return str(name)
    return None


def message_for(exc: IntegrityError, default: str) -> str:
    """What to say about this particular collision."""
    name = constraint_name(exc)
    if name and name in MESSAGES:
        return MESSAGES[name]
    if name:
        # Unmapped but named: log it so the gap can be closed, and fall back to
        # the caller's own wording rather than leaking a constraint name.
        logger.warning(
            "No friendly message for constraint %r; add it to "
            "services/conflicts.MESSAGES",
            name,
        )
    return default


@asynccontextmanager
async def as_conflict(
    session: AsyncSession, *, default: str = "That already exists."
) -> AsyncIterator[None]:
    """Run a write, and answer 409 instead of 500 if the database refuses it.

    Wrap from the first write through the commit — the refusal can surface at
    either the flush or the commit depending on what the write was, and a
    wrapper around only one of them misses half the cases.

    ROLLS BACK BEFORE RAISING, and that is not optional: a failed statement
    poisons the whole transaction in Postgres, so anything the session does
    afterwards — including the error path — fails with
    `InFailedSQLTransaction` instead of the error you meant to report.
    """
    try:
        yield
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=message_for(exc, default),
        ) from exc
