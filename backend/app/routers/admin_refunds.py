"""Refunds, for the support desk.

Two routes: work out what somebody is owed, and write down that it was given.

WHAT THIS DOES NOT DO. It does not move money. Razorpay's refund API is never
called from here, and that is a deliberate line: the product's job is to say
what the policy gives back and to withdraw the access, and a button that wires
customer money out of the account is a separate decision with separate
approval. Support pays the refund in the Razorpay dashboard and records it
here, and the screen says so rather than implying the money has gone.

Both routes are behind `RequireSuperAdmin`. A refund is a money decision, and
money sits with the super admin (decided 2026-09-24): a platform admin can
neither look a refund up nor record one. They were `RequireAdmin`, open to any
platform admin as "the support desk", which disagreed with the rule written in
CLAUDE.md. The frontend not linking the page is not what protects it.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.deps import DbSession, RequireSuperAdmin
from app.models.order import Order
from app.services import audit, refunds

router = APIRouter(prefix="/admin/refunds", tags=["admin"])


class TierRead(BaseModel):
    key: str
    label: str
    #: Exclusive upper bound in percent; null on the top band.
    below_percent: int | None


class RefundQuoteRead(BaseModel):
    order_id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    user_email: str
    course_id: uuid.UUID | None
    course_title: str
    amount_minor: int
    currency: str
    paid_at: datetime | None
    status: str

    # How far through — the figure the whole policy turns on, sent as the parts
    # as well as the percentage so support can see WHY it is 33% rather than
    # having to take the number on trust.
    completed_modules: int
    total_modules: int
    percent_complete: int

    tier: TierRead
    refund_minor: int
    #: False on a subscription order, where the published policy says nothing.
    covered_by_policy: bool

    refunded_amount_minor: int | None
    refunded_at: datetime | None


class PolicyRead(BaseModel):
    """The tiers themselves, so the screen prints the rule it applied."""

    tiers: list[TierRead]


class RefundLookup(BaseModel):
    policy: PolicyRead
    quotes: list[RefundQuoteRead]


def _to_read(quote: refunds.RefundQuote) -> RefundQuoteRead:
    return RefundQuoteRead(
        order_id=quote.order_id,
        user_id=quote.user_id,
        user_name=quote.user_name,
        user_email=quote.user_email,
        course_id=quote.course_id,
        course_title=quote.course_title,
        amount_minor=quote.amount_minor,
        currency=quote.currency,
        paid_at=quote.paid_at,
        status=quote.status,
        completed_modules=quote.progress.completed_modules,
        total_modules=quote.progress.total_modules,
        percent_complete=quote.progress.percent,
        tier=TierRead(
            key=quote.tier.key,
            label=quote.tier.label,
            below_percent=quote.tier.below_percent,
        ),
        refund_minor=quote.refund_minor,
        covered_by_policy=quote.covered_by_policy,
        refunded_amount_minor=quote.refunded_amount_minor,
        refunded_at=quote.refunded_at,
    )


@router.get("", response_model=RefundLookup)
async def look_up_refunds(
    session: DbSession,
    actor: RequireSuperAdmin,
    q: str | None = Query(
        default=None,
        max_length=255,
        description="Part of a customer's email or name. Empty lists recent orders.",
    ),
    limit: int = Query(default=50, ge=1, le=200),
) -> RefundLookup:
    """Orders a refund could be asked about, with what the policy gives back.

    The policy is returned alongside, so the screen prints the rule it applied
    rather than restating it in a second place that could drift from the one in
    `services/refunds.py`.
    """
    quotes = await refunds.quotes_for(session, search=q, limit=limit)
    return RefundLookup(
        policy=PolicyRead(
            tiers=[
                TierRead(key=t.key, label=t.label, below_percent=t.below_percent)
                for t in refunds.TIERS
            ]
        ),
        quotes=[_to_read(quote) for quote in quotes],
    )


class RecordRefundRequest(BaseModel):
    """What support is writing down.

    The AMOUNT IS EXPLICIT rather than recomputed from the policy at this
    point, for two reasons. Support sometimes agrees a different figure —
    goodwill, a mistake on our side — and a route that silently substituted the
    policy amount would record something other than what happened. And the
    number that reaches here is the one the operator actually saw and paid; a
    server that quietly recalculated could disagree with the Razorpay dashboard
    and nobody would know which was right.

    The policy amount is still shown on the screen, and the audit record keeps
    both, so a refund that departs from the tiers is visible as a departure.
    """

    amount_minor: int = Field(ge=0)
    #: Why, in support's own words. Kept short; it goes into the audit trail.
    note: str | None = Field(default=None, max_length=500)


@router.post("/{order_id}", response_model=RefundQuoteRead)
async def record_refund(
    order_id: uuid.UUID,
    payload: RecordRefundRequest,
    session: DbSession,
    actor: RequireSuperAdmin,
) -> RefundQuoteRead:
    """Write down a refund that has been paid, and withdraw the access.

    Marking the order refunded is what actually takes the course away:
    `services/access.py` grants on `status = 'paid'` and nothing else. Without
    this step a refunded student keeps everything they were refunded for, which
    is the failure that made this screen worth building rather than leaving
    support to do the sums by hand.
    """
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Order not found."
        )

    # What the policy WOULD have given, captured before the change so the audit
    # record can show the two side by side.
    quoted = 0
    percent = 0
    if order.course_id is not None:
        progress = await refunds.progress_for(session, order.user_id, order.course_id)
        percent = progress.percent
        quoted = refunds.tier_for(percent).amount_for(order.amount_minor)

    try:
        await refunds.record_refund(
            session, order=order, amount_minor=payload.amount_minor
        )
    except refunds.RefundError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    # `record`, not `record_safely`: this is money leaving, and an event that
    # failed to write would leave a refund nobody can account for. It shares the
    # transaction, so the refund and its record commit together or not at all.
    await audit.record(
        session,
        action="refund.recorded",
        actor=actor,
        target_type="order",
        target_id=order.id,
        metadata={
            "amount_minor": payload.amount_minor,
            # Both figures, so a refund that departed from the policy is
            # visible as a departure rather than having to be re-derived from
            # progress that may have moved on since.
            "policy_amount_minor": quoted,
            "percent_complete": percent,
            "order_amount_minor": order.amount_minor,
            "currency": order.currency,
            "refunded_user_id": str(order.user_id),
            "note": (payload.note or "").strip()[:500] or None,
        },
    )
    await session.commit()
    await session.refresh(order)
    return _to_read(await refunds.quote_for_order(session, order))
