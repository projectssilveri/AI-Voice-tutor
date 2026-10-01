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
import uuid
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import redact
from app.models.cart import CartItem
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.order import Order, OrderStatus
from app.models.subscription import (
    BillingInterval,
    PlanCourse,
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


async def start_cart_purchase(
    session: AsyncSession, *, user: User, courses: Sequence[Course]
) -> list[Order]:
    """One payment for a basket of courses. Returns the orders it created.

    THE AMOUNT IS SUMMED FROM THE COURSE ROWS, never sent by the client — the
    same rule as buying one course, and the reason is the same: a client that
    names its own price names it wrong on purpose eventually.

    THE ROWS ARE WRITTEN BEFORE RAZORPAY IS ASKED, for the reason spelled out
    in `_record_then_register`: an order the provider knows about and we do not
    is a payment our webhook cannot find. Written together in one transaction,
    so a basket never lands half-recorded.

    The caller is expected to have run `services.cart.purchasable`, which is
    what decides a course may still be bought. The checks here are the ones
    that protect the MONEY — a zero total, or a duplicate — rather than the
    ones that decide what is on sale.
    """
    if not courses:
        raise PaymentError("There is nothing in your cart.")

    seen: set[uuid.UUID] = set()
    for course in courses:
        if course.id in seen:
            raise PaymentError("The same course appears twice in your cart.")
        seen.add(course.id)

    total_minor = sum(course.price_minor for course in courses)
    if total_minor <= 0:
        raise PaymentError("There is nothing to pay for.")

    # One currency per payment, because Razorpay takes one amount in one
    # currency. Everything is INR today; this is the check that turns a silent
    # mis-charge into a refusal on the day that stops being true.
    currencies = {course.currency for course in courses}
    if len(currencies) > 1:
        raise PaymentError(
            "These courses are priced in different currencies and cannot be "
            "bought together."
        )
    currency = courses[0].currency

    already = await session.scalars(
        select(Order.course_id).where(
            Order.user_id == user.id,
            Order.course_id.in_(seen),
            Order.status == OrderStatus.PAID,
        )
    )
    owned = set(already.all())
    if owned:
        raise PaymentError("Your cart has something you already own.")

    group_id = uuid.uuid4()
    orders = [
        Order(
            user_id=user.id,
            course_id=course.id,
            amount_minor=course.price_minor,
            currency=currency,
            status=OrderStatus.CREATED,
            provider="razorpay",
            order_group_id=group_id,
        )
        for course in courses
    ]
    session.add_all(orders)
    await session.commit()
    for order in orders:
        await session.refresh(order)

    try:
        provider_order_id = await _create_provider_order(
            amount_minor=total_minor,
            currency=currency,
            receipt=f"cart-{group_id}",
        )
    except PaymentError:
        # Inert rows, exactly as in the single-course path: nothing is granted
        # by anything but `paid`, and they record that somebody tried.
        for order in orders:
            order.failure_reason = "Could not create an order with the provider."
        await session.commit()
        raise

    for order in orders:
        order.provider_order_id = provider_order_id
    await session.commit()
    for order in orders:
        await session.refresh(order)
    return orders


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


async def orders_for_provider_order(
    session: AsyncSession, provider_order_id: str
) -> list[Order]:
    """Every order row one provider payment covers.

    ONE ROW FOR A SINGLE PURCHASE, SEVERAL FOR A CART. This used to be a
    `scalar()` returning one row, which was right while a payment could only
    buy one thing. Left as it was, a basket of three courses would have marked
    one order paid and granted one course for the price of three — and the
    other two rows would have sat in `created` looking like abandoned
    checkouts rather than like money taken for nothing.
    """
    found = await session.scalars(
        select(Order)
        .where(Order.provider_order_id == provider_order_id)
        .order_by(Order.created_at, Order.id)
    )
    return list(found.all())


async def confirm_payment(
    session: AsyncSession,
    *,
    user: User,
    provider_order_id: str,
    provider_payment_id: str,
    signature: str,
) -> list[Order]:
    """Mark a payment's orders paid, if and only if the signature checks out.

    Returns every order the payment settled — one for a single purchase,
    several for a cart. Raises rather than returning a failure flag, so a
    caller cannot forget to look.
    """
    orders = await orders_for_provider_order(session, provider_order_id)
    if not orders:
        raise PaymentError("No such order.")

    # The orders belong to whoever created them. Without this check, anyone
    # could confirm someone else's payment and have the courses land on their
    # account. Checked on EVERY row, not the first: they are written together
    # by one call, and "they always share a user" is exactly the sort of
    # invariant that stops being true quietly.
    for order in orders:
        if order.user_id != user.id:
            logger.warning(
                "User %s tried to confirm order %s belonging to %s",
                user.id,
                order.id,
                order.user_id,
            )
            raise PaymentError("No such order.")

    # Razorpay retries, and the webhook may have got here first. Confirming
    # twice is not an error.
    if all(order.status is OrderStatus.PAID for order in orders):
        return orders

    if not signature_is_valid(
        provider_order_id=provider_order_id,
        provider_payment_id=provider_payment_id,
        signature=signature,
    ):
        for order in orders:
            if order.status is not OrderStatus.PAID:
                order.status = OrderStatus.FAILED
                order.failure_reason = "Signature verification failed."
        await session.commit()
        logger.warning("Signature mismatch on payment %s", provider_order_id)
        raise SignatureMismatchError("Payment could not be verified.")

    await mark_paid(session, orders, provider_payment_id=provider_payment_id)
    await session.commit()
    for order in orders:
        await session.refresh(order)

    for order in orders:
        logger.info(
            "Order %s paid (%s %s) by user %s",
            order.id,
            order.amount_minor,
            order.currency,
            user.id,
        )
    return orders


async def mark_paid(
    session: AsyncSession, orders: Sequence[Order], *, provider_payment_id: str
) -> None:
    """Move orders to paid and hand over what they bought. No commit.

    Shared by the browser callback and the webhook, which had drifted apart
    once already — the webhook marked an order paid and forgot to start the
    subscription, so a customer who closed the tab was charged for a bundle
    that unlocked nothing. Two callers, one body, and that cannot happen twice.

    A COURSE NEEDS NOTHING FULFILLING. Access reads `orders.status = 'paid'`
    directly, so the row moving is the grant. A plan does not work that way:
    the access check reads `subscriptions`.
    """
    now = datetime.now(UTC)
    for order in orders:
        if order.status is OrderStatus.PAID:
            continue
        order.status = OrderStatus.PAID
        order.provider_payment_id = provider_payment_id
        order.paid_at = now
        if order.plan_id is not None:
            await fulfil_plan_order(session, order)

    # The basket has been paid for, so it is not a basket any more. Left alone,
    # the cart badge would still show three the morning after checkout and the
    # cart page would be a list of "you already have this".
    bought = [order.course_id for order in orders if order.course_id is not None]
    if bought:
        await session.execute(
            delete(CartItem).where(
                CartItem.user_id == orders[0].user_id,
                CartItem.course_id.in_(bought),
            )
        )


async def fulfil_plan_order(session: AsyncSession, order: Order) -> Subscription:
    """Start or extend the subscription a paid plan order bought.

    Renewal moves the existing row's window forward rather than inserting a
    second one: `subscriptions` is unique on (user, plan), and a student
    renewing should not end up with two rows racing each other.

    Extending from the later of "now" and the current period end means paying
    early adds time rather than throwing the remainder away.
    """
    plan = await session.get(SubscriptionPlan, order.plan_id)
    if plan is None:
        raise PaymentError("That plan no longer exists.")
    return await start_or_extend_plan(
        session, user_id=order.user_id, plan=plan, provider="razorpay"
    )


async def start_or_extend_plan(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    plan: SubscriptionPlan,
    provider: str,
) -> Subscription:
    """The subscription row for a paid order or a free claim. No commit.

    AND THE COURSES, ENROLLED. Holding a bundle opened its courses but enrolled
    the student in none of them, so "You have this. Start learning" led to My
    courses showing only what they had happened to open themselves: one of two
    free courses in the tester's bundle. Every published course the plan covers
    is enrolled here, the ones already enrolled are left as they are.
    """
    now = datetime.now(UTC)
    days = 365 if plan.billing_interval is BillingInterval.YEARLY else 30

    existing = await session.scalar(
        select(Subscription).where(
            Subscription.user_id == user_id,
            Subscription.plan_id == plan.id,
        )
    )

    if existing is None:
        subscription = Subscription(
            user_id=user_id,
            plan_id=plan.id,
            status=SubscriptionStatus.ACTIVE,
            started_at=now,
            current_period_start=now,
            current_period_end=now + timedelta(days=days),
            provider=provider,
        )
        session.add(subscription)
    else:
        start = max(now, existing.current_period_end)
        existing.status = SubscriptionStatus.ACTIVE
        existing.cancelled_at = None
        existing.current_period_start = start
        existing.current_period_end = start + timedelta(days=days)
        existing.provider = provider
        subscription = existing

    await enrol_in_plan_courses(session, user_id=user_id, plan_id=plan.id)
    return subscription


async def enrol_in_plan_courses(
    session: AsyncSession, *, user_id: uuid.UUID, plan_id: uuid.UUID
) -> int:
    """Enrol a holder in every published course of a plan. Returns how many.

    Drafts are skipped: an All Access plan links them so they are in when
    published, and enrolling somebody in a course that is not out yet would
    put it on their list early. No commit.
    """
    wanted = set(
        (
            await session.scalars(
                select(PlanCourse.course_id)
                .join(Course, Course.id == PlanCourse.course_id)
                .where(
                    PlanCourse.plan_id == plan_id,
                    Course.is_published.is_(True),
                    Course.organization_id.is_(None),
                )
            )
        ).all()
    )
    if not wanted:
        return 0
    have = set(
        (
            await session.scalars(
                select(Enrollment.course_id).where(
                    Enrollment.user_id == user_id,
                    Enrollment.course_id.in_(wanted),
                )
            )
        ).all()
    )
    for course_id in wanted - have:
        session.add(Enrollment(user_id=user_id, course_id=course_id))
    return len(wanted - have)


async def enrol_holders(
    session: AsyncSession, course_ids: Iterable[uuid.UUID]
) -> int:
    """Enrol everybody already holding a plan in these of its courses.

    The other direction from `enrol_in_plan_courses`, which runs when somebody
    buys or claims a plan. A course added to a bundle afterwards, or a draft in
    it published afterwards, never reached the people who already held it, so
    their list stayed short of what the bundle page promised.

    Published public courses only, and plans still running, the same test as
    `access`. Only these courses, never the whole plan, so somebody who left a
    course is not put back in it by an unrelated edit. Returns how many. No
    commit.
    """
    wanted = set(course_ids)
    if not wanted:
        return 0
    await session.flush()
    missing = (
        await session.execute(
            select(Subscription.user_id, PlanCourse.course_id)
            .join(PlanCourse, PlanCourse.plan_id == Subscription.plan_id)
            .join(Course, Course.id == PlanCourse.course_id)
            .outerjoin(
                Enrollment,
                and_(
                    Enrollment.user_id == Subscription.user_id,
                    Enrollment.course_id == PlanCourse.course_id,
                ),
            )
            .where(
                PlanCourse.course_id.in_(wanted),
                Course.is_published.is_(True),
                Course.organization_id.is_(None),
                Subscription.status.in_(
                    [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]
                ),
                Subscription.current_period_end > datetime.now(UTC),
                Enrollment.id.is_(None),
            )
            .distinct()
        )
    ).all()
    for user_id, course_id in missing:
        session.add(Enrollment(user_id=user_id, course_id=course_id))
    return len(missing)


async def claim_free_plan(
    session: AsyncSession, *, user: User, plan: SubscriptionPlan
) -> Subscription:
    """Hold a plan that costs nothing, with no payment provider involved.

    A bundle priced at 0 went through checkout like any other, and checkout
    answers "Payments are not configured" until Razorpay keys exist, so a free
    bundle could not be had at all. A plan with no price needs no payment. No
    commit.
    """
    if not plan.is_active:
        raise PaymentError("That plan is no longer available.")
    if plan.price_minor != 0:
        raise PaymentError("This plan has a price, so it goes through checkout.")
    return await start_or_extend_plan(
        session, user_id=user.id, plan=plan, provider="free"
    )


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


