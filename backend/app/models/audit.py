"""The compliance audit trail.

One row per thing that happened: who did it, to what, when, and from where.

This is deliberately NOT the application log. `app/core/logging.py` writes a
text log for operators to debug with, and decision 88 established that it
identifies people by UUID and never carries a payload. An audit event is
different in kind — it is *data*, queried by admins through an authenticated,
role-gated endpoint, and it has to name the actor because "who did this" is the
entire question it exists to answer.

What it still must not carry: request bodies, passwords, quiz answers, exam
answers, or transcript text. The event records that an exam was submitted, not
what was written in it. `metadata` is for identifiers and counts.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from app.models.user import User


class AuditAction:
    """Well-known action names.

    A plain string column with constants rather than a database enum: a new
    action must not require a migration, and an enum whose values change every
    time a feature ships is a migration treadmill. The constants exist so the
    names stay consistent — `auth.login` not `login`, `logged_in`, `LOGIN`.

    Dotted namespaces so a query can ask for a whole family with LIKE
    'auth.%' without needing a second column.
    """

    LOGIN = "auth.login"
    LOGIN_FAILED = "auth.login_failed"
    LOGOUT = "auth.logout"
    REGISTER = "auth.register"

    VOICE_SESSION_STARTED = "voice.session_started"
    VOICE_SESSION_ENDED = "voice.session_ended"
    VOICE_INTERRUPTED = "voice.interrupted"

    QUIZ_SUBMITTED = "assessment.quiz_submitted"
    ASSIGNMENT_SUBMITTED = "assessment.assignment_submitted"
    EXAM_SUBMITTED = "assessment.exam_submitted"
    CERTIFICATE_ISSUED = "assessment.certificate_issued"

    MODULE_COMPLETED = "progress.module_completed"
    MODULE_REOPENED = "progress.module_reopened"
    ENROLLED = "progress.enrolled"

    USER_CREATED = "admin.user_created"
    ROLE_CHANGED = "admin.role_changed"
    ATTEMPT_GRANTED = "admin.attempt_granted"
    MARK_OVERRIDDEN = "admin.mark_overridden"

    COURSE_CREATED = "content.course_created"
    COURSE_UPDATED = "content.course_updated"
    COURSE_DELETED = "content.course_deleted"
    MATERIAL_UPLOADED = "content.material_uploaded"
    MATERIAL_DELETED = "content.material_deleted"

    ORG_CREATED = "org.created"
    ORG_USER_CREATED = "org.user_created"
    ORG_USER_UPDATED = "org.user_updated"
    ORG_ROLE_CHANGED = "org.role_changed"
    ORG_DOCUMENT_UPLOADED = "org.document_uploaded"
    ORG_DOCUMENT_DELETED = "org.document_deleted"
    ORG_COURSE_CREATED = "org.course_created"
    ORG_COURSE_UPDATED = "org.course_updated"
    # ASKING TO DESTROY SOMETHING, AND THE ANSWER. Three events rather than
    # one, because the three moments are separated in time and by person: who
    # asked, and then who agreed or refused and what they said about it.
    DELETION_REQUESTED = "org.deletion_requested"
    DELETION_APPROVED = "org.deletion_approved"
    DELETION_DECLINED = "org.deletion_declined"

    # Platform staff reaching into a customer's tenant.
    PLATFORM_ACCESSED_ORG = "org.platform_access"
    ORG_UPDATED = "org.updated"
    BRANCH_CREATED = "org.branch_created"
    DEPARTMENT_CREATED = "org.department_created"

    MESSAGE_SENT = "message.sent"

    ORDER_PAID = "billing.order_paid"

    # Written by the middleware net for any mutation without a domain event of
    # its own. Carries the method and path so nothing goes unrecorded even when
    # nobody remembered to add an explicit call.
    REQUEST = "http.request"


class AuditEvent(Base):
    """One recorded action.

    No `updated_at` and no TimestampMixin: an audit record is written once and
    never changed. A mutable audit log is not an audit log.
    """

    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = uuid_pk()

    # Nullable: platform-level activity (a public B2C student, or the platform
    # super admin) belongs to no organization. Non-NULL is what lets an org
    # admin be shown their own organization's trail and nothing else.
    #
    # RESTRICT, like actor_user_id: an organization's history must survive the
    # organization being closed, or the trail cannot answer questions about
    # what happened while it was open.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=True, index=True
    )

    # RESTRICT, matching attempt_grants.granted_by (decision 24): an audit
    # record must never become anonymous because the account was tidied away.
    # Nullable only for events with no signed-in actor — a failed login, or
    # something the system did to itself.
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )

    action: Mapped[str] = mapped_column(String(64), nullable=False)

    # What was acted upon, e.g. ("course", <uuid>). Free-form because the target
    # may live in any of twenty tables and a real FK would need twenty columns.
    target_type: Mapped[str | None] = mapped_column(String(64))
    target_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    # 45 characters holds an IPv6 address with an IPv4 tail. Stored as text
    # rather than INET so a proxy value that is not a valid address is recorded
    # rather than throwing at write time — losing the whole event to a
    # malformed header would be the wrong trade in an audit log.
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(400))

    # A FIRST-PARTY COOKIE WE ISSUE, not a fingerprint we compute.
    #
    # Browsers do not hand out a device identifier, and the usual way to
    # manufacture one is to fingerprint — canvas, fonts, screen metrics — which
    # tracks people across sites they never agreed to be tracked on, and which
    # browsers are actively closing off anyway. This is a random opaque value in
    # our own httpOnly cookie, set on first contact. It answers "is this the
    # same browser that signed in yesterday", which is what an audit trail asks,
    # and it tells nobody else anything about the person.
    device_id: Mapped[str | None] = mapped_column(String(64))

    # Identifiers, counts and outcomes. Never a request body, never an answer.
    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    actor: Mapped[User | None] = relationship("User", lazy="raise")

    __table_args__ = (
        # Every read of this table is "most recent first, filtered by one of
        # these three". This table grows faster than anything else in the
        # schema, so the composite indexes are not premature.
        Index("ix_audit_events_org_created", "organization_id", created_at.desc()),
        Index("ix_audit_events_actor_created", "actor_user_id", created_at.desc()),
        Index("ix_audit_events_action_created", "action", created_at.desc()),
        # "Everything from this device" is the query a security review runs
        # after something goes wrong.
        Index("ix_audit_events_device_created", "device_id", created_at.desc()),
    )
