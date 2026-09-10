"""Getting a course from an admin's draft onto the catalogue.

An ordinary admin writes courses. They do not decide what goes on sale — that
sits with the platform owner, alongside pricing and revenue (decision 50). So a
course now travels:

    draft ──submit──> pending ──approve──> approved ──publish──> on sale
                         │
                         └──reject──> rejected ──submit──> pending

EVERY TRANSITION IS HERE, and nowhere else. The rule that matters is the one
between the two columns: `is_published` may only become true on an APPROVED
course. Scattering that across the routes that happen to touch publishing today
is how the next publishing route ships without it.

THE SUPER ADMIN'S DIRECT PUBLISH IS AN APPROVAL, not a bypass. They are the
approver; pressing Publish on an unreviewed course is them saying yes, and it
is recorded as exactly that — with their name on it — rather than leaving a
live course whose review status says nobody ever looked.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course, CourseReviewStatus
from app.models.user import User, UserRole


class ReviewError(ValueError):
    """The course cannot move to that state from where it is."""


#: States a course may be submitted from. Submitting an APPROVED course again
#: is refused rather than silently accepted: it is already through, and putting
#: it back in the queue would ask the owner to re-approve something they have
#: already approved.
SUBMITTABLE = (CourseReviewStatus.DRAFT, CourseReviewStatus.REJECTED)


def can_publish(course: Course) -> bool:
    """Whether this course is allowed on sale at all."""
    return course.review_status is CourseReviewStatus.APPROVED


async def submit_for_review(
    session: AsyncSession, *, course: Course, actor: User
) -> Course:
    """An admin sends a course to the platform owner. Does not commit.

    Refused on an empty course. A course with no modules has nothing to review
    and nothing to teach, and the owner finding that out by opening it is a
    round trip that costs both of them a day.
    """
    if course.review_status is CourseReviewStatus.PENDING:
        raise ReviewError("This course is already waiting for approval.")
    if course.review_status is CourseReviewStatus.APPROVED:
        raise ReviewError("This course has already been approved.")
    if course.review_status not in SUBMITTABLE:
        raise ReviewError("This course cannot be submitted from its current state.")

    # Counted through the loaded relationship where present, and the caller is
    # responsible for loading it — `courses.get_course_with_modules` does.
    if not course.modules:
        raise ReviewError(
            "Add at least one module before submitting. There is nothing to "
            "review or teach yet."
        )

    course.review_status = CourseReviewStatus.PENDING
    course.submitted_by = actor.id
    course.submitted_at = datetime.now(UTC)
    # Cleared, so a note from a previous rejection does not sit on a course
    # that has since been rewritten and resubmitted.
    course.review_note = None
    course.reviewed_by = None
    course.reviewed_at = None
    return course


async def approve(
    session: AsyncSession,
    *,
    course: Course,
    actor: User,
    publish: bool = True,
    note: str | None = None,
) -> Course:
    """The owner says yes. Does not commit.

    `publish` defaults to True because that is what approval MEANS here — the
    brief is "then the course will be published". It is still a parameter so an
    owner can approve something they want to hold back for a launch date, which
    is a real thing and not worth forcing them to unpublish afterwards.
    """
    if actor.role is not UserRole.SUPER_ADMIN:
        raise ReviewError("Only the platform owner can approve a course.")

    course.review_status = CourseReviewStatus.APPROVED
    course.reviewed_by = actor.id
    course.reviewed_at = datetime.now(UTC)
    course.review_note = (note or "").strip() or None
    if publish:
        course.is_published = True
    return course


async def reject(
    session: AsyncSession, *, course: Course, actor: User, note: str
) -> Course:
    """The owner sends it back, with a reason. Does not commit.

    THE NOTE IS REQUIRED. "Rejected" with no reason tells the author nothing
    they can act on, and the next submission is a guess — so the route refuses
    an empty one rather than letting a blank rejection through.

    Rejecting also UNPUBLISHES. A course being sent back is a course that
    should not be on sale, and leaving it live while telling its author it was
    refused is the two halves of the product disagreeing.
    """
    if actor.role is not UserRole.SUPER_ADMIN:
        raise ReviewError("Only the platform owner can review a course.")

    clean = (note or "").strip()
    if not clean:
        raise ReviewError("Say why it is going back, so the author can fix it.")

    course.review_status = CourseReviewStatus.REJECTED
    course.reviewed_by = actor.id
    course.reviewed_at = datetime.now(UTC)
    course.review_note = clean[:2_000]
    course.is_published = False
    return course


async def apply_publish_flag(
    session: AsyncSession, *, course: Course, publish: bool, actor: User
) -> Course:
    """Set `is_published` from the super admin's own toggle. Does not commit.

    The one place the publish bit is allowed to move, so the "only an approved
    course may be published" rule cannot be forgotten by a route that sets the
    column directly.

    Turning it ON approves the course if it is not approved already. The person
    doing this IS the approver, so treating their Publish as an approval is
    accurate — and it stops the catalogue holding a live course whose review
    status claims nobody ever looked at it.

    Turning it OFF leaves the review status alone. Unpublishing is "off sale",
    not "unapproved": decision 62 already establishes that a course taken down
    keeps its history, and forcing a full re-review to put it back would make
    the owner's own toggle a one-way door.
    """
    if actor.role is not UserRole.SUPER_ADMIN:
        raise ReviewError("Only the platform owner can publish a course.")

    if publish and course.review_status is not CourseReviewStatus.APPROVED:
        course.review_status = CourseReviewStatus.APPROVED
        course.reviewed_by = actor.id
        course.reviewed_at = datetime.now(UTC)
        course.review_note = None

    course.is_published = publish
    return course
