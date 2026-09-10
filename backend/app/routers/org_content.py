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
from app.models.org_document import DocumentVisibility
from app.models.organization import Branch, Department
from app.models.user import User, UserRole
from app.services import audit, limits, materials
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


def _visibility_of(value) -> DocumentVisibility:
    """The listing hands back the column value, the detail routes an ORM row.

    Both are the enum in practice, but the row builder below already defends
    against a plain string, so the two checks agree rather than one of them
    silently deciding a document is not departmental.
    """
    return value if isinstance(value, DocumentVisibility) else DocumentVisibility(value)


def _may_manage_document(scope, visibility, department_id) -> bool:
    """Whether this caller may remove this document.

    An org admin looks after the whole library. A department admin looks after
    the files scoped to their own department and nothing else — not another
    department's, and not the organization-wide ones, which belong to everybody.
    """
    if scope.is_org_admin:
        return True
    if not scope.is_dept_admin:
        return False
    scoped = scope.scoped_department_id()
    return (
        scoped is not None
        and _visibility_of(visibility) is DocumentVisibility.DEPARTMENT
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
                can_edit=_may_manage_document(scope, r.visibility, r.department_id),
            )
            for r in rows
        ],
        total=len(rows),
    )


@router.post(
    "/documents", response_model=DocumentRow, status_code=status.HTTP_201_CREATED
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
) -> DocumentRow:
    """Add a file to the library.

    Open to a DEPARTMENT ADMIN as well as an org admin. The HR admin
    maintaining HR's training needs the HR handbook in the library, and being
    able to write the course while having to ask somebody else to upload its
    source document is half a role. Their file is filed against their own
    department, and nowhere else.

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

    return DocumentRow(
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
    document_id: uuid.UUID, session: DbSession, scope: OrgAuthorScope
) -> None:
    """Remove a file. Whose file decides who may.

    Read BEFORE deleting, rather than deleting and checking: the service would
    otherwise have removed another department's document by the time anything
    looked at whose it was.
    """
    document = await doc_service.get_with_data(
        session, scope.organization.id, document_id
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found."
        )
    if not _may_manage_document(scope, document.visibility, document.department_id):
        if _document_readable(
            scope, document.visibility, document.branch_id, document.department_id
        ):
            # They can see it, so 404 would be a lie. It is the company's file.
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "This document is for the whole organization. Ask an administrator."
                ),
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found."
        )

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
    if document is None or not _document_readable(
        scope, document.visibility, document.branch_id, document.department_id
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


def _may_edit(scope, course: Course) -> bool:
    """Whether this caller may change this course.

    An org admin may change anything in their organization. A department admin
    may change their own department's courses and nothing else — not another
    department's, and not the company-wide ones, which belong to everybody and
    are the org admin's to write.
    """
    if scope.is_org_admin:
        return True
    if scope.is_dept_admin:
        scoped = scope.scoped_department_id()
        return scoped is not None and course.department_id == scoped
    return False


def _require_editable(scope, course: Course) -> None:
    """404, not 403, for a course outside the caller's department.

    Same reasoning as the tenant boundary: whether a course exists in another
    department is not something the sales admin should learn by the shape of
    the refusal. A course they can SEE but not edit — a company-wide one — is
    a 403, because they already know it exists.
    """
    if _may_edit(scope, course):
        return
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

    return [
        OrgCourseRow(
            id=course.id,
            title=course.title,
            description=course.description,
            is_published=course.is_published,
            module_count=count,
            department_id=course.department_id,
            department_name=department_names.get(course.department_id),
            can_edit=_may_edit(scope, course),
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
    "/courses", response_model=OrgCourseRow, status_code=status.HTTP_201_CREATED
)
async def create_org_course(
    payload: OrgCourseCreate, session: DbSession, scope: OrgAuthorScope
) -> OrgCourseRow:
    """Create a course inside this organization.

    Stamped with the organization's id at creation, which is the single fact
    that keeps it private: `services/access.py` reads that column and refuses
    every caller outside the tenant, in both directions.

    Open to a DEPARTMENT ADMIN as well as an org admin — writing their own
    department's training is half of what that role is for — and their course
    is stamped with their own department, which is the other half. An org
    TEACHER still cannot create courses: the admin floor and the audit trail
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
    return OrgCourseRow(
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
    _require_editable(scope, course)

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

    # A DEPARTMENT MUST BE ONE OF OURS. `model_dump` plus a blind setattr would
    # have written whatever id was sent, so an admin who knew another
    # customer's department id could file their course against it — a
    # cross-tenant write dressed up as an ordinary field. Same guard as
    # `_validate_placement` uses for people (decisions 145 and 154).
    if "department_id" in changes:
        changes["department_id"] = await _department_in_scope(
            session, scope, changes["department_id"]
        )

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
        can_edit=_may_edit(scope, course),
    )


class OrgModuleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    #: Omit to append. It used to default to 0, so a caller that sent nothing
    #: collided with the first module rather than landing after the last.
    order: int | None = Field(default=None, ge=0)
    # What the tutor teaches from. Reviewed and saved by a person, never
    # written straight from an extraction — decision 97.
    content: str | None = None


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
) -> dict:
    course = await session.get(Course, course_id)
    if course is None or course.organization_id != scope.organization.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found."
        )
    # Adding a module IS editing the course — it is what the tutor reads out —
    # so it is gated exactly as the course itself is.
    _require_editable(scope, course)
    # The same cap as a platform course, except an organization may be given
    # its own limit — which is part of what a business plan is sold on.
    try:
        await limits.assert_can_add_module(session, course)
    except limits.LimitReached as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None

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
        "id": str(module.id),
        "title": module.title,
        "order": module.order,
        "has_content": bool(module.content),
    }


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
    _require_editable(scope, course)

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
