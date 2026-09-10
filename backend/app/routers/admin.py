"""Admin: users, activity logs, AI usage, and attempt grants.

Every route here depends on `require_role(UserRole.ADMIN)`. A student who
guesses a URL gets 403 — the frontend hiding the link is not what protects
this.

Usage figures are aggregated from `voice_sessions` and `transcripts`, which the
voice endpoint writes during a live session.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.deps import DbSession, RequireAdmin, RequireSuperAdmin, require_role
from app.models.audit import AuditAction
from app.models.certification import AttemptGrant, CertAttempt
from app.models.contact import ContactMessage
from app.models.course import Course, Module
from app.models.enrollment import Enrollment
from app.models.suspension import SuspensionRequest, SuspensionStatus
from app.models.user import User, UserRole
from app.models.voice import Transcript, VoiceSession
from app.services import audit, certification

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

admin_only = Depends(require_role(UserRole.ADMIN))


class AdminUserRow(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    # Sent so the console can edit it. The row already carried the two other
    # editable details; phone was the one the details editor could not show
    # without a second request per row.
    phone: str | None
    role: str
    is_active: bool
    created_at: datetime
    enrollments: int
    voice_sessions: int
    voice_minutes: int
    # The project spec asks specifically for a flag showing whether a user has ever
    # used the AI tutor at all.
    has_used_tutor: bool
    last_session_at: datetime | None

    # SOMEBODY HAS ALREADY ASKED for this account to be switched off, and the
    # platform owner has not decided. Without it an ordinary admin has no way
    # to tell a request they raised yesterday from one they never raised —
    # pressing the button again is the only feedback, and it is an error.
    suspension_pending: bool = False

    # WHICH CUSTOMER THEY BELONG TO. Null for a public B2C account. Sent so the
    # console can filter by organisation and label the row — without it, a super
    # admin looking at fifty accounts across six customers cannot tell which is
    # which, and the filter would have to guess from the email domain.
    organization_id: uuid.UUID | None
    organization_name: str | None


class ActivityLogRow(BaseModel):
    session_id: uuid.UUID
    user_name: str
    user_email: str
    module_title: str
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: int | None
    model_name: str
    turns: int
    interruptions: int


class UsagePoint(BaseModel):
    day: str
    sessions: int
    minutes: int


class ModuleUsageRow(BaseModel):
    module_title: str
    sessions: int
    minutes: int


class UsageOverview(BaseModel):
    total_users: int
    users_who_used_tutor: int
    total_sessions: int
    total_minutes: int
    total_interruptions: int
    sessions_per_day: list[UsagePoint]
    top_modules: list[ModuleUsageRow]


class GrantRequest(BaseModel):
    user_id: uuid.UUID
    cert_exam_id: uuid.UUID
    extra_attempts: int = Field(ge=1, le=20)
    reason: str | None = Field(default=None, max_length=1000)


class GrantRow(BaseModel):
    id: uuid.UUID
    user_name: str
    user_email: str
    exam_title: str
    extra_attempts_granted: int
    granted_by_name: str
    reason: str | None
    ts: datetime


# Seconds a session ran, or NULL while still open.
_DURATION = func.extract("epoch", VoiceSession.ended_at - VoiceSession.started_at)


@router.get("/users", response_model=list[AdminUserRow])
async def list_users(session: DbSession, actor: RequireAdmin) -> list[AdminUserRow]:
    """Platform users with their activity counts.

    Counts come from grouped subqueries rather than a query per user, so this
    stays a fixed number of round trips as the table grows.

    SCOPED. An ordinary platform admin sees public B2C accounts only —
    customers' staff are their own to manage, and listing them here handed an
    admin eight people's names and work addresses across two organizations.
    A super admin still sees everyone, for support; org admins manage their own
    people at /org/{slug}/members.
    """
    enrollment_counts = dict(
        (
            await session.execute(
                select(Enrollment.user_id, func.count()).group_by(Enrollment.user_id)
            )
        ).all()
    )

    session_rows = (
        await session.execute(
            select(
                VoiceSession.user_id,
                func.count(),
                func.coalesce(func.sum(_DURATION), 0),
                func.max(VoiceSession.started_at),
            ).group_by(VoiceSession.user_id)
        )
    ).all()
    session_stats = {row[0]: (row[1], int(row[2] or 0), row[3]) for row in session_rows}

    # One query for the whole table. There are rarely more than a handful open.
    pending_suspensions = set(
        (
            await session.execute(
                select(SuspensionRequest.user_id).where(
                    SuspensionRequest.status == SuspensionStatus.PENDING
                )
            )
        )
        .scalars()
        .all()
    )

    query = select(User).order_by(User.created_at.desc())
    if actor.role is not UserRole.SUPER_ADMIN:
        query = query.where(User.organization_id.is_(None))
    users = (await session.execute(query)).scalars().all()

    # One lookup for every organisation rather than one per user — there are a
    # handful of customers and hundreds of accounts, so the whole table is
    # cheaper than a join repeated per row.
    from app.models.organization import Organization

    org_names = dict(
        (await session.execute(select(Organization.id, Organization.name))).all()
    )

    rows: list[AdminUserRow] = []
    for user in users:
        count, seconds, last = session_stats.get(user.id, (0, 0, None))
        rows.append(
            AdminUserRow(
                id=user.id,
                name=user.name,
                email=user.email,
                phone=user.phone,
                role=user.role.value,
                is_active=user.is_active,
                created_at=user.created_at,
                enrollments=enrollment_counts.get(user.id, 0),
                voice_sessions=count,
                voice_minutes=seconds // 60,
                has_used_tutor=count > 0,
                last_session_at=last,
                organization_id=user.organization_id,
                organization_name=org_names.get(user.organization_id),
                suspension_pending=user.id in pending_suspensions,
            )
        )
    return rows


@router.get("/activity", response_model=list[ActivityLogRow], dependencies=[admin_only])
async def list_activity(
    session: DbSession, limit: int = Query(default=50, ge=1, le=500)
) -> list[ActivityLogRow]:
    """Recent voice sessions, newest first."""
    turn_counts = dict(
        (
            await session.execute(
                select(Transcript.session_id, func.count()).group_by(
                    Transcript.session_id
                )
            )
        ).all()
    )
    interrupt_counts = dict(
        (
            await session.execute(
                select(Transcript.session_id, func.count())
                .where(Transcript.is_interruption.is_(True))
                .group_by(Transcript.session_id)
            )
        ).all()
    )

    rows = (
        await session.execute(
            select(VoiceSession, User, Module)
            .join(User, User.id == VoiceSession.user_id)
            .join(Module, Module.id == VoiceSession.module_id)
            .order_by(VoiceSession.started_at.desc())
            .limit(limit)
        )
    ).all()

    return [
        ActivityLogRow(
            session_id=voice.id,
            user_name=user.name,
            user_email=user.email,
            module_title=module.title,
            started_at=voice.started_at,
            ended_at=voice.ended_at,
            duration_seconds=(
                int((voice.ended_at - voice.started_at).total_seconds())
                if voice.ended_at
                else None
            ),
            model_name=voice.model_name,
            turns=turn_counts.get(voice.id, 0),
            interruptions=interrupt_counts.get(voice.id, 0),
        )
        for voice, user, module in rows
    ]


@router.get("/usage", response_model=UsageOverview)
async def get_usage(
    session: DbSession,
    actor: RequireAdmin,
    days: int = Query(default=14, ge=1, le=90),
) -> UsageOverview:
    """Aggregates for the admin charts."""
    total_users = await session.scalar(select(func.count()).select_from(User)) or 0
    total_sessions = (
        await session.scalar(select(func.count()).select_from(VoiceSession)) or 0
    )
    total_seconds = int(
        await session.scalar(
            select(func.coalesce(func.sum(_DURATION), 0)).where(
                VoiceSession.ended_at.is_not(None)
            )
        )
        or 0
    )
    users_with_sessions = (
        await session.scalar(select(func.count(func.distinct(VoiceSession.user_id))))
        or 0
    )
    total_interruptions = (
        await session.scalar(
            select(func.count())
            .select_from(Transcript)
            .where(Transcript.is_interruption.is_(True))
        )
        or 0
    )

    since = datetime.now(UTC) - timedelta(days=days)
    per_day = (
        await session.execute(
            select(
                func.date_trunc("day", VoiceSession.started_at).label("day"),
                func.count(),
                func.coalesce(func.sum(_DURATION), 0),
            )
            .where(VoiceSession.started_at >= since)
            .group_by("day")
            .order_by("day")
        )
    ).all()

    # "Most used modules" names modules, and a customer's private module title
    # is exactly what the walled garden keeps off other people's screens. An
    # ordinary platform admin sees public course modules only; a super admin
    # sees across tenants, for support.
    module_scope = (
        ()
        if actor.role is UserRole.SUPER_ADMIN
        else (Course.organization_id.is_(None),)
    )

    per_module = (
        await session.execute(
            select(
                Module.title,
                func.count(),
                func.coalesce(func.sum(_DURATION), 0),
            )
            .join(Module, Module.id == VoiceSession.module_id)
            .join(Course, Course.id == Module.course_id)
            .where(*module_scope)
            .group_by(Module.title)
            .order_by(func.count().desc())
            .limit(10)
        )
    ).all()

    return UsageOverview(
        total_users=total_users,
        users_who_used_tutor=users_with_sessions,
        total_sessions=total_sessions,
        total_minutes=total_seconds // 60,
        total_interruptions=total_interruptions,
        sessions_per_day=[
            UsagePoint(
                day=day.date().isoformat(),
                sessions=count,
                minutes=int(seconds or 0) // 60,
            )
            for day, count, seconds in per_day
        ],
        top_modules=[
            ModuleUsageRow(
                module_title=title,
                sessions=count,
                minutes=int(seconds or 0) // 60,
            )
            for title, count, seconds in per_module
        ],
    )


@router.get("/attempt-grants", response_model=list[GrantRow], dependencies=[admin_only])
async def list_grants(session: DbSession) -> list[GrantRow]:
    from app.models.certification import CertExam

    granter = User.__table__.alias("granter")
    rows = (
        await session.execute(
            select(AttemptGrant, User, CertExam, granter.c.name)
            .join(User, User.id == AttemptGrant.user_id)
            .join(CertExam, CertExam.id == AttemptGrant.cert_exam_id)
            .join(granter, granter.c.id == AttemptGrant.granted_by)
            .order_by(AttemptGrant.ts.desc())
        )
    ).all()

    return [
        GrantRow(
            id=grant.id,
            user_name=user.name,
            user_email=user.email,
            exam_title=exam.title,
            extra_attempts_granted=grant.extra_attempts_granted,
            granted_by_name=granted_by_name,
            reason=grant.reason,
            ts=grant.ts,
        )
        for grant, user, exam, granted_by_name in rows
    ]


@router.post(
    "/attempt-grants",
    response_model=GrantRow,
    status_code=status.HTTP_201_CREATED,
)
async def grant_attempts(
    payload: GrantRequest, session: DbSession, admin: RequireAdmin
) -> GrantRow:
    """Give a student extra certification attempts.

    `admin` is the acting user, recorded as `granted_by` so every grant is
    attributable.
    """
    from app.models.certification import CertExam

    student = await session.get(User, payload.user_id)
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found."
        )

    exam = await session.get(CertExam, payload.cert_exam_id)
    if exam is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found."
        )

    grant = await certification.grant_extra_attempts(
        session,
        user_id=payload.user_id,
        exam_id=payload.cert_exam_id,
        granted_by=admin.id,
        extra=payload.extra_attempts,
        reason=payload.reason,
    )

    return GrantRow(
        id=grant.id,
        user_name=student.name,
        user_email=student.email,
        exam_title=exam.title,
        extra_attempts_granted=grant.extra_attempts_granted,
        granted_by_name=admin.name,
        reason=grant.reason,
        ts=grant.ts,
    )


@router.get("/cert-exams", response_model=list[dict], dependencies=[admin_only])
async def list_all_exams(session: DbSession) -> list[dict]:
    """Every exam, for the grant form's dropdown."""
    from app.models.certification import CertExam
    from app.models.course import Course

    rows = (
        await session.execute(
            select(CertExam, Course.title)
            .join(Course, Course.id == CertExam.course_id)
            .order_by(Course.title, CertExam.title)
        )
    ).all()
    return [
        {
            "id": str(exam.id),
            "title": exam.title,
            "course_title": course_title,
            "default_max_attempts": exam.default_max_attempts,
        }
        for exam, course_title in rows
    ]


class RoleUpdate(BaseModel):
    # TEACHER is gone from the dropdown: nothing on the platform distinguishes
    # a teacher from an admin today, so it was an option that changed nothing
    # anyone could see. Existing teacher accounts keep the role.
    #
    # SUPER_ADMIN is now assignable, on request. The lockout guard that made it
    # unassignable is the one BELOW — a super admin still cannot demote another
    # super admin, so promoting someone can never leave the platform with
    # nobody able to promote anyone back. Handing out the top role is the
    # loudest event in the audit trail either way.
    role: Literal[UserRole.STUDENT, UserRole.ADMIN, UserRole.SUPER_ADMIN]


@router.patch("/users/{user_id}/role", response_model=AdminUserRow)
async def set_user_role(
    user_id: uuid.UUID,
    payload: RoleUpdate,
    session: DbSession,
    admin: RequireSuperAdmin,
) -> AdminUserRow:
    """Promote or demote a user. Super admin only.

    This is the other half of what separates a super admin from an admin: an
    admin runs the platform, a super admin decides who gets to.

    Two guards worth stating:
      * you cannot change your own role — a super admin demoting themselves
        could leave nobody able to promote anyone back;
      * you cannot demote another super admin, for the same reason in reverse.
    """
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role.",
        )

    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )

    if target.role is UserRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Another super admin cannot be demoted from here.",
        )

    # An org admin demoted to student is an org admin the organization has
    # lost. The floor is theirs, not this console's, so it applies here too.
    if (
        target.organization_id is not None
        and target.role is UserRole.ORG_ADMIN
        and payload.role is not UserRole.ORG_ADMIN
    ):
        from app.services import organizations as org_service

        try:
            await org_service.assert_admin_floor_after_change(
                session, target, still_admin=False
            )
        except org_service.AdminFloorError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None

    previous = target.role
    target.role = payload.role
    # fastapi-users reads is_superuser; keep it in step so the two cannot drift.
    target.is_superuser = payload.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN)

    # `record`, not `record_safely`: handing someone power is exactly the class
    # of event a compliance trail exists for, so a failure to record it must
    # fail the change rather than quietly grant it unrecorded. It shares this
    # transaction, so the promotion and its record commit together or not at
    # all — the same reasoning that made decision 54's NameError so bad, where
    # the commit landed and the response reported failure.
    await audit.record(
        session,
        action=AuditAction.ROLE_CHANGED,
        actor=admin,
        target_type="user",
        target_id=target.id,
        metadata={"from": previous.value, "to": target.role.value},
    )
    await session.commit()

    logger.info(
        "Super admin %s changed %s from %s to %s",
        admin.id,
        target.id,
        previous.value,
        target.role.value,
    )

    # ORGANISATION FIELDS ARE REQUIRED HERE. They were added to the model for
    # the customer filter and never added to this construction, and neither has
    # a default — so every role change raised a ValidationError building the
    # response, AFTER the commit. The promotion landed and the console showed
    # an error, which is the worst possible pair.
    org_name = None
    if target.organization_id is not None:
        from app.models.organization import Organization

        org_name = await session.scalar(
            select(Organization.name).where(Organization.id == target.organization_id)
        )

    return AdminUserRow(
        id=target.id,
        name=target.name,
        email=target.email,
        phone=target.phone,
        role=target.role.value,
        is_active=target.is_active,
        created_at=target.created_at,
        enrollments=0,
        voice_sessions=0,
        voice_minutes=0,
        has_used_tutor=False,
        last_session_at=None,
        organization_id=target.organization_id,
        organization_name=org_name,
    )


class ContactMessageRow(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    phone: str | None
    subject: str | None
    message: str
    handled: bool
    handled_by_name: str | None
    handled_at: datetime | None
    reply_body: str | None
    created_at: datetime


class ContactHandledUpdate(BaseModel):
    handled: bool


class ContactReply(BaseModel):
    """A reply written in the console.

    Stored, not sent: no mail provider is configured (decision 36), so the
    honest thing is to keep the text against the message and say on screen that
    it is a record of the reply rather than a delivery. Wiring email later is a
    sender on top of this, not a schema change.
    """

    body: str = Field(min_length=1, max_length=5_000)


def _contact_row(
    message: ContactMessage, handler_name: str | None
) -> ContactMessageRow:
    return ContactMessageRow(
        id=message.id,
        name=message.name,
        email=message.email,
        phone=message.phone,
        subject=message.subject,
        message=message.message,
        handled=message.handled,
        handled_by_name=handler_name,
        handled_at=message.handled_at,
        reply_body=message.reply_body,
        created_at=message.created_at,
    )


@router.get(
    "/contact-messages",
    response_model=list[ContactMessageRow],
    dependencies=[admin_only],
)
async def list_contact_messages(
    session: DbSession, limit: int = Query(default=200, ge=1, le=500)
) -> list[ContactMessageRow]:
    """The contact-form inbox: unanswered first, then newest first."""
    handler = User.__table__.alias("handler")

    rows = (
        await session.execute(
            select(ContactMessage, handler.c.name)
            .outerjoin(handler, handler.c.id == ContactMessage.handled_by_user_id)
            .order_by(ContactMessage.handled.asc(), ContactMessage.created_at.desc())
            .limit(limit)
        )
    ).all()

    return [_contact_row(message, handler_name) for message, handler_name in rows]


@router.patch("/contact-messages/{message_id}", response_model=ContactMessageRow)
async def set_contact_message_handled(
    message_id: uuid.UUID,
    payload: ContactHandledUpdate,
    session: DbSession,
    admin: RequireAdmin,
) -> ContactMessageRow:
    """Mark a message dealt with, or put it back in the queue.

    Records which admin, for the same reason attempt grants do: "who replied to
    this person" is a question someone will ask.
    """
    message = await session.get(ContactMessage, message_id)
    if message is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Message not found."
        )

    message.handled = payload.handled
    message.handled_by_user_id = admin.id if payload.handled else None
    message.handled_at = datetime.now(UTC) if payload.handled else None
    await session.commit()
    await session.refresh(message)

    return _contact_row(message, admin.name if message.handled else None)


@router.post("/contact-messages/{message_id}/reply", response_model=ContactMessageRow)
async def reply_to_contact_message(
    message_id: uuid.UUID,
    payload: ContactReply,
    session: DbSession,
    admin: RequireAdmin,
) -> ContactMessageRow:
    """Record the reply, and mark the message answered in the same step.

    One action, not two. Writing a reply and then having to remember to tick
    "handled" is how an inbox ends up with answered messages still sitting in
    the queue.
    """
    message = await session.get(ContactMessage, message_id)
    if message is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Message not found."
        )

    message.reply_body = payload.body.strip()
    message.handled = True
    message.handled_by_user_id = admin.id
    message.handled_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(message)

    return _contact_row(message, admin.name)


@router.get("/stats/attempts", response_model=list[dict], dependencies=[admin_only])
async def attempts_overview(session: DbSession) -> list[dict]:
    """Certification attempts per student, so admins can see who is stuck."""
    from app.models.certification import CertExam

    rows = (
        await session.execute(
            select(
                User.name,
                User.email,
                CertExam.title,
                func.count(CertAttempt.id),
                func.max(CertAttempt.score),
                func.bool_or(CertAttempt.passed),
            )
            .join(User, User.id == CertAttempt.user_id)
            .join(CertExam, CertExam.id == CertAttempt.cert_exam_id)
            .group_by(User.name, User.email, CertExam.title)
            .order_by(func.count(CertAttempt.id).desc())
        )
    ).all()
    return [
        {
            "user_name": name,
            "user_email": email,
            "exam_title": exam_title,
            "attempts": attempts,
            "best_score": float(best or 0),
            "passed": bool(passed),
        }
        for name, email, exam_title, attempts, best, passed in rows
    ]
