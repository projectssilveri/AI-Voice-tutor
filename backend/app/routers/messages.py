"""Private messages between accounts.

The profile page told people to "contact an admin" and then gave them no way to
do it. This is that way.

Distinct from the public contact form, which is for strangers with no account
(`/public/contact`, decision 36). Here both ends are known, so a message threads
and can be marked read, and nobody has to type a reply-to address.

Who may write to whom:

* Staff write to a named person.
* Everyone else writes to "support" and does not choose a recipient. Letting a
  learner address any account by id would turn the picker into a directory of
  every user on the platform, which is the leak decision 150 had to close on
  the organization member list.

"Support" resolves to a real account so the row is valid and the thread has two
ends — the longest-serving active org admin for an organization member, the
longest-serving active platform admin otherwise. The console then shows staff
every message rather than only the ones addressed to them, because a support
inbox that depends on one person being at their desk is not a support inbox.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased

from app.deps import CurrentUser, DbSession, RequireAdmin
from app.models.message import DirectMessage
from app.models.user import User, UserRole
from app.services import audit

router = APIRouter(tags=["messages"])

# Both ends of a message are users, so every query self-joins. Named aliases
# once, here, rather than re-deriving them in five places.
Sender = aliased(User, name="sender")
Recipient = aliased(User, name="recipient")

# Who counts as staff for the purposes of addressing a message.
STAFF = {
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.TEACHER,
    UserRole.ORG_ADMIN,
    UserRole.BRANCH_MANAGER,
}
PLATFORM_SUPPORT = (UserRole.SUPER_ADMIN, UserRole.ADMIN)


class MessageRow(BaseModel):
    id: uuid.UUID
    subject: str
    body: str
    created_at: datetime
    read_at: datetime | None
    in_reply_to_id: uuid.UUID | None

    sender_id: uuid.UUID
    sender_name: str
    sender_email: str
    sender_role: str
    sender_phone: str | None

    recipient_id: uuid.UUID
    recipient_name: str
    recipient_email: str
    recipient_role: str
    recipient_phone: str | None


class MessageCreate(BaseModel):
    # Omitted by a learner: they write to support and the server resolves who
    # that is. Supplying one as a learner is refused rather than ignored — a
    # request that quietly does something other than what it asked for is worse
    # than one that fails.
    recipient_id: uuid.UUID | None = None
    subject: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=5_000)
    in_reply_to_id: uuid.UUID | None = None


class MessageCounts(BaseModel):
    unread: int


class Correspondent(BaseModel):
    """Someone a staff user may write to."""

    id: uuid.UUID
    name: str
    email: str
    role: str
    phone: str | None


def _row(message: DirectMessage, sender: User, recipient: User) -> MessageRow:
    return MessageRow(
        id=message.id,
        subject=message.subject,
        body=message.body,
        created_at=message.created_at,
        read_at=message.read_at,
        in_reply_to_id=message.in_reply_to_id,
        sender_id=sender.id,
        sender_name=sender.name,
        sender_email=sender.email,
        sender_role=sender.role.value,
        sender_phone=sender.phone,
        recipient_id=recipient.id,
        recipient_name=recipient.name,
        recipient_email=recipient.email,
        recipient_role=recipient.role.value,
        recipient_phone=recipient.phone,
    )


async def _resolve_support(session: DbSession, sender: User) -> User:
    """Who "support" is for this sender.

    An organization member's question goes to their own employer's admins, not
    to us: their training, their people, their answer to give. Only a public
    B2C user reaches the platform.
    """
    if sender.organization_id is not None:
        found = await session.scalar(
            select(User)
            .where(
                User.organization_id == sender.organization_id,
                User.role == UserRole.ORG_ADMIN,
                User.is_active.is_(True),
            )
            .order_by(User.created_at)
            .limit(1)
        )
        if found is not None:
            return found
        # An organization with no active admin should not swallow the message —
        # fall through to the platform, which can at least chase it up.

    found = await session.scalar(
        select(User)
        .where(User.role.in_(PLATFORM_SUPPORT), User.is_active.is_(True))
        .order_by(User.role.desc(), User.created_at)
        .limit(1)
    )
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No one is available to receive messages right now.",
        )
    return found


@router.post(
    "/messages", response_model=MessageRow, status_code=status.HTTP_201_CREATED
)
async def send_message(
    payload: MessageCreate, session: DbSession, sender: CurrentUser
) -> MessageRow:
    is_staff = sender.role in STAFF

    if payload.recipient_id is None:
        recipient = await _resolve_support(session, sender)
    else:
        if not is_staff:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Write to support. You cannot address another account directly.",
            )
        found = await session.get(User, payload.recipient_id)
        if found is None or not found.is_active:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="No such recipient."
            )
        # Organization staff stay inside their own organization, the same rule
        # `require_org_scope` applies everywhere else. A platform admin is not
        # widened here either: messaging a customer's staff is support access,
        # which decision 159 keeps with the super admin.
        if sender.organization_id is not None and (
            found.organization_id != sender.organization_id
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="No such recipient."
            )
        if (
            sender.role is UserRole.ADMIN
            and sender.organization_id is None
            and found.organization_id is not None
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="No such recipient."
            )
        recipient = found

    if recipient.id == sender.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot message yourself.",
        )

    message = DirectMessage(
        sender_id=sender.id,
        recipient_id=recipient.id,
        subject=payload.subject.strip(),
        body=payload.body.strip(),
        in_reply_to_id=payload.in_reply_to_id,
    )
    session.add(message)
    await session.flush()

    # `record_safely`, not `record`: losing a message because the trail was
    # briefly unavailable would be the worse failure of the two.
    await audit.record_safely(
        session,
        actor=sender,
        action="message.sent",
        target_type="user",
        target_id=recipient.id,
        # The subject, never the body. What was written to support is between
        # the two of them; that it happened is the auditable fact.
        metadata={"subject": message.subject},
    )
    await session.commit()
    await session.refresh(message)
    return _row(message, sender, recipient)


@router.get("/messages/inbox", response_model=list[MessageRow])
async def my_inbox(
    session: DbSession,
    user: CurrentUser,
    limit: int = Query(default=100, ge=1, le=200),
) -> list[MessageRow]:
    rows = (
        await session.execute(
            select(DirectMessage, Sender, Recipient)
            .join(Sender, Sender.id == DirectMessage.sender_id)
            .join(Recipient, Recipient.id == DirectMessage.recipient_id)
            .where(DirectMessage.recipient_id == user.id)
            .order_by(DirectMessage.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [_row(message, from_whom, to_whom) for message, from_whom, to_whom in rows]


@router.get("/messages/sent", response_model=list[MessageRow])
async def my_sent(
    session: DbSession,
    user: CurrentUser,
    limit: int = Query(default=100, ge=1, le=200),
) -> list[MessageRow]:
    rows = (
        await session.execute(
            select(DirectMessage, Sender, Recipient)
            .join(Sender, Sender.id == DirectMessage.sender_id)
            .join(Recipient, Recipient.id == DirectMessage.recipient_id)
            .where(DirectMessage.sender_id == user.id)
            .order_by(DirectMessage.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [_row(message, from_whom, to_whom) for message, from_whom, to_whom in rows]


@router.get("/messages/unread", response_model=MessageCounts)
async def unread_count(session: DbSession, user: CurrentUser) -> MessageCounts:
    """Drives the badge in the header. One cheap count, not a page of rows."""
    total = await session.scalar(
        select(func.count())
        .select_from(DirectMessage)
        .where(DirectMessage.recipient_id == user.id, DirectMessage.read_at.is_(None))
    )
    return MessageCounts(unread=total or 0)


@router.post("/messages/{message_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    message_id: uuid.UUID, session: DbSession, user: CurrentUser
) -> None:
    message = await session.get(DirectMessage, message_id)
    # Only the recipient marks a message read. The sender doing it would make
    # "they have seen this" a claim the sender could manufacture.
    if message is None or message.recipient_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Message not found."
        )
    if message.read_at is None:
        message.read_at = datetime.now(UTC)
        await session.commit()


@router.get("/messages/recipients", response_model=list[Correspondent])
async def who_i_can_write_to(
    session: DbSession,
    user: CurrentUser,
    q: str | None = Query(default=None, description="Name or email"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[Correspondent]:
    """The people this account may address by name.

    Empty for a learner — deliberately, and not an error: they write to support
    and the UI shows that instead of a picker. Returning the full user list and
    letting the frontend hide it is how a directory leaks.
    """
    if user.role not in STAFF:
        return []

    filters = [User.is_active.is_(True), User.id != user.id]
    if user.organization_id is not None:
        filters.append(User.organization_id == user.organization_id)
    elif user.role is UserRole.ADMIN:
        # An ordinary platform admin sees platform users only (decision 171).
        filters.append(User.organization_id.is_(None))
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(or_(User.name.ilike(pattern), User.email.ilike(pattern)))

    rows = (
        await session.scalars(
            select(User).where(*filters).order_by(User.name).limit(limit)
        )
    ).all()
    return [
        Correspondent(
            id=row.id,
            name=row.name,
            email=row.email,
            role=row.role.value,
            phone=row.phone,
        )
        for row in rows
    ]


@router.get("/admin/messages", response_model=list[MessageRow])
async def all_messages(
    session: DbSession,
    admin: RequireAdmin,
    q: str | None = Query(default=None, description="Subject, or either party"),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[MessageRow]:
    """The shared staff view.

    Every message, not only the ones addressed to the admin reading it — a
    support inbox that depends on one person being at their desk is not a
    support inbox.

    Scoped the same way as the audit trail: an ordinary platform admin does not
    read a customer's correspondence.
    """
    filters = []
    if admin.role is not UserRole.SUPER_ADMIN:
        filters.append(Sender.organization_id.is_(None))
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                DirectMessage.subject.ilike(pattern),
                Sender.name.ilike(pattern),
                Sender.email.ilike(pattern),
                Recipient.name.ilike(pattern),
                Recipient.email.ilike(pattern),
            )
        )

    rows = (
        await session.execute(
            select(DirectMessage, Sender, Recipient)
            .join(Sender, Sender.id == DirectMessage.sender_id)
            .join(Recipient, Recipient.id == DirectMessage.recipient_id)
            .where(*filters)
            .order_by(DirectMessage.created_at.desc())
            .limit(limit)
        )
    ).all()

    return [_row(message, from_whom, to_whom) for message, from_whom, to_whom in rows]
