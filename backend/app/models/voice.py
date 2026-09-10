"""Gemini Live voice sessions and their transcripts."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk

if TYPE_CHECKING:
    from app.models.course import Module
    from app.models.user import User


class TranscriptRole(str, enum.Enum):
    USER = "user"
    MODEL = "model"


class VoiceSession(Base):
    """One Gemini Live session for one student on one module.

    A single Live connection only lasts ~10 minutes, so `resumption_handle`
    stores the handle Gemini returns; reconnecting with it makes the drop
    invisible to the student. `model_name` is recorded per session because the
    Live model is preview-status and will change — without it, older
    transcripts lose the context of which model produced them.
    """

    __tablename__ = "voice_sessions"
    __table_args__ = (
        Index("ix_voice_sessions_user_id", "user_id"),
        Index("ix_voice_sessions_module_id", "module_id"),
        # Admin usage graphs aggregate by user over time (step 10).
        Index("ix_voice_sessions_user_started", "user_id", "started_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    module_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("modules.id", ondelete="CASCADE"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Null while the session is still open.
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Opaque token from Gemini. Treated as a secret — never logged, never
    # returned to the browser.
    resumption_handle: Mapped[str | None] = mapped_column(Text)

    model_name: Mapped[str] = mapped_column(String(128), nullable=False)

    user: Mapped[User] = relationship(back_populates="voice_sessions")
    module: Mapped[Module] = relationship(back_populates="voice_sessions")
    transcripts: Mapped[list[Transcript]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="Transcript.ts",
    )


class Transcript(Base):
    """A single turn within a voice session.

    `is_interruption` marks the turns where the student cut the tutor off
    mid-sentence. It is the only record that barge-in actually fired, so it is
    what step 12's end-to-end test and the admin activity log both read.
    """

    __tablename__ = "transcripts"
    __table_args__ = (
        Index("ix_transcripts_session_id", "session_id"),
        Index("ix_transcripts_session_ts", "session_id", "ts"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("voice_sessions.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[TranscriptRole] = mapped_column(
        # See the note in models/user.py — Gemini's own wire format uses
        # lowercase "user"/"model", so the stored value must match that.
        Enum(
            TranscriptRole,
            native_enum=False,
            length=10,
            validate_strings=True,
            create_constraint=True,
            name="ck_transcripts_role",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    is_interruption: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    session: Mapped[VoiceSession] = relationship(back_populates="transcripts")
