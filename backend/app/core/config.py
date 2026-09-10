"""Application settings, loaded from the environment.

Everything tunable lives here rather than being hardcoded at a call site, so
model names, attempt limits, and token lifetimes can change without a code edit.

Secrets default to None rather than raising at import time: the skeleton must
start and serve /health before any API key exists. Each consumer is responsible
for failing loudly when it needs a secret that is missing.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        # `model_name`-style fields would otherwise collide with pydantic's
        # reserved `model_` namespace and emit warnings.
        protected_namespaces=(),
    )

    # --- Runtime ---------------------------------------------------------
    environment: Literal["local", "staging", "production"] = "local"
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"

    # --- Database --------------------------------------------------------
    # Hosted Postgres (Neon/Supabase) with the pgvector extension enabled.
    # Accepts the plain `postgresql://` URL those providers hand out; it is
    # normalised to the asyncpg driver in db/session.py.
    database_url: str | None = None
    db_echo: bool = False

    # --- Auth ------------------------------------------------------------
    # FastAPI-native auth (fastapi-users + argon2). Confirmed deviation from
    # the original spec's "Clerk or NextAuth" line so that FastAPI stays the
    # single backend and `users.password_hash` is used as the schema intends.
    jwt_secret: str | None = None
    jwt_lifetime_seconds: int = 60 * 60 * 24  # 24h

    # --- AI providers ----------------------------------------------------
    # Live voice. Preview model — the name may change, so it is config,
    # never a literal in the voice router.
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.1-flash-live-preview"

    # HOW A LESSON OUTLIVES GOOGLE'S OWN LIMITS.
    #
    # Two ceilings sit under every Live call and neither is ours to raise:
    #
    #   * one connection lasts about ten minutes, whatever we do
    #   * the conversation's context window holds 128k tokens, and audio
    #     spends roughly 25 of them a second — about fifteen minutes of talk
    #
    # A paid course allows an hour and a half with the tutor. Without the two
    # settings below it delivered ten minutes, because the connection died and
    # nothing picked it back up.
    #
    # Context compression: when the conversation reaches `trigger` tokens,
    # Google trims it back to `target`, keeping the newest turns. The system
    # instruction and the module material are pinned at the front and are never
    # trimmed, so the tutor cannot forget what it is teaching — it loses the
    # oldest small talk, not the lesson.
    #
    # 96k of the 128k window, trimmed back to 48k. Set for the HOUR a paid
    # lesson now runs, not for a short one.
    #
    # Trimming costs latency on the turn it happens to land on, and it throws
    # away real conversation. Both argue for doing it as late and as rarely as
    # the window allows: at 96k a ninety-minute lesson trims a handful of
    # times and the tutor keeps most of what was said; at 32k it would trim
    # three times as often and remember far less. The 32k headroom above the
    # trigger is the safety margin — one turn of audio is a few thousand tokens
    # at most, so the window cannot overshoot 128k between checks.
    gemini_context_trigger_tokens: int = 96_000
    gemini_context_target_tokens: int = 48_000

    # How many times in a row a reconnect may fail before the lesson is ended
    # and the student told. One failure is a blip; two in a row means the
    # handle is stale or Google is refusing us, and silently retrying forever
    # leaves somebody watching a page that will never speak again.
    gemini_max_resume_failures: int = 2

    # Non-live text generation only: lecture scripts, quiz/exam questions,
    # grading of open-ended answers. Never inside a Gemini Live session.
    anthropic_api_key: str | None = None
    anthropic_model: str = "opus-5"

    # --- Business rules --------------------------------------------------
    # Certification exams only. Quizzes are unlimited retakes and content
    # reading is unlimited — neither reads this value.
    cert_default_max_attempts: int = 3

    # HOW MANY MODULES A COURSE MAY HAVE. Config rather than a constant —
    # nothing that should be configurable is hardcoded. An
    # organization may be given its own limit, which overrides this.
    #
    # Ten is a real editorial constraint, not a technical one. A course that
    # needs a twentieth module is two courses, and a spoken lecture per module
    # means the length of a course is the student's actual time commitment.
    max_modules_per_course: int = 10

    # What it takes for a tutoring session to complete a module. Both must be
    # met, so opening the tutor and closing it straight away cannot tick a
    # module off, and neither can a session that never produced a lecture.
    # Config rather than literals: the right duration depends on how long the
    # modules are, which is a content decision, not a code one.
    module_complete_min_seconds: int = 60
    module_complete_min_turns: int = 1

    # --- What the AI tutor is allowed to do ------------------------------
    # HOW MANY TIMES A STUDENT MAY PLAY THE TUTOR ON ONE MODULE, and how long
    # each play may run. These are the DEFAULTS; a super admin can set either
    # per course, and `courses.ai_sessions_per_module` / `ai_session_minutes`
    # override what is here.
    #
    # Free courses get less because the tutor is the most expensive thing the
    # product does and the free course exists to show what it is like, not to
    # be the whole course. Paid courses get more because somebody paid for it.
    #
    # An ORGANISATION'S course counts as paid however it is priced: its price
    # is zero because an employer bought the training, not because it is a
    # sample. Reading it as free would have handed corporate learners one play
    # per module, which is the opposite of what was sold.
    #
    # Config rather than constants, so the numbers can be changed for the whole
    # catalogue without a deploy — and so changing them moves every course that
    # has not been given its own value, which is why the columns are left NULL
    # rather than backfilled.
    free_course_ai_sessions_per_module: int = 1
    paid_course_ai_sessions_per_module: int = 3
    # HOW LONG ONE SITTING WITH THE TUTOR LASTS, and the point at which the
    # session ends itself.
    #
    # Neither number used to mean anything: Gemini closes a connection after
    # about ten minutes and nothing reopened it, so every lesson ended there
    # with the page going quiet and no explanation.
    # `routers/voice._run_bridge` now spans as many connections as a lesson
    # needs and `build_config` trims the conversation before it fills, so these
    # are finally what a student actually gets.
    #
    # The session stops itself when the time is up — `routers/voice` wraps the
    # whole bridge in a `wait_for` — and says so plainly rather than cutting
    # out. A super admin can still set either number per course.
    free_course_ai_session_minutes: int = 30
    paid_course_ai_session_minutes: int = 90

    # --- Payments (Razorpay) ---------------------------------------------
    # The key id is safe to hand to the browser — Razorpay's checkout needs it.
    # The SECRET never leaves this service: it is what signs and verifies a
    # payment, so anyone holding it can forge a successful purchase.
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    # Set in the Razorpay dashboard when configuring the webhook. Separate from
    # the key secret, and required to trust anything the webhook says.
    razorpay_webhook_secret: str | None = None

    @property
    def payments_enabled(self) -> bool:
        """Whether real checkout can run.

        With no keys the app still works: free courses enrol as normal and paid
        ones say checkout is unavailable, rather than 500ing on a missing key.
        """
        return bool(self.razorpay_key_id and self.razorpay_key_secret)

    # --- CORS ------------------------------------------------------------
    # NoDecode is required, not stylistic: pydantic-settings tries to JSON-parse
    # any complex-typed field coming from a .env file *before* validators run,
    # so a plain `CORS_ORIGINS=http://localhost:3000` raises a SettingsError.
    # NoDecode hands the raw string to the validator below instead.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept a comma-separated string, a JSON array, or a real list."""
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                import json

                return json.loads(text)
            return [origin.strip() for origin in text.split(",") if origin.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    """Cached so the .env file is read once per process."""
    return Settings()


settings = get_settings()
