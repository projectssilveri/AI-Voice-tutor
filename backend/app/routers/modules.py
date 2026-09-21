"""Modules: content, ordering, and the material the voice tutor is grounded in.

`modules.content` is what gets fed into the Gemini Live system instruction, so
this router is what the voice session reads from (build-order step 6).

Content access is deliberately unmetered — the spec confirms module text and
PDFs can be re-read without limit. Do not add read-limit logic here.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import CurrentUser, DbSession, require_role
from app.models.course import Course
from app.models.user import UserRole
from app.schemas.course import ModuleCreate, ModuleRead, ModuleUpdate
from app.services import access, audit, limits
from app.services import courses as course_service

router = APIRouter(tags=["modules"])

admin_only = Depends(require_role(UserRole.ADMIN))

# AUTHORING IS SUPER ADMIN ONLY (issue 11). `require_role(ADMIN)` widens
# upwards to include super admins; this one does not widen, because the point
# is to exclude the platform admin who previously satisfied it.
#
# The ORGANISATION portal is untouched. An org admin writes their own company's
# training through `/org/{slug}/courses`, a different router with its own scope
# check — what a customer may write about their own business is not this rule's
# business.
super_admin_only = Depends(require_role(UserRole.SUPER_ADMIN))



@router.get("/courses/{course_id}/modules", response_model=list[ModuleRead])
async def list_course_modules(
    course_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> list[ModuleRead]:
    # Tenancy, matching `GET /modules/{id}` below. That route was gated and
    # this one was not, so a course id was enough to read another tenant's whole
    # curriculum — every module title AND its `content`, which is the material
    # the tutor teaches from. Measured live: a public learner with no
    # organization listed Acme's private compliance modules.
    #
    # Decision 161 in a third place: a rule applied to the detail route and not
    # to the listing that links to it.
    try:
        await access.require_course_in_tenant(session, user, course_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    try:
        records = await course_service.list_modules(session, course_id)
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None
    return [ModuleRead.model_validate(record) for record in records]


@router.get("/modules/{module_id}", response_model=ModuleRead)
async def get_module(
    module_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> ModuleRead:
    try:
        module = await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    # Tenancy only, not the paywall: `ModuleRead` carries `content`, which is
    # the material the tutor teaches from. Reading it stays unlimited within a
    # catalogue (decision 18), but another organization's is not this reader's
    # at any price. This route had no check of any kind, so a module id was
    # enough to read any tenant's training.
    try:
        await access.require_module_in_tenant(session, user, module_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    return ModuleRead.model_validate(module)


@router.post(
    "/courses/{course_id}/modules",
    response_model=ModuleRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[super_admin_only],
)
async def create_module(
    course_id: uuid.UUID, payload: ModuleCreate, session: DbSession, user: CurrentUser
) -> ModuleRead:
    # Tenancy. `admin_only` says "you are staff"; it says nothing about WHOSE
    # course this is. Without this an ordinary platform admin could rename and
    # delete a customer's private training — verified, and it did.
    try:
        await access.require_course_in_tenant(session, user, course_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    # THE MODULE CAP. Counted from the database at the moment of creation, not
    # trusted from the screen that drew the button — that screen may have been
    # open while somebody else added the tenth module.
    course = await session.get(Course, course_id)
    if course is not None:
        try:
            await limits.assert_can_add_module(session, course)
        except limits.LimitReached as exc:
            # 409, not 400: the request is well formed and the caller is
            # allowed to do this in principle. It is the course's current state
            # that refuses, which is the same distinction decision 153 drew for
            # the organization admin floor.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None

    # Where it goes is the server's decision unless the caller insists.
    # `next_module_order` reads the highest position that exists, which is what
    # appending means — a count is not a position once anything has been
    # deleted.
    order = (
        payload.order
        if payload.order is not None
        else await course_service.next_module_order(session, course_id)
    )

    try:
        module = await course_service.create_module(
            session,
            course_id,
            title=payload.title,
            order=order,
            content=payload.content,
        )
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None
    except course_service.DuplicateModuleOrderError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None
    # `record_safely`: the service call above has already
    # committed, so this event stands on its own and a raise here
    # would report failure for work that landed.
    await audit.record_safely(
        session,
        action="content.module_created",
        actor=user,
        target_type="module",
        target_id=module.id,
        # The module AND the course it went into. "A module was added" is not
        # a usable record on a platform with sixty of them; issue 66.
        metadata={
            "name": module.title,
            # `course` is fetched above for the module cap and the code there
            # already allows it to be None, so this must too. An audit write is
            # never the thing that takes a request down.
            "course": course.title if course is not None else None,
            "position": module.order,
        },
    )
    await session.commit()
    await session.refresh(module)
    return ModuleRead.model_validate(module)


@router.patch(
    "/modules/{module_id}", response_model=ModuleRead, dependencies=[super_admin_only]
)
async def update_module(
    module_id: uuid.UUID, payload: ModuleUpdate, session: DbSession, user: CurrentUser
) -> ModuleRead:
    # Tenancy, from the module side. Same reasoning as the course routes.
    try:
        await access.require_module_in_tenant(session, user, module_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    fields = ("title", "summary", "content", "order")
    try:
        existing = await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None
    before = audit.snapshot(existing, fields)

    try:
        module = await course_service.update_module(
            session, module_id, **payload.model_dump(exclude_unset=True)
        )
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None
    except course_service.DuplicateModuleOrderError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    # `content` is the lecture script and runs to thousands of words. It is
    # recorded as having moved, with its length, never quoted — `audit.changes`
    # does that trimming, which is why the rule lives there and not here.
    moved = audit.changes(before, audit.snapshot(module, fields))
    if moved:
        # `record_safely`: the service call above has already
        # committed, so this event stands on its own and a raise here
        # would report failure for work that landed.
        await audit.record_safely(
            session,
            action="content.module_updated",
            actor=user,
            target_type="module",
            target_id=module.id,
            metadata={"name": module.title, "changes": moved},
        )
        await session.commit()
        await session.refresh(module)
    return ModuleRead.model_validate(module)


@router.delete(
    "/modules/{module_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[super_admin_only],
)
async def delete_module(
    module_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> None:
    # Tenancy, from the module side. Same reasoning as the course routes.
    try:
        await access.require_module_in_tenant(session, user, module_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    # Read before it goes, for the same reason as a deleted course: the id
    # afterwards points at nothing.
    try:
        doomed = await course_service.get_module(session, module_id)
        name, position = doomed.title, doomed.order
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    try:
        await course_service.delete_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None

    # `record_safely`: the service call above has already
    # committed, so this event stands on its own and a raise here
    # would report failure for work that landed.
    await audit.record_safely(
        session,
        action="content.module_deleted",
        actor=user,
        target_type="module",
        target_id=module_id,
        metadata={"name": name, "position": position},
    )
    await session.commit()
