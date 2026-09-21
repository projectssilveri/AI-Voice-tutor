"""A basket of courses somebody intends to buy.

WHY A TABLE AND NOT THE BROWSER. A cart kept in `localStorage` is gone when you
open the site on your phone, and it is gone when the browser clears site data.
People add a course, think about it for two days, and come back — often on a
different device. That gap is the whole reason a cart exists rather than a Buy
button, so it has to survive the gap.

There is still a browser-side cart, for visitors who have not signed in yet.
That one is a holding pen: `POST /cart/merge` empties it into this table the
moment they sign in, so the courses they picked before making an account are
still there afterwards.

WHAT IS NOT IN HERE.

  No price. A cart line is "this person wants this course", and the price is
  whatever the course costs when they actually pay. Copying the price in would
  mean either honouring a stale figure or silently changing it under them; the
  cart page reads today's price and says so. `orders.amount_minor` is the
  figure that gets frozen, at the moment money moves, which is the only moment
  that matters.

  No quantity. You cannot own a course twice, and a quantity box on a course is
  a checkout that has stopped thinking about what it sells.

  No subscription plans. A plan is a recurring charge with a billing interval,
  not a thing you accumulate — and mixing a monthly subscription into a
  one-off basket means a total that is neither. Plans keep their own Subscribe
  button, which is what Udemy and Coursera do with theirs too.

CASCADE ON BOTH SIDES. A deleted account takes its basket with it, and an
unpublished-then-deleted course should not leave a line nobody can check out.
Neither side is worth keeping a row for: nothing was paid, so nothing is owed
an audit trail. `orders` is where the permanent record lives, and that one is
RESTRICT for exactly the opposite reason.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from app.models.course import Course
    from app.models.user import User


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (
        # ONE LINE PER COURSE. Adding the same course twice is not an error the
        # customer needs told about — the button is on a card they may click
        # again from a different page — so the service treats a repeat as a
        # no-op. This index is what makes that safe rather than a race.
        Index("uq_cart_items_user_course", "user_id", "course_id", unique=True),
        Index("ix_cart_items_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )

    #: Oldest first on the cart page, so the list does not reshuffle itself
    #: between visits.
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    user: Mapped[User] = relationship()
    course: Mapped[Course] = relationship()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<CartItem user={self.user_id} course={self.course_id}>"
