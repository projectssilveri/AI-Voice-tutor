"""Profile photos, notification preferences, and closing an account.

Revision ID: 0014_profiles_and_notifications
Revises: 0013_org_limits
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0014_profiles_and_notifications"
down_revision = "0013_org_limits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Profile photo
    # ------------------------------------------------------------------
    # ITS OWN TABLE, not a column on `users`. Every query in the product loads
    # a user row — auth on every request, the member list, the audit join — and
    # a LargeBinary column on that table would drag the image bytes into all of
    # them. A separate table is only read when somebody asks for the picture.
    #
    # Bytes in Postgres for decision 95's reason: the deploy targets have
    # ephemeral filesystems, so anything written to disk vanishes on the next
    # deploy. `services/avatars.py` is the seam if this moves to object storage.
    op.create_table(
        "user_avatars",
        sa.Column("user_id", sa.Uuid(), primary_key=True),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        # CASCADE here, unlike everywhere else in this schema. A photo is not a
        # record anybody has to answer for later — it is decoration on an
        # account, and keeping it after the account is gone would be keeping
        # biometric-adjacent personal data for no reason at all.
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_user_avatars_user_id_users",
            ondelete="CASCADE",
        ),
    )

    # ------------------------------------------------------------------
    # Notification preferences
    # ------------------------------------------------------------------
    # Two columns rather than a preferences table: there are two switches, they
    # are read whenever a user is read, and a join for two booleans is worse
    # than two booleans.
    #
    # DEFAULT TRUE for "your learning" and FALSE for marketing. Opting somebody
    # into offerings they never asked for is the wrong default in every
    # jurisdiction that has an opinion, and course reminders are the thing they
    # signed up for.
    op.add_column(
        "users",
        sa.Column(
            "notify_learning", sa.Boolean(), nullable=False, server_default="true"
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "notify_offers", sa.Boolean(), nullable=False, server_default="false"
        ),
    )

    # ------------------------------------------------------------------
    # Closing an account
    # ------------------------------------------------------------------
    # Distinct from `is_active`, which is suspension by staff. This is the
    # person themselves deciding to leave, and the two want different words on
    # screen and different handling: a suspended account may be restored by an
    # admin, a closed one is the user's own decision and is recorded as such.
    op.add_column(
        "users", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "closed_at")
    op.drop_column("users", "notify_offers")
    op.drop_column("users", "notify_learning")
    op.drop_table("user_avatars")
