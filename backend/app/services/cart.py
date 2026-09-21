"""Putting courses in a basket, and checking whether they can still be bought.

THE CART IS NOT A PROMISE. Everything it holds is re-checked at checkout: the
price, whether the course is still published, whether the buyer has since got
it another way. A basket can sit for a week, and a week is long enough for a
course to be unpublished, repriced, or included in a plan the buyer has since
subscribed to. So this module answers two different questions and keeps them
apart:

    what is in the basket        — `contents`, tolerant, shows problems
    what may be paid for now     — `purchasable`, strict, refuses

`contents` never throws. A cart page that 500s because one line went stale is
worse than one that says "this course is no longer on sale — remove it".

WHAT CANNOT GO IN.

  A course the buyer already has, whether they bought it or a subscription
  covers it. Taking money for something somebody can already open is the one
  mistake a cart makes that looks like theft rather than a bug.

  A free course. There is nothing to pay, so it is enrolment, not checkout.

  A course outside the buyer's tenancy. An organisation's member has no
  marketplace (decision 178), and a public visitor cannot see a customer's
  private training. The same `access` helpers the course pages use, so the cart
  cannot become the one door that was left open.

  A draft. It is not on sale until it is published.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cart import CartItem
from app.models.course import Course, Module
from app.models.user import User
from app.services import access


class CartError(RuntimeError):
    """Something about this cart line does not add up. Safe to show a person."""


#: Why a line cannot be paid for. The wording is the customer's, not ours, and
#: each one tells them what to do rather than what went wrong.
UNAVAILABLE = "This course is no longer on sale."
ALREADY_OWNED = "You already have this course."
COVERED_BY_PLAN = "Your subscription already includes this course."
FREE_COURSE = "This course is free. Open it from the catalogue instead."
OUTSIDE_TENANT = "This course is not available on your account."


@dataclass(frozen=True)
class CartLine:
    """One course in the basket, with today's price and today's verdict."""

    course: Course
    #: None when it can be bought. A sentence when it cannot.
    problem: str | None
    #: How many modules, for the card. Counted here rather than left to the
    #: caller so the cart page does not fire one query per line.
    module_count: int = 0

    @property
    def buyable(self) -> bool:
        return self.problem is None


async def _problem_with(
    session: AsyncSession, *, user: User, course: Course
) -> str | None:
    """Why this course cannot be paid for right now, or None."""
    if not course.is_published:
        return UNAVAILABLE

    decision = await access.tenancy_decision(user, course)
    if decision is not None and not decision.allowed:
        return OUTSIDE_TENANT

    if course.price_minor <= 0:
        return FREE_COURSE

    if await access.has_paid_for_course(session, user.id, course.id):
        return ALREADY_OWNED

    if await access.subscription_covers_course(session, user.id, course.id):
        return COVERED_BY_PLAN

    return None


async def add(
    session: AsyncSession, *, user: User, course_id: uuid.UUID
) -> CartItem:
    """Put a course in the basket, or leave it there if it already is.

    Adding twice is not an error worth telling anybody about — the button sits
    on a card that appears on several pages, and a person clicking it again is
    confirming an intention, not making a mistake. The unique index is what
    makes the second click a no-op instead of a race.
    """
    course = await session.get(Course, course_id)
    if course is None:
        raise CartError("Course not found.")

    problem = await _problem_with(session, user=user, course=course)
    if problem is not None:
        # Tenancy is answered as "not found" rather than "not for you": a
        # customer's private course must not be confirmed to exist by the way
        # the cart refuses it.
        raise CartError(
            "Course not found." if problem == OUTSIDE_TENANT else problem
        )

    existing = await session.scalar(
        select(CartItem).where(
            CartItem.user_id == user.id, CartItem.course_id == course_id
        )
    )
    if existing is not None:
        return existing

    item = CartItem(user_id=user.id, course_id=course_id)
    # A SAVEPOINT, not a bare flush. `merge` calls this in a loop, and a plain
    # `session.rollback()` on the third course would throw away the first two.
    try:
        async with session.begin_nested():
            session.add(item)
            await session.flush()
    except IntegrityError:
        # Two tabs, one course, same instant. The index held; read back what
        # the other one wrote.
        found = await session.scalar(
            select(CartItem).where(
                CartItem.user_id == user.id, CartItem.course_id == course_id
            )
        )
        if found is None:  # pragma: no cover - the index says this cannot be
            raise
        return found
    return item


async def remove(
    session: AsyncSession, *, user: User, course_id: uuid.UUID
) -> bool:
    """Take a course out. True if it was there."""
    result = await session.execute(
        delete(CartItem).where(
            CartItem.user_id == user.id, CartItem.course_id == course_id
        )
    )
    return bool(result.rowcount)


async def clear(session: AsyncSession, *, user: User) -> int:
    """Empty the basket. Returns how many lines went."""
    result = await session.execute(
        delete(CartItem).where(CartItem.user_id == user.id)
    )
    return int(result.rowcount or 0)


async def contents(session: AsyncSession, *, user: User) -> list[CartLine]:
    """Everything in the basket, each line with today's price and verdict.

    Oldest first, so the list does not reshuffle between visits.
    """
    rows = (
        await session.execute(
            select(Course, func.count(Module.id))
            .join(CartItem, CartItem.course_id == Course.id)
            .outerjoin(Module, Module.course_id == Course.id)
            .where(CartItem.user_id == user.id)
            .group_by(Course.id, CartItem.added_at)
            .order_by(CartItem.added_at, Course.title)
        )
    ).all()

    lines: list[CartLine] = []
    for course, module_count in rows:
        lines.append(
            CartLine(
                course=course,
                problem=await _problem_with(session, user=user, course=course),
                module_count=module_count,
            )
        )
    return lines


async def purchasable(session: AsyncSession, *, user: User) -> list[Course]:
    """The lines that can actually be paid for, in cart order.

    Raises rather than quietly charging for a subset. Somebody pressing Pay on
    a total of three courses must not be charged for two: the page shows the
    problem and they decide what to do about it.
    """
    lines = await contents(session, user=user)
    if not lines:
        raise CartError("Your cart is empty.")

    blocked = [line for line in lines if not line.buyable]
    if blocked:
        raise CartError(
            f"{blocked[0].course.title}: {blocked[0].problem} "
            "Remove it and try again."
            if len(blocked) == 1
            else (
                f"{len(blocked)} courses in your cart cannot be bought right "
                "now. Remove them and try again."
            )
        )
    return [line.course for line in lines]


async def count(session: AsyncSession, *, user: User) -> int:
    """How many lines, for the badge on the header. Cheap on purpose."""
    return len(
        (
            await session.execute(
                select(CartItem.id).where(CartItem.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )


async def merge(
    session: AsyncSession, *, user: User, course_ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    """Empty a signed-out visitor's browser cart into their real one.

    Anything that cannot go in is DROPPED SILENTLY. This runs on the tick after
    sign-in, in the background, and the person is looking at a page they asked
    for — a modal saying "3 of the 5 things you picked last week are no longer
    on sale" is an interruption nobody asked for at the worst possible moment.
    The cart page says it plainly when they open it.

    Returns the ids that went in, so the browser knows what it can forget.
    """
    added: list[uuid.UUID] = []
    for course_id in course_ids[:50]:  # A browser-supplied list. Bound it.
        try:
            await add(session, user=user, course_id=course_id)
        except CartError:
            continue
        added.append(course_id)
    return added
