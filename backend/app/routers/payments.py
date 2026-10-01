"""Checkout: start an order, confirm it, and see what you own.

The client never sends an amount and never sends "this is paid". It asks to buy
a course, gets back a provider order id to hand to Razorpay's widget, and comes
back with a signature that this service verifies. See `services/payments.py`.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.core.config import settings
from app.deps import CurrentUser, DbSession
from app.models.course import Course
from app.models.order import OrderStatus
from app.models.subscription import SubscriptionPlan
from app.services import access, payments

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["payments"])


class CheckoutSession(BaseModel):
    """What the browser needs to open Razorpay's widget.

    `key_id` is publishable — Razorpay's checkout requires it client-side. The
    key SECRET is not here and must never be.
    """

    order_id: uuid.UUID
    provider_order_id: str
    amount_minor: int
    currency: str
    key_id: str
    item_name: str


class ConfirmRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class OrderRead(BaseModel):
    id: uuid.UUID
    status: str
    amount_minor: int
    currency: str
    course_id: uuid.UUID | None
    plan_id: uuid.UUID | None
    created_at: str | None = None


class EntitlementsRead(BaseModel):
    """What this user may open, for the UI to render locks with."""

    course_ids: list[uuid.UUID]
    # None-equivalent: staff see everything, so the list above is not the whole
    # story and the UI should not draw locks at all.
    unrestricted: bool


def _require_payments() -> None:
    if not settings.payments_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Payments are not configured on this server. Free courses are "
                "unaffected."
            ),
        )


@router.get("/entitlements", response_model=EntitlementsRead)
async def my_entitlements(
    session: DbSession, user: CurrentUser
) -> EntitlementsRead:
    ids = await access.accessible_course_ids(session, user)
    if ids is None:
        return EntitlementsRead(course_ids=[], unrestricted=True)
    return EntitlementsRead(course_ids=sorted(ids), unrestricted=False)


@router.post(
    "/courses/{course_id}/checkout",
    response_model=CheckoutSession,
    status_code=status.HTTP_201_CREATED,
)
async def start_course_checkout(
    course_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> CheckoutSession:
    _require_payments()

    course = await session.get(Course, course_id)
    if course is None or not course.is_published:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )

    # There is no marketplace inside a walled garden (decision 178), so an org
    # course carries no price and `start_course_purchase` refuses it as free.
    # That refusal confirms the course exists, and it rests on an invariant kept
    # somewhere else. Tenancy is the rule that actually applies here.
    try:
        await access.require_course_in_tenant(session, user, course_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        ) from None

    try:
        order = await payments.start_course_purchase(
            session, user=user, course=course
        )
    except payments.PaymentsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from None
    except payments.PaymentError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    return CheckoutSession(
        order_id=order.id,
        provider_order_id=order.provider_order_id or "",
        amount_minor=order.amount_minor,
        currency=order.currency,
        key_id=settings.razorpay_key_id or "",
        item_name=course.title,
    )


@router.post(
    "/plans/{plan_id}/checkout",
    response_model=CheckoutSession,
    status_code=status.HTTP_201_CREATED,
)
async def start_plan_checkout(
    plan_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> CheckoutSession:
    plan = await session.get(SubscriptionPlan, plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found."
        )
    # Razorpay cannot take a payment of nothing. A free plan is claimed.
    # Asked BEFORE the payments switch: with no keys set, a free bundle was
    # answered "Payments are not configured", the very message a tester
    # reported against a bundle that costs nothing.
    if plan.price_minor == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This plan is free. Claim it instead of checking out.",
        )
    _require_payments()

    try:
        order = await payments.start_plan_purchase(session, user=user, plan=plan)
    except payments.PaymentError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    return CheckoutSession(
        order_id=order.id,
        provider_order_id=order.provider_order_id or "",
        amount_minor=order.amount_minor,
        currency=order.currency,
        key_id=settings.razorpay_key_id or "",
        item_name=plan.name,
    )


class ClaimResult(BaseModel):
    plan_id: uuid.UUID
    renews_at: str


@router.post("/plans/{plan_id}/claim", response_model=ClaimResult)
async def claim_free_plan(
    plan_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> ClaimResult:
    """Hold a plan that costs nothing. No payment provider is involved.

    Works whether or not Razorpay is configured, because nothing is paid: a
    bundle priced at 0 used to answer "Payments are not configured on this
    server" and could not be had at all.
    """
    plan = await session.get(SubscriptionPlan, plan_id)
    if plan is None or not plan.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found."
        )
    # There is no marketplace inside an organisation (decision 178), free or not.
    if user.organization_id is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found."
        )

    try:
        subscription = await payments.claim_free_plan(session, user=user, plan=plan)
    except payments.PaymentError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None
    await session.commit()
    return ClaimResult(
        plan_id=plan.id, renews_at=subscription.current_period_end.isoformat()
    )


@router.post("/confirm", response_model=list[OrderRead])
async def confirm(
    payload: ConfirmRequest, session: DbSession, user: CurrentUser
) -> list[OrderRead]:
    """Verify Razorpay's callback and, only then, mark the orders paid.

    A LIST, because one payment can settle a whole basket. It was a single
    object while a payment could only buy one thing; a cart of three courses
    returns three rows, and the page that opened the widget needs all of them
    to know what it just bought.
    """
    _require_payments()

    try:
        orders = await payments.confirm_payment(
            session,
            user=user,
            provider_order_id=payload.razorpay_order_id,
            provider_payment_id=payload.razorpay_payment_id,
            signature=payload.razorpay_signature,
        )
    except payments.SignatureMismatchError as exc:
        # 400, not 403: the caller is authenticated, the message is not
        # trustworthy. The detail stays vague on purpose.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None
    except payments.PaymentError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    return [
        OrderRead(
            id=order.id,
            status=order.status.value,
            amount_minor=order.amount_minor,
            currency=order.currency,
            course_id=order.course_id,
            plan_id=order.plan_id,
        )
        for order in orders
    ]


@router.post("/webhook", include_in_schema=False)
async def razorpay_webhook(request: Request, session: DbSession) -> Response:
    """Razorpay's server-to-server notification.

    Belt and braces: the browser callback already confirms most payments, but
    a customer who closes the tab mid-redirect would otherwise have paid and
    received nothing. Verified against the WEBHOOK secret, over the RAW body —
    re-serialising the parsed JSON would change the bytes and never match.
    """
    body = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")

    if not payments.webhook_signature_is_valid(body=body, signature=signature):
        logger.warning("Rejected a webhook with a bad signature")
        # 400 rather than 403 so Razorpay stops retrying a request we will
        # never accept.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature."
        )

    import json

    try:
        event = json.loads(body)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed body."
        ) from None

    if event.get("event") == "payment.captured":
        entity = (
            event.get("payload", {}).get("payment", {}).get("entity", {})
        )
        provider_order_id = entity.get("order_id")
        provider_payment_id = entity.get("id")

        if provider_order_id:
            # EVERY ROW THE PAYMENT COVERS, not the first one found. A cart
            # checkout writes one row per course against a single provider
            # order, and this is the path that runs when the customer closed
            # the tab — so getting it wrong here means somebody paid for three
            # courses, saw nothing, and got one.
            orders = await payments.orders_for_provider_order(
                session, provider_order_id
            )
            unpaid = [
                order for order in orders if order.status is not OrderStatus.PAID
            ]
            if unpaid:
                # The same body the browser callback uses. These two drifted
                # apart once — the webhook marked an order paid and never
                # started the subscription it bought — and sharing the code is
                # what stops that happening again.
                await payments.mark_paid(
                    session, orders, provider_payment_id=provider_payment_id
                )
                await session.commit()
                logger.info(
                    "Payment %s marked %d order(s) paid by webhook",
                    provider_order_id,
                    len(unpaid),
                )

    # Always 200 once verified, so Razorpay does not retry an event we have
    # deliberately ignored.
    return Response(status_code=status.HTTP_200_OK)
