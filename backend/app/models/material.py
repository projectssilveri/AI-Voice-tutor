"""PDF course material attached to a module.

WHERE THE BYTES LIVE: in Postgres, as `bytea`, not on disk.

The deployment targets — Vercel for the frontend, Render or Fly
for the Python service — both have ephemeral filesystems: anything written to
local disk is gone on the next deploy or restart. Files that silently vanish
after a redeploy is a worse failure than a larger database, and it is the kind
that goes unnoticed until a student reports a dead link. Object storage (S3 or
similar) is the right answer at scale, but nothing is configured and inventing
a bucket the operator has not set up would be a worse default.

`upload_material` in `services/materials.py` is the seam: swapping to S3 later
means changing where `data` is read and written, not the schema around it.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, uuid_pk


class ModuleMaterial(TimestampMixin, Base):
    """A PDF a student can read alongside the module."""

    __tablename__ = "module_materials"
    __table_args__ = (Index("ix_module_materials_module_id", "module_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    module_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("modules.id", ondelete="CASCADE"), nullable=False
    )

    # The name shown to a student. Sanitised on the way in — never used to
    # build a filesystem path, because nothing is written to the filesystem.
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    # Verified from the file's own magic bytes, not from the browser's
    # Content-Type header, which the client controls and can lie about.
    content_type: Mapped[str] = mapped_column(
        String(100), nullable=False, default="application/pdf"
    )

    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    # Text pulled out of the PDF at upload time. NOT automatically used to
    # ground the tutor: `modules.content` remains the single source of what the
    # AI may teach from, and an author copies this into it deliberately.
    # Extraction is imperfect — a scanned page yields nothing — so silently
    # feeding it to the tutor would let a bad extraction become the lesson.
    extracted_text: Mapped[str | None] = mapped_column(Text)

    # Who put it there. RESTRICT, like every other attribution column: material
    # a student is being taught from must not become anonymous.
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    module: Mapped[Module] = relationship(back_populates="materials")  # noqa: F821

    def __repr__(self) -> str:
        return f"<ModuleMaterial {self.filename!r} ({self.size_bytes} bytes)>"
