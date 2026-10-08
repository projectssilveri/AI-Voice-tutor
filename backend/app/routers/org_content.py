"""An organization's own training: its document library and its courses.

Everything here is behind `require_org_scope`, so the organization in the URL
is the only one these routes can touch — and every course created is stamped
with that organization's id, which is what `services/access.py` reads to keep
one customer's training away from another's.

Phase 4 flagged that no organization course should exist until the isolation
rule was enforced. It is now, and pinned by `test_tenant_isolation.py`, so this
is the point at which a customer can safely build their own.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import false, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.deps import DbSession, OrgAuthorScope, OrgScope
from app.models.audit import AuditAction
from app.models.course import Course, Module
from app.models.org_change import ChangeAction, ChangeKind
from app.models.org_document import DocumentVisibility
from app.models.organization import Branch, Department
from app.models.user import User, UserRole
from app.services import audit, limits, materials, org_changes
from app.services import courses as course_service
from app.services import org_documents as doc_service

router = APIRouter(prefix="/org/{slug}", tags=["organization content"])


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


class DocumentRow(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    filename: str
    size_bytes: int
    content_type: str
    visibility: str
    branch_id: uuid.UUID | None
    department_id: uuid.UUID | None
    created_at: datetime
    uploaded_by: uuid.UUID
    # Whether text could be pulled out — a scanned page yields nothing, and the
    # UI should not offer "use as tutor material" for a file that has none.
    has_text: bool
    # WHETHER THIS CALLER MAY DELETE IT, as opposed to merely read it. A
    # department admin manages their own department's files; the company-wide
    # handbook is theirs to read and the org admin's to look after.
    can_edit: bool = True


class DocumentList(BaseModel):
    documents: list[DocumentRow]
    total: int


class DocumentUploadResult(BaseModel):
    """Added to the library at once, or sent to the org admin to approve.

    A department admin or branch manager gets `requested=True` and no document:
    the file is held out of the library until the org admin approves it. An org
    admin or platform staff gets the stored document straight away.
    """

    requested: bool
    document: DocumentRow | None = None
    message: str | None = None


def _visibility_of(value) -> DocumentVisibility:
    """The listing hands back the column value, the detail routes an ORM row.

    Both are the enum in practice, but the row builder below already defends
    against a plain string, so the two checks agree rather than one of them
    silently deciding a document is not departmental.
    """
    return value if isinstance(value, DocumentVisibility) else DocumentVisibility(value)


def _may_manage_document(scope, visibility, branch_id, department_id) -> bool:
    """Whether this caller may remove this document, or ask to.

    An org admin looks after the whole library. A department admin looks after
    the files scoped to their own department, and a branch manager the files
    scoped to their own branch, and nothing else: not another department's or
    branch's, and not the organization-wide ones, which belong to everybody.
    """
    if scope.is_org_admin:
        return True
    seen = _visibility_of(visibility)
    if scope.is_branch_manager:
        own = scope.user.branch_id
        return (
            own is not None
            and seen is DocumentVisibility.BRANCH
            and branch_id == own
        )
    if not scope.is_dept_admin:
        return False
    scoped = scope.scoped_department_id()
    return (
        scoped is not None
        and seen is DocumentVisibility.DEPARTMENT
        and department_id == scoped
    )


def _document_readable(scope, visibility, branch_id, department_id) -> bool:
    """The read rule, as one expression, matching `readable_filter` in SQL.

    Duplicated here rather than imported because the single-document routes
    hold a loaded row and the listing holds a query; keeping the two in step is
    the point of writing them next to each other.
    """
    if scope.is_org_admin:
        return True
    seen = _visibility_of(visibility)
    if seen is DocumentVisibility.ORGANIZATION:
        return True
    if seen is DocumentVisibility.BRANCH:
        return branch_id is not None and branch_id == scope.user.branch_id
    return department_id is not None and department_id == scope.user.department_id


@router.get("/documents", response_model=DocumentList)
async def list_documents(session: DbSession, scope: OrgScope) -> DocumentList:
    """Documents this person may read.

    An admin sees the whole library, because they are responsible for it. A
    learner sees organization-wide documents plus those scoped to their own
    branch or department — applied as a SQL filter, so a payroll procedure
    never reaches the browser of someone outside payroll.
    """
    rows = await doc_service.list_for_user(
        session,
        organization_id=scope.organization.id,
        user=scope.user,
        include_all=scope.is_org_admin,
    )
    return DocumentList(
        documents=[
            DocumentRow(
                id=r.id,
                title=r.title,
                description=r.description,
                filename=r.filename,
                size_bytes=r.size_bytes,
                content_type=r.content_type,
                visibility=r.visibility.value
                if hasattr(r.visibility, "value")
                else str(r.visibility),
                branch_id=r.branch_id,
                department_id=r.department_id,
                created_at=r.created_at,
                uploaded_by=r.uploaded_by,
                has_text=bool(r.has_text),
                can_edit=_may_manage_document(
                    scope, r.visibility, r.branch_id, r.department_id
                ),
            )
            for r in rows
        ],
        total=len(rows),
    )


@router.post(
    "/documents",
    response_model=DocumentUploadResult,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    session: DbSession,
    scope: OrgAuthorScope,
    file: UploadFile = File(...),  # noqa: B008 — FastAPI's documented idiom
    title: str = "",
    description: str = "",
    visibility: str = DocumentVisibility.ORGANIZATION.value,
    branch_id: uuid.UUID | None = None,
    department_id: uuid.UUID | None = None,
) -> DocumentUploadResult:
    """Add a file to the library, or ask the org admin to.

    Open to a DEPARTMENT ADMIN as well as an org admin. The HR admin
    maintaining HR's training needs the HR handbook in the library, and being
    able to write the course while having to ask somebody else to upload its
    source document is half a role. Their file is filed against their own
    department, and nowhere else.

    A BRANCH MANAGER may ask too, for a file filed against their own branch.

    A DEPARTMENT ADMIN'S OR BRANCH MANAGER'S UPLOAD WAITS for the org admin
    (Sir's rule of 2026-10-01), the same as their course. The file is stored
    held back with `pending_approval` set so the title is reserved and the
    request can point at it, but it is in no listing and downloadable by nobody
    until the org admin approves. The org admin and platform staff add at once.

    The upload is validated by magic bytes, not by what the browser claimed —
    `services/materials.validate`, shared with module handouts so the rule has
    one implementation.
    """
    try:
        chosen = DocumentVisibility(visibility)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Visibility must be organization, branch or department.",
        ) from None

    # FORCED, NOT VALIDATED, for a department admin — the same rule as their
    # people and their courses. Sending `visibility=organization` would
    # otherwise publish a departmental file to the whole company, which is the
    # one direction the wall must not open in; and naming another department
    # would put a file where they cannot even see it afterwards.
    if scope.is_dept_admin:
        scoped = scope.scoped_department_id()
        if scoped is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "You have no department assigned, so you cannot add documents."
                ),
            )
        chosen = DocumentVisibility.DEPARTMENT
        department_id = scoped
        branch_id = None

    # THE SAME FOR A BRANCH MANAGER, one level up: their file is filed against
    # their own branch, whatever was sent. "Everyone in the organization" is
    # above their branch, and another branch is not theirs to file for.
    if scope.is_branch_manager:
        own_branch = scope.user.branch_id
        if own_branch is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You have no branch assigned, so you cannot add documents.",
            )
        chosen = DocumentVisibility.BRANCH
        branch_id = own_branch
        department_id = None

    # A scope must name the thing it scopes to, and that thing must belong to
    # THIS organization — otherwise a document could be filed against another
    # customer's branch.
    if chosen is DocumentVisibility.BRANCH:
        branch = await session.get(Branch, branch_id) if branch_id else None
        if branch is None or branch.organization_id != scope.organization.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Choose a branch in this organization.",
            )
    if chosen is DocumentVisibility.DEPARTMENT:
        department = (
            await session.get(Department, department_id) if department_id else None
        )
        if department is None or department.organization_id != scope.organization.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Choose a department in this organization.",
            )

    # A department admin's or branch manager's upload waits; the org admin and
    # platform staff add at once. Decided before the row is built, so the file
    # is stored held back.
    waits = org_changes.needs_approval(scope.user)

    data = await file.read()
    try:
        document = await doc_service.add_document(
            session,
            organization_id=scope.organization.id,
            uploaded_by=scope.user.id,
            title=title.strip() or (file.filename or "Untitled"),
            description=description,
            data=data,
            filename=file.filename,
            visibility=chosen,
            branch_id=branch_id,
            department_id=department_id,
            pending_approval=waits,
        )
    except materials.MaterialError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from None
    except IntegrityError:
        # `uq_organization_documents_org_title`, which spans the whole
        # organization rather than one department — so HR and IT both calling
        # a file "Handbook" collided, and the second upload was a 500 with a
        # stack trace instead of a sentence. Caught rather than pre-checked:
        # a SELECT-then-INSERT races, and the constraint is the only arbiter.
        # 409, matching the module-order collision below: the request is well
        # formed, it is the library's current state that refuses.
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Another document in this organization is already called "
                f'"{title.strip() or (file.filename or "Untitled")}". '
                f"Give this one a different title."
            ),
        ) from None

    # HELD BACK FOR APPROVAL. The request points at the stored-but-hidden row;
    # approving clears the flag and it appears, declining deletes it
    # (`services/org_changes.py`). No "uploaded" audit yet — it is not in the
    # library until the org admin agrees, and the approval writes that record.
    if waits:
        try:
            await org_changes.request(
                session,
                organization_id=scope.organization.id,
                kind=ChangeKind.DOCUMENT,
                action=ChangeAction.CREATE,
                target_id=document.id,
                label=document.filename,
                reason="New document requested.",
                actor=scope.user,
            )
        except org_changes.ChangeError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        await session.commit()
        return DocumentUploadResult(
            requested=True,
            message=(
                f"{document.title} has not been added yet. The organisation "
                "administrator has to approve it."
            ),
        )

    await audit.record_safely(
        session,
        action=AuditAction.ORG_DOCUMENT_UPLOADED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type="organization_document",
        target_id=document.id,
        # The title and size, never the contents.
        metadata={
            "title": document.title,
            "size_bytes": document.size_bytes,
            "visibility": chosen.value,
        },
    )
    await session.commit()
    await session.refresh(document)

    return DocumentUploadResult(
        requested=False,
        document=DocumentRow(
            id=document.id,
            title=document.title,
            description=document.description,
            filename=document.filename,
            size_bytes=document.size_bytes,
            content_type=document.content_type,
            visibility=document.visibility.value,
            branch_id=document.branch_id,
            department_id=document.department_id,
            created_at=document.created_at,
            uploaded_by=document.uploaded_by,
            has_text=document.extracted_text is not None,
            can_edit=True,
        ),
    )


@router.get("/documents/{document_id}/file")
async def download_document(
    document_id: uuid.UUID, session: DbSession, scope: OrgScope
) -> Response:
    """The file itself.

    Re-checks readability rather than trusting that the listing hid it: a
    document id is guessable in principle, and the listing is presentation.
    """
    document = await doc_service.get_with_data(
        session, scope.organization.id, document_id
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found."
        )

    # A document still waiting for the org admin's approval is not in the library
    # yet, so it is not downloadable by its id either — 404, the same answer the
    # listing gives by leaving it out.
    if document.pending_approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found."
        )

    if not _document_readable(
        scope, document.visibility, document.branch_id, document.department_id
    ):
        # 404, not 403: whether a document exists in a department they are not
        # in is not their business either.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found."
        )

    return Response(
        content=document.data,
        media_type=document.content_type,
        headers={
            "Content-Disposition": f'inline; filename="{document.filename}"',
        },
    )


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: uuid.UUID,
    session: DbSession,
    scope: OrgAuthorScope,
    response: Response,
    reason: str = "",
) -> None:
    """Remove a file, or ask an administrator to. Whose file decides who may.

    Read BEFORE deleting, rather than deleting and checking: the service would
    otherwise have removed another department's document by the time anything
    looked at whose it was.

    THE ORG ADMIN AND PLATFORM STAFF REMOVE AT ONCE; a department admin, or
    anyone who cannot manage the file, asks, and the org admin approves. 202 and
    no body when it is queued (Sir's rule of 2026-10-01).
    """
    document = await doc_service.get_with_data(
        session, scope.organization.id, document_id
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found."
        )
    # CAN THEY SEE IT AT ALL? That is the only question this answers now.
    #
    # It used to answer two: "may you manage it" and, if not but you can read
    # it, 403 "This document is for the whole organization. Ask an
    # administrator." The advice was sound and impossible to follow — there was
    # nowhere to ask. Now the asking exists, so a reader who cannot manage the
    # file raises a request like anybody else and the message becomes true.
    #
    # The 404 branch stays exactly as it was: somebody who cannot see a
    # document must not learn it exists by having their request accepted.
    if not _document_readable(
        scope, document.visibility, document.branch_id, document.department_id
    ) and not _may_manage_document(
        scope, document.visibility, document.branch_id, document.department_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found."
        )

    # The org admin and platform staff delete it at once. A department admin,
    # a branch manager, or anyone who cannot manage this file, asks, and the
    # org admin approves (`services/org_changes`, Sir's rule of 2026-10-01).
    if org_changes.needs_approval(scope.user) or not _may_manage_document(
        scope, document.visibility, document.branch_id, document.department_id
    ):
        try:
            await org_changes.request(
                session,
                organization_id=scope.organization.id,
                kind=ChangeKind.DOCUMENT,
                action=ChangeAction.DELETE,
                target_id=document_id,
                label=document.filename,
                reason=reason,
                actor=scope.user,
            )
        except org_changes.ChangeError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        await session.commit()
        response.status_code = status.HTTP_202_ACCEPTED
        return

    removed = await doc_service.delete_document(
        session, scope.organization.id, document_id
    )
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found."
        )
    await audit.record_safely(
        session,
        action=AuditAction.ORG_DOCUMENT_DELETED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type="organization_document",
        target_id=document_id,
    )
    await session.commit()


@router.get("/documents/{document_id}/text")
async def document_text(
    document_id: uuid.UUID, session: DbSession, scope: OrgAuthorScope
) -> dict[str, str | None]:
    """The extracted text, for an author to review before using it.

    Offered, never applied. Decision 97: extraction is imperfect — a scanned
    page yields nothing at all — and silently feeding that to the tutor would
    let a bad extraction become the lecture. The author reads it, edits it, and
    saves it as the module's content themselves.

    THE READ CHECK IS NEW, and it was safe to omit only while this was org
    admins only. This route returns a document's whole contents as text, so
    without it a department admin could read every word of another
    department's files at a URL the listing never shows them — the leak the
    library exists to prevent, through its plainest door.
    """
    document = await doc_service.get_with_data(
        session, scope.organization.id, document_id
    )
    if (
        document is None
        or document.pending_approval
        or not _document_readable(
            scope, document.visibility, document.branch_id, document.department_id
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found."
        )
    return {"title": document.title, "text": document.extracted_text}


# ---------------------------------------------------------------------------
# The organization's own courses
# ---------------------------------------------------------------------------


class OrgCourseRow(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    is_published: bool
    module_count: int
    # Null means everyone in the organization. Carried so the screen can say
    # who a course is for, and preselect it when editing.
    department_id: uuid.UUID | None = None
    department_name: str | None = None
    # WHETHER THIS CALLER MAY CHANGE IT, as opposed to merely see it. A
    # department admin sees the company-wide courses everyone sees and cannot
    # touch them; without this the screen would offer an Edit button that the
    # server answers with a 403. Presentation only — the route re-checks.
    can_edit: bool = True
    # A department admin's edit, waiting for the org admin. The row is returned
    # unchanged with this set, so the screen can say the change was sent.
    change_requested: bool = False


class OrgCourseCreateResult(BaseModel):
    """Created at once, or sent to the org admin to approve.

    A department admin gets `requested=True` and no course: nothing exists until
    the org admin approves. An org admin or platform staff gets the course.
    """

    requested: bool
    course: OrgCourseRow | None = None
    message: str | None = None


class OrgCourseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    # NARROWS IT TO ONE DEPARTMENT. Null means everyone in the organization,
    # which is what every course was before this existed.
    # `services/access.py` reads the column; without this field nothing could
    # ever put a value in it.
    #
    # Ignored for a department admin, who has exactly one department to write
    # for and does not choose it.
    department_id: uuid.UUID | None = None
    # `price_minor` is deliberately absent. There is no marketplace inside a
    # walled garden — the employer has already paid, and a price here would be
    # a number nobody could act on.


class OrgCourseUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    # Sent explicitly as null to widen a course back to everyone, which is why
    # the route checks `model_fields_set` rather than testing for None.
    department_id: uuid.UUID | None = None
    is_published: bool | None = None
    #: Why, for a department admin's edit, which waits for the org admin.
    reason: str | None = Field(default=None, max_length=2_000)


async def _editable_departments(session, scope) -> set[uuid.UUID] | None:
    """The departments whose courses this caller may change, or ask to change.

    None means every course in the organization: an org admin, and platform
    staff acting as one. A department admin has their own department. A branch
    manager has the departments inside their own branch, because a course
    reaches people through its department and a branch has no courses of its
    own. Everybody else, and a manager with no department or branch, has none:
    failing closed, as `scoped_department_id` asks.
    """
    if scope.is_org_admin:
        return None
    if scope.is_dept_admin:
        scoped = scope.scoped_department_id()
        return {scoped} if scoped is not None else set()
    if scope.is_branch_manager and scope.user.branch_id is not None:
        rows = await session.scalars(
            select(Department.id).where(
                Department.organization_id == scope.organization.id,
                Department.branch_id == scope.user.branch_id,
            )
        )
        return set(rows.all())
    return set()


def _may_edit(scope, course: Course, editable: set[uuid.UUID] | None) -> bool:
    """Whether this caller may change this course.

    An org admin may change anything in their organization. A department admin
    may change their own department's courses, and a branch manager the courses
    of the departments in their branch, and nothing else: not another
    department's, and not the company-wide ones, which belong to everybody and
    are the org admin's to write. `editable` is `_editable_departments`.
    """
    if editable is None:
        return True
    return course.department_id is not None and course.department_id in editable


def _require_editable(
    scope, course: Course, editable: set[uuid.UUID] | None
) -> None:
    """404, not 403, for a course outside the caller's department.

    Same reasoning as the tenant boundary: whether a course exists in another
    department is not something the sales admin should learn by the shape of
    the refusal. A course they can SEE but not edit — a company-wide one — is
    a 403, because they already know it exists.

    A branch manager sees every course in the organization
    (`limits.visible_department_ids`), so anything outside their branch is a
    403 for them, never a 404.
    """
    if _may_edit(scope, course, editable):
        return
    if scope.is_branch_manager:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This course is for the whole organization. Ask an administrator."
                if course.department_id is None
                else "This course is not for a department in your branch. "
                "Ask an administrator."
            ),
        )
    visible = course.department_id is None or (
        scope.scoped_department_id() is not None
        and course.department_id == scope.scoped_department_id()
    )
    if visible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This course is for the whole organization. Ask an administrator.",
        )
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
    )


@router.get("/courses", response_model=list[OrgCourseRow])
async def list_org_courses(session: DbSession, scope: OrgScope) -> list[OrgCourseRow]:
    """This organization's courses, with their module counts.

    One grouped query rather than a count per course — the same N+1 rule as
    decisions 29 and 45.

    THE DEPARTMENT WALL, which this route did not have. It listed every course
    in the organization to anyone who could reach the URL — so a sales admin,
    or an ordinary learner, could read the titles and descriptions of HR's
    private training even though `services/access.py` refuses to open them.
    A listing that disagrees with the page it links to is decision 161 again;
    here it leaked the titles, which for a course called "Redundancy
    consultation script" is the whole secret.

    Applied as a SQL filter, from the same `visible_department_ids` the access
    rule uses, so the two cannot drift apart.
    """
    filters = [Course.organization_id == scope.organization.id]

    # `visible_department_ids` reads the USER, and a platform super admin
    # inside a customer's tenant is not one of that function's cases: no
    # organization, no department, no org role — so it answered `set()`, "sees
    # only company-wide courses", and support lost sight of every departmental
    # course the moment this filter was added. `scope.is_org_admin` is the
    # right question here because it already means "org admin OR platform
    # staff", which is exactly who stands above the department wall.
    visible = (
        None if scope.is_org_admin else await limits.visible_department_ids(scope.user)
    )
    if visible is not None:
        filters.append(
            or_(
                Course.department_id.is_(None),
                Course.department_id.in_(visible) if visible else false(),
            )
        )

    rows = (
        await session.execute(
            select(Course, func.count(Module.id))
            .outerjoin(Module, Module.course_id == Course.id)
            .where(*filters)
            .group_by(Course.id)
            .order_by(Course.title)
        )
    ).all()

    # One lookup for the whole organization's departments rather than one per
    # course. There are a handful of departments and potentially many courses.
    department_names = {
        row.id: row.name
        for row in (
            await session.execute(
                select(Department.id, Department.name).where(
                    Department.organization_id == scope.organization.id
                )
            )
        ).all()
    }
    editable = await _editable_departments(session, scope)

    return [
        OrgCourseRow(
            id=course.id,
            title=course.title,
            description=course.description,
            is_published=course.is_published,
            module_count=count,
            department_id=course.department_id,
            department_name=department_names.get(course.department_id),
            can_edit=_may_edit(scope, course, editable),
        )
        for course, count in rows
    ]


async def _department_in_scope(session, scope, department_id):
    """A department id, checked to belong to THIS organization.

    Without the check, knowing any department id would be enough to file a
    course against another customer's structure — a cross-tenant write dressed
    up as an ordinary field. The same guard `_validate_placement` applies to
    people, and decision 145 records why it exists.
    """
    if department_id is None:
        return None
    department = await session.get(Department, department_id)
    if department is None or department.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Department not found."
        )
    return department_id


@router.post(
    "/courses",
    response_model=OrgCourseCreateResult,
    status_code=status.HTTP_201_CREATED,
)
async def create_org_course(
    payload: OrgCourseCreate, session: DbSession, scope: OrgAuthorScope
) -> OrgCourseCreateResult:
    """Create a course inside this organization.

    Stamped with the organization's id at creation, which is the single fact
    that keeps it private: `services/access.py` reads that column and refuses
    every caller outside the tenant, in both directions.

    Open to a DEPARTMENT ADMIN as well as an org admin — writing their own
    department's training is half of what that role is for — and their course
    is stamped with their own department, which is the other half. An ordinary
    LEARNER still cannot create courses: the admin floor and the audit trail
    both attribute content to a named administrator, and widening that is a
    decision for the customer, not a default.
    """
    if scope.is_dept_admin:
        department_id = scope.scoped_department_id()
        if department_id is None:
            # Fails closed. No department to be the admin of means no
            # department to write for — and a course with a null department is
            # company-wide, which is exactly what must not happen by accident.
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "You have no department assigned, so you cannot create courses."
                ),
            )
    else:
        # Optional for an org admin. Null means everyone in the organization,
        # which is what every course was before departments existed.
        department_id = await _department_in_scope(
            session, scope, payload.department_id
        )
        # REQUIRED FOR A BRANCH MANAGER, and it must be in their branch. A
        # course for everyone is above their branch, and another branch's
        # department is not theirs to write for.
        if scope.is_branch_manager:
            editable = await _editable_departments(session, scope)
            if not editable:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Your branch has no departments yet, and a course reaches "
                        "people through a department. Ask the organisation "
                        "administrator."
                    ),
                )
            if department_id is None or department_id not in editable:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Choose a department in your branch. A course for "
                        "everyone is the organisation administrator's to add."
                    ),
                )

    # A DEPARTMENT ADMIN OR BRANCH MANAGER DOES NOT CREATE DIRECTLY. Sir's rule
    # of 2026-10-01: the course is not made until the org admin approves. The
    # org admin and platform staff create at once.
    if org_changes.needs_approval(scope.user):
        try:
            await org_changes.request(
                session,
                organization_id=scope.organization.id,
                kind=ChangeKind.TRAINING,
                action=ChangeAction.CREATE,
                target_id=None,
                label=payload.title.strip(),
                reason="New course requested.",
                actor=scope.user,
                payload={
                    "title": payload.title.strip(),
                    "description": payload.description,
                    "department_id": str(department_id) if department_id else None,
                },
            )
        except org_changes.ChangeError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        await session.commit()
        return OrgCourseCreateResult(
            requested=True,
            message=(
                f"{payload.title.strip()} has not been created yet. The "
                "organisation administrator has to approve it."
            ),
        )

    course = await course_service.create_course(
        session,
        title=payload.title,
        description=payload.description,
        organization_id=scope.organization.id,
        department_id=department_id,
    )
    await audit.record_safely(
        session,
        action=AuditAction.ORG_COURSE_CREATED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type="course",
        target_id=course.id,
        metadata={"title": course.title},
    )
    await session.commit()
    return OrgCourseCreateResult(
        requested=False,
        course=OrgCourseRow(
            id=course.id,
            title=course.title,
            description=course.description,
            is_published=course.is_published,
            module_count=0,
            department_id=course.department_id,
            department_name=(
                (await session.get(Department, course.department_id)).name
                if course.department_id
                else None
            ),
            can_edit=True,
        ),
    )


@router.patch("/courses/{course_id}", response_model=OrgCourseRow)
async def update_org_course(
    course_id: uuid.UUID,
    payload: OrgCourseUpdate,
    session: DbSession,
    scope: OrgAuthorScope,
) -> OrgCourseRow:
    course = await session.get(Course, course_id)
    # The organization is checked as well as the id, or knowing a course id
    # would be enough to edit another customer's training from this URL.
    if course is None or course.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )
    # AND THE DEPARTMENT, inside the tenant. The sales admin does not rename,
    # republish or rewrite HR's training.
    editable = await _editable_departments(session, scope)
    _require_editable(scope, course, editable)

    changes = payload.model_dump(exclude_unset=True)

    # A department admin cannot move a course out of their department, for the
    # same reason they cannot move a person out of it: it would push the course
    # across the wall and out of their own reach in one request — or, worse,
    # widen it to the whole company by sending null.
    if scope.is_dept_admin and "department_id" in changes:
        if changes["department_id"] != scope.scoped_department_id():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot move a course out of your own department.",
            )
    # The same wall one level up: a branch manager keeps a course inside their
    # branch's departments, and cannot widen it to everyone with null.
    if scope.is_branch_manager and "department_id" in changes:
        if editable is not None and changes["department_id"] not in editable:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot move a course out of your own branch.",
            )

    # A DEPARTMENT MUST BE ONE OF OURS. `model_dump` plus a blind setattr would
    # have written whatever id was sent, so an admin who knew another
    # customer's department id could file their course against it — a
    # cross-tenant write dressed up as an ordinary field. Same guard as
    # `_validate_placement` uses for people (decisions 145 and 154).
    if "department_id" in changes:
        changes["department_id"] = await _department_in_scope(
            session, scope, changes["department_id"]
        )

    # A DEPARTMENT ADMIN'S EDIT WAITS for the org admin (Sir's rule of
    # 2026-10-01). The guards above have run, so it only proposes something they
    # are allowed to; nothing moves until the org admin approves.
    proposed = {k: v for k, v in changes.items() if k != "reason"}
    if org_changes.needs_approval(scope.user) and proposed:
        payload_json = {
            key: (str(value) if isinstance(value, uuid.UUID) else value)
            for key, value in proposed.items()
        }
        try:
            await org_changes.request(
                session,
                organization_id=scope.organization.id,
                kind=ChangeKind.TRAINING,
                action=ChangeAction.EDIT,
                target_id=course.id,
                label=course.title,
                reason=payload.reason or "Course edit requested.",
                actor=scope.user,
                payload=payload_json,
            )
        except org_changes.ChangeError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        await session.commit()
        count = await session.scalar(
            select(func.count()).select_from(Module).where(Module.course_id == course.id)
        )
        return OrgCourseRow(
            id=course.id,
            title=course.title,
            description=course.description,
            is_published=course.is_published,
            module_count=count or 0,
            department_id=course.department_id,
            department_name=(
                (await session.get(Department, course.department_id)).name
                if course.department_id
                else None
            ),
            can_edit=_may_edit(scope, course, editable),
            change_requested=True,
        )

    changes.pop("reason", None)
    for field, value in changes.items():
        setattr(course, field, value)

    if changes:
        await audit.record_safely(
            session,
            action=AuditAction.ORG_COURSE_UPDATED,
            actor=scope.user,
            organization_id=scope.organization.id,
            target_type="course",
            target_id=course.id,
            metadata={k: str(v) for k, v in changes.items()},
        )
    await session.commit()

    count = await session.scalar(
        select(func.count()).select_from(Module).where(Module.course_id == course.id)
    )
    return OrgCourseRow(
        id=course.id,
        title=course.title,
        description=course.description,
        is_published=course.is_published,
        module_count=count or 0,
        department_id=course.department_id,
        department_name=(
            (await session.get(Department, course.department_id)).name
            if course.department_id
            else None
        ),
        can_edit=_may_edit(scope, course, editable),
    )


class OrgCourseRemoval(BaseModel):
    """What happened, so the screen can say so."""

    #: "deleted", or "requested" when it waits for platform staff.
    outcome: str
    explanation: str


@router.delete("/courses/{course_id}", response_model=OrgCourseRemoval)
async def delete_org_course(
    course_id: uuid.UUID,
    session: DbSession,
    scope: OrgAuthorScope,
    response: Response,
    reason: str = "",
) -> OrgCourseRemoval:
    """Delete one of this organisation's courses, or ask for it to be deleted.

    The org admin deletes at once, with no approval, and so does platform staff.
    A department admin or branch manager asks, 202, and the org admin approves
    it (`services/org_changes`, Sir's rule of 2026-10-01).
    """
    course = await session.get(Course, course_id)
    if course is None or course.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )
    editable = await _editable_departments(session, scope)
    _require_editable(scope, course, editable)
    name = course.title

    if org_changes.needs_approval(scope.user):
        try:
            await org_changes.request(
                session,
                organization_id=scope.organization.id,
                kind=ChangeKind.TRAINING,
                action=ChangeAction.DELETE,
                target_id=course.id,
                label=name,
                reason=reason,
                actor=scope.user,
            )
        except org_changes.ChangeError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None
        await session.commit()
        response.status_code = status.HTTP_202_ACCEPTED
        return OrgCourseRemoval(
            outcome="requested",
            explanation=(
                f"{name} has not been deleted. The organisation administrator "
                "has to approve it."
            ),
        )

    await session.delete(course)
    await audit.record(
        session,
        action=AuditAction.COURSE_DELETED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type="course",
        target_id=course_id,
        metadata={"name": name},
    )
    await session.commit()
    return OrgCourseRemoval(outcome="deleted", explanation=f"{name} has been deleted.")


class OrgModuleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    #: Omit to append. It used to default to 0, so a caller that sent nothing
    #: collided with the first module rather than landing after the last.
    order: int | None = Field(default=None, ge=0)
    # What the tutor teaches from. Reviewed and saved by a person, never
    # written straight from an extraction — decision 97.
    content: str | None = None
    #: Why, for a department admin's or branch manager's change, which waits
    #: for the org admin.
    reason: str | None = Field(default=None, max_length=2_000)


async def _request_module_change(
    session,
    scope,
    course: Course,
    *,
    op: str,
    target_id: uuid.UUID | None,
    label: str,
    reason: str,
    fields: dict | None = None,
) -> dict:
    """Queue a module change for the org admin, instead of making it.

    A MODULE IS THE COURSE. It is what the tutor reads out, so adding,
    rewriting or removing one is editing the course, and Sir's rule of
    2026-10-01 sends a department admin's or branch manager's course edit to
    the org admin. These routes used to apply it at once.

    Filed as an EDIT of the course, so the org admin's queue reads "Edit
    course" with the module named in the label. `target_id` is the module for
    an edit or removal, so each module carries one open request at a time
    without blocking requests about the course's other modules; a new module
    has none. `services/org_changes._apply_module` makes the change on approval.
    """
    payload = {"module_op": op, "course_id": str(course.id), **(fields or {})}
    try:
        await org_changes.request(
            session,
            organization_id=scope.organization.id,
            kind=ChangeKind.TRAINING,
            action=ChangeAction.EDIT,
            target_id=target_id,
            label=label,
            # Blank is refused there, with the sentence to show. A removal
            # must say why, as a course removal must.
            reason=reason,
            actor=scope.user,
            payload=payload,
        )
    except org_changes.ChangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None
    await session.commit()
    return {
        "requested": True,
        "message": (
            "Nothing has changed yet. The organisation administrator has to "
            "approve it."
        ),
    }


@router.post(
    "/courses/{course_id}/modules",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_org_module(
    course_id: uuid.UUID,
    payload: OrgModuleCreate,
    session: DbSession,
    scope: OrgAuthorScope,
    response: Response,
) -> dict:
    course = await session.get(Course, course_id)
    if course is None or course.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )
    # Adding a module IS editing the course — it is what the tutor reads out —
    # so it is gated exactly as the course itself is.
    editable = await _editable_departments(session, scope)
    _require_editable(scope, course, editable)
    # The same cap as a platform course, except an organization may be given
    # its own limit — which is part of what a business plan is sold on.
    try:
        await limits.assert_can_add_module(session, course)
    except limits.LimitReached as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

    # A department admin or branch manager asks (Sir's rule of 2026-10-01).
    if org_changes.needs_approval(scope.user):
        response.status_code = status.HTTP_202_ACCEPTED
        return await _request_module_change(
            session,
            scope,
            course,
            op="create",
            target_id=None,
            label=f'{course.title}: add module "{payload.title.strip()}"',
            reason=payload.reason or "New module requested.",
            fields={
                "title": payload.title.strip(),
                "content": payload.content,
                "order": payload.order,
            },
        )

    # Same rule as the platform route: append unless the caller names a
    # position. This screen used to send `course.module_count`, so deleting a
    # module made every later add collide with `uq_modules_course_order`.
    order = (
        payload.order
        if payload.order is not None
        else await course_service.next_module_order(session, course_id)
    )

    module = Module(
        course_id=course_id,
        title=payload.title.strip(),
        order=order,
        content=payload.content,
    )
    session.add(module)
    await audit.record_safely(
        session,
        action=AuditAction.ORG_COURSE_UPDATED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type="course",
        target_id=course_id,
        metadata={"added_module": payload.title},
    )
    try:
        await session.commit()
    except IntegrityError:
        # `uq_modules_course_order`. Appending above removes the ordinary cause,
        # but a caller that names a position can still land on a taken one, and
        # two requests naming the same one still race. Caught rather than
        # pre-checked: a SELECT-then-INSERT races too, and the constraint is the
        # only reliable arbiter. 409, matching the platform route -- the request
        # is well formed, it is the course's current state that refuses.
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Course already has a module at position {order}.",
        ) from None
    await session.refresh(module)
    return {
        "requested": False,
        "id": str(module.id),
        "title": module.title,
        "order": module.order,
        "has_content": bool(module.content),
    }


class OrgModuleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    order: int | None = Field(default=None, ge=0)
    content: str | None = None
    #: Why, for a department admin's or branch manager's change.
    reason: str | None = Field(default=None, max_length=2_000)


@router.get("/courses/{course_id}/modules", response_model=list[dict])
async def list_org_course_modules(
    course_id: uuid.UUID,
    session: DbSession,
    scope: OrgAuthorScope,
) -> list[dict]:
    """The modules of one org course, with content, so they can be edited."""
    course = await session.get(Course, course_id)
    if course is None or course.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )
    editable = await _editable_departments(session, scope)
    _require_editable(scope, course, editable)
    modules = await course_service.list_modules(session, course_id)
    return [
        {
            "id": str(m.id),
            "title": m.title,
            "order": m.order,
            "content": m.content,
            "has_content": bool(m.content),
        }
        for m in modules
    ]


@router.patch("/courses/{course_id}/modules/{module_id}", response_model=dict)
async def update_org_module(
    course_id: uuid.UUID,
    module_id: uuid.UUID,
    payload: OrgModuleUpdate,
    session: DbSession,
    scope: OrgAuthorScope,
    response: Response,
) -> dict:
    """Edit a module of an org course: its title, content or position.

    The gap this closes: a course could only have modules ADDED, so a mistake
    in an existing module could not be fixed from the portal. Gated exactly as
    creating one is (`_require_editable`), and a department admin's or branch
    manager's edit waits for the org admin the same way.
    """
    course = await session.get(Course, course_id)
    if course is None or course.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )
    editable = await _editable_departments(session, scope)
    _require_editable(scope, course, editable)
    try:
        module = await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None
    # The module must belong to the course in the URL, or knowing a module id
    # would be enough to edit one through another course's path.
    if module.course_id != course_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        )
    changes = payload.model_dump(exclude_unset=True)
    reason = changes.pop("reason", None)
    if org_changes.needs_approval(scope.user):
        if not changes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Nothing to change.",
            )
        response.status_code = status.HTTP_202_ACCEPTED
        return await _request_module_change(
            session,
            scope,
            course,
            op="edit",
            target_id=module.id,
            label=f'{course.title}: change module "{module.title}"',
            reason=reason or "Module edit requested.",
            fields=changes,
        )
    try:
        module = await course_service.update_module(session, module_id, **changes)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None
    except course_service.DuplicateModuleOrderError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None
    await audit.record_safely(
        session,
        action=AuditAction.ORG_COURSE_UPDATED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type="course",
        target_id=course_id,
        metadata={"edited_module": module.title},
    )
    await session.commit()
    return {
        "requested": False,
        "id": str(module.id),
        "title": module.title,
        "order": module.order,
        "has_content": bool(module.content),
    }


@router.delete(
    "/courses/{course_id}/modules/{module_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    # Set, not inferred: 204 carries no body, and a department admin's or
    # branch manager's removal answers 202 with one.
    response_model=None,
)
async def delete_org_module(
    course_id: uuid.UUID,
    module_id: uuid.UUID,
    session: DbSession,
    scope: OrgAuthorScope,
    response: Response,
    reason: str = "",
) -> dict | None:
    """Remove a module from an org course. Gated as editing the course is.

    The org admin and platform staff remove it at once, 204. A department
    admin or branch manager asks, 202, and the org admin approves.
    """
    course = await session.get(Course, course_id)
    if course is None or course.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )
    editable = await _editable_departments(session, scope)
    _require_editable(scope, course, editable)
    try:
        module = await course_service.get_module(session, module_id)
    except course_service.ModuleNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        ) from None
    if module.course_id != course_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Module not found."
        )
    name = module.title
    if org_changes.needs_approval(scope.user):
        response.status_code = status.HTTP_202_ACCEPTED
        return await _request_module_change(
            session,
            scope,
            course,
            op="delete",
            target_id=module.id,
            label=f'{course.title}: remove module "{name}"',
            reason=reason,
        )
    await course_service.delete_module(session, module_id)
    await audit.record_safely(
        session,
        action=AuditAction.ORG_COURSE_UPDATED,
        actor=scope.user,
        organization_id=scope.organization.id,
        target_type="course",
        target_id=course_id,
        metadata={"removed_module": name},
    )
    await session.commit()


class OrgLearnerRow(BaseModel):
    """Who to enrol, for the assignment screen."""

    id: uuid.UUID
    name: str
    email: str
    branch_name: str | None


@router.get("/courses/{course_id}/audience", response_model=list[OrgLearnerRow])
async def course_audience(
    course_id: uuid.UUID, session: DbSession, scope: OrgAuthorScope
) -> list[OrgLearnerRow]:
    """Everyone in the organization who can actually take this course.

    Scoped to the organization, so it can never list another customer's staff —
    and scoped to the course's DEPARTMENT, which it was not. It counted every
    learner in the organization regardless, so a course narrowed to Compliance
    reported an audience including people the access rule refuses. A screen
    saying "this reaches 20 people" when it reaches 6 is worse than no screen.
    """
    course = await session.get(Course, course_id)
    if course is None or course.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )
    # WHOSE COURSE, not merely which organization. This route answers with
    # names and email addresses, and it had no department check at all — safe
    # while only org admins could call it, a leak the moment department admins
    # could. A company-wide course is in every department admin's own listing,
    # and its audience is the WHOLE organization: asking about it handed the
    # sales admin every HR learner's name and address, from their own screen.
    editable = await _editable_departments(session, scope)
    _require_editable(scope, course, editable)

    filters = [
        User.organization_id == scope.organization.id,
        User.is_active.is_(True),
        User.role == UserRole.STUDENT,
    ]
    if course.department_id is not None:
        # Matches `limits.visible_department_ids`: somebody in that department,
        # or anybody flagged to see across departments. Not a second copy of
        # the rule — the same two conditions the access check applies.
        filters.append(
            or_(
                User.department_id == course.department_id,
                User.sees_all_departments.is_(True),
            )
        )

    rows = (
        await session.execute(
            select(User, Branch.name)
            .outerjoin(Branch, Branch.id == User.branch_id)
            .where(*filters)
            .order_by(User.name)
        )
    ).all()
    return [
        OrgLearnerRow(
            id=user.id, name=user.name, email=user.email, branch_name=branch_name
        )
        for user, branch_name in rows
    ]
