"""The Team plan: an organization can be granted the public catalogue.

Revision ID: 0032_org_catalogue_access
Revises: 0031_org_change_requests
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0032_org_catalogue_access"
down_revision = "0031_org_change_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # True means this organization's people get every published public course,
    # with full coursework, the same as if the company had bought each one.
    # Off by default, so every organization keeps its current walled garden
    # until platform staff switch it on from the Limits screen. Additive and
    # back-compatible: nothing to backfill. See app/models/organization.py and
    # app/services/access.tenancy_decision.
    op.add_column(
        "organizations",
        sa.Column(
            "catalogue_access",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("organizations", "catalogue_access")
