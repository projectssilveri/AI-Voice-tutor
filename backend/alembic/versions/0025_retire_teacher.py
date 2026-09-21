"""The teacher role is retired. Its one account becomes a student.

Revision ID: 0025_no_teacher
Revises: 0024_cart
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0025_no_teacher"
down_revision = "0024_cart"
branch_labels = None
depends_on = None

#: Every role the product has, now that `teacher` is gone.
ROLES_AFTER = (
    "'student', 'admin', 'super_admin', 'org_admin', 'branch_manager', "
    "'dept_admin'"
)
ROLES_BEFORE = (
    "'student', 'teacher', 'admin', 'super_admin', 'org_admin', "
    "'branch_manager', 'dept_admin'"
)


def upgrade() -> None:
    # ------------------------------------------------------------------
    # WHY IT IS GOING
    # ------------------------------------------------------------------
    # `teacher` is the last piece of the first schema (0001), when the product
    # was going to be classrooms: teachers author, students learn. It became a
    # platform with a super admin, then a B2B side with org admins, branch
    # managers and department admins — and the department admin is the role
    # that actually authors training for its own team. Nothing was left that a
    # teacher did and an admin did not.
    #
    # It was taken off the platform role dropdown at that point and left in the
    # code, which is the worst of both: nobody could see it, and it still
    # carried real power. A teacher was in `STAFF_ROLES`, so they bypassed the
    # paywall and got every paid course free, saw unpublished drafts, read
    # training reports about other people, wrote and read quiz answer keys, and
    # skipped the certification completion gate. That last one is how it
    # surfaced: a teacher was handed an exam paper for a course they had
    # finished 2 of 4 modules of, and refused only at the submit.
    #
    # It also stayed assignable INSIDE an organization — `ORG_ASSIGNABLE_ROLES`
    # still offered it — so this was not merely a legacy value nobody could
    # reach any more.
    #
    # THEY BECOME STUDENTS, which is what the one holder asked for. Student is
    # also the safe direction: it removes power rather than granting it, so a
    # mistake here cannot open anything.
    op.execute("UPDATE users SET role = 'student' WHERE role = 'teacher'")

    # The constraint goes last, and only once no row can violate it.
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint("ck_users_role", "users", f"role IN ({ROLES_AFTER})")


def downgrade() -> None:
    # The accounts are NOT put back. Which students used to be teachers is not
    # recorded anywhere — `audit_events` stores `actor_user_id`, never a role
    # string — so restoring them would mean guessing, and guessing here means
    # handing somebody the paywall bypass. Widening the constraint is enough to
    # let the value exist again; who holds it is a decision, not a rollback.
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.create_check_constraint("ck_users_role", "users", f"role IN ({ROLES_BEFORE})")
