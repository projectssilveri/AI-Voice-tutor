"""Organizations, branches and departments; tenancy columns; two org roles.

EVERY TENANCY COLUMN IS NULLABLE, and NULL means "public B2C". That is what
lets this land without changing anything for the existing product: every
account, every course and every query over them behaves exactly as before.

The isolation rule that reads these columns arrives in a later migration's
phase — `services/access.py`. Until then the columns exist and are populated,
but nothing filters on them, so no organization content may be created yet.

Revision ID: 0009_organizations
Revises: 0008_audit_events
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0009_organizations"
down_revision = "0008_audit_events"
branch_labels = None
depends_on = None

# Kept next to each other so the pair is obviously symmetrical; getting these
# out of step is how a CHECK constraint silently starts rejecting a valid role.
_ROLES_BEFORE = "'student', 'teacher', 'admin', 'super_admin'"
_ROLES_AFTER = (
    "'student', 'teacher', 'admin', 'super_admin', 'org_admin', 'branch_manager'"
)


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=63), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
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
        sa.PrimaryKeyConstraint("id", name="pk_organizations"),
    )
    # A UNIQUE INDEX, not a UNIQUE CONSTRAINT plus a separate index. The first
    # draft created both, which left two btrees over one column: the model
    # declares `unique=True, index=True`, and SQLAlchemy renders that as a
    # single unique index. Found by `test_migration_matches_models`.
    op.create_index("ix_organizations_slug", "organizations", ["slug"], unique=True)

    op.create_table(
        "branches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
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
            name="fk_branches_organization_id_organizations",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_branches"),
        sa.UniqueConstraint(
            "organization_id", "name", name="uq_branches_organization_id_name"
        ),
    )
    op.create_index("ix_branches_organization_id", "branches", ["organization_id"])

    op.create_table(
        "departments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        # Nullable: a company-wide function belongs to no branch.
        sa.Column("branch_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
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
            name="fk_departments_organization_id_organizations",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["branch_id"],
            ["branches.id"],
            name="fk_departments_branch_id_branches",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_departments"),
        sa.UniqueConstraint(
            "organization_id",
            "branch_id",
            "name",
            name="uq_departments_organization_id_branch_id_name",
        ),
    )
    op.create_index("ix_departments_organization_id", "departments", ["organization_id"])
    op.create_index("ix_departments_branch_id", "departments", ["branch_id"])

    # Postgres treats NULLs as distinct in a UNIQUE constraint, so the one
    # above does NOT stop two org-wide departments sharing a name — the pair
    # ('acme', NULL, 'Compliance') never collides with itself. A partial unique
    # index over the NULL case is the only way to express it.
    op.create_index(
        "uq_departments_org_wide_name",
        "departments",
        ["organization_id", "name"],
        unique=True,
        postgresql_where=sa.text("branch_id IS NULL"),
    )

    # --- Tenancy columns ----------------------------------------------------
    for column, target, ondelete in (
        ("organization_id", "organizations", "RESTRICT"),
        ("branch_id", "branches", "SET NULL"),
        ("department_id", "departments", "SET NULL"),
    ):
        op.add_column("users", sa.Column(column, sa.Uuid(), nullable=True))
        op.create_foreign_key(
            f"fk_users_{column}_{target}",
            "users",
            target,
            [column],
            ["id"],
            ondelete=ondelete,
        )
        op.create_index(f"ix_users_{column}", "users", [column])

    op.add_column("courses", sa.Column("organization_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_courses_organization_id_organizations",
        "courses",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_courses_organization_id", "courses", ["organization_id"])

    # `audit_events.organization_id` was created in 0008 without a constraint,
    # because the table it points at did not exist yet.
    op.create_foreign_key(
        "fk_audit_events_organization_id_organizations",
        "audit_events",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # --- Roles --------------------------------------------------------------
    # These persist as VARCHAR + CHECK rather than a Postgres enum (decision
    # 55), so widening the role set means rewriting the constraint. Forget this
    # and every insert of an org_admin fails at runtime with a constraint
    # violation that says nothing about the cause.
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint("ck_users_role", "users", f"role IN ({_ROLES_AFTER})")


def downgrade() -> None:
    # Anyone holding an org role has to become something the old constraint
    # accepts, or re-adding it fails. Student is the safe floor: it grants
    # nothing, so a bad downgrade under-permits rather than over-permits.
    op.execute(
        "UPDATE users SET role = 'student' "
        "WHERE role IN ('org_admin', 'branch_manager')"
    )
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint("ck_users_role", "users", f"role IN ({_ROLES_BEFORE})")

    op.drop_constraint(
        "fk_audit_events_organization_id_organizations", "audit_events", type_="foreignkey"
    )

    op.drop_index("ix_courses_organization_id", table_name="courses")
    op.drop_constraint(
        "fk_courses_organization_id_organizations", "courses", type_="foreignkey"
    )
    op.drop_column("courses", "organization_id")

    for column, target in (
        ("department_id", "departments"),
        ("branch_id", "branches"),
        ("organization_id", "organizations"),
    ):
        op.drop_index(f"ix_users_{column}", table_name="users")
        op.drop_constraint(f"fk_users_{column}_{target}", "users", type_="foreignkey")
        op.drop_column("users", column)

    op.drop_index("uq_departments_org_wide_name", table_name="departments")
    op.drop_index("ix_departments_branch_id", table_name="departments")
    op.drop_index("ix_departments_organization_id", table_name="departments")
    op.drop_table("departments")

    op.drop_index("ix_branches_organization_id", table_name="branches")
    op.drop_table("branches")

    op.drop_index("ix_organizations_slug", table_name="organizations")
    op.drop_table("organizations")
