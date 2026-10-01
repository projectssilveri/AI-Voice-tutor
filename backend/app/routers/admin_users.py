"""Managing people, and the complete record of one person.

Split out of `admin.py`, which was already 650 lines and is the place four
different consoles meet. Everything here is about a user: creating one,
removing one, and the single screen that answers "what has this person actually
done" without an admin opening six tabs and joining it up in their head.

Scoping is the same rule as everywhere else on the platform console: an
ordinary admin sees public B2C accounts, a super admin sees everyone (decision
171). An organization's own people are managed by that organization at
`/org/{slug}/members`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select

from app.core import passwords
from app.core.users import password_helper
from app.deps import DbSession, RequireAdmin
from app.models.approval import ApprovalKind
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.audit import AuditAction, AuditEvent
from app.models.certification import CertAttempt, CertExam, Certificate
from app.models.course import Course, Module
from app.models.deletion import DeletionTarget
from app.models.enrollment import Enrollment, ModuleProgress, ProgressStatus
from app.models.order import Order, OrderStatus
from app.models.organization import Branch, Department, Organization
from app.models.profile import AccessExtension
from app.models.quiz import QuizAttempt, QuizQuestion
from app.models.subscription import (
    PlanCourse,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
)
from app.models.user import User, UserRole
from app.models.voice import VoiceSession
from app.services import (
    accounts,
    approvals,
    audit,
    certification,
    concurrency,
    conflicts,
    deletions,
)

router = APIRouter(prefix="/admin", tags=["admin"])

# WHO MAY HAND OUT WHICH ROLE.
#
# Was a rank comparison: anything at or below your own. That is how a platform
# admin could mint another platform admin, and then a super admin, and it is
# the escalation issue 1 reports. Rank still exists — the demotion floor uses
# it — but it is no longer the authority on who may create whom.
#
# An explicit table instead, because the rule is not actually "below me". A
# platform admin may create an ORGANISATION admin, which is not below them at
# all; it is beside them, on the customer's ladder. A rank number cannot say
# that and a table can.
#
# "Tutor" is absent because the role no longer exists — retired in migration
# 0025, its one account moved to Student.
ROLE_RANK = {
    UserRole.STUDENT: 0,
    UserRole.ADMIN: 2,
    UserRole.SUPER_ADMIN: 3,
}

MAY_CREATE: dict[UserRole, frozenset[UserRole]] = {
    UserRole.SUPER_ADMIN: frozenset(
        {
            UserRole.STUDENT,
            UserRole.ADMIN,
            UserRole.SUPER_ADMIN,
            UserRole.ORG_ADMIN,
        }
    ),
    # A platform admin runs the public side and appoints a customer's first
    # administrator. They do not staff the platform — that is the super admin's
    # to decide, and it is the whole point of the split.
    UserRole.ADMIN: frozenset({UserRole.STUDENT, UserRole.ORG_ADMIN}),
}

#: Every role this console can create, for the "not from here" message. The
#: per-actor sets above are what actually decide.
PLATFORM_ASSIGNABLE = tuple(
    sorted({role for roles in MAY_CREATE.values() for role in roles}, key=lambda r: r.value)
)

#: The staff ladder a platform admin may not look at. Their own row is always
#: visible; a peer's and the super admin's are not.
STAFF_ABOVE_PLATFORM_ADMIN = frozenset({UserRole.ADMIN, UserRole.SUPER_ADMIN})


def _may_assign(actor: User, role: UserRole) -> None:
    allowed = MAY_CREATE.get(actor.role, frozenset())
    if role not in PLATFORM_ASSIGNABLE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That role cannot be assigned from here.",
        )
    if role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot create an account with that role.",
        )


def can_see(actor: User, target: User) -> bool:
    """Whether `actor` may see `target` exists at all.

    THE LADDER IS super admin > platform admin > organisation admin, and sight
    runs DOWN it. A platform admin sees every customer's people in full —
    administrators, branch and department managers, learners — because they are
    above the organisation admin and support work is impossible from a directory
    of four names.

    THE ONE THING THEY DO NOT SEE IS THE LADDER ABOVE THEM: other platform
    admins and super admins are not in their list, wherever those accounts sit.
    Their own row always is.

    THE LISTING AND THE PER-USER ROUTES MUST AGREE, or a row appears in the
    table and 404s when clicked. The predicate lives here once and
    `visible_filter` below is its SQL twin — change one and the tests that
    compare them will say so.

    SEEING IS NOT TOUCHING. `can_manage` is the other half, and it is much
    narrower: full sight of a customer plus no ability to change them is
    exactly the shape decision 170 asked for.
    """
    if actor.role is UserRole.SUPER_ADMIN:
        return True
    if target.id == actor.id:
        return True
    # Hidden wherever they sit, which is on the public side in practice — a
    # platform account cannot be stamped with an organisation any more, and
    # `create_platform_user` refuses to make one.
    return target.role not in STAFF_ABOVE_PLATFORM_ADMIN


def visible_filter(actor: User) -> list:
    """`can_see` as SQL, for the listing. Keep the two in step."""
    if actor.role is UserRole.SUPER_ADMIN:
        return []
    return [
        or_(
            User.id == actor.id,
            User.role.notin_(tuple(STAFF_ABOVE_PLATFORM_ADMIN)),
        )
    ]


def can_manage(actor: User, target: User) -> bool:
    """Whether `actor` may CHANGE `target`, as opposed to merely see them.

    Platform staff change every account they can see, a customer's people
    included, since the role model of 2026-10-01 gave a platform admin the
    super admin's work. Before that a platform admin saw a customer's roster
    and changed none of it (decision 170).

    What is still not theirs: the staff ladder above a platform admin, which
    `can_see` never shows them; and roles, which `PATCH /users/{id}/role`
    keeps for the super admin, on public accounts only. Deleting a customer's
    people is theirs at once since 2026-10-01 (`services/deletions.py`).
    """
    if not can_see(actor, target):
        return False
    return actor.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN)


def _visible(actor: User, target: User) -> None:
    """404 unless this person may be SEEN. The guard on every read route.

    Existed, was deleted in the previous change when the reads all moved to
    `_manageable`, and is back because the reads moved again: a platform admin
    reads a customer's people in full now. The pair is the point — one door for
    looking, a narrower one for changing — and collapsing them in either
    direction is what produced both bugs.
    """
    if not can_see(actor, target):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )


def _manageable(actor: User, target: User) -> None:
    """404 unless this person may be changed.

    404 rather than 403, matching `_visible`: a platform admin can see that an
    organisation admin exists, and telling them "you are not allowed" on every
    action would be a worse experience than the buttons simply not being there
    — which is what the console does. This is the server saying the same thing
    to anyone who goes round it.
    """
    if not can_manage(actor, target):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )


async def assert_super_admin_floor(session, target: User) -> None:
    """Refuse to take the last active super admin off the platform.

    The old rule was blunter: NO super admin could be demoted by anyone, ever.
    That prevented the lockout, but it made role management self-contradictory —
    a super admin could hand the top role to somebody and then had no way to
    take it back, which is what issues 2, 4 and 6 report.

    The thing actually worth protecting is not "super admins are permanent", it
    is "the platform always has somebody who can promote people". So count them
    instead. This is the same shape as
    `organizations.assert_admin_floor_after_change`, which has protected
    customers from the identical lockout since organizations existed.

    409, not 403: the caller has the right to do this in principle, the
    platform's current state is what forbids it.

    LOCKED, NOT MERELY COUNTED. Reading the count and then writing leaves a gap:
    two requests demoting two different super admins each see one remaining, and
    between them leave none. Every super admin row is locked here — including
    the target's, so both requests contend on the same set rather than on
    disjoint halves of it — and ordered by id so they queue instead of
    deadlocking.
    """
    if target.role is not UserRole.SUPER_ADMIN:
        return

    held = await concurrency.lock_and_list(
        session,
        select(User.id)
        .where(User.role == UserRole.SUPER_ADMIN, User.is_active.is_(True))
        .order_by(User.id),
    )
    remaining = len([row for row in held if row != target.id])
    if not remaining:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "That is the last super admin. Promote somebody else first, or "
                "there would be nobody left able to promote anyone."
            ),
        )


async def _assert_org_floor_holds(session, target: User) -> None:
    """Refuse to take the second-to-last admin off an organization.

    The floor belongs to the ORGANIZATION, not to the console you happen to be
    using. It was enforced in the org portal and nowhere here, so a super admin
    could strand a customer from the platform Users screen — which is the same
    lockout, reached through a different door.

    409, not 403, matching decision 153: the caller has the right to do this in
    principle, the organization's current state is what forbids it.
    """
    if target.organization_id is None or target.role is not UserRole.ORG_ADMIN:
        return

    from app.services import organizations as org_service

    try:
        await org_service.assert_admin_floor_after_change(
            session, target, still_admin=False
        )
    except org_service.AdminFloorError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None


# ---------------------------------------------------------------------------
# Creating, editing and removing
# ---------------------------------------------------------------------------


class PlatformUserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    # Set by whoever creates the account and given to the person. There is no
    # mail provider (decision 36), so an invite email is not an option and
    # pretending otherwise would create accounts nobody can sign in to.
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.STUDENT
    phone: str | None = Field(default=None, max_length=40)
    #: REQUIRED FOR AN ORGANISATION ADMIN, refused for anybody else.
    #:
    #: An org admin with no organisation administers nothing: they sign in,
    #: `require_org_scope` finds no tenant for them, and every screen in the
    #: portal answers 404. The account looks fine in the console and is useless
    #: to the person holding it, which is the worst shape a bug can take.
    organization_id: uuid.UUID | None = None
    #: Courses to enrol them in immediately, so "create a user and give them
    #: the induction course" is one action rather than three screens.
    course_ids: list[uuid.UUID] = Field(default_factory=list)


class PlatformUserUpdate(BaseModel):
    """What an admin may change about a user.

    EMAIL IS HERE NOW, and it was deliberately absent before: it is the
    sign-in identifier, so changing it moves which address the person has to
    type. That is exactly why it needed to be editable — a customer whose
    address was typed wrong at creation could not sign in at all, and there was
    no way to put it right short of the database. The route validates it, keeps
    it unique, and writes the old and new values into the audit trail.

    IS_ACTIVE IS GONE from here. Suspending an account is not an editing
    decision: platform staff do it with a reason at `POST
    /admin/users/{id}/active`, which keeps the history and the floors. Absent
    from this schema, so the route drops the field even if it is in the body.
    """

    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    # `EmailStr`, so an address the API could not later serialise never reaches
    # the column: `CreatedUser` re-validates on the way out, and a bad one
    # would 500 every endpoint that returns this person.
    email: EmailStr | None = None


class UserRemoval(BaseModel):
    outcome: str
    explanation: str


class CreatedUser(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    is_active: bool
    # A platform admin's new organisation administrator, waiting for a super
    # admin. The account exists and cannot sign in until approved.
    pending_approval: bool = False


@router.post("/users", response_model=CreatedUser, status_code=status.HTTP_201_CREATED)
async def create_platform_user(
    payload: PlatformUserCreate, session: DbSession, admin: RequireAdmin
) -> CreatedUser:
    """Create an account from the console.

    Public signup exists and always will; this is for the cases it does not
    cover — a colleague who needs an admin account, a student being set up by
    someone else, an account recreated after a mistake.
    """
    _may_assign(admin, payload.role)

    # The organisation, checked before the account exists rather than after.
    organization_id = None
    if payload.role is UserRole.ORG_ADMIN:
        if payload.organization_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Name the organisation this administrator belongs to.",
            )
        from app.models.organization import Organization

        organization = await session.get(Organization, payload.organization_id)
        if organization is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="That organisation does not exist.",
            )
        organization_id = organization.id
    elif payload.organization_id is not None:
        # Silently ignoring it would create a platform account quietly stamped
        # with a customer's id — which is the exact shape that let a tenant
        # reach a platform account through its own member list.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only an organisation administrator belongs to an organisation.",
        )

    email = payload.email.lower().strip()
    if await session.scalar(select(User).where(User.email == email)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists.",
        )

    # THE SAME RULE AS PUBLIC SIGN-UP. `validate_password` on `UserManager`
    # only runs on the fastapi-users routes; this one builds the User itself,
    # so without this an admin could set a one-character password on somebody
    # else's account — and that person has no way to know it is weak.
    try:
        passwords.check(payload.password, email=email, name=payload.name)
    except passwords.WeakPassword as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    # A PLATFORM ADMIN'S NEW ORGANISATION ADMIN WAITS for a super admin (role
    # model of 2026-10-01): made switched off, approved on /admin/approvals.
    waits = approvals.needs_approval(admin, payload.role)

    user = User(
        name=payload.name.strip(),
        email=email,
        hashed_password=password_helper.hash(payload.password),
        role=payload.role,
        phone=(payload.phone or "").strip() or None,
        is_active=not waits,
        # An admin vouched for them, and there is no mail provider to verify
        # through — the same reasoning as the organization portal.
        is_verified=True,
        is_superuser=payload.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN),
        organization_id=organization_id,
    )
    # THE UNIQUE INDEX IS THE ONLY THING THAT CAN DECIDE THIS.
    #
    # There is a check for the address a few lines above, and it is worth
    # keeping — it gives a clean message without a wasted round trip. What it
    # cannot do is win a race: two admins creating the same person at the same
    # moment both read "that email is free", both insert, and `ix_users_email`
    # refuses the second. That was a 500 for whoever lost, on a form they had
    # filled in correctly. Verified before this fix.
    async with conflicts.as_conflict(
        session, default="An account with that email already exists."
    ):
        session.add(user)
        await session.flush()

    # Deduped, exactly as `set_enrollments` does two hundred lines below. Sending
    # the same id twice produced two identical rows, `uq_enrollments_user_course`
    # refused the second, and the whole request came back 500 with no account
    # created and nothing on screen to explain it. Verified before this fix.
    for course_id in dict.fromkeys(payload.course_ids):
        course = await session.get(Course, course_id)
        # Silently skipping would enrol them in fewer courses than the admin
        # asked for and say nothing.
        if course is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One of those courses does not exist.",
            )
        # Said as it is, the same sentence `set_enrollments` uses. "Does not
        # exist" about a course that is plainly on the screen is what this
        # used to answer.
        if course.organization_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "One of those courses is an organisation's own training. "
                    "Only public courses can be given from here."
                ),
            )
        session.add(Enrollment(user_id=user.id, course_id=course_id))

    if waits and organization_id is not None:
        try:
            await approvals.request(
                session,
                user=user,
                organization_id=organization_id,
                kind=ApprovalKind.NEW_ACCOUNT,
                actor=admin,
            )
        except approvals.ApprovalError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None

    await audit.record(
        session,
        action=AuditAction.USER_CREATED,
        actor=admin,
        target_type="user",
        target_id=user.id,
        metadata={
            "role": user.role.value,
            "courses": len(set(payload.course_ids)),
            "organization": str(organization_id) if organization_id else None,
        },
    )
    # The enrolments added above carry their own unique index, so the commit
    # needs the same floor as the insert did.
    async with conflicts.as_conflict(
        session, default="That account could not be created."
    ):
        await session.commit()

    return CreatedUser(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role.value,
        is_active=user.is_active,
        pending_approval=waits,
    )


@router.patch("/users/{user_id}", response_model=CreatedUser)
async def update_platform_user(
    user_id: uuid.UUID,
    payload: PlatformUserUpdate,
    session: DbSession,
    admin: RequireAdmin,
) -> CreatedUser:
    """Edit a user's name, email or phone.

    Email is editable now. It was not, on the reasoning that changing the
    sign-in identifier locks somebody out of an account they still hold — but
    the case that actually happened is the opposite one: an address typed wrong
    when the account was created, and nobody able to sign in at all. It is
    changed here with both values recorded, and the console warns before saving.

    Not here: the role, which has its own endpoint behind a stricter gate, and
    `is_active`, which has its own route (`POST /admin/users/{id}/active`).
    """
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )
    _manageable(admin, user)

    # A SUPER ADMIN MAY EDIT ANOTHER SUPER ADMIN since 2026-10-01, the user's
    # decision: "Super Admin can do everything". It was refused before (issue
    # 5), because the address is the sign-in and editing it hands the account
    # over. Both addresses still go into the trail below. A platform admin
    # never reaches a super admin here: `_manageable` answers 404.

    changed: dict[str, Any] = {}
    if payload.name is not None:
        user.name = payload.name.strip()
        changed["name"] = user.name
    if "phone" in payload.model_fields_set:
        user.phone = (payload.phone or "").strip() or None
        changed["phone"] = "set" if user.phone else "cleared"

    if payload.email is not None:
        address = str(payload.email).strip().lower()
        if address != user.email.lower():
            # Refused rather than caught: `users.email` is unique, and an
            # IntegrityError here would surface as a 500 on a mistake the
            # operator can fix in two seconds.
            taken = await session.scalar(
                select(User.id).where(
                    func.lower(User.email) == address, User.id != user.id
                )
            )
            if taken is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Another account already uses that address.",
                )
            # BOTH VALUES in the trail. "Email changed" alone cannot answer
            # "what was it before", which is the question asked when somebody
            # says they can no longer sign in.
            changed["email_from"] = user.email
            changed["email_to"] = address
            user.email = address

    if changed:
        await audit.record_safely(
            session,
            action="admin.user_updated",
            actor=admin,
            target_type="user",
            target_id=user.id,
            metadata=changed,
        )
    await session.commit()

    return CreatedUser(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role.value,
        is_active=user.is_active,
    )


@router.delete("/users/{user_id}", response_model=UserRemoval)
async def remove_platform_user(
    user_id: uuid.UUID,
    session: DbSession,
    admin: RequireAdmin,
    reason: str = Query(
        default="",
        max_length=2_000,
        description="Why. Kept on the customer's deletion record.",
    ),
) -> UserRemoval:
    """Delete an account, public or a customer's: deleted, or closed if it has history.

    Platform staff. It was super admin only until the role model of
    2026-10-01 gave platform admins the same work; they still cannot remove
    the staff above them, which `_manageable` answers with a 404.

    A CUSTOMER'S ACCOUNT is deleted at once too, since 2026-10-01: platform
    staff delete inside a customer directly, and it is the customer's own
    people who ask (`deletions.acts_directly`). It still leaves a deletion
    request, raised and approved in the same moment, so that customer's
    history says who removed the person and why, and the organisation's
    admin floor holds.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot remove your own account.",
        )
    _manageable(admin, user)

    # Was a blanket refusal. Now the floor: the last super admin cannot go, and
    # any other one can: the same rule demotion uses, so the two screens do not
    # disagree about who is removable. The organisation's floor likewise.
    await assert_super_admin_floor(session, user)
    await _assert_org_floor_holds(session, user)

    organization = (
        await session.get(Organization, user.organization_id)
        if user.organization_id is not None
        else None
    )
    if organization is not None:
        try:
            await deletions.record_direct(
                session,
                organization=organization,
                target_type=DeletionTarget.MEMBER,
                target_id=user.id,
                target_label=f"{user.name} ({user.email})",
                actor=admin,
                reason=reason or "Removed by platform staff.",
            )
        except deletions.DeletionError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None

    removal = await accounts.remove_account(session, user)
    await audit.record(
        session,
        action="admin.user_removed",
        actor=admin,
        # A customer's person shows up in that customer's own activity log.
        organization_id=organization.id if organization is not None else None,
        target_type="user",
        target_id=user_id,
        metadata={"outcome": removal.outcome},
    )
    await session.commit()
    return UserRemoval(outcome=removal.outcome, explanation=removal.explanation)


class EnrollmentSet(BaseModel):
    course_ids: list[uuid.UUID]


@router.get("/users/{user_id}/enrollments", response_model=list[uuid.UUID])
async def get_enrollments(
    user_id: uuid.UUID, session: DbSession, admin: RequireAdmin
) -> list[uuid.UUID]:
    """Which courses this person is enrolled in, as ids.

    The PUT below is DECLARATIVE — it sets the whole list — so any screen
    offering those checkboxes has to know what is already ticked before the
    operator touches anything. There was no reader, so the console opened every
    editor empty, and ticking one new course deleted every other enrolment the
    student had. Reported as issues 69 and 70.

    Ids only. The console already holds the titles from `/admin/courses`, and a
    second copy here is a second thing to keep in step.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )
    # READ, so `_visible`. What a customer's member is enrolled in is part of
    # the customer's data a platform admin may see; `set_enrollments` below is
    # the write, and it keeps the narrower guard.
    _visible(admin, user)

    return sorted(
        (
            await session.scalars(
                select(Enrollment.course_id).where(Enrollment.user_id == user_id)
            )
        ).all()
    )


@router.put("/users/{user_id}/enrollments", response_model=list[uuid.UUID])
async def set_enrollments(
    user_id: uuid.UUID,
    payload: EnrollmentSet,
    session: DbSession,
    admin: RequireAdmin,
) -> list[uuid.UUID]:
    """Set exactly which courses a user is enrolled in.

    Declarative rather than add/remove endpoints: the screen shows a list of
    checkboxes, and sending the whole list back is the only version that cannot
    drift from what is on screen.

    Removing an enrolment does NOT delete their progress. If they are enrolled
    again, they pick up where they left off — losing someone's completed
    modules because an admin unticked a box for a moment would be unforgivable.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )
    _manageable(admin, user)

    # A COMPANY'S PEOPLE ARE TRAINED INSIDE THE COMPANY. This route only takes
    # public courses, and somebody in an organisation can only ever open their
    # own organisation's, so nothing sent here could be used by them. The
    # console offered the button anyway: their current company course came up
    # ticked, and every save failed with "one of those courses does not exist".
    if user.organization_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{user.name} belongs to an organisation. Their training is "
                "assigned inside that organisation, not from here."
            ),
        )

    wanted = set(payload.course_ids)
    if wanted:
        rows = (
            await session.execute(
                select(Course.id, Course.organization_id).where(Course.id.in_(wanted))
            )
        ).all()
        if len(rows) != len(wanted):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One of those courses does not exist.",
            )
        # Said as it is. "Does not exist" about a course that plainly does, and
        # is on the screen, is what the old message told the super admin.
        if any(org_id is not None for _, org_id in rows):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "One of those courses is an organisation's own training. "
                    "Only public courses can be given from here."
                ),
            )

    current = {
        row.course_id: row
        for row in (
            await session.scalars(
                select(Enrollment).where(Enrollment.user_id == user_id)
            )
        ).all()
    }

    for course_id in wanted - current.keys():
        session.add(Enrollment(user_id=user_id, course_id=course_id))
    for course_id in current.keys() - wanted:
        await session.delete(current[course_id])

    await audit.record_safely(
        session,
        action="admin.enrollments_set",
        actor=admin,
        target_type="user",
        target_id=user_id,
        metadata={"courses": len(wanted)},
    )
    await session.commit()
    return sorted(wanted)


# ---------------------------------------------------------------------------
# One person, completely
# ---------------------------------------------------------------------------


class CourseProgress(BaseModel):
    course_id: uuid.UUID
    course_title: str
    enrolled_at: datetime | None
    modules_total: int
    modules_completed: int
    modules_in_progress: int
    percent: int
    last_activity_at: datetime | None
    # Decision: what they paid and when, and when it runs out. Null expiry on a
    # course bought outright is not "unknown" — it genuinely never expires.
    purchased_at: datetime | None
    expires_at: datetime | None
    access_via: str  # purchase | subscription | free | enrolled


class QuizRecord(BaseModel):
    module_id: uuid.UUID
    module_title: str
    course_title: str
    questions: int
    attempts: int
    best_score: float | None
    last_attempt_at: datetime | None
    #: The question the original spec asks for by name — has this person taken it at all.
    taken: bool


class AssignmentRecord(BaseModel):
    assignment_id: uuid.UUID
    title: str
    module_title: str
    attempts: int
    best_score: float | None
    last_submitted_at: datetime | None


class CertAttemptRecord(BaseModel):
    attempt_number: int
    # Numeric(5, 2) in the database, so a fractional score is normal — 4 right
    # out of 9 is 44.44. Typed `int` this 500'd on the first real attempt.
    score: float
    passed: bool
    taken_at: datetime


class CertificationRecord(BaseModel):
    exam_id: uuid.UUID
    exam_title: str
    course_title: str
    used_attempts: int
    allowed_attempts: int
    extra_granted: int
    best_score: float | None
    passed: bool
    certificate_id: uuid.UUID | None
    certificate_issued_at: datetime | None
    attempts: list[CertAttemptRecord]


class SessionRecord(BaseModel):
    id: uuid.UUID
    module_title: str | None
    course_title: str | None
    started_at: datetime
    ended_at: datetime | None
    minutes: int


class ActivityRecord(BaseModel):
    action: str
    created_at: datetime
    ip_address: str | None
    user_agent: str | None
    target_type: str | None
    metadata: dict[str, Any] | None


class UserDossier(BaseModel):
    """Everything the console knows about one person, in one response.

    One request rather than nine. An admin looking at a support ticket needs
    the whole picture, and nine round trips is nine chances to render half a
    page — the same reasoning as the audit facets endpoint.
    """

    id: uuid.UUID
    name: str
    email: str
    phone: str | None
    role: str
    is_active: bool
    created_at: datetime

    organization_name: str | None
    branch_name: str | None
    department_name: str | None

    # Headline counts, so the top of the screen does not require reading the
    # tables underneath it.
    total_courses: int
    total_modules_completed: int
    total_quiz_attempts: int
    total_assignments: int
    certificates_earned: int
    certification_attempts: int
    voice_sessions: int
    voice_minutes: int
    #: Seconds as well, so a short session is not shown as 0 minutes.
    voice_seconds: int = 0
    last_login_at: datetime | None
    last_logout_at: datetime | None
    login_count: int

    courses: list[CourseProgress]
    quizzes: list[QuizRecord]
    assignments: list[AssignmentRecord]
    certifications: list[CertificationRecord]
    sessions: list[SessionRecord]
    activity: list[ActivityRecord]


_DURATION = func.extract(
    "epoch", func.coalesce(VoiceSession.ended_at, VoiceSession.started_at)
) - func.extract("epoch", VoiceSession.started_at)


@router.get("/users/{user_id}/dossier", response_model=UserDossier)
async def user_dossier(
    user_id: uuid.UUID,
    session: DbSession,
    admin: RequireAdmin,
    activity_limit: int = Query(default=100, ge=1, le=500),
) -> UserDossier:
    """The complete record for one person."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )
    # READ. The whole record of one person — enrolments, progress, tutor use,
    # orders. For a customer's member this is the screen support actually needs,
    # and none of it changes anything.
    _visible(admin, user)

    organization = (
        await session.get(Organization, user.organization_id)
        if user.organization_id
        else None
    )
    branch = await session.get(Branch, user.branch_id) if user.branch_id else None
    department = (
        await session.get(Department, user.department_id)
        if user.department_id
        else None
    )

    # ---- courses and progress -------------------------------------------
    enrolments = {
        row.course_id: row
        for row in (
            await session.scalars(
                select(Enrollment).where(Enrollment.user_id == user_id)
            )
        ).all()
    }

    module_totals = dict(
        (
            await session.execute(
                select(Module.course_id, func.count()).group_by(Module.course_id)
            )
        ).all()
    )

    progress_rows = (
        await session.execute(
            select(
                Module.course_id,
                ModuleProgress.status,
                func.count(),
                func.max(ModuleProgress.updated_at),
            )
            .join(Module, Module.id == ModuleProgress.module_id)
            .where(ModuleProgress.user_id == user_id)
            .group_by(Module.course_id, ModuleProgress.status)
        )
    ).all()

    by_course: dict[uuid.UUID, dict[str, Any]] = {}
    for course_id, state, count, last in progress_rows:
        entry = by_course.setdefault(
            course_id, {"completed": 0, "in_progress": 0, "last": None}
        )
        if state is ProgressStatus.COMPLETED:
            entry["completed"] += count
        elif state is ProgressStatus.IN_PROGRESS:
            entry["in_progress"] += count
        if last and (entry["last"] is None or last > entry["last"]):
            entry["last"] = last

    # What they paid, and when it runs out. A course bought outright has a
    # purchase date and no expiry; a subscription has both.
    paid_orders = {
        row.course_id: row
        for row in (
            await session.scalars(
                select(Order)
                .where(
                    Order.user_id == user_id,
                    Order.status == OrderStatus.PAID,
                    Order.course_id.is_not(None),
                )
                .order_by(Order.paid_at.desc().nullslast())
            )
        ).all()
    }

    subscription_courses: dict[uuid.UUID, Subscription] = {}
    subscriptions = (
        await session.scalars(
            select(Subscription).where(
                Subscription.user_id == user_id,
                Subscription.status == SubscriptionStatus.ACTIVE,
            )
        )
    ).all()
    for subscription in subscriptions:
        for course_id in (
            await session.scalars(
                select(PlanCourse.course_id).where(
                    PlanCourse.plan_id == subscription.plan_id
                )
            )
        ).all():
            subscription_courses.setdefault(course_id, subscription)

    course_ids = set(enrolments) | set(paid_orders) | set(subscription_courses)
    course_titles = (
        dict(
            (
                await session.execute(
                    select(Course.id, Course.title).where(
                        Course.id.in_(course_ids or {None})
                    )
                )
            ).all()
        )
        if course_ids
        else {}
    )
    course_prices = (
        dict(
            (
                await session.execute(
                    select(Course.id, Course.price_minor).where(
                        Course.id.in_(course_ids or {None})
                    )
                )
            ).all()
        )
        if course_ids
        else {}
    )

    courses: list[CourseProgress] = []
    for course_id in course_ids:
        stats = by_course.get(
            course_id, {"completed": 0, "in_progress": 0, "last": None}
        )
        total = module_totals.get(course_id, 0)
        order = paid_orders.get(course_id)
        subscription = subscription_courses.get(course_id)
        if order is not None:
            purchased, expires, via = (
                order.paid_at or order.created_at,
                None,
                "purchase",
            )
        elif subscription is not None:
            purchased = subscription.created_at
            expires = subscription.current_period_end
            via = "subscription"
        elif not course_prices.get(course_id):
            purchased, expires, via = None, None, "free"
        else:
            purchased, expires, via = None, None, "enrolled"

        enrolment = enrolments.get(course_id)
        courses.append(
            CourseProgress(
                course_id=course_id,
                course_title=course_titles.get(course_id, "(deleted course)"),
                enrolled_at=enrolment.enrolled_at if enrolment else None,
                modules_total=total,
                modules_completed=stats["completed"],
                modules_in_progress=stats["in_progress"],
                percent=round(stats["completed"] * 100 / total) if total else 0,
                last_activity_at=stats["last"],
                purchased_at=purchased,
                expires_at=expires,
                access_via=via,
            )
        )
    courses.sort(key=lambda row: row.course_title)

    # ---- quizzes ---------------------------------------------------------
    question_counts = dict(
        (
            await session.execute(
                select(QuizQuestion.module_id, func.count()).group_by(
                    QuizQuestion.module_id
                )
            )
        ).all()
    )
    attempt_rows = {
        row[0]: row[1:]
        for row in (
            await session.execute(
                select(
                    QuizAttempt.module_id,
                    func.count(),
                    func.max(QuizAttempt.score),
                    func.max(QuizAttempt.ts),
                )
                .where(QuizAttempt.user_id == user_id)
                .group_by(QuizAttempt.module_id)
            )
        ).all()
    }

    # Every module on their courses that HAS a quiz, plus any module they have
    # attempted. The second half matters: a quiz they sat on a course they have
    # since been unenrolled from is still part of their record.
    modules_on_their_courses: set[uuid.UUID] = set()
    if course_ids:
        modules_on_their_courses = set(
            (
                await session.scalars(
                    select(Module.id).where(Module.course_id.in_(course_ids))
                )
            ).all()
        )
    quiz_module_ids = (set(question_counts) & modules_on_their_courses) | set(
        attempt_rows
    )

    quizzes: list[QuizRecord] = []
    if quiz_module_ids:
        module_rows = (
            await session.execute(
                select(Module.id, Module.title, Course.title)
                .join(Course, Course.id == Module.course_id)
                .where(Module.id.in_(quiz_module_ids))
                .order_by(Course.title, Module.order)
            )
        ).all()
        for module_id, module_title, course_title in module_rows:
            count, best, last = attempt_rows.get(module_id, (0, None, None))
            quizzes.append(
                QuizRecord(
                    module_id=module_id,
                    module_title=module_title,
                    course_title=course_title,
                    questions=question_counts.get(module_id, 0),
                    attempts=count,
                    best_score=best,
                    last_attempt_at=last,
                    taken=count > 0,
                )
            )

    # ---- assignments -----------------------------------------------------
    assignment_rows = (
        await session.execute(
            select(
                Assignment.id,
                Assignment.title,
                Module.title,
                func.count(AssignmentSubmission.id),
                func.max(AssignmentSubmission.score),
                func.max(AssignmentSubmission.submitted_at),
            )
            .join(Module, Module.id == Assignment.module_id)
            .join(
                AssignmentSubmission,
                (AssignmentSubmission.assignment_id == Assignment.id)
                & (AssignmentSubmission.user_id == user_id),
            )
            .group_by(Assignment.id, Assignment.title, Module.title)
            .order_by(Assignment.title)
        )
    ).all()
    assignments = [
        AssignmentRecord(
            assignment_id=row[0],
            title=row[1],
            module_title=row[2],
            attempts=row[3],
            best_score=row[4],
            last_submitted_at=row[5],
        )
        for row in assignment_rows
    ]

    # ---- certification ---------------------------------------------------
    exam_ids = set(
        (
            await session.scalars(
                select(CertAttempt.cert_exam_id).where(CertAttempt.user_id == user_id)
            )
        ).all()
    )
    if course_ids:
        exam_ids |= set(
            (
                await session.scalars(
                    select(CertExam.id).where(CertExam.course_id.in_(course_ids))
                )
            ).all()
        )

    certifications: list[CertificationRecord] = []
    for exam_id in exam_ids:
        exam = await session.get(CertExam, exam_id)
        if exam is None:
            continue
        course = await session.get(Course, exam.course_id)
        attempts = (
            await session.scalars(
                select(CertAttempt)
                .where(
                    CertAttempt.user_id == user_id,
                    CertAttempt.cert_exam_id == exam_id,
                )
                .order_by(CertAttempt.attempt_number)
            )
        ).all()
        # Straight from the service the exam itself uses. Two implementations
        # of the attempt rule is exactly how a console comes to tell a student
        # something different from the screen they are sitting the exam on.
        allowance = await certification.get_allowance(session, user_id, exam_id)
        certificate = await session.scalar(
            select(Certificate).where(
                Certificate.user_id == user_id, Certificate.cert_exam_id == exam_id
            )
        )
        certifications.append(
            CertificationRecord(
                exam_id=exam_id,
                exam_title=exam.title,
                course_title=course.title if course else "(deleted course)",
                used_attempts=allowance.used_attempts,
                allowed_attempts=allowance.allowed_attempts,
                extra_granted=allowance.granted_attempts,
                best_score=max((a.score for a in attempts), default=None),
                passed=any(a.passed for a in attempts),
                certificate_id=certificate.id if certificate else None,
                certificate_issued_at=certificate.issued_at if certificate else None,
                attempts=[
                    CertAttemptRecord(
                        attempt_number=a.attempt_number,
                        score=a.score,
                        passed=a.passed,
                        taken_at=a.ts,
                    )
                    for a in attempts
                ],
            )
        )
    certifications.sort(key=lambda row: (row.course_title, row.exam_title))

    # ---- voice sessions --------------------------------------------------
    session_rows = (
        await session.execute(
            select(VoiceSession, Module.title, Course.title)
            .outerjoin(Module, Module.id == VoiceSession.module_id)
            .outerjoin(Course, Course.id == Module.course_id)
            .where(VoiceSession.user_id == user_id)
            .order_by(VoiceSession.started_at.desc())
            .limit(100)
        )
    ).all()
    sessions = [
        SessionRecord(
            id=row[0].id,
            module_title=row[1],
            course_title=row[2],
            started_at=row[0].started_at,
            ended_at=row[0].ended_at,
            minutes=(
                int((row[0].ended_at - row[0].started_at).total_seconds() // 60)
                if row[0].ended_at
                else 0
            ),
        )
        for row in session_rows
    ]
    total_seconds = await session.scalar(
        select(func.coalesce(func.sum(_DURATION), 0)).where(
            VoiceSession.user_id == user_id
        )
    )

    # ---- activity, logins and logouts ------------------------------------
    events = (
        await session.scalars(
            select(AuditEvent)
            .where(AuditEvent.actor_user_id == user_id)
            .order_by(AuditEvent.created_at.desc())
            .limit(activity_limit)
        )
    ).all()
    activity = [
        ActivityRecord(
            action=event.action,
            created_at=event.created_at,
            ip_address=event.ip_address,
            user_agent=event.user_agent,
            target_type=event.target_type,
            metadata=event.meta,
        )
        for event in events
    ]

    last_login = await session.scalar(
        select(func.max(AuditEvent.created_at)).where(
            AuditEvent.actor_user_id == user_id,
            AuditEvent.action == AuditAction.LOGIN,
        )
    )
    last_logout = await session.scalar(
        select(func.max(AuditEvent.created_at)).where(
            AuditEvent.actor_user_id == user_id,
            AuditEvent.action == AuditAction.LOGOUT,
        )
    )
    login_count = await session.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(
            AuditEvent.actor_user_id == user_id,
            AuditEvent.action == AuditAction.LOGIN,
        )
    )

    return UserDossier(
        id=user.id,
        name=user.name,
        email=user.email,
        phone=user.phone,
        role=user.role.value,
        is_active=user.is_active,
        created_at=user.created_at,
        organization_name=organization.name if organization else None,
        branch_name=branch.name if branch else None,
        department_name=department.name if department else None,
        total_courses=len(courses),
        total_modules_completed=sum(row.modules_completed for row in courses),
        total_quiz_attempts=sum(row.attempts for row in quizzes),
        total_assignments=sum(row.attempts for row in assignments),
        certificates_earned=sum(1 for row in certifications if row.certificate_id),
        certification_attempts=sum(row.used_attempts for row in certifications),
        voice_sessions=len(sessions),
        voice_minutes=int(total_seconds or 0) // 60,
        voice_seconds=int(total_seconds or 0),
        last_login_at=last_login,
        last_logout_at=last_logout,
        login_count=login_count or 0,
        courses=courses,
        quizzes=quizzes,
        assignments=assignments,
        certifications=certifications,
        sessions=sessions,
        activity=activity,
    )


# ---------------------------------------------------------------------------
# Extending how long somebody keeps a course
# ---------------------------------------------------------------------------


class ExtensionRequest(BaseModel):
    """More time on one course, or on everything in a plan."""

    course_id: uuid.UUID | None = None
    plan_id: uuid.UUID | None = None
    extends_to: datetime
    reason: str | None = Field(default=None, max_length=500)


class ExtensionRow(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID | None
    course_title: str | None
    plan_id: uuid.UUID | None
    plan_name: str | None
    extends_to: datetime
    granted_by_name: str | None
    reason: str | None
    created_at: datetime


@router.post(
    "/users/{user_id}/extensions",
    response_model=ExtensionRow,
    status_code=status.HTTP_201_CREATED,
)
async def grant_extension(
    user_id: uuid.UUID,
    payload: ExtensionRequest,
    session: DbSession,
    admin: RequireAdmin,
) -> ExtensionRow:
    """Give somebody longer on a course, or on a whole plan.

    A GRANT, not an edit to their expiry. `access_extensions` records who, when
    and why, exactly as `attempt_grants` does for certification attempts
    (decision 24) — an expiry column that is simply overwritten cannot answer
    "who gave them another three months", which is the question asked later.

    Extensions only ever push a date LATER (`extensions.apply`), so a mistyped
    grant cannot take away access somebody already had.
    """
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )
    _manageable(admin, user)

    # Exactly one target, matching the CHECK constraint on the table. Caught
    # here so the caller gets a sentence rather than an IntegrityError.
    if (payload.course_id is None) == (payload.plan_id is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name either a course or a plan, not both and not neither.",
        )

    # A date in the past is not an extension; it is a typo that would look like
    # one on the screen and do nothing.
    if payload.extends_to <= datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That date has already passed. Pick one in the future.",
        )

    course = None
    plan = None
    if payload.course_id is not None:
        course = await session.get(Course, payload.course_id)
        if course is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
            )
    else:
        plan = await session.get(SubscriptionPlan, payload.plan_id)
        if plan is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found."
            )

    extension = AccessExtension(
        user_id=user_id,
        course_id=payload.course_id,
        plan_id=payload.plan_id,
        extends_to=payload.extends_to,
        granted_by=admin.id,
        reason=(payload.reason or "").strip() or None,
    )
    session.add(extension)
    await session.flush()

    # `record`, not `record_safely`: handing somebody access they had run out of
    # is a change to what they are entitled to, and it shares the transaction so
    # the grant and its record land together or not at all.
    await audit.record(
        session,
        action="admin.access_extended",
        actor=admin,
        target_type="user",
        target_id=user_id,
        metadata={
            "until": payload.extends_to.date().isoformat(),
            "course": str(payload.course_id) if payload.course_id else None,
            "plan": str(payload.plan_id) if payload.plan_id else None,
        },
    )
    await session.commit()

    return ExtensionRow(
        id=extension.id,
        course_id=extension.course_id,
        course_title=course.title if course else None,
        plan_id=extension.plan_id,
        plan_name=plan.name if plan else None,
        extends_to=extension.extends_to,
        granted_by_name=admin.name,
        reason=extension.reason,
        created_at=extension.created_at,
    )


@router.get("/users/{user_id}/extensions", response_model=list[ExtensionRow])
async def list_extensions(
    user_id: uuid.UUID, session: DbSession, admin: RequireAdmin
) -> list[ExtensionRow]:
    """Every extension this person has been given, newest first."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found."
        )
    # READ. `grant_extension` is the write and keeps `_manageable`.
    _visible(admin, user)

    granter = User.__table__.alias("granter")
    rows = (
        await session.execute(
            select(AccessExtension, Course.title, SubscriptionPlan.name, granter.c.name)
            .outerjoin(Course, Course.id == AccessExtension.course_id)
            .outerjoin(SubscriptionPlan, SubscriptionPlan.id == AccessExtension.plan_id)
            .outerjoin(granter, granter.c.id == AccessExtension.granted_by)
            .where(AccessExtension.user_id == user_id)
            .order_by(AccessExtension.created_at.desc())
        )
    ).all()

    return [
        ExtensionRow(
            id=extension.id,
            course_id=extension.course_id,
            course_title=course_title,
            plan_id=extension.plan_id,
            plan_name=plan_name,
            extends_to=extension.extends_to,
            granted_by_name=granted_by_name,
            reason=extension.reason,
            created_at=extension.created_at,
        )
        for extension, course_title, plan_name, granted_by_name in rows
    ]
