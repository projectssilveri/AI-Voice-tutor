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
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.deps import DbSession, RequireAdmin, RequireSuperAdmin, require_role
from app.models.audit import AuditAction
from app.models.certification import AttemptGrant, CertAttempt
from app.models.contact import ContactMessage
from app.models.course import Course, Module
from app.models.deletion import DeletionTarget
from app.models.enrollment import Enrollment
from app.models.suspension import SuspensionRequest, SuspensionStatus
from app.models.user import User, UserRole
from app.models.voice import Transcript, VoiceSession
from app.routers import admin_users
from app.services import approvals, audit, certification, deletions

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
    # The same time in seconds. Whole minutes floor a 40-second session to 0,
    # so a row read "1 session · 0 min" beside an audit entry of 40 seconds and
    # a dashboard total that did count them.
    voice_seconds: int = 0
    # The project spec asks specifically for a flag showing whether a user has ever
    # used the AI tutor at all.
    has_used_tutor: bool
    last_session_at: datetime | None

    # SOMEBODY HAS ALREADY ASKED for this account to be switched off, and the
    # super admin has not decided. Without it an ordinary admin has no way
    # to tell a request they raised yesterday from one they never raised —
    # pressing the button again is the only feedback, and it is an error.
    suspension_pending: bool = False

    # SOMEBODY INSIDE THE CUSTOMER HAS ASKED for this account to be deleted,
    # and no Platform Admin or Super Admin has decided yet (2026-10-01). It
    # waits on the Deletion requests page; deleting directly answers it too.
    deletion_pending: bool = False

    # WHICH CUSTOMER THEY BELONG TO. Null for a public B2C account. Sent so the
    # console can filter by organisation and label the row — without it, a super
    # admin looking at fifty accounts across six customers cannot tell which is
    # which, and the filter would have to guess from the email domain.
    organization_id: uuid.UUID | None
    organization_name: str | None

    # Made an organisation admin by a platform admin and not approved yet by
    # a super admin, so switched off until then (`services/approvals`).
    approval_pending: bool = False


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
    #: Seconds as well as whole minutes. A 40-second session floors to 0
    #: minutes, and "1 session · 0 min" reads as a bug rather than a short
    #: lesson — the screen needs the finer number to say "under a minute".

    module_title: str
    sessions: int
    minutes: int
    seconds: int = 0


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


class AdminUserPage(BaseModel):
    """One screen of people, and how many there are altogether.

    THE TOTAL IS THE POINT. This route used to answer a bare list of everyone,
    which meant a cap could never be added later without the screen silently
    showing a truncated table and having no way to tell. Same shape as the
    audit trail, which has answered {events, total, limit, offset} from the
    start.
    """

    items: list[AdminUserRow]
    total: int
    limit: int
    offset: int


@router.get("/users", response_model=AdminUserPage)
async def list_users(
    session: DbSession,
    actor: RequireAdmin,
    q: str | None = Query(default=None, description="Name, email or organisation"),
    role: str | None = Query(default=None, description="Exactly this role"),
    organization_id: Annotated[
        uuid.UUID | None, Query(description="One customer")
    ] = None,
    public_only: bool = Query(
        default=False, description="Only accounts belonging to no organisation"
    ),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> AdminUserPage:
    """Platform users with their activity counts, filtered and paged.

    IT USED TO ANSWER WITH EVERYONE. The screen's search box and its two
    dropdowns filtered in the browser, so narrowing a list of five thousand
    people to one still downloaded five thousand people: a 1.9MB response to
    draw ten rows, measured. The filters the screen offers are parameters now.

    Counts come from grouped subqueries rather than a query per user, which was
    already true and already right. What is new is that they are grouped over
    THIS PAGE rather than over the whole of `enrollments` and `voice_sessions`.

    SCOPED, and the rule is `admin_users.visible_filter` rather than a WHERE
    clause written out here, so the table and the per-user routes cannot
    disagree about who exists.

    What a platform admin gets: everyone except the staff ladder above them —
    B2C learners, and every customer's people in full, administrators and
    managers and learners alike. The ladder is super admin > platform admin >
    organisation admin and sight runs down it. What they do not get is other
    platform admins or super admins.

    SEEING IS NOT TOUCHING. The rows for a customer's people are read-only
    here; `can_manage` refuses every write, their own admins manage them at
    /org/{slug}/members, and deleting one goes through the approval queue.
    """
    from app.models.organization import Organization

    # WHO THIS CALLER MAY SEE FIRST, then what they asked for. The order is not
    # cosmetic: the scope is fixed and the filters may only narrow inside it.
    conditions = list(admin_users.visible_filter(actor))
    if role:
        conditions.append(User.role == role)
    if organization_id is not None:
        conditions.append(User.organization_id == organization_id)
    elif public_only:
        conditions.append(User.organization_id.is_(None))
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        conditions.append(
            or_(
                User.name.ilike(pattern),
                User.email.ilike(pattern),
                Organization.name.ilike(pattern),
            )
        )

    # An OUTER join, so a B2C account with no organisation still matches a
    # search on a name. An inner one would quietly drop every public learner
    # the moment somebody typed in the box.
    scoped = (
        select(User)
        .outerjoin(Organization, Organization.id == User.organization_id)
        .where(*conditions)
    )

    total = (
        await session.scalar(
            select(func.count()).select_from(scoped.subquery())
        )
    ) or 0

    users = (
        (
            await session.execute(
                # `id` breaks the tie. Accounts created in the same
                # transaction share a `created_at`, and without a total
                # order LIMIT/OFFSET reshuffles between pages: measured
                # showing the same person on page one and page two while
                # two other people appeared on neither.
                scoped.order_by(User.created_at.desc(), User.id.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    if not users:
        return AdminUserPage(items=[], total=total, limit=limit, offset=offset)

    page_ids = [user.id for user in users]

    # SCOPED TO THE PAGE. Each of these used to group over its whole table to
    # decorate however many rows were on screen.
    enrollment_counts = dict(
        (
            await session.execute(
                select(Enrollment.user_id, func.count())
                .where(Enrollment.user_id.in_(page_ids))
                .group_by(Enrollment.user_id)
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
            )
            .where(VoiceSession.user_id.in_(page_ids))
            .group_by(VoiceSession.user_id)
        )
    ).all()
    session_stats = {row[0]: (row[1], int(row[2] or 0), row[3]) for row in session_rows}

    pending_suspensions = set(
        (
            await session.execute(
                select(SuspensionRequest.user_id).where(
                    SuspensionRequest.status == SuspensionStatus.PENDING,
                    SuspensionRequest.user_id.in_(page_ids),
                )
            )
        )
        .scalars()
        .all()
    )

    # Not narrowed: there are rarely more than a handful open at once, and the
    # service owns the query.
    pending_deletions = await deletions.pending_ids(session, DeletionTarget.MEMBER)
    waiting = await approvals.waiting_ids(session, page_ids)

    # One lookup for every organisation rather than one per user. There are a
    # handful of customers, so the whole table is cheaper than a join per row.
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
                voice_seconds=seconds,
                has_used_tutor=count > 0,
                last_session_at=last,
                organization_id=user.organization_id,
                organization_name=org_names.get(user.organization_id),
                suspension_pending=user.id in pending_suspensions,
                deletion_pending=user.id in pending_deletions,
                approval_pending=user.id in waiting,
            )
        )
    return AdminUserPage(items=rows, total=total, limit=limit, offset=offset)


@router.get("/activity", response_model=list[ActivityLogRow])
async def list_activity(
    session: DbSession,
    actor: RequireAdmin,
    limit: int = Query(default=50, ge=1, le=500),
) -> list[ActivityLogRow]:
    """Recent voice sessions IN SCOPE, newest first.

    SCOPED BY WHOSE PERSON IT IS. The wall went up around a customer's content
    and this row of their people was left outside it: an ordinary platform
    admin could read a customer's staff by name and email, the module each one
    sat with the tutor on, and when. Issue 52, and the same leak as 62.

    The two transcript counts above are keyed by session id and only read for
    rows that come back, so they need no scope of their own.
    """
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

    # Every customer for platform staff since the role model of 2026-10-01;
    # only the staff ladder above a platform admin stays out.
    people_scope = tuple(admin_users.visible_filter(actor))

    rows = (
        await session.execute(
            select(VoiceSession, User, Module)
            .join(User, User.id == VoiceSession.user_id)
            .join(Module, Module.id == VoiceSession.module_id)
            .where(*people_scope)
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
    # EVERY CUSTOMER, AND NOT THE STAFF ABOVE. Platform staff count across
    # tenants since the role model of 2026-10-01. What a platform admin still
    # does not count is the ladder above them: their Users page hides the
    # super admin, and a card saying 7 beside a list of 6 is a number about
    # someone they cannot see (issue 44).
    ladder = admin_users.visible_filter(actor)
    public_only = bool(ladder)
    people_scope = tuple(ladder)
    # Sessions belonging to somebody in scope, as a subquery rather than a
    # join, so each aggregate below keeps the shape it already had.
    in_scope_sessions = select(User.id).where(*people_scope)
    session_scope = (
        (VoiceSession.user_id.in_(in_scope_sessions),) if public_only else ()
    )
    transcript_scope = (
        (
            Transcript.session_id.in_(
                select(VoiceSession.id).where(*session_scope)
            ),
        )
        if public_only
        else ()
    )

    total_users = (
        await session.scalar(
            select(func.count()).select_from(User).where(*people_scope)
        )
        or 0
    )
    total_sessions = (
        await session.scalar(
            select(func.count()).select_from(VoiceSession).where(*session_scope)
        )
        or 0
    )
    total_seconds = int(
        await session.scalar(
            select(func.coalesce(func.sum(_DURATION), 0)).where(
                VoiceSession.ended_at.is_not(None), *session_scope
            )
        )
        or 0
    )
    users_with_sessions = (
        await session.scalar(
            select(func.count(func.distinct(VoiceSession.user_id))).where(
                *session_scope
            )
        )
        or 0
    )
    total_interruptions = (
        await session.scalar(
            select(func.count())
            .select_from(Transcript)
            .where(Transcript.is_interruption.is_(True), *transcript_scope)
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
            .where(VoiceSession.started_at >= since, *session_scope)
            .group_by("day")
            .order_by("day")
        )
    ).all()

    # "Most used modules" names modules, and a customer's private module title
    # is exactly what the walled garden keeps off other people's screens. An
    # ordinary platform admin sees public course modules only; a super admin
    # sees across tenants, for support.
    # Every customer's courses for platform staff since 2026-10-01.
    module_scope: tuple = ()

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
            # RANKED BY TIME, NOT BY SESSION COUNT.
            #
            # Counting sessions sounds like "most used" and is not: a student
            # opens a module's tutor once, so on a real catalogue almost every
            # module has exactly one session and the ranking is whatever order
            # the database felt like. Measured: four modules, one session each,
            # four identical bars — and the one that had eight minutes of
            # lecture sat below one that had none.
            #
            # Minutes is the number that varies, and it is also the number this
            # screen exists to watch: it is what the AI costs and what a
            # customer's allowance is spent on. Sessions break the tie.
            .order_by(func.coalesce(func.sum(_DURATION), 0).desc(), func.count().desc())
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
                # Floored, not rounded, and the screen says "under a minute"
                # rather than "0 min" — a lesson that happened should not be
                # reported as no time at all.
                minutes=int(seconds or 0) // 60,
                seconds=int(seconds or 0),
            )
            for title, count, seconds in per_module
        ],
    )


@router.get("/attempt-grants", response_model=list[GrantRow])
async def list_grants(session: DbSession, actor: RequireAdmin) -> list[GrantRow]:
    """Extra attempts handed out, for the people in scope.

    Scoped for the reason `/activity` is: the row carries the learner's name
    and email, and a customer's learner is not a platform admin's to read.
    """
    from app.models.certification import CertExam

    # Every customer for platform staff since the role model of 2026-10-01;
    # only the staff ladder above a platform admin stays out.
    people_scope = tuple(admin_users.visible_filter(actor))

    granter = User.__table__.alias("granter")
    rows = (
        await session.execute(
            select(AttemptGrant, User, CertExam, granter.c.name)
            .join(User, User.id == AttemptGrant.user_id)
            .join(CertExam, CertExam.id == AttemptGrant.cert_exam_id)
            .join(granter, granter.c.id == AttemptGrant.granted_by)
            .where(*people_scope)
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

    # TENANCY, which this write never checked. The listings beside it were
    # scoped to public accounts, but the grant took any user id and any exam
    # id, so a platform admin could hand a customer's learner extra attempts.
    # `can_manage` is the rule every other write on a person follows. 404, not
    # 403, for the same reason `_manageable` gives. Issue 51.
    if not admin_users.can_manage(admin, student):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found."
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


@router.get("/cert-exams", response_model=list[dict])
async def list_all_exams(session: DbSession, actor: RequireAdmin) -> list[dict]:
    """The exams in scope, for the grant form's dropdown.

    A customer's course title is the thing the walled garden is built around,
    and this dropdown was handing over every one of them.
    """
    from app.models.certification import CertExam
    from app.models.course import Course

    # Every customer's courses for platform staff since 2026-10-01.
    course_scope: tuple = ()

    rows = (
        await session.execute(
            select(CertExam, Course.title)
            .join(Course, Course.id == CertExam.course_id)
            .where(*course_scope)
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
    # TEACHER is gone entirely now, not just off this dropdown. Taking it off
    # the dropdown and leaving it in the code is what let a retired role keep
    # the paywall bypass for months — see migration 0025.
    #
    # SUPER_ADMIN is assignable, on request. The lockout guard is BELOW: the
    # last active super admin cannot be demoted and nobody changes their own
    # role, so the platform always keeps somebody able to promote people back.
    # Handing out the top role is the loudest event in the audit trail either
    # way.
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
      * the last active super admin cannot be demoted, so there is always
        somebody able to promote people back. Changing your OWN role is
        allowed since 2026-10-01 (the user's decision), under the same floor;
      * nobody inside an organisation is staffed from here.
    """
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )

    # AN ORGANISATION'S PEOPLE ARE NOT PROMOTED FROM HERE. This could turn an
    # Acme learner into a platform admin or a super admin and leave them inside
    # Acme, while a platform account belongs to no organisation:
    # `create_platform_user` refuses to make one. Their role belongs to their
    # own organisation's portal, where its admin floor is enforced as well.
    if target.organization_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{target.name} belongs to an organisation. Their role is "
                "changed in that organisation's portal, not from here."
            ),
        )

    # DEMOTING A SUPER ADMIN IS ALLOWED NOW, and it was not before. The old rule
    # refused it outright to prevent a lockout, which worked but left role
    # management contradicting itself: the top role could be handed out and
    # never taken back. Issues 2, 4 and 6 are all that contradiction.
    #
    # What needs protecting is that somebody can always promote people, not that
    # super admins are permanent, so the floor counts them instead.
    if target.role is UserRole.SUPER_ADMIN and payload.role is not UserRole.SUPER_ADMIN:
        await admin_users.assert_super_admin_floor(session, target)

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


@router.get("/stats/attempts", response_model=list[dict])
async def attempts_overview(session: DbSession, actor: RequireAdmin) -> list[dict]:
    """Certification attempts per student in scope, so admins see who is stuck.

    Name, email, exam title and score, one row per learner. Every one of those
    columns is a customer's to hold, so the same wall as `/activity` goes here.
    """
    from app.models.certification import CertExam

    # Every customer for platform staff since the role model of 2026-10-01;
    # only the staff ladder above a platform admin stays out.
    people_scope = tuple(admin_users.visible_filter(actor))

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
            .where(*people_scope)
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
