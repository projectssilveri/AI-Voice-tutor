"""An organization's document library.

Validation, filename safety and text extraction are REUSED from
`services/materials.py` rather than reimplemented. Those rules are the
security-relevant part — magic bytes decide what a PDF is, never the browser's
Content-Type; the filename is stripped of anything that could inject into a
`Content-Disposition` header — and having two copies of them is how one copy
quietly falls behind.

WHO CAN READ WHAT. A document is scoped to the whole organization, one branch,
or one department. The filter is built here and applied as SQL, not by hiding
rows in the UI: a payroll procedure must never reach the browser of someone
outside payroll, whatever the page chooses to draw.
"""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.org_document import DocumentVisibility, OrganizationDocument
from app.models.user import User
from app.services.materials import extract_text, safe_filename, validate

__all__ = [
    "add_document",
    "delete_document",
    "get_with_data",
    "list_for_user",
    "readable_filter",
    "validate",
]


def readable_filter(user: User):
    """The SQL condition for "documents this person may read".

    Three rules, OR'd:

      * organization-wide — everyone in the organization
      * branch — only people in that branch
      * department — only people in that department

    A person with no branch or department sees the organization-wide documents
    and nothing else, which is the correct fail-closed answer: unassigned means
    "we have not decided where they belong", not "they belong everywhere".
    """
    conditions = [
        OrganizationDocument.visibility == DocumentVisibility.ORGANIZATION,
    ]
    if user.branch_id is not None:
        conditions.append(
            (OrganizationDocument.visibility == DocumentVisibility.BRANCH)
            & (OrganizationDocument.branch_id == user.branch_id)
        )
    if user.department_id is not None:
        conditions.append(
            (OrganizationDocument.visibility == DocumentVisibility.DEPARTMENT)
            & (OrganizationDocument.department_id == user.department_id)
        )
    return or_(*conditions)


async def list_for_user(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    user: User,
    include_all: bool = False,
) -> list[OrganizationDocument]:
    """Documents in this organization that this person may read.

    `include_all` is for an admin managing the library — they need to see
    everything they are responsible for, including documents scoped to a
    department they are not in. Off by default so a caller that forgets it
    shows less rather than more.

    `data` is deliberately not loaded: these rows carry whole PDFs, and a
    listing that dragged every file's bytes into memory would fall over on the
    first library of any size. The download route fetches one row's bytes.
    """
    query = (
        select(
            OrganizationDocument.id,
            OrganizationDocument.title,
            OrganizationDocument.description,
            OrganizationDocument.filename,
            OrganizationDocument.size_bytes,
            OrganizationDocument.content_type,
            OrganizationDocument.visibility,
            OrganizationDocument.branch_id,
            OrganizationDocument.department_id,
            OrganizationDocument.created_at,
            OrganizationDocument.uploaded_by,
            (OrganizationDocument.extracted_text.is_not(None)).label("has_text"),
        )
        .where(OrganizationDocument.organization_id == organization_id)
        # A document a department admin uploaded is not in the library until the
        # org admin approves it (Sir's rule of 2026-10-01). It is held with
        # `pending_approval` set and must not show in any listing, not even the
        # admin's own — the org admin decides it from the change queue, and it
        # appears here the moment they approve. See `services/org_changes.py`.
        .where(OrganizationDocument.pending_approval.is_(False))
        .order_by(OrganizationDocument.title)
    )
    if not include_all:
        query = query.where(readable_filter(user))
    return list((await session.execute(query)).all())


async def add_document(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    uploaded_by: uuid.UUID,
    title: str,
    description: str | None,
    data: bytes,
    filename: str | None,
    visibility: DocumentVisibility,
    branch_id: uuid.UUID | None,
    department_id: uuid.UUID | None,
    pending_approval: bool = False,
) -> OrganizationDocument:
    """Store one file. Does not commit — the caller owns the transaction.

    `validate` is the materials one: it measures the size from the bytes rather
    than trusting a header, and refuses anything whose first five bytes are not
    `%PDF-`. A real PDF named `.txt` is accepted and renamed; `<script>` named
    `.pdf` is not.

    `pending_approval` holds a department admin's upload out of the library
    until the org admin approves it. The row exists (so the request can point at
    it and the title is reserved), but no listing or download returns it while
    the flag is set.
    """
    # `validate` returns (safe_filename, content_type) in that order — the same
    # as `materials.add_material`. Unpacking it the other way round stored every
    # document's filename as "pdf.pdf" and put the real filename in the
    # content-type column, so downloads came out misnamed and mis-typed.
    clean_name, content_type = validate(data, filename)

    document = OrganizationDocument(
        organization_id=organization_id,
        uploaded_by=uploaded_by,
        title=title.strip(),
        description=(description or "").strip() or None,
        filename=safe_filename(clean_name),
        size_bytes=len(data),
        content_type=content_type,
        data=data,
        pending_approval=pending_approval,
        # Pulled out now so it can be offered later. Never applied on its own —
        # see decision 97.
        extracted_text=extract_text(data),
        visibility=visibility,
        # Only kept when the visibility actually uses it, so a document that
        # was narrowed and then widened does not carry a stale scope.
        branch_id=branch_id if visibility is DocumentVisibility.BRANCH else None,
        department_id=(
            department_id if visibility is DocumentVisibility.DEPARTMENT else None
        ),
    )
    session.add(document)
    await session.flush()
    return document


async def get_with_data(
    session: AsyncSession, organization_id: uuid.UUID, document_id: uuid.UUID
) -> OrganizationDocument | None:
    """One document including its bytes.

    Scoped by organization as well as id: without it, knowing a document id
    would be enough to download another customer's file.
    """
    return await session.scalar(
        select(OrganizationDocument).where(
            OrganizationDocument.id == document_id,
            OrganizationDocument.organization_id == organization_id,
        )
    )


async def delete_document(
    session: AsyncSession, organization_id: uuid.UUID, document_id: uuid.UUID
) -> bool:
    document = await get_with_data(session, organization_id, document_id)
    if document is None:
        return False
    await session.delete(document)
    return True
