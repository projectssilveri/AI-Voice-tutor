"""Profile photos.

The seam, in the sense decision 95 gives: moving to object storage means
changing where `data` is read and written here, and nothing else.

Validation is by MAGIC BYTES, never by what the browser claims — the same rule
`services/materials.py` applies to PDFs (decision 96). Content-Type and filename
are both chosen by the client, so neither is evidence of anything.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profile import UserAvatar

#: 2 MB. A profile photo displayed at 40px does not need more, and the bytes
#: live in Postgres — a generous cap here is a bill nobody sees until later.
MAX_BYTES = 2 * 1024 * 1024

#: What each format starts with. WebP needs two checks because the size sits
#: between the two markers.
_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)


class InvalidImage(ValueError):
    """Not an image we will store. Carries the sentence to show the person."""


def detect(data: bytes) -> str:
    """The real content type, from the bytes themselves.

    SVG is deliberately not accepted. It is a document, not a bitmap: it can
    carry script and external references, and serving one back from our own
    origin would be serving whatever somebody put inside it.
    """
    if len(data) > MAX_BYTES:
        raise InvalidImage(
            f"That image is {len(data) // 1024}KB. Keep it under "
            f"{MAX_BYTES // 1024 // 1024}MB."
        )
    if not data:
        raise InvalidImage("That file is empty.")

    for signature, content_type in _SIGNATURES:
        if data.startswith(signature):
            return content_type

    # RIFF....WEBP
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"

    raise InvalidImage(
        "That is not an image we can use. Upload a JPEG, PNG, GIF or WebP."
    )


async def save(session: AsyncSession, user_id: uuid.UUID, data: bytes) -> UserAvatar:
    """Store a photo, replacing whatever was there.

    Does not commit — the caller owns the transaction, so the photo and its
    audit record land together.
    """
    content_type = detect(data)

    existing = await session.scalar(
        select(UserAvatar).where(UserAvatar.user_id == user_id)
    )
    if existing is not None:
        # Updated in place rather than deleted and re-inserted: the user is the
        # primary key, so there is exactly one row and no history to keep.
        existing.data = data
        existing.content_type = content_type
        existing.size_bytes = len(data)
        return existing

    avatar = UserAvatar(
        user_id=user_id,
        data=data,
        content_type=content_type,
        size_bytes=len(data),
    )
    session.add(avatar)
    return avatar


async def get(session: AsyncSession, user_id: uuid.UUID) -> UserAvatar | None:
    return await session.scalar(select(UserAvatar).where(UserAvatar.user_id == user_id))


async def remove(session: AsyncSession, user_id: uuid.UUID) -> bool:
    """Delete the photo. True when there was one."""
    avatar = await get(session, user_id)
    if avatar is None:
        return False
    await session.delete(avatar)
    return True


