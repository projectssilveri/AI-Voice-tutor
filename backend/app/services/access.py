"""Who may use a course.

ONE function answers this — `can_access_course`. Every route that gates paid
material calls it, so there is a single place to read when asking "why could
this student open that?", and a single place to change when the rules move.

The rule:

    a course is accessible if
        it is free (price_minor == 0),
     or the student holds a PAID order for it,
     or an active subscription whose plan covers it,
     or they are staff,
     or checkout is switched off and they are enrolled in it.

`status = 'paid'` is set only after a signature has been verified server-side
(see `services/payments.py`). Nothing here trusts a value the browser sent.

Enrolment is deliberately NOT part of this. Enrolment says "I am taking this";
access says "I am allowed to". Keeping them apart is what lets a paid student
unenrol and re-enrol without buying the course twice.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.certification import CertExam
from app.models.course import Course, Module
from app.models.enrollment import Enrollment
from app.models.material import ModuleMaterial
from app.models.order import Order, OrderStatus
from app.models.quiz import QuizQuestion
from app.models.subscription import PlanCourse, Subscription, SubscriptionStatus
from app.models.user import User, UserRole
from app.services import limits

#: Platform staff. THIS SET BYPASSES THE PAYWALL, which is why TEACHER being
#: in it mattered: a retired role nobody could see on any screen was handing
#: out every paid course for nothing. Migration 0025 took it away.
STAFF_ROLES = {UserRole.ADMIN, UserRole.SUPER_ADMIN}

#: Roles that run an ORGANIZATION, as opposed to the platform. Deliberately a
#: separate set from STAFF_ROLES: that one means "platform staff" and is what
#: bypasses the paywall, which an organization role must never do.
#:
#: DEPT_ADMIN is here because they author their department's training and
#: cannot open what they are writing otherwise. It does NOT widen what they
#: see: the department wall in `tenancy_decision` and
#: `limits.visible_department_ids` is applied to them exactly as to a learner,
#: so being staff here means "sees their own drafts", not "sees everyone's".
ORG_STAFF_ROLES = {UserRole.ORG_ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEPT_ADMIN}


def can_see_drafts(user: User, course: Course) -> bool:
    """Whether this person may open an unpublished course.

    Decision 64: unpublished is "off sale", not "confiscated" — staff still see
    drafts, or an author cannot open what they are writing.

    That was written before organizations existed, and `STAFF_ROLES` holds only
    PLATFORM roles. So an org admin who created a course inside their own
    organization could not then open it: they wrote it, and the product gave
    them a 404. Verified before this existed.

    Scoped to their OWN organization, and checked against the course's owner
    rather than merely the caller's role — an org admin of Acme has no business
    reading Globex's drafts, and `tenancy_decision` refusing them separately is
    not a reason to be sloppy here. The same argument scopes a department admin
    to their own department, one level further in.
    """
    if user.role in STAFF_ROLES:
        return True
    if user.role not in ORG_STAFF_ROLES:
        return False
    if user.organization_id is None or course.organization_id != user.organization_id:
        return False

    # AND THE DEPARTMENT WALL, for a department admin. Their own department's
    # drafts and the company-wide ones; never another department's. Belt and
    # braces — `tenancy_decision` refuses the course a few lines later in the
    # only route that calls this — but the honest expression of the rule
    # belongs in the function that answers the question, not in the ordering of
    # two checks that somebody may one day swap.
    if user.role is UserRole.DEPT_ADMIN and course.department_id is not None:
        return course.department_id == user.department_id

    return True


class CourseLockedError(PermissionError):
    """The course is paid for and this user has not paid for it.

    A domain error rather than an HTTPException so the rule stays testable
    without an HTTP client; routers translate it to 402.
    """

    def __init__(self, course_title: str = "") -> None:
        self.course_title = course_title
        super().__init__("Buy this course, or subscribe, to use it.")


class CourseOutsideTenantError(CourseLockedError):
    """The course belongs to a different organization — or to none.

    A SUBCLASS of CourseLockedError so every existing `except CourseLockedError`
    still catches it and no route accidentally leaks a course by forgetting the
    new type. Routes that want to distinguish it catch this one first.

    The distinction matters at the HTTP layer. Decision 60 established 402 for a
    locked course because it means "this is for sale" and gives the UI a Buy
    button. That is exactly wrong here: an organization's private training is
    not for sale, and offering to sell it would both confuse the learner and
    confirm the course exists. This maps to 404.
    """


@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    # Why, in a form the UI can act on: "free", "purchased", "subscription",
    # "staff", or "payment_required".
    reason: str

    @property
    def requires_payment(self) -> bool:
        return self.reason == "payment_required"


async def has_paid_for_course(
    session: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> bool:
    order = await session.scalar(
        select(Order.id)
        .where(
            Order.user_id == user_id,
            Order.course_id == course_id,
            Order.status == OrderStatus.PAID,
        )
        .limit(1)
    )
    return order is not None


async def subscription_covers_course(
    session: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> bool:
    """An active, unexpired subscription whose plan includes this course.

    Both halves matter: a cancelled subscription that has not reached its
    period end still grants access, and an 'active' row whose period has passed
    does not.
    """
    now = datetime.now(UTC)
    found = await session.scalar(
        select(Subscription.id)
        .join(PlanCourse, PlanCourse.plan_id == Subscription.plan_id)
        .where(
            Subscription.user_id == user_id,
            PlanCourse.course_id == course_id,
            Subscription.status.in_(
                [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]
            ),
            Subscription.current_period_end > now,
        )
        .limit(1)
    )
    return found is not None


async def tenancy_decision(user: User, course: Course) -> AccessDecision | None:
    """The walled garden, applied in BOTH directions.

    Returns a decision when tenancy settles the question, or None when the
    course is public and the caller is public, in which case the ordinary
    payment rules below decide it.

    This runs BEFORE the staff check, and that ordering is the whole point.
    Anybody in `STAFF_ROLES` would otherwise be handed
    `AccessDecision(True, "staff")` for every course on the platform —
    including other customers' private training. Tenancy is not a
    permission that a role can outrank; it is a boundary.

    Two directions, and the second is the one that leaks:

      * An ORG user may only ever reach their own organization's courses.
        Never the marketplace: their employer bought training, not a shop.

      * A PUBLIC user may never reach ANY organization's course. This is the
        direction that leaks, because an org's internal compliance training
        would otherwise appear anywhere a public course can.

    The single exception is a platform SUPER_ADMIN, matching
    `deps.require_org_scope`: support work is real, and it is audited. A
    platform ADMIN is deliberately NOT included — decision 50 keeps customer
    data with revenue and role management, above ordinary admin.
    """
    if user.organization_id is not None:
        if course.organization_id != user.organization_id:
            return AccessDecision(False, "not_in_organization")

        # THE DEPARTMENT WALL, inside the tenant.
        #
        # A course narrowed to one department is training written for those
        # people — payroll procedure, a clinical protocol — and the reason a
        # customer asks for departments at all is so it is not on show to
        # everyone else. Org admins and branch managers see past it by role;
        # so does anyone an admin has flagged `sees_all_departments`, which is
        # how an HR or IT manager gets cross-department sight without being
        # handed a rank they should not have.
        #
        # Refused with the SAME reason as a cross-tenant miss, so the route
        # layer 404s rather than 402s: this is not something for sale, and
        # confirming it exists is the leak.
        if course.department_id is not None:
            visible = await limits.visible_department_ids(user)
            if visible is not None and course.department_id not in visible:
                return AccessDecision(False, "not_in_organization")

        # Inside their own organization everything else is included; the
        # employer has already paid, and there is no marketplace here.
        return AccessDecision(True, "organization")

    if course.organization_id is not None:
        if user.role is UserRole.SUPER_ADMIN:
            return AccessDecision(True, "platform_staff")
        return AccessDecision(False, "not_in_organization")

    return None


async def is_enrolled(
    session: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID
) -> bool:
    found = await session.scalar(
        select(Enrollment.id)
        .where(Enrollment.user_id == user_id, Enrollment.course_id == course_id)
        .limit(1)
    )
    return found is not None


async def can_access_course(
    session: AsyncSession, user: User, course: Course
) -> AccessDecision:
    """The decision. Call this; do not re-derive the rule at the call site."""
    tenancy = await tenancy_decision(user, course)
    if tenancy is not None:
        return tenancy

    if user.role in STAFF_ROLES:
        return AccessDecision(True, "staff")

    if course.price_minor == 0:
        return AccessDecision(True, "free")

    if await has_paid_for_course(session, user.id, course.id):
        return AccessDecision(True, "purchased")

    if await subscription_covers_course(session, user.id, course.id):
        return AccessDecision(True, "subscription")

    # WHILE CHECKOUT IS SWITCHED OFF, AN ENROLMENT IS THE WAY IN.
    #
    # With no Razorpay keys nobody can buy anything, so a paid course reached a
    # student only one way: an admin assigning it. That enrolled them for
    # reading and left the quizzes, assignments and exam locked behind a Buy
    # button that could not work, so the course could never be finished or
    # certified (issue 18). Decided 2026-09-24: until payments are on, being
    # enrolled is enough.
    #
    # It cannot be used to help yourself. Self-enrolment calls this function
    # BEFORE the enrolment exists, so a student still meets "Buy this course"
    # and only an admin can put them in. And it switches itself off: once the
    # Razorpay keys are set, `payments_enabled` is true and a paid course needs
    # a paid order or a subscription again, as it did before.
    if not settings.payments_enabled and await is_enrolled(session, user.id, course.id):
        return AccessDecision(True, "enrolled")

    return AccessDecision(False, "payment_required")


async def require_course_access(
    session: AsyncSession, user: User, course: Course
) -> None:
    """Raise unless this user may use the course. Call before doing work."""
    decision = await can_access_course(session, user, course)
    if not decision.allowed:
        if decision.reason == "not_in_organization":
            raise CourseOutsideTenantError(course.title)
        raise CourseLockedError(course.title)


async def require_access_to_module(
    session: AsyncSession, user: User, module_id: uuid.UUID
) -> None:
    """Same check, starting from a module.

    Quizzes, assignments and voice sessions are all addressed by module, so
    each of them would otherwise have to join back to the course by hand — and
    the one that forgets is the hole.
    """
    course = await session.scalar(
        select(Course)
        .join(Module, Module.course_id == Course.id)
        .where(Module.id == module_id)
    )
    if course is None:
        return  # No such module; the caller's own 404 is the better error.
    await require_course_access(session, user, course)


async def require_access_to_exam(
    session: AsyncSession, user: User, exam: CertExam
) -> None:
    """Same check, starting from a certification exam."""
    course = await session.get(Course, exam.course_id)
    if course is None:
        return
    await require_course_access(session, user, course)


async def require_course_in_tenant(
    session: AsyncSession, user: User, course_id: uuid.UUID
) -> None:
    """Tenancy for the AUTHORING routes. Not the paywall.

    Phase 4 closed the read path and the listings and stopped there, which left
    every write wide open: `PATCH /courses/{id}` and `DELETE /courses/{id}` are
    gated by `require_role(ADMIN)` and nothing else, so an ordinary platform
    admin could rename — and did delete — a customer's private course. Found by
    trying it.

    This is decision 59's lesson repeating: gating the door and forgetting the
    rooms behind it.
    """
    course = await session.get(Course, course_id)
    if course is None:
        return  # The caller's own 404 is the better error.
    decision = await tenancy_decision(user, course)
    if decision is not None and not decision.allowed:
        raise CourseOutsideTenantError(course.title)


async def require_module_in_tenant(
    session: AsyncSession, user: User, module_id: uuid.UUID
) -> None:
    """Tenancy only. Deliberately NOT the paywall.

    Decision 18 rules that reading course material is unlimited — an unenrolled
    student may read every module and only the tutor is gated. That stays true,
    so this must not become `require_access_to_module`, which would paywall the
    reading and break the rule the brief is explicit about.

    But "unlimited" was written for one shared catalogue. Another organization's
    module content is not material this reader is entitled to at any price, so
    tenancy alone is enforced here.
    """
    course = await session.scalar(
        select(Course)
        .join(Module, Module.course_id == Course.id)
        .where(Module.id == module_id)
    )
    if course is None:
        return  # No such module; the caller's own 404 is the better error.
    decision = await tenancy_decision(user, course)
    if decision is not None and not decision.allowed:
        raise CourseOutsideTenantError(course.title)


async def require_material_in_tenant(
    session: AsyncSession, user: User, material_id: uuid.UUID
) -> None:
    """Tenancy for a PDF handout, reached by material id rather than module id.

    `require_module_in_tenant` covers the routes addressed by module. The
    download, extract and delete routes are addressed by material, so they
    reached no check at all — and a handout is the module's content in another
    file format. Measured before this: a public learner with no organization
    listed and downloaded an Acme private compliance PDF.

    Same level as the module text, per decision 98: tenancy, never the paywall.
    Reading course material stays unlimited inside the catalogue you belong to.
    """
    course = await session.scalar(
        select(Course)
        .join(Module, Module.course_id == Course.id)
        .join(ModuleMaterial, ModuleMaterial.module_id == Module.id)
        .where(ModuleMaterial.id == material_id)
    )
    if course is None:
        return  # No such material; the caller's own 404 is the better error.
    decision = await tenancy_decision(user, course)
    if decision is not None and not decision.allowed:
        raise CourseOutsideTenantError(course.title)


async def require_assignment_in_tenant(
    session: AsyncSession, user: User, assignment_id: uuid.UUID
) -> None:
    """Tenancy for an assignment reached by its own id.

    THE SAME GAP `require_material_in_tenant` WAS WRITTEN FOR, in a router
    nobody came back to. Creating an assignment is addressed by module and
    therefore checked; EDITING and DELETING one are addressed by assignment id
    and reached no check at all. So a platform admin could not
    rename a customer's course, but could rewrite and delete the assignments
    inside it — which is the same content through a different door.

    `courses.py` puts it plainly where it does the equivalent check: "an
    ordinary platform admin could rename and delete a customer's private
    training — verified, and it did."
    """
    course = await session.scalar(
        select(Course)
        .join(Module, Module.course_id == Course.id)
        .join(Assignment, Assignment.module_id == Module.id)
        .where(Assignment.id == assignment_id)
    )
    if course is None:
        return  # No such assignment; the caller's own 404 is the better error.
    decision = await tenancy_decision(user, course)
    if decision is not None and not decision.allowed:
        raise CourseOutsideTenantError(course.title)


async def require_submission_in_tenant(
    session: AsyncSession, user: User, submission_id: uuid.UUID
) -> None:
    """Tenancy for a student's submission, reached by submission id.

    This one guards a MARK. Overriding a submission changes what a student
    scored, so reaching it across a tenant boundary means altering a customer's
    training record.
    """
    course = await session.scalar(
        select(Course)
        .join(Module, Module.course_id == Course.id)
        .join(Assignment, Assignment.module_id == Module.id)
        .join(AssignmentSubmission, AssignmentSubmission.assignment_id == Assignment.id)
        .where(AssignmentSubmission.id == submission_id)
    )
    if course is None:
        return
    decision = await tenancy_decision(user, course)
    if decision is not None and not decision.allowed:
        raise CourseOutsideTenantError(course.title)


async def require_question_in_tenant(
    session: AsyncSession, user: User, question_id: uuid.UUID
) -> None:
    """Tenancy for a quiz question reached by its own id.

    Adding a question is addressed by module and checked; deleting one is
    addressed by question id and was not.
    """
    course = await session.scalar(
        select(Course)
        .join(Module, Module.course_id == Course.id)
        .join(QuizQuestion, QuizQuestion.module_id == Module.id)
        .where(QuizQuestion.id == question_id)
    )
    if course is None:
        return
    decision = await tenancy_decision(user, course)
    if decision is not None and not decision.allowed:
        raise CourseOutsideTenantError(course.title)


async def accessible_course_ids(
    session: AsyncSession, user: User
) -> set[uuid.UUID] | None:
    """Every course this user may use, or None meaning "all of them".

    For listings, where calling `can_access_course` per row would be an N+1.
    None rather than a set of everything so callers cannot accidentally treat
    "staff sees all" as "staff sees none".
    """
    # Tenancy first, for the same reason as in `can_access_course`.
    if user.organization_id is not None:
        # Exactly their own organization's courses. Nothing public, nothing
        # anyone else's — regardless of role.
        filters = [Course.organization_id == user.organization_id]

        # AND THE SAME DEPARTMENT WALL THE DETAIL ROUTE APPLIES.
        #
        # Applied here as well as in `can_access_course` because a listing that
        # disagrees with the page it links to is decision 161 all over again:
        # there, the listing filtered correctly and the detail route did not,
        # so a course was simultaneously hidden and readable. Here it would be
        # the reverse — a course listed and then refused — which is a smaller
        # bug and still a bug.
        visible = await limits.visible_department_ids(user)
        if visible is not None:
            filters.append(
                or_(
                    Course.department_id.is_(None),
                    Course.department_id.in_(visible) if visible else false(),
                )
            )

        return set((await session.scalars(select(Course.id).where(*filters))).all())

    if user.role is UserRole.SUPER_ADMIN:
        return None

    if user.role in STAFF_ROLES:
        # Platform staff who are not super admins see the public catalogue and
        # no customer's private training.
        return set(
            (
                await session.scalars(
                    select(Course.id).where(Course.organization_id.is_(None))
                )
            ).all()
        )

    # A public learner. Every branch below is additionally constrained to
    # public courses, so an organization course can never enter this set even
    # if a stray order or plan link pointed at one.
    free = await session.scalars(
        select(Course.id).where(
            Course.price_minor == 0, Course.organization_id.is_(None)
        )
    )
    purchased = await session.scalars(
        select(Order.course_id)
        .join(Course, Course.id == Order.course_id)
        .where(
            Order.user_id == user.id,
            Order.status == OrderStatus.PAID,
            Order.course_id.is_not(None),
            Course.organization_id.is_(None),
        )
    )
    now = datetime.now(UTC)
    subscribed = await session.scalars(
        select(PlanCourse.course_id)
        .join(Subscription, Subscription.plan_id == PlanCourse.plan_id)
        .join(Course, Course.id == PlanCourse.course_id)
        .where(
            Course.organization_id.is_(None),
            Subscription.user_id == user.id,
            Subscription.status.in_(
                [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]
            ),
            Subscription.current_period_end > now,
        )
    )

    return set(free) | set(purchased) | set(subscribed)
