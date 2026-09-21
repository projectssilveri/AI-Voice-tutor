"""Organizations, and the structure inside them.

A customer company. Its learners live in a walled garden: they see their own
organization's courses and nothing from the public marketplace, and nobody
outside the organization sees theirs. That rule is enforced in
`app/services/access.py` — the single chokepoint — not here.

THE SHAPE OF TENANCY. Every tenancy column in this schema is NULLABLE, and
`NULL` means "public B2C". That is what lets organizations land without
touching the existing product: a public student, a public course and every
query over them behave exactly as they did before. One organization per user
(columns on `users` rather than a membership table), which matches how
employment works and keeps every scoped query one join shorter.

  organizations
    └── branches            a physical or regional site
          └── departments   a team; may instead sit directly under the org

A department may belong to a branch OR to the organization at large — a
company-wide "Compliance" function is not a branch's. That is why
`departments.branch_id` is nullable rather than required.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from app.models.course import Course
    from app.models.user import User


class Organization(TimestampMixin, Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # The tenant's address bar identity: /org/acme/login. UNIQUE because it
    # resolves to exactly one organization, and indexed because every request
    # to an org route looks it up. Chosen by staff at creation rather than
    # derived from the name, so renaming a company does not break its links.
    slug: Mapped[str] = mapped_column(
        String(63), nullable=False, unique=True, index=True
    )

    # Deactivating suspends access without deleting anyone's history — which
    # matters because `audit_events.actor_user_id` is RESTRICT and a customer
    # who leaves still has a trail somebody may have to answer for.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )

    # WHAT THEY BOUGHT. All nullable, and NULL means unlimited, so every
    # organization created before these existed behaves exactly as it did.
    # Zero is a real limit meaning "none", which is why absent cannot be zero.
    max_members: Mapped[int | None] = mapped_column(Integer)
    # AI is the one cost here that scales with USE rather than headcount: a
    # Gemini Live session is billed by the minute against our key. This is the
    # number a business plan is actually sold on.
    max_ai_minutes_per_month: Mapped[int | None] = mapped_column(Integer)
    # Overrides the platform default (settings.max_modules_per_course).
    max_modules_per_course: Mapped[int | None] = mapped_column(Integer)
    # What the super admin agreed when a customer negotiated something off
    # the standard plans. Free text, because the point of custom pricing is
    # that it does not fit the columns.
    plan_note: Mapped[str | None] = mapped_column(String(500))

    branches: Mapped[list[Branch]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    departments: Mapped[list[Department]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    users: Mapped[list[User]] = relationship(back_populates="organization")
    courses: Mapped[list[Course]] = relationship(back_populates="organization")


class Branch(TimestampMixin, Base):
    """A site or region within an organization."""

    __tablename__ = "branches"

    id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )

    organization: Mapped[Organization] = relationship(back_populates="branches")
    departments: Mapped[list[Department]] = relationship(
        back_populates="branch", cascade="all, delete-orphan"
    )
    users: Mapped[list[User]] = relationship(back_populates="branch")

    __table_args__ = (
        # Two branches called "London" in one company is a data-entry mistake,
        # not a valid state. Scoped to the organization, so two customers may
        # each have a London.
        UniqueConstraint(
            "organization_id", "name", name="uq_branches_organization_id_name"
        ),
    )


class Department(TimestampMixin, Base):
    """A team. Belongs to a branch, or to the organization at large."""

    __tablename__ = "departments"

    id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Nullable: an org-wide department is a real thing. Deleting a branch takes
    # its departments with it, which is why this is CASCADE rather than
    # RESTRICT — a department with no branch and no org-wide intent is orphaned
    # data nobody can act on.
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    organization: Mapped[Organization] = relationship(back_populates="departments")
    branch: Mapped[Branch | None] = relationship(back_populates="departments")
    users: Mapped[list[User]] = relationship(back_populates="department")

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "branch_id",
            "name",
            name="uq_departments_organization_id_branch_id_name",
        ),
        # The constraint above does NOT cover org-wide departments. Postgres
        # treats NULLs as distinct in a UNIQUE constraint, so
        # (acme, NULL, 'Compliance') never collides with itself. A partial
        # unique index over the NULL case is the only way to express it —
        # declared here rather than only in the migration, so the model stays
        # the single source of truth and the drift test can check the two
        # against each other.
        Index(
            "uq_departments_org_wide_name",
            "organization_id",
            "name",
            unique=True,
            postgresql_where=text("branch_id IS NULL"),
        ),
    )
