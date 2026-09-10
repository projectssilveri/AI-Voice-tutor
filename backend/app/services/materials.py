"""Accepting and serving PDF course material.

Everything an uploaded file could do wrong is refused here rather than at the
route, so there is one place to read when asking "what are we willing to
store?".

A file arriving from a browser is untrusted in three separate ways, and each
needs its own check:
  - the Content-Type header is set by the client and can say anything
  - the filename is chosen by the client and may contain path separators
  - the size is only known once the bytes are actually read
"""

from __future__ import annotations

import io
import re
import unicodedata
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.material import ModuleMaterial

# A PDF starts with "%PDF-" followed by a version. This is what makes it a PDF,
# not the extension and not the Content-Type header.
PDF_MAGIC = b"%PDF-"

# 20 MB. Large enough for a lecture handout with diagrams, small enough that a
# row stays comfortable in Postgres and one upload cannot exhaust memory.
MAX_BYTES = 20 * 1024 * 1024

# Extraction stops here. A pathological PDF can hold far more text than any
# lesson needs, and the column is read back into API responses.
MAX_EXTRACTED_CHARS = 200_000


class MaterialError(ValueError):
    """The upload is not something we are willing to store."""


class MaterialTooLargeError(MaterialError):
    pass


class NotAPdfError(MaterialError):
    pass


def safe_filename(raw: str | None) -> str:
    """A display name that cannot be mistaken for a path.

    Nothing here is written to disk, so this is not a traversal defence — it is
    so the name is readable, bounded, and safe to put in a Content-Disposition
    header, where a stray quote or newline would let the caller inject header
    content.
    """
    name = (raw or "").strip() or "material.pdf"
    # Take the last segment: browsers on some platforms send a full path.
    name = re.split(r"[\\/]", name)[-1]
    # Strip control characters and quotes rather than escaping them.
    name = unicodedata.normalize("NFKC", name)
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '"\\')
    name = name.strip(". ") or "material.pdf"
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    return name[:255]


def extract_text(data: bytes) -> str | None:
    """Pull the readable text out of a PDF, or None if there is none.

    A scanned document is a picture of text and yields nothing — that is a
    normal outcome, not an error, and the caller must not treat an empty result
    as a failed upload. Any parser exception is swallowed for the same reason:
    a PDF we cannot read is still a PDF a student can download.
    """
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        chunks: list[str] = []
        total = 0
        for page in reader.pages:
            try:
                text = page.extract_text() or ""
            except Exception:
                continue  # One unreadable page must not lose the rest.
            if not text.strip():
                continue
            chunks.append(text)
            total += len(text)
            if total >= MAX_EXTRACTED_CHARS:
                break
        joined = "\n\n".join(chunks).strip()
        return joined[:MAX_EXTRACTED_CHARS] or None
    except Exception:
        return None


def validate(data: bytes, filename: str | None) -> tuple[str, str]:
    """Check the bytes and return (safe_filename, content_type).

    Raises MaterialError for anything we will not store.
    """
    if not data:
        raise NotAPdfError("The file is empty.")
    if len(data) > MAX_BYTES:
        raise MaterialTooLargeError(
            f"That file is {len(data) / 1024 / 1024:.1f} MB. "
            f"The limit is {MAX_BYTES // 1024 // 1024} MB."
        )
    # The magic bytes, not the header the browser sent.
    if not data.startswith(PDF_MAGIC):
        raise NotAPdfError("That file is not a PDF.")
    return safe_filename(filename), "application/pdf"


async def add_material(
    session: AsyncSession,
    *,
    module_id: uuid.UUID,
    data: bytes,
    filename: str | None,
    uploaded_by: uuid.UUID,
) -> ModuleMaterial:
    """Store a validated PDF against a module."""
    name, content_type = validate(data, filename)

    material = ModuleMaterial(
        module_id=module_id,
        filename=name,
        size_bytes=len(data),
        content_type=content_type,
        data=data,
        extracted_text=extract_text(data),
        uploaded_by=uploaded_by,
    )
    session.add(material)
    await session.commit()
    await session.refresh(material)
    return material


async def list_for_module(
    session: AsyncSession, module_id: uuid.UUID
) -> list[ModuleMaterial]:
    """Materials for one module.

    Deliberately does NOT select `data`: the listing is rendered on every
    module page, and shipping the bytes of every PDF to build a list of links
    would move megabytes to draw a few filenames.
    """
    result = await session.execute(
        select(
            ModuleMaterial.id,
            ModuleMaterial.module_id,
            ModuleMaterial.filename,
            ModuleMaterial.size_bytes,
            ModuleMaterial.content_type,
            ModuleMaterial.created_at,
            ModuleMaterial.uploaded_by,
        )
        .where(ModuleMaterial.module_id == module_id)
        .order_by(ModuleMaterial.created_at)
    )
    return list(result.all())


async def get_with_data(
    session: AsyncSession, material_id: uuid.UUID
) -> ModuleMaterial | None:
    """The full row including bytes — only for the download route."""
    return await session.scalar(
        select(ModuleMaterial).where(ModuleMaterial.id == material_id)
    )


async def get_extracted_text(
    session: AsyncSession, material_id: uuid.UUID
) -> tuple[uuid.UUID, str | None] | None:
    """(module_id, text) without loading the PDF itself."""
    row = (
        await session.execute(
            select(ModuleMaterial.module_id, ModuleMaterial.extracted_text).where(
                ModuleMaterial.id == material_id
            )
        )
    ).first()
    return (row[0], row[1]) if row else None


async def delete_material(session: AsyncSession, material_id: uuid.UUID) -> bool:
    material = await session.get(ModuleMaterial, material_id)
    if material is None:
        return False
    await session.delete(material)
    await session.commit()
    return True
