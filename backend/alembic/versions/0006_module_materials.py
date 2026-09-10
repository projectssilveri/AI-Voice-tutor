"""PDF course material attached to a module.

Bytes live in Postgres rather than on disk: the deployment targets have
ephemeral filesystems, so an uploaded file would disappear on the next deploy.
See app/models/material.py for the full reasoning.

Revision ID: 0006_module_materials
Revises: 0005_pricing_and_super_admin
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0006_module_materials"
down_revision = "0005_pricing_and_super_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "module_materials",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("module_id", sa.UUID(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "content_type",
            sa.String(length=100),
            nullable=False,
            server_default="application/pdf",
        ),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.UUID(), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_module_materials")),
        sa.ForeignKeyConstraint(
            ["module_id"],
            ["modules.id"],
            name=op.f("fk_module_materials_module_id_modules"),
            ondelete="CASCADE",
        ),
        # RESTRICT: material a student is taught from must not become
        # anonymous because an account was removed.
        sa.ForeignKeyConstraint(
            ["uploaded_by"],
            ["users.id"],
            name=op.f("fk_module_materials_uploaded_by_users"),
            ondelete="RESTRICT",
        ),
    )
    op.create_index(
        "ix_module_materials_module_id", "module_materials", ["module_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_module_materials_module_id", table_name="module_materials")
    op.drop_table("module_materials")
