"""A person's own profile: their photo, what we email them, and leaving.

Everything here acts on the CALLER. There is no user id in any path — an
endpoint that took one would need a permission check, and the whole point of
these three is that they are yours to change.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel

from app.deps import CurrentUser, DbSession
from app.services import audit, avatars, gemini_live

router = APIRouter(tags=["profile"])


# ---------------------------------------------------------------------------
# Photo
# ---------------------------------------------------------------------------


@router.put("/profile/photo", status_code=status.HTTP_204_NO_CONTENT)
async def upload_photo(
    file: Annotated[UploadFile, File()],
    session: DbSession,
    user: CurrentUser,
) -> None:
    """Set the caller's profile photo.

    The type is decided by the bytes, not by the browser's Content-Type —
    the same rule as PDF material (decision 96), and it matters more here
    because the result is served back from our own origin.
    """
    data = await file.read()
    try:
        await avatars.save(session, user.id, data)
    except avatars.InvalidImage as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    await audit.record_safely(
        session,
        action="profile.photo_set",
        actor=user,
        target_type="user",
        target_id=user.id,
        metadata={"bytes": len(data)},
    )
    await session.commit()


class PhotoRemoved(BaseModel):
    """Whether there was anything to take off."""

    removed: bool


@router.delete("/profile/photo", response_model=PhotoRemoved)
async def delete_photo(session: DbSession, user: CurrentUser) -> PhotoRemoved:
    """Take the caller's photo off, and say whether there was one.

    IT USED TO RETURN 204 AND NOTHING ELSE, so the browser could not tell
    "removed your photo" from "you had no photo". It reported success either
    way, which meant an account showing its fallback initial — a coloured
    square with a letter, not a picture — answered Remove with "Photo removed."
    and changed nothing. A button that lies is worse than a button that fails.

    RECORDED EITHER WAY, since the middleware net no longer covers this path.
    The event used to be written only when something was deleted, which was
    fine while the net caught the rest; now this route is the only record of
    the request, so a removal that found nothing is recorded as exactly that.
    """
    removed = await avatars.remove(session, user.id)
    await audit.record_safely(
        session,
        action="profile.photo_removed",
        actor=user,
        target_type="user",
        target_id=user.id,
        metadata={"had_photo": removed},
    )
    await session.commit()
    return PhotoRemoved(removed=removed)


@router.get("/users/{user_id}/photo")
async def get_photo(user_id: str, session: DbSession, user: CurrentUser) -> Response:
    """Serve someone's photo.

    Any SIGNED-IN user may fetch any other's. A profile photo is shown beside a
    name wherever people appear together — a member list, a message thread, an
    audit row — so gating it per relationship would mean a permission check on
    every avatar in a table. It is deliberately not public: an unauthenticated
    stranger has no reason to enumerate our users' faces.
    """
    import uuid as _uuid

    try:
        target = _uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No photo."
        ) from None

    avatar = await avatars.get(session, target)
    if avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No photo.")

    return Response(
        content=avatar.data,
        media_type=avatar.content_type,
        headers={
            # Private, because this is per-user content behind a session — a
            # shared cache must not hand one person's photo to another.
            # `must-revalidate` so a changed photo appears on the next load
            # rather than an hour later.
            "Cache-Control": "private, max-age=300, must-revalidate",
            "Content-Length": str(avatar.size_bytes),
        },
    )


# ---------------------------------------------------------------------------
# What we email
# ---------------------------------------------------------------------------


class NotificationPreferences(BaseModel):
    """Two switches, and what neither of them turns off."""

    notify_learning: bool
    notify_offers: bool


@router.get("/profile/notifications", response_model=NotificationPreferences)
async def get_notifications(user: CurrentUser) -> NotificationPreferences:
    return NotificationPreferences(
        notify_learning=user.notify_learning, notify_offers=user.notify_offers
    )


@router.put("/profile/notifications", response_model=NotificationPreferences)
async def set_notifications(
    payload: NotificationPreferences, session: DbSession, user: CurrentUser
) -> NotificationPreferences:
    """Change what we email.

    NEITHER SWITCH TOUCHES TRANSACTIONAL MAIL. A receipt, a password reset or a
    notice that an account was closed is not a communication anybody opts out
    of, and pretending otherwise would mean somebody paying for a course and
    never being told it worked. The screen says so in as many words.
    """
    user.notify_learning = payload.notify_learning
    user.notify_offers = payload.notify_offers

    await audit.record_safely(
        session,
        action="profile.notifications_changed",
        actor=user,
        target_type="user",
        target_id=user.id,
        metadata={"learning": payload.notify_learning, "offers": payload.notify_offers},
    )
    await session.commit()
    return payload


# ---------------------------------------------------------------------------
# The tutor's voice
# ---------------------------------------------------------------------------


class VoiceOption(BaseModel):
    """One choice, as the screen needs it."""

    name: str
    label: str
    sounds: str
    hint: str


class VoiceChoice(BaseModel):
    #: Null means "the platform default", which is what an account that has
    #: never chosen holds. Sent back as null rather than resolved, so the
    #: screen can show "Default" instead of pretending they picked it.
    voice: str | None
    #: Everything on offer, so the screen does not keep its own copy of a list
    #: that lives in `services/gemini_live` and changes there.
    options: list[VoiceOption]


def _voice_options() -> list[VoiceOption]:
    return [
        VoiceOption(name=v.name, label=v.label, sounds=v.sounds, hint=v.hint)
        for v in gemini_live.TUTOR_VOICES
    ]


@router.get("/profile/voice", response_model=VoiceChoice)
async def get_voice(user: CurrentUser) -> VoiceChoice:
    return VoiceChoice(voice=user.tutor_voice, options=_voice_options())


class VoiceUpdate(BaseModel):
    #: Null clears the choice and puts them back on the platform default —
    #: which is not the same as picking today's default by name, because that
    #: would stop tracking it the day it changes.
    voice: str | None = None


@router.put("/profile/voice", response_model=VoiceChoice)
async def set_voice(
    payload: VoiceUpdate, session: DbSession, user: CurrentUser
) -> VoiceChoice:
    """Choose the voice the tutor speaks in.

    Validated against the offered list rather than stored as sent: this column
    is handed straight to Gemini, and a value it does not recognise would fail
    a lesson at the worst possible moment — after the student pressed start.
    """
    chosen = payload.voice
    if chosen is not None and not any(
        v.name == chosen for v in gemini_live.TUTOR_VOICES
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="That is not one of the voices on offer.",
        )

    user.tutor_voice = chosen
    await audit.record_safely(
        session,
        action="profile.voice_changed",
        actor=user,
        target_type="user",
        target_id=user.id,
        metadata={"voice": chosen or "default"},
    )
    await session.commit()
    return VoiceChoice(voice=user.tutor_voice, options=_voice_options())


# ---------------------------------------------------------------------------
# Leaving
# ---------------------------------------------------------------------------


class CloseAccountRequest(BaseModel):
    # Typing the address is the confirmation. A checkbox is one careless click;
    # this is not something to undo by asking support nicely.
    confirm_email: str
    reason: str | None = None


class CloseAccountResult(BaseModel):
    closed: bool
    explanation: str


@router.post("/profile/close", response_model=CloseAccountResult)
async def close_account(
    payload: CloseAccountRequest, session: DbSession, user: CurrentUser
) -> CloseAccountResult:
    """Close your own account.

    CLOSED, NOT DELETED, and the response says so plainly rather than implying
    a clean erasure that did not happen. Half this schema points at `users.id`
    with RESTRICT so that an audit event never becomes anonymous (decision 24)
    and a certificate never loses its holder — those records are why the row
    stays. What changes is that the account can no longer be used: `is_active`
    goes false, so the next request 401s and no password will get back in.

    A real erasure request is a different operation with a retention policy
    behind it, and the spec flags that as a business decision rather than
    something to improvise here.
    """
    if payload.confirm_email.strip().lower() != user.email.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That is not the email address on this account.",
        )

    # THE LAST ADMIN CANNOT WALK OUT. An organization stranded with no
    # administrator is exactly what the admin floor exists to prevent, and it
    # does not care whether they were demoted, removed, or left of their own
    # accord.
    if user.organization_id is not None:
        from app.services import organizations as org_service

        try:
            await org_service.assert_admin_floor_after_change(
                session, user, still_admin=False
            )
        except org_service.AdminFloorError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from None

    # AND THE PLATFORM'S OWN FLOOR, which this door did not check.
    #
    # The same argument as the organization floor directly above, one level
    # up: the last super admin walking out leaves nobody able to promote
    # anyone, and the platform cannot be recovered from inside the product.
    # It is enforced on demotion and on deletion; closing your own account
    # reached the same end state and asked nobody.
    from app.routers.admin_users import assert_super_admin_floor

    await assert_super_admin_floor(session, user)

    user.is_active = False
    user.closed_at = datetime.now(UTC)
    # Marketing stops immediately. Continuing to email offers to somebody who
    # has just closed their account is the clearest possible way to say nobody
    # is reading.
    user.notify_offers = False
    user.notify_learning = False

    # `record`, not `record_safely`: an account ending is the class of event
    # this trail exists for, and it shares the transaction so the closure and
    # its record commit together or not at all.
    await audit.record(
        session,
        action="profile.account_closed",
        actor=user,
        target_type="user",
        target_id=user.id,
        # The reason, if they gave one. Never anything else they typed.
        metadata={"reason": (payload.reason or "").strip()[:200] or None},
    )
    await session.commit()

    return CloseAccountResult(
        closed=True,
        explanation=(
            "Your account is closed and you have been signed out. Your name "
            "stays on the records you are part of: certificates you earned, "
            "and the activity log your organisation keeps. Those belong to "
            "more than one person, not only to you. Write to us if you need "
            "them erased."
        ),
    )
