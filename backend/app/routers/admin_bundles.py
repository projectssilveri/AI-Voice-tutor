"""Bundles and packages, for platform staff.

List them, see who bought each one, change what they cost and what they cover,
and create new ones.

PLATFORM STAFF, all of it, including the read: a super admin or a platform
admin. Money was the super admin's alone until the role model of 2026-10-01
gave platform admins the same work.

A bundle is never deleted here. `subscriptions.plan_id` and `orders.plan_id`
are RESTRICT, so deleting one would either fail or orphan a receipt. Retiring
it (`is_active = false`) takes it off sale and leaves every holder untouched,
which is what "remove this bundle" actually means once somebody has bought it.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.deps import DbSession, RequireAdmin
from app.models.subscription import BillingInterval, SubscriptionPlan
from app.schemas.text import NonBlankName, OptionalNonBlankName
from app.services import audit, plans

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/bundles", tags=["admin"])


class BundleCourseRead(BaseModel):
    id: uuid.UUID
    title: str
    price_minor: int
    is_published: bool


class BundleRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    price_minor: int
    currency: str
    billing_interval: str
    is_active: bool
    created_at: datetime

    courses: list[BundleCourseRead]
    course_count: int
    #: Covers the whole published catalogue, so it is All Access rather than a
    #: stack bundle. Counted from the course links, or true when flagged.
    covers_everything: bool
    #: Flagged All Access: every public course is in it automatically,
    #: including ones created later.
    all_access: bool
    #: What those courses cost bought one at a time, at today's prices.
    separate_total_minor: int

    active_subscribers: int
    total_subscribers: int
    paid_orders: int
    gross_minor: int
    refunded_minor: int
    net_minor: int


class BundleHolderRead(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    #: A subscription status, or "paid_not_granted" — see below.
    status: str
    started_at: datetime | None
    period_end: datetime | None
    cancelled: bool
    live: bool
    paid_minor: int
    orders: int


def _to_read(summary: plans.PlanSummary) -> BundleRead:
    return BundleRead(
        id=summary.id,
        name=summary.name,
        description=summary.description,
        price_minor=summary.price_minor,
        currency=summary.currency,
        billing_interval=summary.billing_interval,
        is_active=summary.is_active,
        created_at=summary.created_at,
        courses=[
            BundleCourseRead(
                id=row.id,
                title=row.title,
                price_minor=row.price_minor,
                is_published=row.is_published,
            )
            for row in summary.courses
        ],
        course_count=len(summary.courses),
        covers_everything=summary.covers_everything,
        all_access=summary.all_access,
        separate_total_minor=summary.separate_total_minor,
        active_subscribers=summary.active_subscribers,
        total_subscribers=summary.total_subscribers,
        paid_orders=summary.paid_orders,
        gross_minor=summary.gross_minor,
        refunded_minor=summary.refunded_minor,
        net_minor=summary.net_minor,
    )


@router.get("", response_model=list[BundleRead])
async def list_bundles(
    session: DbSession, admin: RequireAdmin
) -> list[BundleRead]:
    """Every bundle and package, on sale or retired, with its numbers."""
    return [_to_read(summary) for summary in await plans.list_plans(session)]


@router.get("/{plan_id}/holders", response_model=list[BundleHolderRead])
async def list_bundle_holders(
    plan_id: uuid.UUID, session: DbSession, admin: RequireAdmin
) -> list[BundleHolderRead]:
    """Who bought this bundle, and where each of them stands.

    A row with status `paid_not_granted` is somebody who paid and has no
    subscription — money taken and nothing given. It is listed rather than
    filtered out because that is the only way anybody would notice it.
    """
    if await session.get(SubscriptionPlan, plan_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Bundle not found."
        )
    return [
        BundleHolderRead(**holder.__dict__)
        for holder in await plans.holders_of(session, plan_id)
    ]


class BundleCreate(BaseModel):
    name: NonBlankName
    description: str | None = Field(default=None, max_length=2_000)
    # Integer minor units (paise). 0 is allowed — a free bundle is a coherent
    # thing to offer — and negative is not.
    price_minor: int = Field(ge=0, le=100_000_000)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    billing_interval: BillingInterval = BillingInterval.MONTHLY
    course_ids: list[uuid.UUID] = Field(default_factory=list)
    is_active: bool = True
    #: Every public course, now and later, whatever `course_ids` leaves out.
    all_access: bool = False


class BundleUpdate(BaseModel):
    """What a super admin may change about an existing bundle.

    Every field is optional and absent means "leave it alone" — including
    `course_ids`, where an absent value leaves the membership untouched and an
    empty list genuinely empties it. Those are different intentions and the
    route has to be able to tell them apart.
    """

    name: OptionalNonBlankName
    description: str | None = Field(default=None, max_length=2_000)
    price_minor: int | None = Field(default=None, ge=0, le=100_000_000)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    billing_interval: BillingInterval | None = None
    is_active: bool | None = None
    course_ids: list[uuid.UUID] | None = None
    #: Switching it on links every public course straight away; switching it
    #: off leaves the list as it is, now an ordinary bundle.
    all_access: bool | None = None


@router.post("", response_model=BundleRead, status_code=status.HTTP_201_CREATED)
async def create_bundle(
    payload: BundleCreate, session: DbSession, admin: RequireAdmin
) -> BundleRead:
    """Add a bundle."""
    try:
        plan = await plans.create_plan(
            session,
            name=payload.name,
            description=payload.description,
            price_minor=payload.price_minor,
            currency=payload.currency,
            billing_interval=payload.billing_interval,
            course_ids=payload.course_ids,
            is_active=payload.is_active,
            all_access=payload.all_access,
        )
    except plans.PlanError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    await audit.record(
        session,
        action="bundle.created",
        actor=admin,
        target_type="subscription_plan",
        target_id=plan.id,
        metadata={
            "name": plan.name,
            "price_minor": plan.price_minor,
            "currency": plan.currency,
            "interval": plan.billing_interval.value,
            "course_count": len(payload.course_ids),
            "all_access": plan.all_access,
        },
    )
    await session.commit()

    return _find(await plans.list_plans(session), plan.id)


@router.patch("/{plan_id}", response_model=BundleRead)
async def update_bundle(
    plan_id: uuid.UUID,
    payload: BundleUpdate,
    session: DbSession,
    admin: RequireAdmin,
) -> BundleRead:
    """Change a bundle's price, name, availability or contents.

    TWO KINDS OF CHANGE, with very different consequences, and the audit record
    keeps both:

      PRICE affects the next person to buy. Nobody's existing order changes —
      `orders.amount_minor` is copied at purchase time exactly so a price
      change cannot rewrite what somebody already paid.

      COURSES affect everybody holding it, immediately. Access is a live join
      through `plan_courses`, so removing a course closes it for every current
      subscriber the moment this saves. That is the correct behaviour for a
      subscription and it is still worth knowing before pressing the button,
      which is why the screen warns and this records what changed.
    """
    plan = await session.get(SubscriptionPlan, plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Bundle not found."
        )

    changes = payload.model_dump(exclude_unset=True)
    course_ids = changes.pop("course_ids", None)
    before_price = plan.price_minor

    try:
        await plans.update_plan(
            session, plan, changes=changes, course_ids=course_ids
        )
    except plans.PlanError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    await audit.record(
        session,
        action="bundle.updated",
        actor=admin,
        target_type="subscription_plan",
        target_id=plan.id,
        metadata={
            "name": plan.name,
            "changed": sorted(changes.keys())
            + (["course_ids"] if course_ids is not None else []),
            "price_before_minor": before_price,
            "price_after_minor": plan.price_minor,
            "course_count": (
                len(course_ids) if course_ids is not None else None
            ),
            "all_access": plan.all_access,
        },
    )
    await session.commit()

    return _find(await plans.list_plans(session), plan.id)


def _find(summaries: list[plans.PlanSummary], plan_id: uuid.UUID) -> BundleRead:
    """The freshly saved bundle, read back with its numbers."""
    for summary in summaries:
        if summary.id == plan_id:
            return _to_read(summary)
    # Unreachable: the plan was just committed in this transaction.
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="The bundle was saved but could not be read back.",
    )
