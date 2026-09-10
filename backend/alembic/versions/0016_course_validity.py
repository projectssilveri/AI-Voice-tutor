"""A purchase now expires, and a course can show what it used to cost.

Revision ID: 0016_course_validity
Revises: 0015_device_id_and_validity
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0016_course_validity"
down_revision = "0015_device_id_and_validity"
branch_labels = None
depends_on = None

#: Days of access per module. A three-module course is not worth the same
#: window as a twelve-module one, so the length of the course sets the length
#: of the entitlement. Kept identical to `services/extensions.DAYS_PER_MODULE`
#: — a migration cannot import from the app (the model may have moved on by the
#: time it runs), so the two are pinned to each other by a test instead.
DAYS_PER_MODULE = 15

#: Nobody gets less than a month, however short the course. A student who buys
#: on a Friday and travels for a fortnight has not bought anything.
MINIMUM_DAYS = 30


def upgrade() -> None:
    # ------------------------------------------------------------------
    # What the course used to cost
    # ------------------------------------------------------------------
    # NULLABLE, AND LEFT NULL. Every existing course gets no "was" price,
    # because none of them had one. Backfilling an inflated figure so the real
    # price reads as a discount is a deceptive pricing practice — in India it
    # falls under the Consumer Protection Act's rules on misleading adverts,
    # and the same is true in the UK and EU. The column exists so an admin can
    # record a price the course GENUINELY carried; it is not for decoration.
    op.add_column(
        "courses", sa.Column("list_price_minor", sa.Integer(), nullable=True)
    )

    # ------------------------------------------------------------------
    # How long a purchase lasts
    # ------------------------------------------------------------------
    # Until now `extensions.resolve` returned `(paid_at, None, "purchase")` —
    # bought outright, never expires, and the marketing copy said so: "pay once,
    # keep it". This gives a purchase an end date scaled to the size of the
    # course.
    op.add_column("courses", sa.Column("access_days", sa.Integer(), nullable=True))

    # Backfill from the module count, so every course starts with a window that
    # matches its length rather than one number applied to all of them.
    op.execute(
        sa.text(
            f"""
            UPDATE courses AS c
            SET access_days = GREATEST(
                {MINIMUM_DAYS},
                {DAYS_PER_MODULE} * (
                    SELECT count(*) FROM modules m WHERE m.course_id = c.id
                )
            )
            """
        )
    )

    # ------------------------------------------------------------------
    # EXISTING PURCHASES KEEP WHAT THEY BOUGHT
    # ------------------------------------------------------------------
    # This is the part that would otherwise be quietly unfair. Anyone who has
    # already paid did so under "pay once, keep it", and applying a fresh 45-day
    # window to a purchase from three months ago would cut off access somebody
    # paid for, retroactively, with no notice. Their courses are not for sale
    # again — they were sold on different terms.
    #
    # So every PAID order that exists at this moment gets an explicit
    # never-expires grant, recorded in `access_extensions` with a reason, which
    # `extensions.resolve` already honours and which is visible on the admin
    # screen rather than hidden in a column default.
    op.execute(
        sa.text(
            """
            INSERT INTO access_extensions
                (id, user_id, course_id, plan_id, extends_to, granted_by,
                 reason, created_at)
            SELECT gen_random_uuid(),
                   o.user_id,
                   o.course_id,
                   NULL,
                   TIMESTAMPTZ '2099-12-31 00:00:00+00',
                   o.user_id,
                   'Bought under the earlier "pay once, keep it" terms, before '
                   'courses carried an expiry. Honoured indefinitely.',
                   now()
            FROM orders o
            WHERE o.status = 'paid'
              AND o.course_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM access_extensions e
                  WHERE e.user_id = o.user_id AND e.course_id = o.course_id
              )
            """
        )
    )


def downgrade() -> None:
    # The grandfathering grants go too, identified by their reason rather than
    # by date — a downgrade that left them behind would give those students a
    # permanent extension nobody could account for.
    op.execute(
        sa.text(
            """
            DELETE FROM access_extensions
            WHERE reason LIKE 'Bought under the earlier%'
            """
        )
    )
    op.drop_column("courses", "access_days")
    op.drop_column("courses", "list_price_minor")
