"""Razorpay checkout.

The security property this file exists to hold:

    An order becomes PAID only after `razorpay_signature` verifies against our
    key secret. The browser cannot grant itself a course.

Razorpay's checkout runs in the client and calls back with a payment id and a
signature. The signature is HMAC-SHA256 of "{order_id}|{payment_id}" keyed by
the account's key secret, which only this service holds. Verifying it is the
difference between taking payment and letting anyone POST themselves a free
course.

`hmac.compare_digest` rather than `==`, so the comparison does not leak where
the first differing byte is to someone timing the endpoint.

No SDK: the two calls needed are a POST to create an order and an HMAC, and
`httpx` is already a dependency. That is one less package with our key secret
in its process.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import redact
from app.models.course import Course
from app.models.order import Order, OrderStatus
from app.models.subscription import (
    BillingInterval,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
)
from app.models.user import User

logger = logging.getLogger(__name__)

RAZORPAY_ORDERS_URL = "https://api.razorpay.com/v1/orders"
REQUEST_TIMEOUT = 20.0


class PaymentsNotConfiguredError(RuntimeError):
    """No Razorpay keys. Checkout cannot run; free courses still can."""


class PaymentError(RuntimeError):
    """The provider refused, or something about the order does not add up."""


class SignatureMismatchError(PaymentError):
    """The callback did not come from Razorpay, or was tampered with."""


def _auth() -> tuple[str, str]:
    if not settings.payments_enabled:
        raise PaymentsNotConfiguredError(
            "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set. Add them to "
            "backend/.env, and see .env.example."
        )
    return (settings.razorpay_key_id or "", settings.razorpay_key_secret or "")


def _safe_body(response: httpx.Response) -> str:
    """A provider response body, fit to log.

    JSON goes through `redact` so any field named like a credential is masked.
    A non-JSON body cannot be walked key by key, so it is truncated instead —
    better a clipped diagnostic than an unbounded blob in the log file.
    """
    try:
        parsed = response.json()
    except ValueError:
        return response.text[:500]
    if isinstance(parsed, dict):
        return str(redact(parsed))[:500]
    return str(parsed)[:500]


async def _create_provider_order(
    *, amount_minor: int, currency: str, receipt: str
) -> str:
    """Ask Razorpay for an order id. Returns the provider's id."""
    payload = {
        "amount": amount_minor,
        "currency": currency,
        "receipt": receipt,
        # Razorpay may auto-capture; we still only trust our own verification.
        "payment_capture": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.post(
                RAZORPAY_ORDERS_URL, json=payload, auth=_auth()
            )
    except httpx.HTTPError as exc:
        logger.exception("Could not reach Razorpay")
        raise PaymentError("Could not reach the payment provider.") from exc

    if response.status_code >= 400:
        # Razorpay's message is safe to show an operator but not a customer: it
        # can name account-level configuration problems.
        #
        # Redacted rather than logged raw. This is the only place a third
        # party's payload reaches our log file, and we do not control what they
        # put in it — an error body that echoes back part of the request, or
        # grows a new field in a future API version, would otherwise land in
        # the log verbatim. `redact` was written for exactly this and had no
        # caller until now.
        logger.error(
            "Razorpay rejected an order (%s): %s",
            response.status_code,
            _safe_body(response),
        )
        raise PaymentError("The payment provider rejected this order.")

    provider_order_id = response.json().get("id")
    if not provider_order_id:
        raise PaymentError("The payment provider returned no order id.")
    return str(provider_order_id)


async def _record_then_register(
    session: AsyncSession, order: Order, *, receipt_prefix: str
) -> Order:
    """Save the order, THEN ask Razorpay for one, then save its id.

    Ordering matters, for two reasons.

    Money: if the provider is called first, or inside the same open
    transaction, there is a window where Razorpay has an order that we never
    recorded — a customer could pay against an order id our webhook cannot
    find. Committing our row first inverts the failure: the worst outcome
    becomes a local order with no provider id, which is inert, obvious, and
    cleanable.

    Connections: `_create_provider_order` is a network call to a third party.
    Holding a database transaction open across it pins a pooled connection for
    however long Razorpay takes, and under load that exhausts the pool long
    before the payment provider is the bottleneck.
    """
    session.add(order)
    await session.commit()
    await session.refresh(order)

    try:
        provider_order_id = await _create_provider_order(
            amount_minor=order.amount_minor,
            currency=order.currency,
            receipt=f"{receipt_prefix}-{order.id}",
        )
    except PaymentError:
        # Leave the row as CREATED with no provider id. It grants nothing —
        # only `paid` does — and it records that someone tried, which is worth
        # having when they write in to ask why checkout failed.
        order.failure_reason = "Could not create an order with the provider."
        await session.commit()
        raise

    order.provider_order_id = provider_order_id
    await session.commit()
    await session.refresh(order)
    return order


async def start_course_purchase(
    session: AsyncSession, *, user: User, course: Course
) -> Order:
    """Create a pending order for one course.

    The amount comes from the course row, never from the request. Letting the
    client name its own price is the oldest bug in online payments.
    """
    if course.price_minor <= 0:
        raise PaymentError("This course is free, so no payment is needed.")

    existing = await session.scalar(
        select(Order).where(
            Order.user_id == user.id,
            Order.course_id == course.id,
            Order.status == OrderStatus.PAID,
        )
    )
    if existing is not None:
        raise PaymentError("You already own this course.")

    order = Order(
        user_id=user.id,
        course_id=course.id,
        amount_minor=course.price_minor,
        currency=course.currency,
        status=OrderStatus.CREATED,
        provider="razorpay",
    )
    return await _record_then_register(session, order, receipt_prefix="course")


async def start_plan_purchase(
    session: AsyncSession, *, user: User, plan: SubscriptionPlan
) -> Order:
    """Create a pending order for a subscription plan."""
    if not plan.is_active:
        raise PaymentError("That plan is no longer available.")

    order = Order(
        user_id=user.id,
        plan_id=plan.id,
        amount_minor=plan.price_minor,
        currency=plan.currency,
        status=OrderStatus.CREATED,
        provider="razorpay",
    )
    return await _record_then_register(session, order, receipt_prefix="plan")


def signature_is_valid(
    *, provider_order_id: str, provider_payment_id: str, signature: str
) -> bool:
    """Verify Razorpay's callback signature.

    HMAC-SHA256 over "{order_id}|{payment_id}", keyed by the account secret.
    """
    _, secret = _auth()
    expected = hmac.new(
        secret.encode(),
        f"{provider_order_id}|{provider_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    # Constant-time: a plain == leaks the position of the first wrong byte to
    # anyone willing to time the endpoint.
    return hmac.compare_digest(expected, signature)


async def confirm_payment(
    session: AsyncSession,
    *,
    user: User,
    provider_order_id: str,
    provider_payment_id: str,
    signature: str,
) -> Order:
    """Mark an order paid, if and only if the signature checks out.

    Returns the order. Raises rather than returning a failure flag, so a caller
    cannot forget to look.
    """
    order = await session.scalar(
        select(Order).where(Order.provider_order_id == provider_order_id)
    )
    if order is None:
        raise PaymentError("No such order.")

    # The order belongs to whoever created it. Without this check, anyone could
    # confirm someone else's order and have the course land on their account.
    if order.user_id != user.id:
        logger.warning(
            "User %s tried to confirm order %s belonging to %s",
            user.id,
            order.id,
            order.user_id,
        )
        raise PaymentError("No such order.")

    if order.status is OrderStatus.PAID:
        return order  # Razorpay retries; confirming twice is not an error.

    if not signature_is_valid(
        provider_order_id=provider_order_id,
        provider_payment_id=provider_payment_id,
        signature=signature,
    ):
        order.status = OrderStatus.FAILED
        order.failure_reason = "Signature verification failed."
        await session.commit()
        logger.warning("Signature mismatch on order %s", order.id)
        raise SignatureMismatchError("Payment could not be verified.")

    order.status = OrderStatus.PAID
    order.provider_payment_id = provider_payment_id
    order.paid_at = datetime.now(UTC)

    # Paying for a plan has to produce the thing that actually grants access.
    # Marking the order paid alone would take the money and give nothing: the
    # access check reads `subscriptions`, not `orders`.
    if order.plan_id is not None:
        await fulfil_plan_order(session, order)

    await session.commit()
    await session.refresh(order)

    logger.info(
        "Order %s paid (%s %s) by user %s",
        order.id,
        order.amount_minor,
        order.currency,
        user.id,
    )
    return order


async def fulfil_plan_order(session: AsyncSession, order: Order) -> Subscription:
    """Start or extend the subscription a paid plan order bought.

    Renewal moves the existing row's window forward rather than inserting a
    second one — `subscriptions` is unique on (user, plan), and a student
    renewing should not end up with two rows racing each other.

    Extending from the later of "now" and the current period end means paying
    early adds time rather than throwing the remainder away.
    """
    plan = await session.get(SubscriptionPlan, order.plan_id)
    if plan is None:
        raise PaymentError("That plan no longer exists.")

    now = datetime.now(UTC)
    days = 365 if plan.billing_interval is BillingInterval.YEARLY else 30

    existing = await session.scalar(
        select(Subscription).where(
            Subscription.user_id == order.user_id,
            Subscription.plan_id == plan.id,
        )
    )

    if existing is None:
        subscription = Subscription(
            user_id=order.user_id,
            plan_id=plan.id,
            status=SubscriptionStatus.ACTIVE,
            started_at=now,
            current_period_start=now,
            current_period_end=now + timedelta(days=days),
            provider="razorpay",
        )
        session.add(subscription)
        return subscription

    start = max(now, existing.current_period_end)
    existing.status = SubscriptionStatus.ACTIVE
    existing.cancelled_at = None
    existing.current_period_start = start
    existing.current_period_end = start + timedelta(days=days)
    existing.provider = "razorpay"
    return existing


def webhook_signature_is_valid(*, body: bytes, signature: str) -> bool:
    """Verify a Razorpay webhook.

    Keyed by the WEBHOOK secret, which is a different value from the key
    secret, and computed over the raw request body — re-serialising the parsed
    JSON would change the bytes and never match.
    """
    secret = settings.razorpay_webhook_secret
    if not secret:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


