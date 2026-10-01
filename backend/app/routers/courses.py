"""Courses: read for any signed-in user, write for admins only.

Reads are open to every authenticated user rather than enrolment-gated —
the spec is explicit that browsing and re-reading course material is
unlimited. Enrolment governs progress and the voice tutor, not visibility.
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select

from app.deps import CurrentUser, DbSession, RequireAdmin, require_role
from app.models.assignment import Assignment
from app.models.audit import AuditAction
from app.models.certification import CertExam
from app.models.deletion import DeletionTarget
from app.models.material import ModuleMaterial
from app.models.order import Order
from app.models.quiz import QuizQuestion
from app.models.user import UserRole
from app.models.voice import VoiceSession
from app.schemas.course import (
    CourseCreate,
    CourseLimitsUpdate,
    CoursePricingUpdate,
    CourseRead,
    CourseUpdate,
    CourseWithModules,
    ModuleSummary,
)
from app.services import (
    access,
    audit,
    conflicts,
    course_review,
    deletions,
    limits,
    plans,
)
from app.services import courses as course_service
from app.services import enrollments as enrollment_service
from app.services import extensions as extension_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/courses", tags=["courses"])

admin_only = Depends(require_role(UserRole.ADMIN))

# AUTHORING IS PLATFORM STAFF: a super admin or a platform admin. It was super
# admin only (issue 11) until the role model of 2026-10-01 gave platform admins
# the super admin's work, catalogue and prices included. `require_role(ADMIN)`
# widens upwards to include super admins.
#
# The ORGANISATION portal is untouched. An org admin writes their own company's
# training through `/org/{slug}/courses`, a different router with its own scope
# check — what a customer may write about their own business is not this rule's
# business.
platform_staff_only = Depends(require_role(UserRole.ADMIN))



def _speaking_minutes(content: str | None) -> int:
    """Minutes of tutor speech, at ~140 words per minute.

    Duplicated deliberately rather than imported from the public router: these
    two modules are otherwise independent, and the figure is one line.
    """
    words = len((content or "").split())
    return max(1, round(words / 140)) if words else 0


@router.get("", response_model=list[CourseRead])
async def list_courses(session: DbSession, user: CurrentUser) -> list[CourseRead]:
    # Staff author drafts and must see them. A student must not: an unpublished
    # course was still listed here, so unpublishing took a course off the
    # marketing site while leaving it on the screen students actually browse.
    # Platform staff, or somebody running their own organization. An org admin
    # who cannot see their own drafts cannot find the course they are writing.
    is_staff = user.role in access.STAFF_ROLES or user.role in access.ORG_STAFF_ROLES
    rows = await course_service.list_courses_with_counts(
        session,
        include_unpublished=is_staff,
        visible_to_user_id=None if is_staff else user.id,
        # The walled garden. An organization member sees exactly their own
        # organization's courses and nothing from the marketplace — including
        # one who is in STAFF_ROLES and would otherwise be shown every course
        # on the platform by the line above.
        organization_id=user.organization_id,
        # Only platform staff see across tenants, matching `require_org_scope`
        # and `access.tenancy_decision`.
        include_organization_courses=(
            user.organization_id is None and user.role in access.STAFF_ROLES
        ),
        # The department wall. Only meaningful inside an organization — a
        # public learner has no department, and every public course has none
        # either, so passing None keeps their listing exactly as it was.
        visible_department_ids=(
            await limits.visible_department_ids(user)
            if user.organization_id is not None
            else None
        ),
    )
    # What each course's tutor limits RESOLVE to. Resolved here rather than in
    # the browser for the same reason as `suggested_access_days`: the free and
    # paid defaults live in config, and a screen that re-derived them would
    # quietly disagree with the tutor the day one was changed.
    allowances = {
        course.id: await limits.tutor_allowance_for(session, course)
        for course, _ in rows
    }

    # WHICH COURSES END IN AN EXAM. Nothing else on the row implies it, and the
    # authoring screen had no way to say: an owner had to open each course in
    # turn to find out whether finishing it earned a certificate (issue 74).
    # One query for the whole page, not one per row.
    certified: set[uuid.UUID] = set()
    if rows:
        certified = set(
            (
                await session.scalars(
                    select(CertExam.course_id).where(
                        CertExam.course_id.in_([course.id for course, _ in rows])
                    )
                )
            ).all()
        )

    return [
        CourseRead.model_validate(course).model_copy(
            update={
                "module_count": module_count,
                # The suggestion the pricing form offers. Computed here, from
                # `extensions.suggested_days`, rather than re-derived in the
                # browser — one rule, one place.
                "suggested_access_days": extension_service.suggested_days(
                    module_count
                ),
                "effective_ai_sessions_per_module": allowances[
                    course.id
                ].sessions_per_module,
                "effective_ai_session_minutes": allowances[
                    course.id
                ].minutes_per_session,
                "ai_limit_basis": allowances[course.id].basis,
                "has_certification": course.id in certified,
            }
        )
        for course, module_count in rows
    ]


@router.get("/{course_id}", response_model=CourseWithModules)
async def get_course(
    course_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> CourseWithModules:
    try:
        course = await course_service.get_course_with_modules(session, course_id)
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    enrolled = await enrollment_service.is_enrolled(session, user.id, course_id)

    # Same rule as the listing, for the single-course form of the same leak.
    # Someone who already holds the course keeps it — unpublishing is "off
    # sale", not "confiscated".
    if not course.is_published and not access.can_see_drafts(user, course):
        keeps_it = enrolled or await access.has_paid_for_course(
            session, user.id, course_id
        )
        if not keeps_it:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
            )

    progress = await enrollment_service.get_module_progress(session, user.id, course_id)
    decision = await access.can_access_course(session, user, course)

    # A PAYWALL refusal is reported, not enforced, here: decision 18 rules that
    # reading course material is unlimited and only the tutor is gated, so an
    # unpaid course is still readable and `has_access` tells the UI to draw a
    # Buy button.
    #
    # A TENANCY refusal is different in kind and must 404. Another
    # organization's course is not something to be sold, and its modules —
    # titles, structure, and the material behind them — are exactly what the
    # walled garden exists to keep private. Reporting instead of refusing here
    # left the listing correct while the URL still served the content.
    if decision.reason == "not_in_organization":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )

    # What each module contains, so the course page can link straight to the
    # quiz or the assignments. Grouped, not per module: a course with twenty
    # modules would otherwise issue sixty queries to draw one list.
    module_ids = [m.id for m in course.modules]

    async def counts_for(column) -> dict:
        if not module_ids:
            return {}
        rows = await session.execute(
            select(column, func.count()).where(column.in_(module_ids)).group_by(column)
        )
        return {row[0]: row[1] for row in rows}

    quiz_counts = await counts_for(QuizQuestion.module_id)
    assignment_counts = await counts_for(Assignment.module_id)
    material_counts = await counts_for(ModuleMaterial.module_id)

    purchased_at, expires_at, access_via = await enrollment_service.entitlement_dates(
        session, user.id, course
    )

    # HOW MANY TUTOR PLAYS THIS STUDENT HAS USED, per module. One grouped
    # query, not one per module: the same N+1 the counts above avoid.
    plays_used: dict[uuid.UUID, int] = {}
    if module_ids:
        plays_used = dict(
            (
                await session.execute(
                    select(VoiceSession.module_id, func.count())
                    .where(
                        VoiceSession.module_id.in_(module_ids),
                        VoiceSession.user_id == user.id,
                    )
                    .group_by(VoiceSession.module_id)
                )
            ).all()
        )

    allowance = await limits.tutor_allowance_for(session, course)

    return CourseWithModules(
        id=course.id,
        title=course.title,
        description=course.description,
        created_at=course.created_at,
        updated_at=course.updated_at,
        price_minor=course.price_minor,
        currency=course.currency,
        is_published=course.is_published,
        enrolled=enrolled,
        has_access=decision.allowed,
        access_reason=decision.reason,
        purchased_at=purchased_at,
        expires_at=expires_at,
        access_via=access_via,
        # THE REVIEW STATE. This response is built field by field rather than
        # validated off the ORM row, so anything not named here silently falls
        # back to the schema default — and the defaults are "draft" and no
        # note. The author's own course page is exactly where the rejection has
        # to show up, and it was reporting every course as an untouched draft.
        review_status=course.review_status.value,
        submitted_at=course.submitted_at,
        reviewed_at=course.reviewed_at,
        review_note=course.review_note,
        ai_sessions_per_module=course.ai_sessions_per_module,
        ai_session_minutes=course.ai_session_minutes,
        effective_ai_sessions_per_module=allowance.sessions_per_module,
        effective_ai_session_minutes=allowance.minutes_per_session,
        ai_limit_basis=allowance.basis,
        modules=[
            ModuleSummary(
                id=module.id,
                course_id=module.course_id,
                title=module.title,
                order=module.order,
                # Whether the tutor has anything to teach from, without
                # shipping the whole body to render a list.
                has_content=bool(module.content and module.content.strip()),
                status=(
                    progress[module.id].status.value
                    if module.id in progress
                    else "not_started"
                ),
                estimated_minutes=_speaking_minutes(module.content),
                quiz_questions=quiz_counts.get(module.id, 0),
                assignments=assignment_counts.get(module.id, 0),
                materials=material_counts.get(module.id, 0),
                tutor_sessions_used=plays_used.get(module.id, 0),
            )
            for module in sorted(course.modules, key=lambda m: m.order)
        ],
    )


@router.post(
    "",
    response_model=CourseRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[platform_staff_only],
)
async def create_course(
    payload: CourseCreate, session: DbSession, user: CurrentUser
) -> CourseRead:
    course = await course_service.create_course(
        session, title=payload.title, description=payload.description
    )
    # Recorded by name. Nothing explicit was written here, so the middleware's
    # catch-all filed it as `http.request` and the console showed "Changed
    # something" for the creation of a course. Issue 66 asks which object was
    # touched; a title answers that in a way a uuid never will.
    # `record_safely`, not `record`: the service above has already committed,
    # so this event is in a transaction of its own. A raise here would report
    # failure for work that already landed.
    await audit.record_safely(
        session,
        action=AuditAction.COURSE_CREATED,
        actor=user,
        target_type="course",
        target_id=course.id,
        metadata={"name": course.title},
    )
    # A new public course joins every All Access plan now, not when somebody
    # remembers to tick it. Drafts included, so publishing needs no second step.
    await plans.fill_all_access(session)
    await session.commit()
    await session.refresh(course)
    return CourseRead.model_validate(course)


@router.patch(
    "/{course_id}", response_model=CourseRead, dependencies=[platform_staff_only]
)
async def update_course(
    course_id: uuid.UUID, payload: CourseUpdate, session: DbSession, user: CurrentUser
) -> CourseRead:
    # Tenancy. `admin_only` says "you are staff"; it says nothing about WHOSE
    # course this is. Without this an ordinary platform admin could rename and
    # delete a customer's private training — verified, and it did.
    try:
        await access.require_course_in_tenant(session, user, course_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    # READ IT BEFORE IT MOVES. The trail could say a course had been updated
    # and never what changed, which is issues 41, 59 and 60 — "Changed
    # something" with no old value is a record nobody can act on.
    fields = ("title", "description", "access_days", "is_published")
    try:
        existing = await course_service.get_course(session, course_id)
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None
    before = audit.snapshot(existing, fields)

    try:
        course = await course_service.update_course(
            session, course_id, **payload.model_dump(exclude_unset=True)
        )
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    moved = audit.changes(before, audit.snapshot(course, fields))
    if moved:
        # `record_safely`: `course_service.update_course` commits before this
        # runs, so a raise here would fail a request whose work already landed.
        await audit.record_safely(
            session,
            action=AuditAction.COURSE_UPDATED,
            actor=user,
            target_type="course",
            target_id=course.id,
            metadata={"name": course.title, "changes": moved},
        )
        await session.commit()
        await session.refresh(course)
    return CourseRead.model_validate(course)


@router.patch("/{course_id}/pricing", response_model=CourseRead)
async def update_course_pricing(
    course_id: uuid.UUID,
    payload: CoursePricingUpdate,
    session: DbSession,
    admin: RequireAdmin,
    user: CurrentUser,
) -> CourseRead:
    """Set a course's price and whether it is on sale. Platform staff only.

    Separate from `PATCH /courses/{id}` so the gate is visible in the route
    rather than buried in a field check: an ordinary admin can write the course
    but cannot decide what it costs, and cannot put it on sale.

    Changing the price does not touch existing orders — `orders.amount_minor`
    is copied at purchase time precisely so a price change never rewrites what
    somebody already paid.
    """
    # Tenancy. `admin_only` says "you are staff"; it says nothing about WHOSE
    # course this is. Without this an ordinary platform admin could rename and
    # delete a customer's private training — verified, and it did.
    try:
        await access.require_course_in_tenant(session, user, course_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    try:
        course = await course_service.get_course(session, course_id)
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    changes = payload.model_dump(exclude_unset=True)
    if changes.get("currency"):
        changes["currency"] = str(changes["currency"]).upper()

    # A "was" price has to actually be more than the price. Below or equal is
    # either a slip or a false discount, and the second is a deceptive trade
    # practice — so it is refused here rather than rendered and argued about
    # later. Clearing it (null) is always allowed.
    proposed_list = changes.get("list_price_minor")
    if proposed_list is not None:
        effective_price = changes.get("price_minor", course.price_minor)
        if proposed_list <= effective_price:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "The previous price has to be higher than the price you "
                    "charge, or there is no discount to show."
                ),
            )

    # 0 means "no window": back to never expiring. Stored as NULL so the column
    # has one meaning rather than two.
    if changes.get("access_days") == 0:
        changes["access_days"] = None

    # PUBLISHING IS NOT AN ORDINARY FIELD. It may only go true on an approved
    # course, and this super admin pressing Publish IS the approval — recorded
    # with their name rather than leaving a live course whose review status
    # says nobody ever looked. `course_review.apply_publish_flag` is the single
    # place that rule lives, so a future publishing route cannot forget it.
    publish = changes.pop("is_published", None)

    # WHAT THE PRICE WAS, captured before it moves. "Who dropped the price,
    # and from what" is the question this trail exists to answer and could not
    # — the route wrote nothing, so the catch-all filed it as `http.request`
    # and the console said "Changed something". Issue 41 names price changes
    # specifically.
    priced = ("price_minor", "list_price_minor", "currency", "access_days")
    before = audit.snapshot(course, priced)
    was_published = course.is_published

    for field, value in changes.items():
        setattr(course, field, value)

    submitted = False
    if publish is not None:
        review_before = course.review_status
        try:
            await course_review.apply_publish_flag(
                session, course=course, publish=publish, actor=admin
            )
        except course_review.ReviewError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        # A platform admin's Publish on a course nobody has approved sends it
        # to the super admin instead (`apply_publish_flag`).
        submitted = (
            course.review_status != review_before
            and course.review_status.value == "pending"
        )

    if submitted:
        await audit.record(
            session,
            action="course.submitted_for_review",
            actor=admin,
            target_type="course",
            target_id=course.id,
            metadata={"title": course.title, "modules": len(course.modules)},
        )

    moved = audit.changes(before, audit.snapshot(course, priced))
    if course.is_published != was_published:
        # Going on or off sale is not a field edit and reads badly as one.
        moved["on sale"] = {"from": was_published, "to": course.is_published}

    if moved:
        await audit.record(
            session,
            action="content.course_priced",
            actor=admin,
            target_type="course",
            target_id=course.id,
            metadata={
                "name": course.title,
                "currency": course.currency,
                "changes": moved,
            },
        )

    await session.commit()
    await session.refresh(course)

    logger.info(
        "Super admin %s changed pricing on course %s: %s",
        admin.id,
        course.id,
        changes,
    )
    return CourseRead.model_validate(course)


@router.post("/{course_id}/submit-for-review", response_model=CourseRead)
async def submit_course_for_review(
    course_id: uuid.UUID,
    session: DbSession,
    user: CurrentUser,
    _: Annotated[None, platform_staff_only] = None,
) -> CourseRead:
    """Send a course to the super admin for approval.

    What an ordinary admin does instead of publishing. They write the course
    and hand it over; the owner decides whether it goes on sale. A super admin
    can use this too, though they have no need to — their Publish approves.
    """
    try:
        await access.require_course_in_tenant(session, user, course_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    try:
        # WITH its modules: `submit_for_review` refuses an empty course, and it
        # can only see that if the relationship is loaded.
        course = await course_service.get_course_with_modules(session, course_id)
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    try:
        await course_review.submit_for_review(session, course=course, actor=user)
    except course_review.ReviewError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    await audit.record(
        session,
        action="course.submitted_for_review",
        actor=user,
        target_type="course",
        target_id=course.id,
        metadata={"title": course.title, "modules": len(course.modules)},
    )
    await session.commit()
    await session.refresh(course)
    return CourseRead.model_validate(course)


@router.patch("/{course_id}/limits", response_model=CourseRead)
async def update_course_limits(
    course_id: uuid.UUID,
    payload: CourseLimitsUpdate,
    session: DbSession,
    admin: RequireAdmin,
    user: CurrentUser,
) -> CourseRead:
    """Set what the AI tutor may do on this course. Platform staff only.

    How many times a student may play the tutor on one module, and how long
    each play runs. Both are per COURSE and apply to every module in it.

    Its own route, and its own gate, for the same reason pricing has one: this
    decides how much of the most expensive thing the product does a student
    gets, which is a commercial decision rather than an authoring one. An
    ordinary admin writes the course; they do not set its AI budget.

    SENDING NULL CLEARS THE OVERRIDE and returns the course to the platform
    default for its kind — free courses and paid ones have different ones. That
    is why null has to be distinguishable from "not sent": `exclude_unset`
    below means an absent field is left alone, while an explicit null resets
    it.
    """
    try:
        await access.require_course_in_tenant(session, user, course_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    try:
        course = await course_service.get_course(session, course_id)
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(course, field, value)

    await session.commit()
    await session.refresh(course)

    allowance = await limits.tutor_allowance_for(session, course)
    logger.info(
        "Super admin %s changed tutor limits on course %s: %s (now %d plays, "
        "%d minutes)",
        admin.id,
        course.id,
        changes,
        allowance.sessions_per_module,
        allowance.minutes_per_session,
    )
    return CourseRead.model_validate(course).model_copy(
        update={
            "effective_ai_sessions_per_module": allowance.sessions_per_module,
            "effective_ai_session_minutes": allowance.minutes_per_session,
            "ai_limit_basis": allowance.basis,
        }
    )


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(
    course_id: uuid.UUID,
    session: DbSession,
    admin: RequireAdmin,
    user: CurrentUser,
    reason: str = "",
) -> None:
    """Delete our course, or ASK to delete a customer's. PLATFORM STAFF ONLY.

    Was `admin_only`, which let anybody with the admin role destroy a course —
    including one another admin had spent a week writing, and one that had been
    approved and sold. Deleting is not authoring: it sits with the owner,
    beside publishing and pricing, for the same reason.

    An ordinary admin who wants a course gone asks for it, exactly as they now
    ask for it to go on sale.

    A COURSE INSIDE AN ORGANISATION is deleted at once too, since 2026-10-01:
    platform staff delete inside a customer directly, and it is the people
    inside the customer who ask (`deletions.acts_directly`). It still writes a
    deletion request, raised and approved in the same moment, so the
    customer's own history says who removed their training and why.
    """
    # Tenancy. `admin_only` says "you are staff"; it says nothing about WHOSE
    # course this is. Without this an ordinary platform admin could rename and
    # delete a customer's private training — verified, and it did.
    try:
        await access.require_course_in_tenant(session, user, course_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    # THE NAME, READ BEFORE THE ROW GOES. After a delete the target id points
    # at nothing, so an event carrying only a uuid is a record that a course
    # was destroyed and no way to say which one. Issue 66.
    try:
        doomed = await course_service.get_course(session, course_id)
        name, was_published = doomed.title, doomed.is_published
        owner_org = doomed.organization_id
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    if doomed.organization_id is not None:
        from app.models.organization import Organization

        organization = await session.get(Organization, doomed.organization_id)
        if organization is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
            )
        try:
            await deletions.record_direct(
                session,
                organization=organization,
                target_type=DeletionTarget.TRAINING,
                target_id=course_id,
                target_label=name,
                actor=user,
                reason=reason or "Removed by platform staff.",
            )
        except deletions.DeletionError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        # Falls through to the deletion below, which commits this row with it.

    # SOLD COURSES CANNOT BE DELETED, and now they say so.
    #
    # `orders.course_id` is RESTRICT on purpose: an order that cannot name what
    # was bought is not a receipt, and a refund needs it. The delete therefore
    # fails at the database — which nothing caught, so the owner pressing Delete
    # on a course with one sale against it got "Internal server error" and no
    # idea that selling it was the reason.
    #
    # Checked BEFORE the delete rather than caught after it, because the count
    # is the useful part of the message. The `as_conflict` below is still there
    # for anything else that points at a course.
    sold = await session.scalar(
        select(func.count()).select_from(Order).where(Order.course_id == course_id)
    )
    if sold:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{name} has been bought {sold} time{'s' if sold != 1 else ''}, "
                "so it cannot be deleted. The orders would no longer say what "
                "was paid for. Take it off sale instead."
            ),
        )

    try:
        async with conflicts.as_conflict(
            session,
            default=(
                "Something still refers to this course, so it cannot be deleted. "
                "Take it off sale instead."
            ),
        ):
            await course_service.delete_course(session, course_id)
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    # `record_safely`, not `record`: the service above has already committed,
    # so this event is in a transaction of its own. A raise here would report
    # failure for work that already landed.
    await audit.record_safely(
        session,
        action=AuditAction.COURSE_DELETED,
        actor=user,
        # A customer's course shows up in that customer's own activity log.
        organization_id=owner_org,
        target_type="course",
        target_id=course_id,
        metadata={"name": name, "was_on_sale": was_published},
    )
    await session.commit()
