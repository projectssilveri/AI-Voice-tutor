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

import logging
import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assignment import AssignmentSubmission
from app.models.audit import AuditEvent
from app.models.certification import AttemptGrant, CertAttempt, Certificate
from app.models.contact import ContactMessage
from app.models.course import Course
from app.models.deletion import DeletionRequest
from app.models.enrollment import Enrollment, ModuleProgress
from app.models.material import ModuleMaterial
from app.models.message import DirectMessage
from app.models.order import Order
from app.models.org_document import OrganizationDocument
from app.models.profile import AccessExtension
from app.models.quiz import QuizAttempt
from app.models.subscription import Subscription
from app.models.suspension import SuspensionRequest
from app.models.user import User
from app.models.voice import VoiceSession

logger = logging.getLogger(__name__)

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
#
# THIS LIST MUST COVER EVERY RESTRICT FOREIGN KEY INTO `users`. When it does
# not, `remove_account` reads "nothing points at this account", asks for a hard
# delete, and the database refuses — which reached the caller as a 500 on the
# approve button. Seven were missing, including two from `deletion_requests`.
# `audit_events` masked most of them in practice, because nearly every action
# writes one; that masking is not a guarantee, since `record_safely` swallows a
# failed audit write and any retention policy that prunes old events takes the
# mask away years later.
#
# To check this list against the database:
#
#   SELECT tc.table_name, kcu.column_name, rc.delete_rule
#     FROM information_schema.table_constraints tc
#     JOIN information_schema.key_column_usage kcu
#       ON tc.constraint_name = kcu.constraint_name
#     JOIN information_schema.referential_constraints rc
#       ON tc.constraint_name = rc.constraint_name
#     JOIN information_schema.constraint_column_usage ccu
#       ON tc.constraint_name = ccu.constraint_name
#    WHERE tc.constraint_type = 'FOREIGN KEY'
#      AND ccu.table_name = 'users'
#      AND rc.delete_rule <> 'CASCADE';
_HISTORY = (
    ("audit_events", AuditEvent, AuditEvent.actor_user_id),
    ("enrollments", Enrollment, Enrollment.user_id),
    ("module_progress", ModuleProgress, ModuleProgress.user_id),
    ("voice_sessions", VoiceSession, VoiceSession.user_id),
    ("quiz_attempts", QuizAttempt, QuizAttempt.user_id),
    ("assignment_submissions", AssignmentSubmission, AssignmentSubmission.user_id),
    # Marking somebody else's work is history too, and a different column from
    # the one above — the grader is not the submitter.
    ("graded_submissions", AssignmentSubmission, AssignmentSubmission.graded_by_user_id),
    ("certification_attempts", CertAttempt, CertAttempt.user_id),
    ("certificates", Certificate, Certificate.user_id),
    ("attempt_grants", AttemptGrant, AttemptGrant.granted_by),
    ("orders", Order, Order.user_id),
    ("subscriptions", Subscription, Subscription.user_id),
    ("documents", OrganizationDocument, OrganizationDocument.uploaded_by),
    ("handled_messages", ContactMessage, ContactMessage.handled_by_user_id),
    # --- the seven that were missing -------------------------------------
    ("access_extensions_granted", AccessExtension, AccessExtension.granted_by),
    ("courses_submitted", Course, Course.submitted_by),
    ("courses_reviewed", Course, Course.reviewed_by),
    ("materials_uploaded", ModuleMaterial, ModuleMaterial.uploaded_by),
    ("suspensions_requested", SuspensionRequest, SuspensionRequest.requested_by),
    ("suspensions_decided", SuspensionRequest, SuspensionRequest.decided_by),
    ("deletions_requested", DeletionRequest, DeletionRequest.requested_by),
    ("deletions_decided", DeletionRequest, DeletionRequest.decided_by),
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


def _close(user: User, history: dict[str, int]) -> Removal:
    """Deactivate rather than delete, and detach from the org structure.

    A closed account should not keep occupying a seat in a branch list, and
    leaving it placed makes headcounts wrong.
    """
    user.is_active = False
    user.branch_id = None
    user.department_id = None
    return Removal(outcome="deactivated", history=history)


async def remove_account(session: AsyncSession, user: User) -> Removal:
    """Delete the account if it is safe to, otherwise close it.

    Does not commit — the caller owns the transaction, so the removal and its
    audit record land together or not at all.

    THE DELETE IS TRIED INSIDE A SAVEPOINT, and that is the belt to `_HISTORY`'s
    braces. The list above decides; the database has the final say. When the two
    disagree — because a foreign key was added without touching that list — the
    old code asked for a delete, Postgres refused, and the IntegrityError came
    out of a route as a 500 on a button somebody had just pressed.

    Now the refusal is caught and answered honestly: the account is closed, and
    `history` says which constraint stopped it. The savepoint matters because a
    failed statement poisons the whole transaction in Postgres — without it, the
    caller's audit write and request row would be lost along with the delete.
    """
    history = await history_of(session, user.id)
    if history:
        return _close(user, history)

    # `begin_nested` is SAVEPOINT. Rolling back to it undoes only the delete.
    try:
        async with session.begin_nested():
            await session.delete(user)
            await session.flush()
    except IntegrityError as exc:
        # Something still points at this account that `_HISTORY` does not know
        # about. That is a gap in the list, and it is logged as one — but the
        # person who pressed the button gets the right outcome either way.
        logger.warning(
            "Hard delete of user %s refused by the database; closing the "
            "account instead. `_HISTORY` in services/accounts.py is missing a "
            "RESTRICT foreign key: %s",
            user.id,
            _constraint_name(exc),
        )
        return _close(user, {_constraint_name(exc): 1})

    return Removal(outcome="deleted", history={})


def _constraint_name(exc: IntegrityError) -> str:
    """The constraint Postgres named, for the log and the explanation."""
    name = getattr(getattr(exc.orig, "__cause__", None), "constraint_name", None)
    if not name:
        return "related records"
    # `fk_deletion_requests_decided_by_users` reads better as what it is.
    return name.removeprefix("fk_").replace("_", " ")
