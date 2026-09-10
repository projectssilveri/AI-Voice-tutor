"""Departmental administrators — the HR admin, the sales admin.

Adds one role and nothing else. Everything a department admin needs is already
in the schema: `users.department_id` says which department they run, and
`courses.department_id` says which department a course belongs to. What was
missing was a role that means "administers exactly one department", so an
organization could not delegate downwards without handing over the whole
company.

`UserRole` persists as VARCHAR + a CHECK constraint rather than a Postgres enum
(decision 55), so widening the role set means rewriting the constraint. Forget
this and every insert of a dept_admin fails at runtime with a constraint
violation that says nothing about the cause.

Revision ID: 0021_dept_admin
Revises: 0020_suspensions
"""

from __future__ import annotations

from alembic import op

revision = "0021_dept_admin"
down_revision = "0020_suspensions"
branch_labels = None
depends_on = None

_ROLES_BEFORE = (
    "'student', 'teacher', 'admin', 'super_admin', 'org_admin', 'branch_manager'"
)
_ROLES_AFTER = f"{_ROLES_BEFORE}, 'dept_admin'"


def upgrade() -> None:
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint("ck_users_role", "users", f"role IN ({_ROLES_AFTER})")


def downgrade() -> None:
    # Anyone holding the role has to become something the old constraint
    # accepts, or re-adding it fails. STUDENT is the safe floor: it grants
    # nothing, so a bad downgrade under-permits rather than over-permits. The
    # same choice migration 0009 made for the two roles it added.
    op.execute("UPDATE users SET role = 'student' WHERE role = 'dept_admin'")
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint("ck_users_role", "users", f"role IN ({_ROLES_BEFORE})")
