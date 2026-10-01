"""A plan can be All Access: every public course, new ones included.

Revision ID: 0029_all_access_plans
Revises: 0028_revoked_tokens
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0029_all_access_plans"
down_revision = "0028_revoked_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Access still flows through `plan_courses` alone. The flag only says "keep
    # this plan's list complete": every public course is linked to it, and a
    # course created later is linked the moment it is made. Before this, All
    # Access was whatever the super admin had ticked, so a new course was left
    # out until somebody remembered, while the card promised "including new
    # ones". See app/models/subscription.py.
    op.add_column(
        "subscription_plans",
        sa.Column(
            "all_access", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )

    # The plans that already are All Access: they link every published public
    # course. On the live site that is All Access Monthly and Yearly, whose
    # lists were completed by hand on 2026-09-25. A stack bundle links a few
    # courses and is left as it is.
    op.execute(
        """
        UPDATE subscription_plans AS p
           SET all_access = true
         WHERE EXISTS (
                   SELECT 1 FROM courses AS c
                    WHERE c.organization_id IS NULL AND c.is_published
               )
           AND NOT EXISTS (
                   SELECT 1 FROM courses AS c
                    WHERE c.organization_id IS NULL AND c.is_published
                      AND NOT EXISTS (
                          SELECT 1 FROM plan_courses AS pc
                           WHERE pc.plan_id = p.id AND pc.course_id = c.id
                      )
               )
        """
    )

    # And complete them, drafts included, so a course published later is
    # already in. Organisation courses never are: they belong to a customer.
    op.execute(
        """
        INSERT INTO plan_courses (plan_id, course_id)
        SELECT p.id, c.id
          FROM subscription_plans AS p
          CROSS JOIN courses AS c
         WHERE p.all_access AND c.organization_id IS NULL
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    # The links stay. They are what subscribers were given, and removing them
    # would close courses people are paying for.
    op.drop_column("subscription_plans", "all_access")
