"""Deleting a customer's data now goes past that customer first.

Revision ID: 0023_deletions
Revises: 0022_tutor_voice
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0023_deletions"
down_revision = "0022_tutor_voice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # WHY THIS TABLE EXISTS
    # ------------------------------------------------------------------
    # A platform admin can now see every organization in full — its people, its
    # training, its documents. Sight runs down the ladder; destruction does not.
    # The data belongs to the customer even though the platform holds it, so
    # anything that destroys it is a request the customer's own administrator
    # decides.
    #
    # Same shape as `suspension_requests` (0020) and for the same reasons: a
    # request has an author, a reason, a decision, a decider and two timestamps,
    # and there can be several over the life of one thing. None of that belongs
    # as columns on `users`, `courses` or `organization_documents`.
    op.create_table(
        "deletion_requests",
        sa.Column(
            "id",
            sa.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        # WHOSE APPROVAL THIS NEEDS. CASCADE: a request against a deleted
        # organization is a decision nobody is left to make.
        sa.Column(
            "organization_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        # DELIBERATELY NOT A FOREIGN KEY. It points at one of three tables —
        # users, courses, organization_documents — and the alternative is three
        # near-identical tables and three queues for an administrator to check.
        sa.Column("target_id", sa.UUID(as_uuid=True), nullable=False),
        # THE NAME, COPIED IN AT REQUEST TIME. Without a foreign key nothing
        # stops a request outliving its target, and after the deletion the id
        # points at nothing: a queue that can only say "a member" is one nobody
        # can decide from. The audit trail records a name on delete for exactly
        # the same reason (issue 66).
        sa.Column("target_label", sa.String(length=300), nullable=False),
        # WHO ASKED and WHO DECIDED. RESTRICT on both, matching
        # `suspension_requests`: something was destroyed on somebody's say-so,
        # and a record that cannot say whose is not a record.
        sa.Column(
            "requested_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "decided_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        # `accounts.remove_account` deletes an account with no history and
        # closes one that has any. Which of those ran is what the person who
        # asked actually wants to know.
        sa.Column("outcome", sa.String(length=40), nullable=True),
    )

    # NAMED CHECKS rather than a Postgres ENUM type, matching 0020. An enum type
    # needs ALTER TYPE to gain a value and cannot lose one; a check constraint
    # is one DDL statement either way.
    op.create_check_constraint(
        "ck_deletion_requests_target_type",
        "deletion_requests",
        "target_type IN ('member', 'training', 'document')",
    )
    op.create_check_constraint(
        "ck_deletion_requests_status",
        "deletion_requests",
        "status IN ('pending', 'approved', 'declined')",
    )

    # ONE OPEN REQUEST PER THING. Two people asking to remove the same member
    # would otherwise queue the same decision twice, and approving one would
    # leave the other pending against something already gone.
    #
    # PARTIAL, so a decided request never blocks a later one — somebody declined
    # today can be asked about again next year. The service checks this too, and
    # the check races two people pressing at the same moment; the index is the
    # only thing that cannot.
    op.create_index(
        "uq_deletion_requests_one_open",
        "deletion_requests",
        ["target_type", "target_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    # The queue an organization admin opens, which is always scoped to them and
    # almost always filtered to pending.
    op.create_index(
        "ix_deletion_requests_org_status",
        "deletion_requests",
        ["organization_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_deletion_requests_org_status", table_name="deletion_requests")
    op.drop_index("uq_deletion_requests_one_open", table_name="deletion_requests")
    op.drop_table("deletion_requests")
