"""An organization's own document library.

Modelled on `module_materials` (migration 0006) and reusing the same validation
service: magic bytes decide what a PDF is, never the browser's Content-Type,
and the bytes live in Postgres because the deploy targets have ephemeral
filesystems.

`visibility` persists as VARCHAR + CHECK rather than a Postgres enum, matching
decision 55 — widening the set later is then a constraint rewrite rather than
an enum migration.

Revision ID: 0010_org_documents
Revises: 0009_organizations
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0010_org_documents"
down_revision = "0009_organizations"
branch_labels = None
depends_on = None

_VISIBILITY = "'organization', 'branch', 'department'"


def upgrade() -> None:
    op.create_table(
        "organization_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        # SET NULL, not CASCADE: closing a site must not silently destroy its
        # documents. They fall back to organization-wide, which is the safe
        # direction for a policy.
        sa.Column("branch_id", sa.Uuid(), nullable=True),
        sa.Column("department_id", sa.Uuid(), nullable=True),
        sa.Column(
            "visibility",
            sa.String(length=20),
            server_default="organization",
            nullable=False,
        ),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "content_type",
            sa.String(length=100),
            server_default="application/pdf",
            nullable=False,
        ),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name="fk_organization_documents_organization_id_organizations",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["branch_id"],
            ["branches.id"],
            name="fk_organization_documents_branch_id_branches",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["department_id"],
            ["departments.id"],
            name="fk_organization_documents_department_id_departments",
            ondelete="SET NULL",
        ),
        # RESTRICT: who put a document into a company's library is not a detail
        # to lose when an account is tidied away.
        sa.ForeignKeyConstraint(
            ["uploaded_by"],
            ["users.id"],
            name="fk_organization_documents_uploaded_by_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_organization_documents"),
        sa.UniqueConstraint(
            "organization_id", "title", name="uq_organization_documents_org_title"
        ),
        sa.CheckConstraint(
            f"visibility IN ({_VISIBILITY})", name="ck_organization_documents_visibility"
        ),
    )
    op.create_index(
        "ix_organization_documents_organization_id",
        "organization_documents",
        ["organization_id"],
    )
    op.create_index(
        "ix_organization_documents_branch_id", "organization_documents", ["branch_id"]
    )
    op.create_index(
        "ix_organization_documents_department_id",
        "organization_documents",
        ["department_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_organization_documents_department_id", table_name="organization_documents"
    )
    op.drop_index(
        "ix_organization_documents_branch_id", table_name="organization_documents"
    )
    op.drop_index(
        "ix_organization_documents_organization_id", table_name="organization_documents"
    )
    op.drop_table("organization_documents")
