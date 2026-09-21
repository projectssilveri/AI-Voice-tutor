"""Courses waiting for the super admin.

An ordinary admin writes a course and submits it; this is where the owner sees
the queue and says yes or sends it back. Super admin only — approving is the
same authority as publishing, and publishing has always sat here.

Three routes and no more: see the queue, approve, reject. Editing the course
itself is done on the ordinary course screens, which the owner reaches from the
row — a second editor here would be a second place for course content to be
changed from.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.deps import DbSession, RequireSuperAdmin
from app.models.course import Course, CourseReviewStatus, Module
from app.models.user import User
from app.services import audit, course_review
from app.services import courses as course_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/course-reviews", tags=["admin"])


class ReviewRow(BaseModel):
    """One course in the queue, with enough to judge it without opening it."""

    id: uuid.UUID
    title: str
    description: str | None
    review_status: str
    module_count: int
    price_minor: int
    currency: str
    is_published: bool

    submitted_at: datetime | None
    submitted_by_name: str | None
    submitted_by_email: str | None
    reviewed_at: datetime | None
    reviewed_by_name: str | None
    review_note: str | None


class ReviewDecision(BaseModel):
    #: Required on a rejection, optional on an approval. `course_review.reject`
    #: refuses an empty one: "rejected" with no reason leaves the author
    #: guessing, and the next submission is a guess too.
    note: str | None = Field(default=None, max_length=2_000)
    #: Approval publishes by default — that is what approving means here. False
    #: approves without putting it on sale, for a launch date.
    publish: bool = True


async def _rows(
    session,
    *,
    wanted: CourseReviewStatus | None = None,
    only: uuid.UUID | None = None,
) -> list[ReviewRow]:
    """The queue query. One definition, used by the list and by a single read.

    Building a row twice — once for the list and once for the response to a
    decision — is how the two come to disagree about a field somebody added to
    only one of them.
    """
    submitter = aliased(User)
    reviewer = aliased(User)

    query = (
        select(
            Course,
            func.count(Module.id),
            submitter.name,
            submitter.email,
            reviewer.name,
        )
        .outerjoin(Module, Module.course_id == Course.id)
        .outerjoin(submitter, submitter.id == Course.submitted_by)
        .outerjoin(reviewer, reviewer.id == Course.reviewed_by)
        # Marketplace courses only. An organization's private training is its
        # own to run — it never goes on our catalogue, so it is not ours to
        # approve.
        .where(Course.organization_id.is_(None))
        .group_by(Course.id, submitter.name, submitter.email, reviewer.name)
    )

    if wanted is not None:
        query = query.where(Course.review_status == wanted)
    if only is not None:
        query = query.where(Course.id == only)

    rows = (
        await session.execute(
            query.order_by(
                # Pending at the top whatever else is in the list, then the
                # longest-waiting first — a queue ordered by anything else asks
                # the owner to hunt for the oldest thing somebody is blocked on.
                (Course.review_status != CourseReviewStatus.PENDING),
                Course.submitted_at.asc().nullslast(),
                Course.title,
            )
        )
    ).all()

    return [
        ReviewRow(
            id=course.id,
            title=course.title,
            description=course.description,
            review_status=course.review_status.value,
            module_count=module_count,
            price_minor=course.price_minor,
            currency=course.currency,
            is_published=course.is_published,
            submitted_at=course.submitted_at,
            submitted_by_name=submitted_name,
            submitted_by_email=submitted_email,
            reviewed_at=course.reviewed_at,
            reviewed_by_name=reviewed_name,
            review_note=course.review_note,
        )
        for course, module_count, submitted_name, submitted_email, reviewed_name in rows
    ]


async def _load(session, course_id: uuid.UUID) -> Course:
    try:
        return await course_service.get_course(session, course_id)
    except course_service.CourseNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None


@router.post("/{course_id}/approve", response_model=ReviewRow)
async def approve_course(
    course_id: uuid.UUID,
    payload: ReviewDecision,
    session: DbSession,
    admin: RequireSuperAdmin,
) -> ReviewRow:
    """Say yes, and put it on sale."""
    course = await _load(session, course_id)
    try:
        await course_review.approve(
            session,
            course=course,
            actor=admin,
            publish=payload.publish,
            note=payload.note,
        )
    except course_review.ReviewError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    # `record`, not `record_safely`: who approved a course, and when, is the
    # class of fact this trail exists for.
    await audit.record(
        session,
        action="course.approved",
        actor=admin,
        target_type="course",
        target_id=course.id,
        metadata={
            "title": course.title,
            "published": course.is_published,
            "note": (payload.note or "").strip() or None,
        },
    )
    await session.commit()
    logger.info("Super admin %s approved course %s", admin.id, course.id)
    return await _one(session, course_id)


@router.post("/{course_id}/reject", response_model=ReviewRow)
async def reject_course(
    course_id: uuid.UUID,
    payload: ReviewDecision,
    session: DbSession,
    admin: RequireSuperAdmin,
) -> ReviewRow:
    """Send it back, with a reason the author can act on."""
    course = await _load(session, course_id)
    try:
        await course_review.reject(
            session, course=course, actor=admin, note=payload.note or ""
        )
    except course_review.ReviewError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    await audit.record(
        session,
        action="course.rejected",
        actor=admin,
        target_type="course",
        target_id=course.id,
        metadata={"title": course.title, "note": course.review_note},
    )
    await session.commit()
    logger.info("Super admin %s sent course %s back", admin.id, course.id)
    return await _one(session, course_id)


async def _one(session, course_id: uuid.UUID) -> ReviewRow:
    """Read one row back through the same query the list uses."""
    rows = await _rows(session, only=course_id)
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )
    return rows[0]


@router.get("", response_model=list[ReviewRow])
async def list_course_reviews(
    session: DbSession,
    admin: RequireSuperAdmin,
    status_filter: str | None = None,
) -> list[ReviewRow]:
    """The review queue. Pending first, because that is the work.

    Returns every reviewed state, not only pending: an owner asking "what did I
    send back, and did they fix it" has nowhere else to look.
    """
    wanted: CourseReviewStatus | None = None
    if status_filter:
        try:
            wanted = CourseReviewStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unknown review status.",
            ) from None
    return await _rows(session, wanted=wanted)
