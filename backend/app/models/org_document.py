"""An organization's own document library.

Deliberately separate from `module_materials`. A module material is a handout
attached to one lesson; these are the company's own files — a policy, a
handbook, a procedure — which exist whether or not a course ever references
them, and which are shared by audience rather than by lesson.

The bytes live in Postgres: the target hosts
have ephemeral filesystems, so anything written to disk is
gone on the next deploy. Files that silently vanish after a redeploy are a
worse failure than a larger database, and the kind nobody notices until someone
reports a dead link. `services/org_documents.py` is the seam — moving to object
storage means changing where `data` is read and written, not the schema.
"""

from __future__ import annotations

import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Enum,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, uuid_pk

if TYPE_CHECKING:
    from app.models.organization import Branch, Department, Organization
    from app.models.user import User


class DocumentVisibility(str, enum.Enum):
    """Who inside the organization may read a document.

    `str` base is load-bearing, per decision 55: this persists as VARCHAR +
    CHECK, and the base is what makes a member compare equal to its stored
    value.

    Narrowing is the point. A payroll procedure belongs to one department; a
    fire drill belongs to one site; a code of conduct belongs to everyone. One
    library with three audiences beats three libraries.
    """

    ORGANIZATION = "organization"
    BRANCH = "branch"
    DEPARTMENT = "department"


class OrganizationDocument(TimestampMixin, Base):
    __tablename__ = "organization_documents"

    id: Mapped[uuid.UUID] = uuid_pk()

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Which branch or department this is for, when the visibility narrows to
    # one. Both SET NULL rather than CASCADE: closing a site must not silently
    # destroy its documents — an admin should find them, unassigned, and
    # decide. A document whose scope has been deleted falls back to
    # organization-wide, which is the safe direction for a policy.
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )

    visibility: Mapped[DocumentVisibility] = mapped_column(
        Enum(
            DocumentVisibility,
            # Named the way every other enum in this schema is named, so the
            # model and migration 0010 agree. SQLAlchemy uses `name` for the
            # CHECK constraint itself; `models/base.py` deliberately has no
            # `ck` convention token, so each one is named at its definition.
            name="ck_organization_documents_visibility",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            native_enum=False,
            length=20,
            validate_strings=True,
            create_constraint=True,
        ),
        nullable=False,
        server_default=DocumentVisibility.ORGANIZATION.value,
    )

    # UPLOADED BY A BRANCH OR DEPARTMENT ADMIN, NOT YET APPROVED. Sir's rule of
    # 2026-10-01: a manager's upload waits for the org admin. The file is stored
    # at once but hidden until then, so the listings and the file fetch filter
    # this out for everyone. Approving clears it; declining deletes the row.
    # Default false, so an org admin's or platform staff's upload is visible at
    # once, as is every document that existed before this column.
    pending_approval: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )

    # What the uploader called it, which is not the filename: "Code of Conduct
    # 2026" reads better in a list than "coc_v3_FINAL_final.pdf".
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(
        String(100), nullable=False, server_default="application/pdf"
    )
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    # Pulled out at upload so it can be OFFERED as tutor material. Never
    # applied automatically — decision 97: extraction is imperfect, a scanned
    # page yields nothing at all, and silently feeding that to Gemini would let
    # a bad extraction become the lecture.
    extracted_text: Mapped[str | None] = mapped_column(Text)

    # RESTRICT, like `attempt_grants.granted_by`: who put a document into a
    # company's library is not a detail to lose when an account is tidied away.
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    organization: Mapped[Organization] = relationship()
    branch: Mapped[Branch | None] = relationship()
    department: Mapped[Department | None] = relationship()
    uploader: Mapped[User] = relationship()

    __table_args__ = (
        # Two files with the same title in the same organization is a
        # data-entry mistake, not a valid state — and it makes "open the code
        # of conduct" ambiguous, which for a policy document is the whole
        # problem. Scoped to the organization, so two customers may each have
        # a "Code of Conduct".
        UniqueConstraint(
            "organization_id", "title", name="uq_organization_documents_org_title"
        ),
    )
