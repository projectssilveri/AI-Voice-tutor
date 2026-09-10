"""Attribute past org-portal requests to the organization they acted on.

The audit middleware fell back to the ACTOR's organization, which is NULL for
platform staff. So a super admin working inside a customer's portal produced a
platform-level event whose recorded path named the customer —
`path=/org/globex/members` — and an ordinary platform admin reading the platform
trail learned both that the customer exists and what was being done there. That
is the leak decision 171 closed, coming back in through the middleware net.

`app/deps.py` now stamps `request.state.organization_id` from the resolved
scope, which fixes every event written from here on. This fixes the ones already
written, by reading the slug back out of the recorded path and matching it
against `organizations.slug`.

Deliberately narrow: only rows that have no organization yet, only `metadata`
carrying a path of the form `/org/{slug}/...`, and only where that slug matches
a real organization. A row that matches nothing is left exactly as it is —
guessing at an audit record is worse than an unattributed one.

Revision ID: 0012_backfill_audit_org
Revises: 0011_messaging
"""

from __future__ import annotations

from alembic import op

revision = "0012_backfill_audit_org"
down_revision = "0011_messaging"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE audit_events AS e
        SET organization_id = o.id
        FROM organizations AS o
        WHERE e.organization_id IS NULL
          AND e.metadata ->> 'path' LIKE '/org/%'
          AND split_part(e.metadata ->> 'path', '/', 3) = o.slug
        """
    )


def downgrade() -> None:
    # Not reversed. Putting the leak back is not a migration anybody wants, and
    # the correct attribution is not distinguishable afterwards from one written
    # correctly in the first place.
    pass
