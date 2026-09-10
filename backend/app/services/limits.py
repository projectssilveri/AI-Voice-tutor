"""What an organization is allowed, and what it has used.

Every limit here is recomputed from the database on each check, never cached
and never trusted from a request — the same rule the certification allowance
follows (`services/certification.get_allowance`). A limit the client can send
is not a limit.

NULL MEANS UNLIMITED, everywhere. Zero is a real limit meaning "none", which is
why the absent case cannot be zero: an organization created before any of this
existed must behave exactly as it did, and it has NULL in every column.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.course import Course, Module
from app.models.organization import Organization
from app.models.user import User
from app.models.voice import VoiceSession


class LimitReached(Exception):
    """A limit was hit. Carries the sentence to show the person who hit it."""


@dataclass(frozen=True)
class Usage:
    """One organization's headroom, as a screen would want to draw it."""

    members_used: int
    members_allowed: int | None
    ai_minutes_used: int
    ai_minutes_allowed: int | None

    @staticmethod
    def _remaining(used: int, allowed: int | None) -> int | None:
        if allowed is None:
            return None
        # Clamped: a negative remaining count is nonsense to display, and can
        # happen legitimately if an admin lowers a limit below current use.
        return max(0, allowed - used)

    @property
    def members_remaining(self) -> int | None:
        return self._remaining(self.members_used, self.members_allowed)

    @property
    def ai_minutes_remaining(self) -> int | None:
        return self._remaining(self.ai_minutes_used, self.ai_minutes_allowed)


def _month_start(now: datetime | None = None) -> datetime:
    """The first instant of the current month, UTC.

    A calendar month rather than a rolling 30 days: a customer reading "1,200
    of 2,000 minutes this month" expects it to reset on the 1st, and a rolling
    window makes the number drift downwards for no visible reason.
    """
    moment = now or datetime.now(UTC)
    return moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def usage_for(session: AsyncSession, organization: Organization) -> Usage:
    """Members and AI minutes used, against what the organization may have."""
    # Deactivated members still count. A suspended account holds its place —
    # it can be switched back on — and not counting it would let an
    # organization park people to get under a seat limit.
    members = await session.scalar(
        select(func.count())
        .select_from(User)
        .where(User.organization_id == organization.id, User.closed_at.is_(None))
    )

    seconds = await session.scalar(
        select(
            func.coalesce(
                func.sum(
                    func.extract(
                        "epoch",
                        func.coalesce(VoiceSession.ended_at, VoiceSession.started_at),
                    )
                    - func.extract("epoch", VoiceSession.started_at)
                ),
                0,
            )
        )
        .select_from(VoiceSession)
        .join(User, User.id == VoiceSession.user_id)
        .where(
            User.organization_id == organization.id,
            VoiceSession.started_at >= _month_start(),
        )
    )

    return Usage(
        members_used=int(members or 0),
        members_allowed=organization.max_members,
        ai_minutes_used=int(seconds or 0) // 60,
        ai_minutes_allowed=organization.max_ai_minutes_per_month,
    )


async def assert_can_add_member(
    session: AsyncSession, organization: Organization
) -> None:
    """Refuse a new member when the organization is at its seat limit.

    Checked at the moment of creation rather than trusted from the screen that
    drew the button, because the screen may have been open for an hour.
    """
    usage = await usage_for(session, organization)
    if usage.members_allowed is None:
        return
    if usage.members_used >= usage.members_allowed:
        raise LimitReached(
            f"This organization is using all {usage.members_allowed} of its "
            f"seats. Ask your account manager to add more before inviting "
            f"anyone else."
        )


async def assert_ai_available(session: AsyncSession, user: User) -> None:
    """Refuse a voice session when the organization is out of AI minutes.

    A public B2C user has no organization and no cap — their access is governed
    by what they bought.

    Deliberately checked when a session OPENS, not while it runs: a lesson that
    cuts out mid-sentence because a counter ticked over is a worse experience
    than one that will not start, and the overshoot is bounded by Gemini's own
    ~10-minute connection cap.
    """
    if user.organization_id is None:
        return

    organization = await session.get(Organization, user.organization_id)
    if organization is None or organization.max_ai_minutes_per_month is None:
        return

    usage = await usage_for(session, organization)
    if usage.ai_minutes_used >= (usage.ai_minutes_allowed or 0):
        raise LimitReached(
            f"Your organization has used all "
            f"{usage.ai_minutes_allowed} AI tutor minutes for this month. "
            f"Reading and quizzes are unaffected. Ask your administrator to "
            f"raise the limit."
        )


# ---------------------------------------------------------------------------
# What the AI tutor is allowed to do on one module
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TutorAllowance:
    """How many plays a student gets on a module, and how long each may run."""

    sessions_per_module: int
    minutes_per_session: int
    #: True when these came from config rather than from the course row. The
    #: admin screen shows it, so an operator can tell "3 because nobody set it"
    #: apart from "3 because somebody chose 3" — the two look identical on a
    #: form and behave differently when the platform default changes.
    from_default: bool
    #: Which default was used, for the same reason. "free" or "paid".
    basis: str

    @property
    def tutor_disabled(self) -> bool:
        """A course deliberately set to no tutor at all."""
        return self.sessions_per_module == 0


async def tutor_allowance_for(
    session: AsyncSession, course: Course
) -> TutorAllowance:
    """Resolve a course's tutor limits.

    THE ONE PLACE the free/paid split is decided. The course's own columns win;
    NULL falls back to the platform default for a course of that kind.

    An organization's course counts as PAID whatever its price says. Org
    courses carry `price_minor = 0` because an employer bought the training in
    a contract, not because they are samples — reading that zero as "free"
    would give corporate learners one play per module.
    """
    treat_as_paid = course.organization_id is not None or course.price_minor > 0
    basis = "paid" if treat_as_paid else "free"

    default_sessions = (
        settings.paid_course_ai_sessions_per_module
        if treat_as_paid
        else settings.free_course_ai_sessions_per_module
    )
    default_minutes = (
        settings.paid_course_ai_session_minutes
        if treat_as_paid
        else settings.free_course_ai_session_minutes
    )

    # `is None` rather than a falsy test: 0 sessions is a real setting meaning
    # "this course has no tutor", and `or` would silently replace it with the
    # default — turning a deliberate switch-off back on.
    sessions = (
        course.ai_sessions_per_module
        if course.ai_sessions_per_module is not None
        else default_sessions
    )
    minutes = (
        course.ai_session_minutes
        if course.ai_session_minutes is not None
        else default_minutes
    )

    return TutorAllowance(
        sessions_per_module=sessions,
        minutes_per_session=minutes,
        from_default=(
            course.ai_sessions_per_module is None and course.ai_session_minutes is None
        ),
        basis=basis,
    )


async def tutor_plays_used(
    session: AsyncSession, user_id: uuid.UUID, module_id: uuid.UUID
) -> int:
    """How many times this student has already played the tutor on this module.

    Counts `voice_sessions` rows, which are written when a session STARTS. That
    is the honest count for a cap on plays: a student who opens the tutor,
    listens to half a lecture and closes it has used a play, and counting only
    finished sessions would let the same lecture be restarted indefinitely.
    """
    return int(
        await session.scalar(
            select(func.count())
            .select_from(VoiceSession)
            .where(
                VoiceSession.user_id == user_id,
                VoiceSession.module_id == module_id,
            )
        )
        or 0
    )


async def assert_tutor_play_available(
    session: AsyncSession, user: User, course: Course, module_id: uuid.UUID
) -> TutorAllowance:
    """Refuse a play past the course's per-module cap. Returns the allowance.

    STAFF ARE EXEMPT, on purpose. An author has to be able to open the tutor on
    a module they are writing more than once, and the cap is a commercial rule
    about what a student bought — not a technical safety limit.

    Checked when the session opens, matching `assert_ai_available`: a lecture
    that stops mid-sentence because a counter ticked over is worse than one
    that does not start.
    """
    allowance = await tutor_allowance_for(session, course)

    # Imported here rather than at module scope: `services.access` imports this
    # module, and a top-level import would close the cycle.
    from app.services.access import STAFF_ROLES

    if user.role in STAFF_ROLES:
        return allowance

    if allowance.tutor_disabled:
        raise LimitReached(
            "The voice tutor is switched off for this course. The written "
            "material, quizzes and assignments are unaffected."
        )

    used = await tutor_plays_used(session, user.id, module_id)
    if used >= allowance.sessions_per_module:
        plural = "" if allowance.sessions_per_module == 1 else "s"
        raise LimitReached(
            f"You have used all {allowance.sessions_per_module} tutor "
            f"session{plural} for this module. You can still read the "
            f"material, retake the quiz and do the assignment, and the "
            f"transcript of what the tutor said is on the module page."
        )
    return allowance


async def module_limit_for(session: AsyncSession, course: Course) -> int:
    """How many modules this course may have.

    The platform default is config, not a constant in the code:
    nothing that should be config is hardcoded. An organization may be given
    its own limit, which overrides it.
    """
    if course.organization_id is not None:
        organization = await session.get(Organization, course.organization_id)
        if organization is not None and organization.max_modules_per_course:
            return organization.max_modules_per_course
    return settings.max_modules_per_course


async def assert_can_add_module(session: AsyncSession, course: Course) -> None:
    """Refuse a module past the course's cap.

    Counted from the database rather than from `len(course.modules)`, which may
    be a stale relationship on a session that loaded the course earlier.
    """
    limit = await module_limit_for(session, course)
    existing = await session.scalar(
        select(func.count()).select_from(Module).where(Module.course_id == course.id)
    )
    if (existing or 0) >= limit:
        raise LimitReached(
            f"A course can have {limit} modules. Remove one before adding "
            f"another, or split this into a second course."
        )


async def visible_department_ids(user: User) -> set[uuid.UUID] | None:
    """Which departments' training this person may see.

    `None` means "no department filter applies" — they see everything in their
    organization. That is org admins and branch managers by role, plus anyone
    an admin has flagged `sees_all_departments`, which is how an HR or IT
    manager sitting inside one department gets to see everyone's training
    without being given a rank they should not have.

    A DEPARTMENT ADMIN IS NOT ON THAT LIST, and that is the point of the role:
    the sales admin administers sales and sees sales, so they fall through to
    the ordinary `{department_id}` below exactly as one of their learners does.
    Being an administrator widens what they may CHANGE, never what they may
    SEE.

    Everyone else sees organization-wide courses plus their own department's,
    and that is applied as a SQL filter rather than by hiding rows: the point of
    a department wall is that the material never reaches the browser.
    """
    from app.models.user import UserRole

    if user.role in (UserRole.ORG_ADMIN, UserRole.BRANCH_MANAGER):
        return None
    if user.sees_all_departments:
        return None
    return {user.department_id} if user.department_id else set()
