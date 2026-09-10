"""Unauthenticated endpoints for the marketing site.

The marketing pages are seen by people who have not signed up yet, so the
course catalogue has to be readable without a session. Kept in its own router
rather than as an exception inside `courses.py`, so "which routes are public"
is answerable by looking at one file.

Only catalogue-level fields are exposed. `modules.content` is never returned
here — that is the material the tutor teaches from, and handing it out
anonymously would give the whole course away to anyone who opened devtools.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.deps import DbSession
from app.models.assignment import Assignment
from app.models.certification import CertExam, Certificate
from app.models.contact import ContactMessage
from app.models.course import Course, Module
from app.models.material import ModuleMaterial
from app.models.quiz import QuizQuestion
from app.models.subscription import SubscriptionPlan
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/public", tags=["public"])


class PublicCourse(BaseModel):
    id: str
    title: str
    description: str | None
    module_count: int
    # Integer minor units. 0 means free — a real value, not a missing price.
    price_minor: int = 0
    currency: str = "INR"
    # What the course used to cost, struck through beside the real price.
    # None is the honest default: most courses never carried a higher price,
    # and inventing one to manufacture a discount is a deceptive practice.
    list_price_minor: int | None = None
    # How long a purchase lasts, in days. None means it never expires, which is
    # the older "pay once, keep it" rule and still reachable.
    access_days: int | None = None


class PublicPlan(BaseModel):
    id: str
    name: str
    description: str | None
    price_minor: int
    currency: str
    billing_interval: str
    course_titles: list[str]
    # The ids as well as the titles, so the pricing page can tell whether the
    # reader ALREADY holds this plan and offer them "start learning" rather
    # than a Buy button they would be refused. No leak: these are published
    # public courses whose ids are already in /public/courses, and the same
    # organization filter below applies to both lists.
    course_ids: list[str]

    # ------------------------------------------------------------------
    # WHAT KIND OF PLAN THIS IS, worked out rather than stored.
    # ------------------------------------------------------------------
    # A plan that covers every published public course is an all-access
    # subscription; one that covers some of them is a stack bundle. Nothing in
    # the schema records which, and deliberately so: a column would be a second
    # source of truth beside `plan_courses`, and `plan_courses` is what
    # actually grants the access — so on any disagreement the column would be
    # the half that was wrong, while still being the half the page believed.
    covers_everything: bool = False
    course_count: int = 0

    # WHAT THESE COURSES COST BOUGHT ONE AT A TIME, today, at the prices on the
    # course cards. A plain fact the reader can check by adding up the
    # catalogue, offered so a bundle price means something.
    #
    # NOT presented as a discount, and no percentage is computed from it: a
    # monthly subscription and a set of outright purchases are different
    # things, and "save 84%" would be comparing two numbers that are not
    # comparable. The page prints it as context and lets the reader judge.
    separate_total_minor: int = 0


class PublicModule(BaseModel):
    """A module as shown on the public course page.

    Title, position, and COUNTS of what is inside — never the material itself.
    `content` is what the tutor teaches from and is still not exposed here;
    otherwise the whole course would be readable from devtools without signing
    up. A word count and "3 quiz questions" tell a prospective student what
    they are buying without giving them the lesson.
    """

    id: str
    title: str
    order: int
    # Roughly how long the tutor speaks this module, at ~140 words per minute —
    # the same figure the authoring screen shows, so an author's estimate and a
    # student's match.
    estimated_minutes: int
    has_voice_lecture: bool
    # WHETHER there is written material, never what it says. `modules.content`
    # is the text the tutor teaches from, so it stays out of this response — a
    # boolean tells a visitor the module comes with notes without handing them
    # the lesson.
    has_notes: bool = False
    quiz_questions: int
    assignments: int
    materials: int


class PublicCourseDetail(PublicCourse):
    modules: list[PublicModule]


class CertificateCheck(BaseModel):
    """The public answer to "is this certificate real?".

    Deliberately narrow. Anyone holding the id can see it, so it carries only
    what an employer needs to confirm the claim — who, which course, when — and
    nothing else about the holder: no email, no scores, no other courses, no
    account id. The certificate id is the secret; everything behind it stays
    private.
    """

    valid: bool
    student_name: str | None = None
    course_title: str | None = None
    exam_title: str | None = None
    issued_at: datetime | None = None


class ContactRequest(BaseModel):
    """What the Contact page's form sends.

    Every field is length-capped. This is the only endpoint on the service that
    an unauthenticated stranger can write to, so the caps are the difference
    between a contact form and somewhere to dump a megabyte of text.
    """

    # THE SAME RULES THE FORM SHOWS, ENFORCED WHERE IT COUNTS. The browser
    # tells someone what they typed wrong; this is what actually holds, because
    # anyone can post here with curl (frontend validation is not
    # security).
    #
    # `[^\W\d_]` rather than A-Za-z: a name is not ASCII. Refusing "Zoë",
    # "O'Brien" or "Ramírez" would be a bug dressed as validation, and one that
    # only affects people with accents in their names — which is how it ships.
    #
    # min_length is 1, not 2. A single-letter name is rare but real, and the
    # pattern already refuses "1" and "_". Requiring two characters would catch
    # a few more typos at the cost of locking a real person out of the only way
    # they have to contact us, which is the worse trade.
    name: str = Field(min_length=1, max_length=255, pattern=r"^[^\W\d_][^\d_]*$")
    email: EmailStr
    # Optional. Asking for a phone number and refusing the form without one
    # loses the messages from people who would rather not give it. Digits and
    # the punctuation a real number is written with — no letters.
    phone: str | None = Field(default=None, max_length=40, pattern=r"^[+()\d\s.-]+$")
    subject: str | None = Field(default=None, max_length=255)
    message: str = Field(min_length=10, max_length=5_000)

    # Not shown to humans; only a bot fills it in. Named plausibly because
    # scrapers skip anything called "honeypot".
    website: str | None = Field(default=None, max_length=255)


class ContactResponse(BaseModel):
    status: str


@router.get("/courses", response_model=list[PublicCourse])
async def list_public_courses(session: DbSession) -> list[PublicCourse]:
    """Course catalogue for the marketing site.

    Unpublished courses are excluded: an author needs somewhere to write a
    course before it is on sale, and a half-written one on the public site is
    worse than no course at all.
    """
    # One grouped query rather than N+1: counting modules per course in a loop
    # would issue a query per course.
    result = await session.execute(
        select(Course, func.count(Module.id))
        .outerjoin(Module, Module.course_id == Course.id)
        # `organization_id IS NULL` is the marketing site's half of the
        # walled garden, and the higher-severity half. An organization's
        # internal compliance training must never appear on a public page —
        # unlike a draft, which is merely embarrassing, this would be one
        # customer's private material shown to the world.
        .where(Course.is_published.is_(True), Course.organization_id.is_(None))
        .group_by(Course.id)
        .order_by(Course.price_minor, Course.title)
    )
    return [
        PublicCourse(
            id=str(course.id),
            title=course.title,
            description=course.description,
            module_count=module_count,
            price_minor=course.price_minor,
            list_price_minor=course.list_price_minor,
            access_days=course.access_days,
            currency=course.currency,
        )
        for course, module_count in result.all()
    ]


@router.get("/plans", response_model=list[PublicPlan])
async def list_public_plans(session: DbSession) -> list[PublicPlan]:
    """Subscription plans for the pricing page."""
    plans = (
        (
            await session.execute(
                select(SubscriptionPlan)
                .where(SubscriptionPlan.is_active.is_(True))
                .order_by(SubscriptionPlan.price_minor)
                .options(selectinload(SubscriptionPlan.course_links))
            )
        )
        .scalars()
        .all()
    )

    # One query for every plan's courses rather than one per plan.
    #
    # PUBLISHED public courses only, and the `is_published` half is new. A plan
    # linking a draft would otherwise print its title on the pricing page and
    # count it towards what the bundle includes — advertising a course that
    # cannot be opened, since `/public/courses/{id}` filters drafts out.
    catalogue = {
        # Public courses only. A plan that somehow linked an organization's
        # course would otherwise print its title on the pricing page — a small
        # leak, but a leak of exactly the material the walled garden exists to
        # keep private.
        row.id: row
        for row in (
            await session.execute(
                select(Course.id, Course.title, Course.price_minor).where(
                    Course.organization_id.is_(None),
                    Course.is_published.is_(True),
                )
            )
        ).all()
    }

    # The denominator for "does this plan cover everything". Counted from the
    # same set the members are drawn from, so the two cannot drift apart.
    catalogue_size = len(catalogue)

    result: list[PublicPlan] = []
    for plan in plans:
        # Sorted, because `plan.course_links` comes back in whatever order the
        # rows were inserted — so a bundle printed its four courses as
        # "Node.js, JavaScript, React, PostgreSQL", which reads like a jumble
        # rather than a path through a stack. Cheapest first is a decent proxy
        # for easiest first here, and it is at least stable, which the previous
        # order was not.
        members = sorted(
            (
                catalogue[link.course_id]
                for link in plan.course_links
                if link.course_id in catalogue
            ),
            key=lambda row: (row.price_minor, row.title),
        )
        result.append(
            PublicPlan(
                id=str(plan.id),
                name=plan.name,
                description=plan.description,
                price_minor=plan.price_minor,
                currency=plan.currency,
                billing_interval=plan.billing_interval.value,
                course_titles=[row.title for row in members],
                course_ids=[str(row.id) for row in members],
                course_count=len(members),
                covers_everything=(
                    catalogue_size > 0 and len(members) >= catalogue_size
                ),
                separate_total_minor=sum(row.price_minor for row in members),
            )
        )
    return result


def _speaking_minutes(content: str | None) -> int:
    """How long the tutor talks, at ~140 words per minute.

    The same figure the authoring screen shows, so an author's estimate and a
    student's agree. Rounded up, because a short module reading "0 min" looks
    like there is nothing in it.
    """
    words = len((content or "").split())
    if words == 0:
        return 0
    return max(1, round(words / 140))


@router.get("/courses/{course_id}", response_model=PublicCourseDetail)
async def get_public_course(
    course_id: uuid.UUID, session: DbSession
) -> PublicCourseDetail:
    """Course landing page: what the course covers, before signing up.

    Filters on `is_published` exactly as the listing does. Without it,
    unpublishing removed a course from the catalogue but left its URL working —
    so a half-written course stayed reachable by anyone holding the link, and
    the super admin's Unpublish button quietly did half of what it claims.
    """
    result = await session.execute(
        select(Course)
        .where(
            Course.id == course_id,
            Course.is_published.is_(True),
            # Same rule as the listing. Decision 62 had to fix exactly this
            # asymmetry for drafts: the listing filtered and the detail route
            # did not, so the URL kept working for anyone holding the link.
            Course.organization_id.is_(None),
        )
        .options(selectinload(Course.modules))
    )
    course = result.scalar_one_or_none()
    if course is None:
        # 404 rather than 403 for an unpublished course: whether a draft exists
        # is not a stranger's business.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )

    modules = sorted(course.modules, key=lambda m: m.order)
    module_ids = [m.id for m in modules]

    # What is inside each module, as counts. Three grouped queries rather than
    # three per module: this page is public and uncached, so an N+1 here is
    # served to every visitor.
    async def counts_by_module(model, column) -> dict:
        if not module_ids:
            return {}
        rows = await session.execute(
            select(column, func.count()).where(column.in_(module_ids)).group_by(column)
        )
        return {row[0]: row[1] for row in rows}

    quiz_counts = await counts_by_module(QuizQuestion, QuizQuestion.module_id)
    assignment_counts = await counts_by_module(Assignment, Assignment.module_id)
    material_counts = await counts_by_module(ModuleMaterial, ModuleMaterial.module_id)

    return PublicCourseDetail(
        id=str(course.id),
        title=course.title,
        description=course.description,
        module_count=len(modules),
        price_minor=course.price_minor,
        list_price_minor=course.list_price_minor,
        access_days=course.access_days,
        currency=course.currency,
        modules=[
            PublicModule(
                id=str(m.id),
                title=m.title,
                order=m.order,
                estimated_minutes=_speaking_minutes(m.content),
                has_voice_lecture=bool(m.content and m.content.strip()),
                has_notes=bool(m.content and m.content.strip()),
                quiz_questions=quiz_counts.get(m.id, 0),
                assignments=assignment_counts.get(m.id, 0),
                materials=material_counts.get(m.id, 0),
            )
            for m in modules
        ],
    )


@router.post(
    "/contact",
    response_model=ContactResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_contact_message(
    payload: ContactRequest, session: DbSession
) -> ContactResponse:
    """Receive a message from the Contact page.

    Stored for the admin inbox rather than emailed — no mail provider is
    configured, and a form that silently drops what people write is worse than
    no form.

    A filled honeypot is answered with the same success response a human gets.
    Telling a bot it was detected only tells whoever wrote it what to change.

    NOT rate-limited here. Anyone on the internet can call this, so a limit
    belongs in front of the app (reverse proxy or platform WAF) where it can
    see the real client address; the length caps above are what this layer can
    honestly enforce.
    """
    if payload.website:
        logger.info("Discarded a contact submission that filled the honeypot")
        return ContactResponse(status="received")

    session.add(
        ContactMessage(
            name=payload.name.strip(),
            email=payload.email,
            phone=(payload.phone or "").strip() or None,
            subject=(payload.subject or "").strip() or None,
            message=payload.message.strip(),
        )
    )
    await session.commit()
    return ContactResponse(status="received")


@router.get("/certificates/{certificate_id}", response_model=CertificateCheck)
async def verify_certificate(
    certificate_id: uuid.UUID, session: DbSession
) -> CertificateCheck:
    """Confirm a certificate is genuine. No account needed.

    A certificate is worth nothing if the person receiving it cannot check it,
    so this is deliberately open — the id printed on the PDF is what proves
    the holder had it in the first place.

    An unknown id answers `valid: false` rather than 404: the caller asked a
    question and this is the answer, and a 404 would have the frontend render
    a "page not found" instead of "this certificate is not valid".
    """
    row = (
        await session.execute(
            select(
                User.name,
                Course.title,
                CertExam.title,
                Certificate.issued_at,
            )
            .join(User, User.id == Certificate.user_id)
            .join(CertExam, CertExam.id == Certificate.cert_exam_id)
            .join(Course, Course.id == CertExam.course_id)
            .where(Certificate.id == certificate_id)
        )
    ).first()

    if row is None:
        return CertificateCheck(valid=False)

    student_name, course_title, exam_title, issued_at = row
    return CertificateCheck(
        valid=True,
        student_name=student_name,
        course_title=course_title,
        exam_title=exam_title,
        issued_at=issued_at,
    )


class PublicOrgProfile(BaseModel):
    """The little an anonymous visitor may know about an organization.

    Name and slug only — enough to brand a sign-in page, and nothing about its
    people, its size or its training. An inactive organization answers 404
    rather than "suspended": the state of a customer's account is not a
    stranger's business.
    """

    name: str
    slug: str


@router.get("/org/{slug}", response_model=PublicOrgProfile)
async def get_public_org(slug: str, session: DbSession) -> PublicOrgProfile:
    """Resolve an organization for its sign-in page.

    This does confirm whether a given slug exists, which is unavoidable: the
    person typing /org/acme/login has to be told whether that is a real place.
    It reveals nothing further.
    """
    from app.services import organizations as org_service

    organization = await org_service.get_by_slug(session, slug)
    if organization is None or not organization.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found."
        )
    return PublicOrgProfile(name=organization.name, slug=organization.slug)
