"""Users."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from app.models.assignment import AssignmentSubmission
    from app.models.certification import AttemptGrant, CertAttempt, Certificate
    from app.models.enrollment import Enrollment, ModuleProgress
    from app.models.order import Order
    from app.models.organization import Branch, Department, Organization
    from app.models.quiz import QuizAttempt
    from app.models.subscription import Subscription
    from app.models.voice import VoiceSession


class UserRole(str, enum.Enum):
    """Who someone is.

    SUPER_ADMIN is strictly above ADMIN: it can promote and demote admins and
    see revenue, and it satisfies every admin-gated route (see
    `deps.require_role`). Everything else an admin can do, a super admin can do
    too — the split is about money and about who is allowed to hand out power.
    """

    STUDENT = "student"
    TEACHER = "teacher"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"

    # Organization roles. Scoped to one tenant: an ORG_ADMIN administers their
    # own organization and has no reach outside it, which is what separates
    # them from the platform ADMIN above. A BRANCH_MANAGER is narrower still —
    # their own branch only — and a DEPT_ADMIN narrower again.
    ORG_ADMIN = "org_admin"
    BRANCH_MANAGER = "branch_manager"

    # THE HR ADMIN, THE SALES ADMIN. A department's own administrator: they run
    # the people in their department and write the training for it, and they
    # see nothing of any other department's. The department comes from
    # `users.department_id`, not from the role — "HR admin" and "sales admin"
    # are the same role pointed at different departments, which is why this is
    # one role rather than one per team.
    #
    # Deliberately below BRANCH_MANAGER rather than beside it: a branch
    # contains departments, so a branch manager may appoint a department's
    # admin, and a department admin may never appoint a branch's manager.
    DEPT_ADMIN = "dept_admin"


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(
        String(320), nullable=False, unique=True, index=True
    )
    # Optional, and not unique: a shared office line or a parent's number on a
    # student account are both ordinary, and a UNIQUE index would refuse the
    # second person to enter one. Not an identifier — sign-in is by email.
    phone: Mapped[str | None] = mapped_column(String(32))

    # --- Tenancy -----------------------------------------------------------
    # NULL means a public B2C user, which is every account that exists today.
    # That is what lets organizations arrive without changing how the existing
    # product behaves for anyone.
    #
    # RESTRICT rather than CASCADE: deleting an organization must not silently
    # delete the people in it. Emptying a tenant is a deliberate, auditable
    # sequence, not a side effect of one DELETE.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    # SET NULL: closing a branch should not orphan or delete its people. They
    # stay in the organization, unassigned, for an admin to place.
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # The brief names this column `password_hash`; fastapi-users requires the
    # *attribute* to be `hashed_password`. Mapping one to the other satisfies
    # both, so step 4 can drop fastapi-users in without a migration.
    hashed_password: Mapped[str] = mapped_column(
        "password_hash", String(1024), nullable=False
    )

    # SEES PAST THE DEPARTMENT WALL. Org admins and branch managers already do,
    # by role. This is for the person who is neither and still must: an HR or
    # IT manager sitting inside one department who has to see everyone.
    #
    # A flag rather than two more roles. `UserRole` persists as VARCHAR with a
    # CHECK constraint (decision 55), so each new role means editing that
    # constraint in a migration — and "can this person see other departments"
    # is one question, not a rank.
    sees_all_departments: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )

    # WHICH VOICE THE TUTOR SPEAKS IN. NULL means the platform default, which
    # is what every account had before this existed — and before it, nothing
    # picked a voice at all, so every student on the platform heard the same
    # man whether that suited them or not.
    #
    # A plain string, not an enum: the set of prebuilt voices is Gemini's and
    # grows without asking us. `services/gemini_live.TUTOR_VOICES` is the list
    # the API validates against, and a value that is no longer offered falls
    # back to the default rather than failing a lesson.
    tutor_voice: Mapped[str | None] = mapped_column(String(40))

    # Email preferences. Learning on by default because it is what they signed
    # up for; offers OFF by default because opting somebody into marketing they
    # never asked for is the wrong default everywhere it matters.
    #
    # Neither switch touches transactional mail — a receipt or a password reset
    # is not a communication anybody opts out of.
    notify_learning: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", default=True
    )
    notify_offers: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )

    # The person closed their own account, as opposed to `is_active`, which is
    # staff suspending it. Different words on screen and different handling: a
    # suspension can be lifted by an admin, this was their decision.
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    role: Mapped[UserRole] = mapped_column(
        # native_enum=False stores a VARCHAR + CHECK rather than a Postgres
        # ENUM type. Adding a role later is then an ordinary migration instead
        # of an ALTER TYPE that can't run inside a transaction.
        #
        # create_constraint=True is not the SQLAlchemy 2.0 default. It is set
        # because this column decides who reaches admin data: a bad value has
        # to fail at the database, not only in the Python layer that wrote it.
        # values_callable is required, not cosmetic: without it SQLAlchemy
        # persists the enum *member name* ("STUDENT"), which would not match
        # the lowercase server_default below — every default insert would fail
        # the CHECK. The brief also specifies lowercase values.
        Enum(
            UserRole,
            native_enum=False,
            length=20,
            validate_strings=True,
            create_constraint=True,
            name="ck_users_role",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=UserRole.STUDENT,
        server_default=UserRole.STUDENT.value,
        index=True,
    )

    # fastapi-users expects these three on the user table (step 4).
    is_active: Mapped[bool] = mapped_column(
        nullable=False, default=True, server_default="true"
    )
    is_superuser: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default="false"
    )
    is_verified: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default="false"
    )

    organization: Mapped[Organization | None] = relationship(
        back_populates="users", foreign_keys=[organization_id]
    )
    branch: Mapped[Branch | None] = relationship(
        back_populates="users", foreign_keys=[branch_id]
    )
    department: Mapped[Department | None] = relationship(
        back_populates="users", foreign_keys=[department_id]
    )

    enrollments: Mapped[list[Enrollment]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    module_progress: Mapped[list[ModuleProgress]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    voice_sessions: Mapped[list[VoiceSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    quiz_attempts: Mapped[list[QuizAttempt]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    cert_attempts: Mapped[list[CertAttempt]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    certificates: Mapped[list[Certificate]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    attempt_grants: Mapped[list[AttemptGrant]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="AttemptGrant.user_id",
    )
    subscriptions: Mapped[list[Subscription]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    assignment_submissions: Mapped[list[AssignmentSubmission]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="AssignmentSubmission.user_id",
    )
    orders: Mapped[list[Order]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User {self.email} ({self.role.value})>"
