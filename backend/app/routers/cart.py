"""The cart: what somebody means to buy, and paying for it in one go.

Every route here is for the person's OWN cart. There is no id in any path and
no way to name another user — a cart belongs to whoever is signed in, and the
only reason to let one account touch another's basket would be a support tool
nobody has asked for.

CHECKOUT IS A SEPARATE ROUTE FROM READING THE CART, and deliberately strict
where the read is tolerant. `GET /cart` shows a course that has since been
unpublished, with a line saying so, because a cart page that hides what it
cannot explain leaves somebody wondering where their course went.
`POST /cart/checkout` refuses the whole basket in that situation rather than
quietly charging for the rest.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.deps import CurrentUser, DbSession
from app.services import cart, payments

router = APIRouter(prefix="/cart", tags=["cart"])


class CartLineRead(BaseModel):
    """One course in the basket, priced as it is priced today."""

    course_id: uuid.UUID
    title: str
    description: str | None
    module_count: int
    price_minor: int
    list_price_minor: int | None
    currency: str
    access_days: int | None
    #: None when it can be bought; a sentence to show the reader when it cannot.
    problem: str | None


class CartRead(BaseModel):
    items: list[CartLineRead]
    #: The total of the lines that can actually be paid for. A blocked line
    #: contributes nothing, so the figure matches what checkout would charge.
    total_minor: int
    currency: str
    #: True when every line can be bought, i.e. checkout will not refuse.
    ready: bool


class AddRequest(BaseModel):
    course_id: uuid.UUID


class MergeRequest(BaseModel):
    """Course ids a signed-out visitor collected in their browser."""

    course_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class CartCheckout(BaseModel):
    """What the browser needs to open Razorpay's widget for a whole basket."""

    provider_order_id: str
    amount_minor: int
    currency: str
    key_id: str
    #: "3 courses", for the widget's description line.
    item_name: str
    order_ids: list[uuid.UUID]


def _render(lines: list[cart.CartLine]) -> CartRead:
    items = [
        CartLineRead(
            course_id=line.course.id,
            title=line.course.title,
            description=line.course.description,
            module_count=line.module_count,
            price_minor=line.course.price_minor,
            list_price_minor=line.course.list_price_minor,
            currency=line.course.currency,
            access_days=line.course.access_days,
            problem=line.problem,
        )
        for line in lines
    ]
    buyable = [line for line in lines if line.buyable]
    return CartRead(
        items=items,
        total_minor=sum(line.course.price_minor for line in buyable),
        currency=(buyable[0].course.currency if buyable else "INR"),
        ready=bool(lines) and len(buyable) == len(lines),
    )


@router.get("", response_model=CartRead)
async def my_cart(session: DbSession, user: CurrentUser) -> CartRead:
    return _render(await cart.contents(session, user=user))


@router.post("/items", response_model=CartRead, status_code=status.HTTP_201_CREATED)
async def add_item(
    payload: AddRequest, session: DbSession, user: CurrentUser
) -> CartRead:
    """Add a course. Adding one that is already there is a no-op, not an error.

    The whole cart comes back rather than the one line, so the header badge and
    the cart page cannot disagree with each other about what is in it after a
    click on a third page.
    """
    try:
        await cart.add(session, user=user, course_id=payload.course_id)
    except cart.CartError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None
    await session.commit()
    return _render(await cart.contents(session, user=user))


@router.delete("/items/{course_id}", response_model=CartRead)
async def remove_item(
    course_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> CartRead:
    """Take a course out.

    Removing something that is not there answers 200 with the cart as it
    stands. It is not an error: two tabs, or a double tap, and the outcome the
    caller wanted is already true.
    """
    await cart.remove(session, user=user, course_id=course_id)
    await session.commit()
    return _render(await cart.contents(session, user=user))


@router.delete("", response_model=CartRead)
async def empty_cart(session: DbSession, user: CurrentUser) -> CartRead:
    await cart.clear(session, user=user)
    await session.commit()
    return _render(await cart.contents(session, user=user))


@router.post("/merge", response_model=CartRead)
async def merge_cart(
    payload: MergeRequest, session: DbSession, user: CurrentUser
) -> CartRead:
    """Take over the basket somebody filled before they signed in.

    Anything that cannot go in is dropped without comment — see
    `services/cart.merge` for why this is not the moment to interrupt them.
    """
    await cart.merge(session, user=user, course_ids=payload.course_ids)
    await session.commit()
    return _render(await cart.contents(session, user=user))


@router.post(
    "/checkout", response_model=CartCheckout, status_code=status.HTTP_201_CREATED
)
async def checkout(session: DbSession, user: CurrentUser) -> CartCheckout:
    """One payment for the whole basket.

    The amount is summed from the course rows here, never sent by the browser.
    What comes back is a provider order id to hand to Razorpay's widget; the
    orders stay unpaid until `POST /payments/confirm` verifies the signature.
    """
    if not settings.payments_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Card payments are not set up yet.",
        )

    try:
        courses = await cart.purchasable(session, user=user)
    except cart.CartError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    try:
        orders = await payments.start_cart_purchase(
            session, user=user, courses=courses
        )
    except payments.PaymentsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from None
    except payments.PaymentError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    return CartCheckout(
        provider_order_id=orders[0].provider_order_id or "",
        amount_minor=sum(order.amount_minor for order in orders),
        currency=orders[0].currency,
        key_id=settings.razorpay_key_id or "",
        item_name=(
            courses[0].title
            if len(courses) == 1
            else f"{len(courses)} courses"
        ),
        order_ids=[order.id for order in orders],
    )
