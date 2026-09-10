"""Health and readiness.

The only route with real behaviour at step 1. It doubles as the database
smoke test: it reports whether DATABASE_URL is reachable and whether the
pgvector extension is actually installed, which is the check step 2 depends on.
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.core.config import settings
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class DatabaseHealth(BaseModel):
    configured: bool
    reachable: bool
    pgvector_version: str | None = None
    error: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    environment: str
    database: DatabaseHealth


async def _check_database() -> DatabaseHealth:
    if SessionLocal is None:
        return DatabaseHealth(configured=False, reachable=False)

    try:
        async with SessionLocal() as session:
            result = await session.execute(
                text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            )
            version = result.scalar_one_or_none()
        return DatabaseHealth(
            configured=True, reachable=True, pgvector_version=version
        )
    except Exception as exc:
        logger.warning("Database health check failed: %s", exc.__class__.__name__)
        return DatabaseHealth(
            configured=True, reachable=False, error=exc.__class__.__name__
        )


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    database = await _check_database()
    # Not-yet-configured is expected during setup, so it reports ok. A URL that
    # is set but unreachable is a real problem and reports degraded.
    degraded = database.configured and not database.reachable
    return HealthResponse(
        status="degraded" if degraded else "ok",
        environment=settings.environment,
        database=database,
    )
