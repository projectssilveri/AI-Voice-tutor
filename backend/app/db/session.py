"""Async SQLAlchemy engine and session factory.

Hosted Postgres (Neon/Supabase) hands out `postgresql://...?sslmode=require`.
asyncpg does not accept `sslmode` as a connect argument, so the URL is
normalised here: driver swapped to asyncpg, libpq-only query params stripped,
and TLS passed through connect_args instead. Getting this wrong produces
`TypeError: connect() got an unexpected keyword argument 'sslmode'` at the
first query, not at startup.
"""

from __future__ import annotations

import ssl
from collections.abc import AsyncIterator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

# Recognised by libpq/psycopg but not by asyncpg's connect().
_LIBPQ_ONLY_PARAMS = {"sslmode", "channel_binding", "target_session_attrs"}

# sslmode values that mean "encrypt the connection".
_SSL_REQUIRED_MODES = {"require", "verify-ca", "verify-full"}


def normalise_database_url(url: str) -> tuple[str, dict[str, object]]:
    """Return an asyncpg-compatible URL plus the connect_args it needs."""
    parts = urlsplit(url)

    scheme = parts.scheme
    if scheme in {"postgres", "postgresql"}:
        scheme = "postgresql+asyncpg"

    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    kept = [(k, v) for k, v in query_pairs if k not in _LIBPQ_ONLY_PARAMS]
    dropped = {k: v for k, v in query_pairs if k in _LIBPQ_ONLY_PARAMS}

    connect_args: dict[str, object] = {}
    sslmode = dropped.get("sslmode")
    is_remote = not any(h in parts.netloc for h in ("localhost", "127.0.0.1", "db:5432"))

    if sslmode in _SSL_REQUIRED_MODES or (is_remote and sslmode != "disable"):
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        connect_args["ssl"] = context
    elif sslmode == "disable":
        connect_args["ssl"] = False

    # Disable statement cache for PgBouncer / Supabase pooler compatibility
    if is_remote or "pooler" in parts.netloc:
        connect_args["statement_cache_size"] = 0

    normalised = urlunsplit(
        (scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment)
    )
    return normalised, connect_args


def _build_engine() -> AsyncEngine | None:
    """None until DATABASE_URL is configured, so the app still boots without it."""
    if not settings.database_url:
        return None

    url, connect_args = normalise_database_url(settings.database_url)
    return create_async_engine(
        url,
        echo=settings.db_echo,
        pool_pre_ping=True,  # hosted Postgres drops idle connections
        connect_args=connect_args,
    )


engine: AsyncEngine | None = _build_engine()

SessionLocal: async_sessionmaker[AsyncSession] | None = (
    async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    if engine is not None
    else None
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped session."""
    if SessionLocal is None:
        raise RuntimeError(
            "DATABASE_URL is not configured. Add it to backend/.env "
            "(see .env.example)."
        )
    async with SessionLocal() as session:
        yield session


async def dispose_engine() -> None:
    if engine is not None:
        await engine.dispose()
