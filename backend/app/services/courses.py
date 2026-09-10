"""Course and module business logic.

Route handlers stay thin — they validate, call in here, and shape a response.
Anything with a rule in it lives at this layer so it can be tested without an
HTTP client.
"""

from __future__ import annotations

import uuid

from sqlalchemy import false, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.course import Course, Module
from app.models.enrollment import Enrollment
from app.models.order import Order, OrderStatus


class CourseNotFoundError(LookupError):
    pass


class ModuleNotFoundError(LookupError):
    pass


class DuplicateModuleOrderError(ValueError):
    """Two modules cannot occupy the same position in a course."""


async def list_courses(session: AsyncSession) -> list[Course]:
    result = await session.execute(select(Course).order_by(Course.title))
    return list(result.scalars().all())


async def list_courses_with_counts(
    session: AsyncSession,
    *,
    include_unpublished: bool = True,
    visible_to_user_id: uuid.UUID | None = None,
    organization_id: uuid.UUID | None = None,
    include_organization_courses: bool = False,
    # Which departments' training this caller may see. `None` means no
    # department filter — org admins, branch managers, and anyone flagged
    # `sees_all_departments`. An EMPTY set means they see organization-wide
    # courses only, which is what an unassigned person gets: unassigned means
    # "we have not decided where they belong", not "they belong everywhere".
    visible_department_ids: set[uuid.UUID] | None = None,
) -> list[tuple[Course, int]]:
    """Courses plus how many modules each has.

    One grouped query rather than letting the caller loop — the authoring
    screen shows the count for every course, and a request per course would be
    an N+1 that only shows up once there are enough courses to matter.

    `include_unpublished` defaults to True because the authoring screen needs
    drafts; the student-facing listing passes False. Without it, unpublishing a
    course removed it from the marketing site but left it sitting in every
    signed-in student's course list, which is where they actually browse.

    Taking a course off sale must not confiscate it from someone who already
    bought it, so `visible_to_user_id` keeps a draft visible to a student who
    holds a paid order for it or is already enrolled.

    TENANCY. `organization_id` narrows the list to exactly that organization's
    courses — the walled garden. With it unset the list is public courses only,
    unless `include_organization_courses` is passed, which exists solely for
    the platform super admin's own console. The default is the safe one: a
    caller that forgets these arguments gets the public catalogue, never
    somebody's private training.
    """
    query = (
        select(Course, func.count(Module.id))
        .outerjoin(Module, Module.course_id == Course.id)
        .group_by(Course.id)
        .order_by(Course.title)
    )

    if organization_id is not None:
        query = query.where(Course.organization_id == organization_id)
    elif not include_organization_courses:
        query = query.where(Course.organization_id.is_(None))

    # THE DEPARTMENT WALL, in the listing as well as on the page.
    #
    # It was applied in `access.can_access_course` and in
    # `access.accessible_course_ids`, and this listing uses neither — so a
    # course scoped to Compliance appeared in a Sales learner's course list and
    # then 404'd when they clicked it. Decision 161 in reverse: there the
    # listing filtered and the detail route did not.
    if visible_department_ids is not None:
        query = query.where(
            or_(
                Course.department_id.is_(None),
                Course.department_id.in_(visible_department_ids)
                if visible_department_ids
                else false(),
            )
        )

    if not include_unpublished:
        kept = Course.is_published.is_(True)
        if visible_to_user_id is not None:
            already_has_it = (
                select(Order.course_id)
                .where(
                    Order.user_id == visible_to_user_id,
                    Order.status == OrderStatus.PAID,
                    Order.course_id.is_not(None),
                )
                .union(
                    select(Enrollment.course_id).where(
                        Enrollment.user_id == visible_to_user_id
                    )
                )
            )
            kept = or_(kept, Course.id.in_(already_has_it))
        query = query.where(kept)

    result = await session.execute(query)
    return [(course, count) for course, count in result.all()]


async def get_course(session: AsyncSession, course_id: uuid.UUID) -> Course:
    result = await session.execute(select(Course).where(Course.id == course_id))
    course = result.scalar_one_or_none()
    if course is None:
        raise CourseNotFoundError(str(course_id))
    return course


async def get_course_with_modules(
    session: AsyncSession, course_id: uuid.UUID
) -> Course:
    """Course plus its modules, ordered.

    selectinload rather than lazy access: this runs under asyncio, where a
    lazy load on attribute access raises MissingGreenlet instead of quietly
    issuing another query.
    """
    result = await session.execute(
        select(Course)
        .where(Course.id == course_id)
        .options(selectinload(Course.modules))
    )
    course = result.scalar_one_or_none()
    if course is None:
        raise CourseNotFoundError(str(course_id))
    return course


async def create_course(
    session: AsyncSession,
    *,
    title: str,
    description: str | None,
    organization_id: uuid.UUID | None = None,
    # Narrows an ORGANISATION course to one department. Meaningless without an
    # organization_id — a public marketplace course belongs to no company and
    # therefore to no department — and the caller is what enforces that.
    department_id: uuid.UUID | None = None,
) -> Course:
    """Create a course.

    `organization_id=None` is a public marketplace course, which is every
    course the platform authored. A non-None value makes it that
    organization's private training, which only they can ever see —
    `services/access.py` enforces that, and it does so from this column.

    Defaulting to None means a caller that forgets the argument creates a
    PUBLIC course, which is visible but harmless. The opposite default would
    quietly file a platform course inside somebody's tenant.
    """
    course = Course(
        title=title,
        description=description,
        organization_id=organization_id,
        department_id=department_id,
    )
    session.add(course)
    await session.commit()
    await session.refresh(course)
    return course


async def update_course(
    session: AsyncSession, course_id: uuid.UUID, **fields: object
) -> Course:
    course = await get_course(session, course_id)
    for key, value in fields.items():
        if value is not None:
            setattr(course, key, value)
    await session.commit()
    await session.refresh(course)
    return course


async def delete_course(session: AsyncSession, course_id: uuid.UUID) -> None:
    course = await get_course(session, course_id)
    # Modules, progress, sessions, and transcripts cascade via the schema.
    await session.delete(course)
    await session.commit()


async def list_modules(session: AsyncSession, course_id: uuid.UUID) -> list[Module]:
    await get_course(session, course_id)  # 404 rather than an empty list
    result = await session.execute(
        select(Module).where(Module.course_id == course_id).order_by(Module.order)
    )
    return list(result.scalars().all())


async def get_module(session: AsyncSession, module_id: uuid.UUID) -> Module:
    result = await session.execute(select(Module).where(Module.id == module_id))
    module = result.scalar_one_or_none()
    if module is None:
        raise ModuleNotFoundError(str(module_id))
    return module


async def next_module_order(session: AsyncSession, course_id: uuid.UUID) -> int:
    """Position for a module appended to the end of a course."""
    result = await session.execute(
        select(func.max(Module.order)).where(Module.course_id == course_id)
    )
    highest = result.scalar_one_or_none()
    return 0 if highest is None else highest + 1


async def create_module(
    session: AsyncSession,
    course_id: uuid.UUID,
    *,
    title: str,
    order: int,
    content: str | None,
) -> Module:
    await get_course(session, course_id)
    module = Module(course_id=course_id, title=title, order=order, content=content)
    session.add(module)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        # uq_modules_course_order. Caught rather than pre-checked because a
        # SELECT-then-INSERT still races two concurrent requests; the database
        # constraint is the only reliable arbiter.
        raise DuplicateModuleOrderError(
            f"Course already has a module at position {order}."
        ) from exc
    await session.refresh(module)
    return module


async def update_module(
    session: AsyncSession, module_id: uuid.UUID, **fields: object
) -> Module:
    module = await get_module(session, module_id)
    for key, value in fields.items():
        if value is not None:
            setattr(module, key, value)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise DuplicateModuleOrderError(
            "Another module already occupies that position."
        ) from exc
    await session.refresh(module)
    return module


async def delete_module(session: AsyncSession, module_id: uuid.UUID) -> None:
    module = await get_module(session, module_id)
    await session.delete(module)
    await session.commit()
