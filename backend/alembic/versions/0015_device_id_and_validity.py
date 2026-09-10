"""A device identifier on every audit event, and extending course validity.

Revision ID: 0015_device_id_and_validity
Revises: 0014_profiles_and_notifications
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0015_device_id_and_validity"
down_revision = "0014_profiles_and_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Which device
    # ------------------------------------------------------------------
    # A FIRST-PARTY COOKIE WE ISSUE, not a fingerprint we compute.
    #
    # Browsers do not hand out a device id, and the usual way to manufacture one
    # is to fingerprint — canvas, fonts, screen metrics — which tracks people
    # across sites they never agreed to be tracked on, and which the browsers
    # are actively closing off anyway. So this is a random opaque value set in
    # our own httpOnly cookie on first contact. It says "the same browser that
    # signed in yesterday", which is the question an audit trail actually asks,
    # and it says nothing about the person to anybody else.
    #
    # 64 chars: a uuid4 hex is 32, leaving room to change the scheme later.
    op.add_column(
        "audit_events", sa.Column("device_id", sa.String(length=64), nullable=True)
    )
    # "Everything from this device" is the query a security review runs after
    # something goes wrong, so it gets the same composite treatment as the
    # other three.
    op.create_index(
        "ix_audit_events_device_created",
        "audit_events",
        ["device_id", sa.text("created_at DESC")],
    )

    # ------------------------------------------------------------------
    # Extending access to a course
    # ------------------------------------------------------------------
    # Modelled on `attempt_grants` (decision 24) rather than on a mutable
    # column: WHO extended somebody's access, WHEN, and WHY is exactly the
    # question asked afterwards, and a column that is simply overwritten cannot
    # answer it. RESTRICT on the granting admin for the same reason.
    op.create_table(
        "access_extensions",
        sa.Column(
            "id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        # One of these two. A course extension covers one course; a plan
        # extension covers everything in a subscription.
        sa.Column("course_id", sa.Uuid(), nullable=True),
        sa.Column("plan_id", sa.Uuid(), nullable=True),
        sa.Column("extends_to", sa.DateTime(timezone=True), nullable=False),
        sa.Column("granted_by", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_access_extensions_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name="fk_access_extensions_course_id_courses",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["subscription_plans.id"],
            name="fk_access_extensions_plan_id_subscription_plans",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["granted_by"],
            ["users.id"],
            name="fk_access_extensions_granted_by_users",
            ondelete="RESTRICT",
        ),
        # Exactly one target. Without this a row could name both, or neither,
        # and the access check would have to guess which was meant.
        sa.CheckConstraint(
            "(course_id IS NOT NULL) <> (plan_id IS NOT NULL)",
            name="ck_access_extensions_one_target",
        ),
    )
    op.create_index(
        "ix_access_extensions_user_course",
        "access_extensions",
        ["user_id", "course_id"],
    )
    op.create_index(
        "ix_access_extensions_user_plan", "access_extensions", ["user_id", "plan_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_access_extensions_user_plan", table_name="access_extensions")
    op.drop_index("ix_access_extensions_user_course", table_name="access_extensions")
    op.drop_table("access_extensions")
    op.drop_index("ix_audit_events_device_created", table_name="audit_events")
    op.drop_column("audit_events", "device_id")
