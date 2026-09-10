"""Removing an account.

"Delete this user" is one word and two different operations, and picking the
wrong one loses either the person's history or the admin's intent.

A brand-new account — a mistyped invite, someone added twice — has no history,
and deleting it is exactly what the admin means. An account that has signed in,
enrolled, sat an exam or paid for something cannot be deleted at all: half the
schema points at `users.id` with RESTRICT, deliberately, so that an audit event
never becomes anonymous (decision 24) and a certificate never loses its holder.

So this checks first and does whichever is honest, then SAYS WHICH. An admin who
presses Delete and is told "deactivated, because they have 41 records" knows
what happened to the account; one who is told "deleted" and finds the person
still in the audit trail does not.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assignment import AssignmentSubmission
from app.models.audit import AuditEvent
from app.models.certification import AttemptGrant, CertAttempt, Certificate
from app.models.contact import ContactMessage
from app.models.enrollment import Enrollment, ModuleProgress
from app.models.message import DirectMessage
from app.models.order import Order
from app.models.org_document import OrganizationDocument
from app.models.quiz import QuizAttempt
from app.models.subscription import Subscription
from app.models.user import User
from app.models.voice import VoiceSession

Outcome = Literal["deleted", "deactivated"]


@dataclass(frozen=True)
class Removal:
    outcome: Outcome
    #: What stopped a hard delete, e.g. {"audit_events": 41, "enrollments": 2}.
    #: Empty when the account was deleted outright.
    history: dict[str, int]

    @property
    def explanation(self) -> str:
        if self.outcome == "deleted":
            return "The account had no history, so it was deleted."
        kept = ", ".join(
            f"{count} {name.replace('_', ' ')}" for name, count in self.history.items()
        )
        return (
            f"The account was deactivated rather than deleted, because it holds "
            f"{kept}. Those records name this person and are kept."
        )


# Every table that points at a user and would either block a delete or lose
# meaning without them. Listed explicitly rather than discovered from metadata:
# a new table pointing at `users` should be a deliberate addition here, so that
# somebody has to decide whether it counts as history.
_HISTORY = (
    ("audit_events", AuditEvent, AuditEvent.actor_user_id),
    ("enrollments", Enrollment, Enrollment.user_id),
    ("module_progress", ModuleProgress, ModuleProgress.user_id),
    ("voice_sessions", VoiceSession, VoiceSession.user_id),
    ("quiz_attempts", QuizAttempt, QuizAttempt.user_id),
    ("assignment_submissions", AssignmentSubmission, AssignmentSubmission.user_id),
    ("certification_attempts", CertAttempt, CertAttempt.user_id),
    ("certificates", Certificate, Certificate.user_id),
    ("attempt_grants", AttemptGrant, AttemptGrant.granted_by),
    ("orders", Order, Order.user_id),
    ("subscriptions", Subscription, Subscription.user_id),
    ("documents", OrganizationDocument, OrganizationDocument.uploaded_by),
    ("handled_messages", ContactMessage, ContactMessage.handled_by_user_id),
)


async def history_of(session: AsyncSession, user_id: uuid.UUID) -> dict[str, int]:
    """What this account would leave behind. Only non-zero counts."""
    found: dict[str, int] = {}
    for name, model, column in _HISTORY:
        count = await session.scalar(
            select(func.count()).select_from(model).where(column == user_id)
        )
        if count:
            found[name] = count

    # Messages are counted from both ends: being written to is as much a reason
    # to keep an account as writing.
    messages = await session.scalar(
        select(func.count())
        .select_from(DirectMessage)
        .where(
            (DirectMessage.sender_id == user_id)
            | (DirectMessage.recipient_id == user_id)
        )
    )
    if messages:
        found["messages"] = messages
    return found


async def remove_account(session: AsyncSession, user: User) -> Removal:
    """Delete the account if it is safe to, otherwise close it.

    Does not commit — the caller owns the transaction, so the removal and its
    audit record land together or not at all.
    """
    history = await history_of(session, user.id)
    if history:
        user.is_active = False
        # Detached from the organization's structure as well as deactivated:
        # a closed account should not keep occupying a seat in a branch list,
        # and leaving it placed makes headcounts wrong.
        user.branch_id = None
        user.department_id = None
        return Removal(outcome="deactivated", history=history)

    await session.delete(user)
    return Removal(outcome="deleted", history={})
