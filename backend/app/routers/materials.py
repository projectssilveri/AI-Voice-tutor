"""PDF material attached to a module.

WHO CAN DO WHAT:

  upload / delete   staff (admin) — the same people who author the
                    module text the tutor teaches from.
  list / download   any signed-in user who can reach the module.

That last rule is deliberate and matches `GET /modules/{id}` exactly. The spec
is explicit that reading course material is unlimited and that only
certification attempts are capped — it names PDFs specifically — and decision
18 already established that enrolment gates the TUTOR, not the reading. Putting
a paywall in front of the handout while the module text beside it is open would
be an inconsistency a student would notice immediately.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel

from app.deps import CurrentUser, DbSession, require_role
from app.models.user import UserRole
from app.services import access
from app.services import courses as course_service
from app.services import materials as material_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["materials"])

staff_only = Depends(require_role(UserRole.ADMIN))


class MaterialRead(BaseModel):
    id: uuid.UUID
    module_id: uuid.UUID
    filename: str
    size_bytes: int
    content_type: str
    created_at: datetime


class ExtractedText(BaseModel):
    """The PDF's text, for an author to fold into the module's tutor material."""

    material_id: uuid.UUID
    text: str | None
    characters: int


async def _module_or_404(session, module_id: uuid.UUID, user):
    """Resolve the module, and refuse it if it is another tenant's.

    THE LEAK THIS CLOSES. Decision 161 gated `GET /modules/{id}` and stopped
    there; the handouts hanging off that module reached no check at all.
    Measured live: a public learner with no organization listed and downloaded
    an Acme private compliance PDF.

    Tenancy only, never the paywall — decision 98 rules that a handout follows
    the module text, and reading course material is unlimited inside the
    catalogue you belong to.
    """
    try:
        module = await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None
    try:
        await access.require_module_in_tenant(session, user, module_id)
    except access.CourseOutsideTenantError:
        # 404, not 403: whether another organization's material exists is not
        # this caller's business (decision 160).
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None
    return module


async def _material_in_tenant_or_404(session, material_id: uuid.UUID, user) -> None:
    """The same rule for the routes addressed by MATERIAL id rather than module.

    Download, extract and delete take a material id, so `_module_or_404` never
    ran for them and they reached no check at all.
    """
    try:
        await access.require_material_in_tenant(session, user, material_id)
    except access.CourseOutsideTenantError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Material not found."
        ) from None


@router.get(
    "/modules/{module_id}/materials", response_model=list[MaterialRead]
)
async def list_materials(
    module_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> list[MaterialRead]:
    await _module_or_404(session, module_id, user)
    rows = await material_service.list_for_module(session, module_id)
    return [
        MaterialRead(
            id=row.id,
            module_id=row.module_id,
            filename=row.filename,
            size_bytes=row.size_bytes,
            content_type=row.content_type,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post(
    "/modules/{module_id}/materials",
    response_model=MaterialRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[staff_only],
)
async def upload_material(
    module_id: uuid.UUID,
    session: DbSession,
    user: CurrentUser,
    # Annotated rather than `= File(...)`: a call in a default argument is
    # evaluated once at import time, which ruff flags (B008). This is the form
    # FastAPI documents now.
    file: Annotated[UploadFile, File()],
) -> MaterialRead:
    await _module_or_404(session, module_id, user)

    # Read once, then judge. The size is only knowable from the bytes: a
    # Content-Length header is as much under the client's control as the
    # Content-Type is.
    data = await file.read()

    try:
        material = await material_service.add_material(
            session,
            module_id=module_id,
            data=data,
            filename=file.filename,
            uploaded_by=user.id,
        )
    except material_service.MaterialTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc)
        ) from None
    except material_service.MaterialError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from None

    logger.info(
        "Material uploaded (module=%s material=%s %d bytes, text=%s)",
        module_id,
        material.id,
        material.size_bytes,
        "yes" if material.extracted_text else "none",
    )
    return MaterialRead(
        id=material.id,
        module_id=material.module_id,
        filename=material.filename,
        size_bytes=material.size_bytes,
        content_type=material.content_type,
        created_at=material.created_at,
    )


@router.get("/materials/{material_id}/download")
async def download_material(
    material_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> Response:
    await _material_in_tenant_or_404(session, material_id, user)
    material = await material_service.get_with_data(session, material_id)
    if material is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Material not found."
        )

    # `inline` so the browser's own viewer opens it — this is course material
    # to read, not a file to collect. `nosniff` stops a browser second-guessing
    # the declared type, and the filename is already stripped of quotes and
    # control characters by the service, so it cannot inject header content.
    return Response(
        content=material.data,
        media_type=material.content_type,
        headers={
            "Content-Disposition": f'inline; filename="{material.filename}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=300",
        },
    )


@router.get(
    "/materials/{material_id}/text",
    response_model=ExtractedText,
    dependencies=[staff_only],
)
async def material_text(
    material_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> ExtractedText:
    """What the PDF says, for an author to paste into the module content.

    Staff only, and deliberately a separate step from uploading: this text is
    never fed to the tutor on its own. `modules.content` stays the single
    source of what the AI may teach from, so a bad extraction — a scanned page
    yields nothing at all — cannot silently become the lesson.
    """
    await _material_in_tenant_or_404(session, material_id, user)
    found = await material_service.get_extracted_text(session, material_id)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Material not found."
        )
    _, text = found
    return ExtractedText(
        material_id=material_id, text=text, characters=len(text or "")
    )


@router.delete(
    "/materials/{material_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[staff_only],
)
async def delete_material(
    material_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> None:
    await _material_in_tenant_or_404(session, material_id, user)
    if not await material_service.delete_material(session, material_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Material not found."
        )
