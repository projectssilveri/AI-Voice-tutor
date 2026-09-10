"""Persistence for voice sessions and transcripts.

Kept apart from `gemini_live.py` so the Gemini protocol and the database are
independently testable, and so a change to one does not drag in the other.

Transcript writes are buffered rather than written per fragment: Gemini streams
partial transcriptions several times a second, and one INSERT per fragment
would put the database on the latency path of a live conversation.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditAction
from app.models.voice import Transcript, TranscriptRole, VoiceSession
from app.services import audit

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class PendingTurn:
    """A transcript turn still being streamed."""

    role: TranscriptRole
    text: str = ""
    is_interruption: bool = False
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))


async def start_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    module_id: uuid.UUID,
    model_name: str,
) -> VoiceSession:
    record = VoiceSession(user_id=user_id, module_id=module_id, model_name=model_name)
    session.add(record)

    # `record_safely`, not `record`: a student mid-lecture must not lose the
    # session because the trail could not be written. The row in
    # `voice_sessions` is the authoritative record of the lesson either way;
    # this event is what makes it visible in one timeline beside logins and
    # submissions.
    await audit.record_safely(
        session,
        action=AuditAction.VOICE_SESSION_STARTED,
        actor_id=user_id,
        target_type="module",
        target_id=module_id,
        metadata={"model": model_name},
    )

    await session.commit()
    await session.refresh(record)
    return record


async def end_session(session: AsyncSession, voice_session_id: uuid.UUID) -> None:
    record = await session.get(VoiceSession, voice_session_id)
    if record is None:
        return
    record.ended_at = datetime.now(UTC)

    # Duration in whole seconds, and how many times the student cut in. Counts
    # and ids only — never the transcript, which is the point of the lesson but
    # not the business of the audit trail.
    seconds = int((record.ended_at - record.started_at).total_seconds())
    interruptions = await session.scalar(
        select(func.count())
        .select_from(Transcript)
        .where(
            Transcript.session_id == record.id,
            Transcript.is_interruption.is_(True),
        )
    )
    await audit.record_safely(
        session,
        action=AuditAction.VOICE_SESSION_ENDED,
        actor_id=record.user_id,
        target_type="module",
        target_id=record.module_id,
        metadata={
            "session_id": str(record.id),
            "duration_seconds": seconds,
            "interruptions": interruptions or 0,
        },
    )

    await session.commit()


async def save_resumption_handle(
    session: AsyncSession, voice_session_id: uuid.UUID, handle: str
) -> None:
    """Store Gemini's resumption handle.

    Treated as a credential: written here, never logged, never sent to the
    browser.
    """
    record = await session.get(VoiceSession, voice_session_id)
    if record is None:
        return
    record.resumption_handle = handle
    await session.commit()


async def append_turn(
    session: AsyncSession,
    *,
    voice_session_id: uuid.UUID,
    role: TranscriptRole,
    text: str,
    is_interruption: bool = False,
) -> None:
    """Write one completed turn."""
    if not text.strip():
        return
    session.add(
        Transcript(
            session_id=voice_session_id,
            role=role,
            text=text.strip(),
            is_interruption=is_interruption,
        )
    )
    await session.commit()


class TranscriptBuffer:
    """Accumulates streamed fragments and flushes whole turns.

    Gemini emits partial transcriptions continuously. Buffering means one row
    per turn instead of dozens of fragments, and keeps the database off the
    critical path of a live conversation.
    """

    def __init__(self) -> None:
        self._turns: dict[TranscriptRole, PendingTurn] = {}

    def add(self, role: TranscriptRole, text: str) -> None:
        turn = self._turns.get(role)
        if turn is None:
            turn = PendingTurn(role=role)
            self._turns[role] = turn
        turn.text += text

    def mark_interrupted(self) -> None:
        """Flag the tutor's open turn as cut off.

        This is the only durable record that barge-in actually fired, so it has
        to survive even when the turn never completes normally.
        """
        turn = self._turns.get(TranscriptRole.MODEL)
        if turn is not None:
            turn.is_interruption = True

    def take(self, role: TranscriptRole) -> PendingTurn | None:
        return self._turns.pop(role, None)

    def take_all(self) -> list[PendingTurn]:
        turns = list(self._turns.values())
        self._turns.clear()
        return turns

    def has_pending(self) -> bool:
        return any(turn.text.strip() for turn in self._turns.values())


async def close_open_sessions_for(
    session: AsyncSession, user_id: uuid.UUID, *, except_id: uuid.UUID | None = None
) -> int:
    """Close any voice_sessions row still open for this student.

    THE ACCOUNTING HALF of the one-session-at-a-time rule. `live_sessions`
    displaces the socket; this closes the row behind it, because a row with
    `ended_at IS NULL` is counted as zero minutes by
    `limits.usage_for` — so an abandoned session would silently under-report a
    customer's AI usage forever.

    Also cleans up after a RESTART. A process that is killed mid-lesson leaves
    its rows open with no socket anywhere; the next session that student starts
    sweeps them. Without this those rows stay open for good.

    `ended_at` is set to `started_at` rather than to now: we do not know when
    the session actually stopped, and billing a student for the hours between a
    crash and their next sign-in would be worse than recording zero. Zero is
    also what a row with no `ended_at` already counted as, so this changes
    nothing about the totals — it only stops them being wrong later.
    """
    filters = [
        VoiceSession.user_id == user_id,
        VoiceSession.ended_at.is_(None),
    ]
    if except_id is not None:
        filters.append(VoiceSession.id != except_id)

    stale = (await session.scalars(select(VoiceSession).where(*filters))).all()
    for record in stale:
        record.ended_at = record.started_at

    if stale:
        await session.commit()
        logger.info("Closed %d stale voice session(s) for user %s", len(stale), user_id)
    return len(stale)
