"""Course and module schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas import ORMModel
from app.schemas.text import NonBlankName, OptionalNonBlankName


class ModuleBase(BaseModel):
    title: NonBlankName
    order: int | None = Field(
        default=None,
        ge=0,
        description=(
            "Position within the course, 0-based. Omit to append: the server "
            "reads the highest position that exists and adds one. Both "
            "authoring screens used to work this out themselves and they "
            "disagreed, so a course with a deleted module refused the next "
            "one."
        ),
    )
    content: str | None = Field(
        default=None,
        description=(
            "Text the AI tutor is grounded in for this module. This is the "
            "only material it may teach or answer from."
        ),
    )


class ModuleCreate(ModuleBase):
    pass


class ModuleUpdate(BaseModel):
    title: OptionalNonBlankName
    order: int | None = Field(default=None, ge=0)
    content: str | None = None


class ModuleRead(ORMModel, ModuleBase):
    id: uuid.UUID
    course_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ModuleSummary(ORMModel):
    """Module without `content`.

    Course listings return many modules at once and the grounding text can run
    to thousands of words — sending it to render a sidebar is pure waste.
    """

    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    order: int
    has_content: bool
    # This requesting student's progress, so the list can show what is done
    # without a second round trip per module.
    status: str = "not_started"
    # What is inside, so the course page can offer the quiz, the assignments
    # and the handouts as direct links instead of making the student open the
    # module to find out whether they exist.
    estimated_minutes: int = 0
    quiz_questions: int = 0
    assignments: int = 0
    materials: int = 0
    # HOW MANY TIMES THIS STUDENT HAS PLAYED THE TUTOR HERE, against what the
    # course allows. Sent so the module list can say "1 of 3 left" rather than
    # letting somebody find out by pressing start and being refused. The
    # allowance itself lives on the course, not per module — it is repeated
    # here only so a single row is renderable on its own.
    tutor_sessions_used: int = 0


class CourseBase(BaseModel):
    title: NonBlankName
    description: str | None = None


class CourseCreate(CourseBase):
    pass


class CourseUpdate(BaseModel):
    """What an ordinary admin may change about a course.

    Deliberately has no price, currency or published flag. An admin authors
    content; deciding what a course costs and whether it is on sale is a money
    decision, and money belongs to the super admin. Because those fields are
    absent from this schema, an admin cannot set them by adding a line to the
    request body — the route would drop it.
    """

    title: OptionalNonBlankName
    description: str | None = None


class CoursePricingUpdate(BaseModel):
    """Super-admin only: price, currency, and whether it is on sale."""

    # Integer minor units (paise). 0 is a real value meaning free, so it is
    # allowed; negative is not.
    price_minor: int | None = Field(default=None, ge=0, le=10_000_000)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    is_published: bool | None = None

    # WHAT THE COURSE USED TO COST. Struck through beside the real price.
    #
    # Only ever a price the course GENUINELY carried. The route refuses a value
    # at or below the current price, because a "was" figure that is not higher
    # is either a mistake or a claim that is not true — and a fabricated
    # discount is a deceptive trade practice, not a design choice.
    list_price_minor: int | None = Field(default=None, ge=0, le=10_000_000)

    # HOW LONG A PURCHASE LASTS, in days. 0 clears it, which restores the older
    # "bought outright, never expires" rule for anything sold afterwards.
    access_days: int | None = Field(default=None, ge=0, le=3650)


class CourseLimitsUpdate(BaseModel):
    """Super-admin only: what the AI tutor may do on this course.

    Separate from `CoursePricingUpdate` because it is a different decision —
    that one is what a course COSTS, this is what it USES — and separate from
    `CourseUpdate` because an ordinary admin authors content and does not set
    the AI budget.

    Both fields accept null, and null is meaningful: it CLEARS the override and
    puts the course back on the platform default. Without that the only way to
    undo a per-course value would be to guess today's default and type it in,
    which then stops tracking the default when it changes.
    """

    # 0 is allowed and means "no tutor on this course", which is a coherent
    # thing to want on a reading-only course. The cap is a sanity bound, not a
    # policy: a course allowing 500 plays per module is somebody mistyping.
    ai_sessions_per_module: int | None = Field(default=None, ge=0, le=100)
    # Minutes. Not zero — a session that may run for no time cannot start, and
    # an operator typing 0 almost always means "no limit", which is not what it
    # would do.
    ai_session_minutes: int | None = Field(default=None, ge=1, le=600)


class CourseRead(ORMModel, CourseBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    # WHOSE COURSE THIS IS. NULL is a marketplace course; a value makes it one
    # customer's private training, which never reaches the public catalogue.
    #
    # Returned because a super admin's listing spans both, and a screen about
    # the public website could not tell them apart without it — it was showing
    # three organizations' internal compliance courses under "live on the
    # website, anyone can find and buy", which no visitor can see at all.
    organization_id: uuid.UUID | None = None
    price_minor: int = 0
    # Both returned, or the pricing form would reset itself: it re-seeds from
    # the response, so a field the response omits reads back as cleared and the
    # admin watches their own edit disappear.
    list_price_minor: int | None = None
    access_days: int | None = None
    # What `access_days` WOULD be for a course this size. The pricing form used
    # to compute this itself, which put the formula in three places — here, the
    # migration that backfilled it, and a literal in the form. Sent from the
    # server so the admin screen and the data can never quote different numbers.
    suggested_access_days: int | None = None
    currency: str = "INR"
    # Matches the column's default. It read `True` here, contradicting the
    # model, which defaults a new course to unpublished so an author has
    # somewhere to write it before it is on sale. Values always come from the
    # ORM today, so nothing was mis-reported — but a default that disagrees
    # with the column is a trap for whoever first builds this schema by hand.
    is_published: bool = False
    # Populated by the list endpoint only; None when a single course is
    # returned, where the caller has the modules themselves.
    module_count: int | None = None
    # WHETHER THE COURSE ENDS IN AN EXAM. Listing only, for the same reason as
    # `module_count`: a single course is fetched with everything hanging off
    # it, so the caller can already see. On the list it is not derivable from
    # any other field, and without it the authoring screen could not say
    # whether a course offered a certificate or nothing at all (issue 74).
    has_certification: bool | None = None

    # --- Approval --------------------------------------------------------
    # draft | pending | approved | rejected. An ordinary admin writes and
    # submits; only the super admin decides.
    review_status: str = "draft"
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None
    #: Why it was sent back, written for the author to act on.
    review_note: str | None = None

    # --- What the AI tutor is allowed to do ------------------------------
    # The RAW columns, so the super admin's form can tell "set to 3" from "not
    # set". None means the platform default applies.
    ai_sessions_per_module: int | None = None
    ai_session_minutes: int | None = None
    # And what those actually RESOLVE to, which is what the student is
    # governed by. Computed server-side from `limits.tutor_allowance_for`, so
    # the admin screen cannot show one number while the tutor enforces
    # another.
    effective_ai_sessions_per_module: int = 0
    effective_ai_session_minutes: int = 0
    # "free" or "paid" — which default was used. Shown on the form so an
    # operator can see WHY the default is what it is.
    ai_limit_basis: str = "free"


class CourseWithModules(CourseRead):
    modules: list[ModuleSummary] = Field(default_factory=list)
    # Whether the requesting student is enrolled. Governs progress tracking and
    # the voice tutor — never whether the material can be read.
    enrolled: bool = False
    # Whether they are entitled to it: free, bought, subscribed, or staff.
    # Enrolment and access are separate — you can lose access to a course you
    # are enrolled in (a refund), and hold access to one you have not enrolled
    # in yet.
    has_access: bool = True
    # "free" | "purchased" | "subscription" | "staff" | "payment_required".
    access_reason: str = "free"

    # WHEN THEY GOT IT AND WHEN IT RUNS OUT. Computed by
    # `enrollments.entitlement_dates`, the same helper the course LIST uses, so
    # the two screens cannot tell a student different expiry dates.
    #
    # A null `expires_at` with access_via "purchase" means never — the UI says
    # so in words rather than printing a dash the reader has to interpret.
    purchased_at: datetime | None = None
    expires_at: datetime | None = None
    #: purchase | subscription | free | enrolled
    access_via: str = "enrolled"
