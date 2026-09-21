"""Seed the database with accounts and a real course catalogue.

Content lives in `scripts/catalogue.py`; this file is the mechanics of putting
it in the database.

Idempotent: re-running updates or skips rather than duplicating. Safe to run
after adding a course to the catalogue.

    python scripts/seed.py
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import delete, select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

# The progress lines print prices, which carry a rupee sign. A default Windows
# console is cp1252, which cannot encode it — so `python -m scripts.seed` died
# with a UnicodeEncodeError partway through the catalogue, after committing the
# accounts but before the courses, leaving a half-seeded database and a
# traceback that says nothing about the real problem.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import (
    Assignment,
    BillingInterval,
    CertExam,
    Course,
    Module,
    PlanCourse,
    QuizQuestion,
    SubscriptionPlan,
    User,
    UserRole,
)
from app.models.course import CourseReviewStatus
from app.services import extensions
from scripts.catalogue import CATALOGUE, CourseSpec

# example.com is reserved by RFC 2606 for exactly this. A `.local` address is a
# special-use name that `email-validator` rejects, and `UserRead` re-validates
# every address on the way out — so seeding one produces a user who can sign in
# but 500s every endpoint that returns them.
SUPER_ADMIN_EMAIL = "owner@example.com"
SUPER_ADMIN_PASSWORD = "OwnerPass123!"
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "AdminPass123!"
# A student too. The seed used to create only the two staff accounts, so the
# first thing anyone does after seeding — look at the student dashboard, which
# is most of the product — meant signing up by hand first.
STUDENT_EMAIL = "learner@example.com"
STUDENT_PASSWORD = "LearnerPass123!"

@dataclass(frozen=True)
class PlanSpec:
    """One thing a student can subscribe to.

    Two kinds, and the difference is only which courses it covers:

      BUNDLE      a stack. Three or four courses that are actually used
                  together — a language, a database, a framework, somewhere to
                  run it — so somebody learning "Java at work" buys one thing
                  rather than assembling a basket and hoping they picked the
                  right pieces.
      ALL ACCESS  the whole catalogue, including courses added later.

    Nothing in the schema marks which is which, and nothing needs to. A plan is
    a bundle when it covers SOME of the catalogue and all-access when it covers
    ALL of it, which `/public/plans` works out by counting. A column would be a
    second source of truth that could disagree with the actual course links —
    and the links are what grants access, so the column would be the one that
    was wrong.
    """

    name: str
    description: str
    price_minor: int
    interval: BillingInterval
    course_titles: list[str]


#: Prices are per interval, in paise. Every bundle is cheaper than All Access,
#: which is the only ordering that makes sense: a bundle that cost more than
#: the whole catalogue would be a bundle nobody should buy.
STACK_BUNDLES: list[PlanSpec] = [
    PlanSpec(
        "Frontend Track",
        "Everything that runs in the browser: JavaScript, React, TypeScript "
        "and Next.js. The path to a frontend role.",
        69_900,  # ₹699/month
        BillingInterval.MONTHLY,
        [
            "JavaScript Foundations",
            "React Essentials",
            "TypeScript for JavaScript Developers",
            "Next.js App Router",
        ],
    ),
    PlanSpec(
        "PHP Full Stack",
        "The classic web stack, start to finish: pages, PHP on the server and "
        "PostgreSQL underneath.",
        79_900,  # ₹799/month
        BillingInterval.MONTHLY,
        [
            "HTML and CSS Foundations",
            "JavaScript Foundations",
            "PHP for the Web",
            "PostgreSQL and SQL",
        ],
    ),
    PlanSpec(
        "JavaScript Full Stack",
        "One language front to back: JavaScript in the browser, Node on the "
        "server, PostgreSQL for the data.",
        89_900,  # ₹899/month
        BillingInterval.MONTHLY,
        [
            "JavaScript Foundations",
            "React Essentials",
            "Node.js and Express",
            "PostgreSQL and SQL",
        ],
    ),
    PlanSpec(
        "Python Full Stack",
        "Python on the server, PostgreSQL for the data, and the cloud skills "
        "to put it somewhere real.",
        89_900,  # ₹899/month
        BillingInterval.MONTHLY,
        [
            "HTML and CSS Foundations",
            "Python Essentials",
            "PostgreSQL and SQL",
            "Cloud Computing Foundations",
        ],
    ),
    PlanSpec(
        "Next.js Full Stack",
        "The modern TypeScript stack: Next.js and TypeScript in front, Node "
        "and PostgreSQL behind.",
        99_900,  # ₹999/month
        BillingInterval.MONTHLY,
        [
            "TypeScript for JavaScript Developers",
            "Next.js App Router",
            "Node.js and Express",
            "PostgreSQL and SQL",
        ],
    ),
    PlanSpec(
        "Java Full Stack",
        "What most large back ends actually run: Java and PostgreSQL on the "
        "server, React in front, deployed to the cloud.",
        109_900,  # ₹1,099/month
        BillingInterval.MONTHLY,
        [
            "Java Fundamentals",
            "PostgreSQL and SQL",
            "React Essentials",
            "Cloud Computing Foundations",
        ],
    ),
]

ALL_ACCESS: list[PlanSpec] = [
    PlanSpec(
        "All Access Monthly",
        "Every course on the platform, including new ones, while your plan is "
        "active.",
        149_900,  # ₹1,499/month
        BillingInterval.MONTHLY,
        [spec.title for spec in CATALOGUE],
    ),
    PlanSpec(
        "All Access Yearly",
        "Every course, billed once a year. Two months cheaper than paying "
        "monthly.",
        1_499_900,  # ₹14,999/year
        BillingInterval.YEARLY,
        [spec.title for spec in CATALOGUE],
    ),
]

PLANS: list[PlanSpec] = [*STACK_BUNDLES, *ALL_ACCESS]


def check_bundles() -> None:
    """A bundle that names a course we do not have is caught HERE.

    Bundles reference courses by title, which is the readable way to write them
    and also the way to get a silent hole: a typo would link three courses
    instead of four, the plan would still seed, still sell, and the missing
    course would simply never appear. `upsert_plans` skips unknown titles by
    design, so nothing downstream would complain either.
    """
    known = {spec.title for spec in CATALOGUE}
    for plan in PLANS:
        missing = [title for title in plan.course_titles if title not in known]
        if missing:
            raise SystemExit(
                f"Plan {plan.name!r} names courses that are not in the "
                f"catalogue: {', '.join(missing)}"
            )
        if not plan.course_titles:
            raise SystemExit(f"Plan {plan.name!r} covers no courses.")


def check_email(address: str) -> None:
    """Fail loudly here rather than as an opaque 500 at request time.

    Seeding writes through the ORM, which does not apply the API's Pydantic
    rules — so it can create a row the API is then unable to serialise.
    """
    try:
        validate_email(address, check_deliverability=False)
    except EmailNotValidError as exc:
        raise SystemExit(
            f"{address!r} is not an address the API can return: {exc}"
        ) from exc


async def upsert_user(
    session, *, email: str, name: str, password: str, role: UserRole
) -> User:
    check_email(email)
    user = (
        await session.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()

    if user is None:
        user = User(
            name=name,
            email=email,
            hashed_password=hash_password(password),
            role=role,
            is_active=True,
            is_superuser=role in (UserRole.ADMIN, UserRole.SUPER_ADMIN),
            is_verified=True,
        )
        session.add(user)
        print(f"  + {role.value:<12} {email}")
    else:
        user.role = role
        user.is_superuser = role in (UserRole.ADMIN, UserRole.SUPER_ADMIN)
        print(f"  = {role.value:<12} {email}")
    return user


async def upsert_course(session, spec: CourseSpec) -> Course:
    course = (
        await session.execute(select(Course).where(Course.title == spec.title))
    ).scalar_one_or_none()

    # How long a purchase lasts. The catalogue may state it; otherwise it is
    # sized from the module count by the SAME function the admin screen and
    # migration 0016 use, so a seeded course and an authored one cannot end up
    # quoting different windows for the same length of course.
    access_days = spec.access_days or extensions.suggested_days(len(spec.modules))

    if course is None:
        course = Course(
            title=spec.title,
            description=spec.description,
            price_minor=spec.price_minor,
            list_price_minor=spec.list_price_minor,
            access_days=access_days,
            currency="INR",
            is_published=spec.is_published,
            # PUBLISHED MEANS APPROVED, matching what migration 0019 did to
            # every course that already existed when review was introduced
            # ("UPDATE courses SET review_status = 'approved' WHERE
            # is_published = true"). Without this the seed manufactured the one
            # state the workflow says cannot exist: a course on sale that
            # review has never seen. Submitting one then left it PENDING and
            # still published, which is what issue 37 reported.
            review_status=(
                CourseReviewStatus.APPROVED
                if spec.is_published
                else CourseReviewStatus.DRAFT
            ),
        )
        session.add(course)
        await session.flush()
        print(f"\n  + {spec.title} ({spec.price_label})")
    else:
        # Description and price are refreshed from the catalogue; anything an
        # admin changed in the app is overwritten on a re-seed, which is why
        # this is a dev script and refuses to run in production.
        course.description = spec.description
        course.price_minor = spec.price_minor
        course.list_price_minor = spec.list_price_minor
        course.access_days = access_days
        course.is_published = spec.is_published
        # Same rule on a re-seed, or a course published here on the second run
        # drifts back into the contradictory state.
        if spec.is_published and course.review_status is CourseReviewStatus.DRAFT:
            course.review_status = CourseReviewStatus.APPROVED
        print(f"\n  = {spec.title} ({spec.price_label})")

    for order, module_spec in enumerate(spec.modules):
        module = (
            await session.execute(
                select(Module).where(
                    Module.course_id == course.id, Module.order == order
                )
            )
        ).scalar_one_or_none()

        if module is None:
            module = Module(
                course_id=course.id,
                title=module_spec.title,
                order=order,
                content=module_spec.content.strip(),
            )
            session.add(module)
            await session.flush()
            print(f"      + module {order}: {module_spec.title}")
        else:
            module.title = module_spec.title
            module.content = module_spec.content.strip()
            print(f"      = module {order}: {module_spec.title}")

        existing_quiz = (
            await session.execute(
                select(QuizQuestion).where(QuizQuestion.module_id == module.id)
            )
        ).scalars().all()
        if not existing_quiz:
            for question, options, answer in module_spec.quiz:
                session.add(
                    QuizQuestion(
                        module_id=module.id,
                        question=question,
                        options=options,
                        correct_answer=answer,
                    )
                )
            if module_spec.quiz:
                print(f"          + {len(module_spec.quiz)} quiz questions")

        existing_assignments = (
            await session.execute(
                select(Assignment).where(Assignment.module_id == module.id)
            )
        ).scalars().all()
        if not existing_assignments:
            for title, prompt, accepted, mode in module_spec.assignments:
                session.add(
                    Assignment(
                        module_id=module.id,
                        title=title,
                        prompt=prompt,
                        accepted_answers=accepted,
                        match_mode=mode,
                    )
                )
            if module_spec.assignments:
                print(f"          + {len(module_spec.assignments)} assignment(s)")

    exam = (
        await session.execute(
            select(CertExam).where(CertExam.course_id == course.id)
        )
    ).scalar_one_or_none()
    if exam is None:
        session.add(
            CertExam(
                course_id=course.id,
                title=spec.exam_title,
                default_max_attempts=settings.cert_default_max_attempts,
            )
        )
        print(f"      + cert exam ({settings.cert_default_max_attempts} attempts)")

    return course


async def upsert_plans(session, courses_by_title: dict[str, Course]) -> None:
    print("\n  bundles and subscriptions")
    for spec in PLANS:
        plan = (
            await session.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.name == spec.name)
            )
        ).scalar_one_or_none()

        label = f"₹{spec.price_minor // 100:,}/{spec.interval.value}"
        size = f"{len(spec.course_titles)} courses"

        if plan is None:
            plan = SubscriptionPlan(
                name=spec.name,
                description=spec.description,
                price_minor=spec.price_minor,
                currency="INR",
                billing_interval=spec.interval,
                is_active=True,
            )
            session.add(plan)
            await session.flush()
            print(f"      + {spec.name} ({label}, {size})")
        else:
            plan.description = spec.description
            plan.price_minor = spec.price_minor
            plan.billing_interval = spec.interval
            plan.is_active = True
            print(f"      = {spec.name} ({label}, {size})")

        wanted = {
            courses_by_title[title].id
            for title in spec.course_titles
            if title in courses_by_title
        }
        existing = {
            row.course_id
            for row in (
                await session.execute(
                    select(PlanCourse).where(PlanCourse.plan_id == plan.id)
                )
            ).scalars()
        }

        for course_id in wanted - existing:
            session.add(PlanCourse(plan_id=plan.id, course_id=course_id))

        # AND REMOVE WHAT IS NO LONGER IN THE BUNDLE. The previous version only
        # ever added, so editing a bundle here left the dropped course still
        # linked in the database — and a plan_courses row is what actually
        # grants access, so the bundle would keep unlocking a course it no
        # longer advertises, and the pricing page and the paywall would
        # disagree about what was sold.
        for course_id in existing - wanted:
            await session.execute(
                delete(PlanCourse).where(
                    PlanCourse.plan_id == plan.id,
                    PlanCourse.course_id == course_id,
                )
            )
            print(f"          - unlinked a course no longer in {spec.name}")


async def main() -> None:
    if SessionLocal is None:
        raise SystemExit(
            "DATABASE_URL is not set. Add it to backend/.env (see .env.example)."
        )
    if settings.is_production:
        raise SystemExit(
            "Refusing to seed a production environment. This creates known "
            "passwords and overwrites course content."
        )

    # Before touching the database, not after: a bundle with a mistyped course
    # title should stop the script, not half-seed one.
    check_bundles()

    async with SessionLocal() as session:
        print("accounts")
        # NAMED AFTER THE ROLE, because these names are what a tester reads
        # in a message picker or a training report. "Platform Owner" sat beside
        # "Platform Admin" in those lists and read as a rank above it — a tier
        # this product decided it does not have. The ladder is super admin,
        # platform admin, organisation admin, and nothing above it.
        await upsert_user(
            session,
            email=SUPER_ADMIN_EMAIL,
            name="Super Admin",
            password=SUPER_ADMIN_PASSWORD,
            role=UserRole.SUPER_ADMIN,
        )
        await upsert_user(
            session,
            email=ADMIN_EMAIL,
            name="Platform Admin",
            password=ADMIN_PASSWORD,
            role=UserRole.ADMIN,
        )
        await upsert_user(
            session,
            email=STUDENT_EMAIL,
            name="Sample Learner",
            password=STUDENT_PASSWORD,
            role=UserRole.STUDENT,
        )

        courses_by_title: dict[str, Course] = {}
        for spec in CATALOGUE:
            course = await upsert_course(session, spec)
            courses_by_title[spec.title] = course

        await upsert_plans(session, courses_by_title)
        await session.commit()

    total_modules = sum(len(spec.modules) for spec in CATALOGUE)
    total_quiz = sum(len(m.quiz) for spec in CATALOGUE for m in spec.modules)
    total_assignments = sum(
        len(m.assignments) for spec in CATALOGUE for m in spec.modules
    )
    paid = [spec for spec in CATALOGUE if spec.price_minor > 0]

    print()
    print("Seed complete.")
    print(f"  super admin : {SUPER_ADMIN_EMAIL} / {SUPER_ADMIN_PASSWORD}")
    print(f"  admin       : {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    print(f"  student     : {STUDENT_EMAIL} / {STUDENT_PASSWORD}")
    print(f"  courses     : {len(CATALOGUE)} ({len(paid)} paid, "
          f"{len(CATALOGUE) - len(paid)} free)")
    print(f"  modules     : {total_modules}")
    print(f"  quizzes     : {total_quiz} questions")
    print(f"  assignments : {total_assignments}")
    print(f"  bundles     : {len(STACK_BUNDLES)}")
    for spec in STACK_BUNDLES:
        print(
            f"                {spec.name} · "
            + ", ".join(spec.course_titles)
        )
    print(f"  all access  : {len(ALL_ACCESS)}")
    if not settings.payments_enabled:
        print()
        print("  NOTE: Razorpay keys are not set, so paid courses cannot be")
        print("        bought yet. Free courses work. See backend/.env.example.")


if __name__ == "__main__":
    asyncio.run(main())
