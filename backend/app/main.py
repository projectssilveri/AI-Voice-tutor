"""FastAPI application factory.

This is the only backend. Next.js is frontend-only and talks to this service
over HTTP for regular requests and over WebSocket for voice sessions.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.logging import configure_logging
from app.db.session import dispose_engine
from app.middleware import AuditMiddleware, RejectNulBytes
from app.routers import (
    admin,
    admin_bundles,
    admin_refunds,
    admin_reviews,
    admin_suspensions,
    admin_users,
    analytics,
    assignments,
    audit_log,
    auth,
    cart,
    cert_exams,
    courses,
    enrollments,
    health,
    materials,
    messages,
    modules,
    org_content,
    org_portal,
    organizations,
    payments,
    profile,
    public,
    quizzes,
    reports,
    subscriptions,
    voice,
)
from app.schemas import ErrorResponse

logger = logging.getLogger(__name__)


def _error_response(status_code: int, detail: str, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(detail=detail, code=code).model_dump(),
    )


async def _catch_unhandled(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Turn any unhandled error into structured JSON, inside the CORS layer."""
    try:
        return await call_next(request)
    except Exception:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _error_response(500, "Internal server error.", "internal_error")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    logger.info(
        "Starting Voice Tutor LMS API (env=%s, db_configured=%s)",
        settings.environment,
        bool(settings.database_url),
    )
    yield
    await dispose_engine()
    logger.info("Shutdown complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Voice Tutor LMS API",
        version="0.1.0",
        description=(
            "Unified backend for the voice-first AI tutor LMS: auth, courses, "
            "quizzes, certification, admin, and Gemini Live voice sessions."
        ),
        lifespan=lifespan,
        # Docs stay off in production so the schema isn't public by default.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
    )

    # Order matters. `add_middleware` puts the most recently added outermost, so
    # CORS is registered *last* in order to wrap the catch-all below.
    #
    # Starlette routes the `Exception` handler through ServerErrorMiddleware,
    # which sits above every user middleware including CORS. A 500 produced
    # there therefore comes back with no `Access-Control-Allow-Origin`, and the
    # browser surfaces it as an opaque "Failed to fetch" rather than a 500 —
    # which hides real server errors during development. Catching unhandled
    # errors *inside* CORS means the response still gets its CORS headers.
    app.add_middleware(BaseHTTPMiddleware, dispatch=_catch_unhandled)

    # The audit net, registered between the catch-all and CORS so it is inside
    # both. Inside the catch-all because a request that 500s should still leave
    # a trace of having been attempted; inside CORS for the reason above.
    app.add_middleware(AuditMiddleware, api_prefix=settings.api_v1_prefix)

    # ABOVE THE AUDIT NET, so a refused request is still recorded as attempted,
    # and below the catch-all. A NUL byte in a query parameter reached asyncpg,
    # which refuses to bind one, and nine endpoints answered 500 to a URL any
    # signed-in person could type. See middleware/nul_bytes.py.
    app.add_middleware(RejectNulBytes)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    _register_exception_handlers(app)

    # /health sits at the root so uptime checks don't need to know the API
    # version prefix; everything else is versioned.
    app.include_router(health.router)

    # BEFORE the loop below, and that ordering is load-bearing. `/org/mine`
    # answers "which organization am I in", so it cannot sit under the
    # `/org/{slug}` prefix the rest of the portal uses — and FastAPI matches
    # routes in registration order, so registering it after would let
    # `/org/{slug}` swallow it with slug="mine" and answer 404 for everyone.
    app.include_router(org_portal.mine_router, prefix=settings.api_v1_prefix)

    for module in (
        public,
        auth,
        cart,
        courses,
        modules,
        materials,
        enrollments,
        quizzes,
        assignments,
        cert_exams,
        payments,
        subscriptions,
        profile,
        reports,
        analytics,
        admin,
        admin_bundles,
        admin_refunds,
        admin_reviews,
        admin_suspensions,
        admin_users,
        audit_log,
        messages,
        organizations,
        org_portal,
        org_content,
        voice,
    ):
        app.include_router(module.router, prefix=settings.api_v1_prefix)

    # /users/* lives beside /auth/* but is its own router.
    app.include_router(auth.users_router, prefix=settings.api_v1_prefix)

    return app


def _register_exception_handlers(app: FastAPI) -> None:
    """Every failure leaves as structured JSON — never a raw stack trace."""

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        return _error_response(exc.status_code, str(exc.detail), "http_error")

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # The field-level errors are safe to return; the raw input is not, so
        # it is dropped rather than echoed back.
        return JSONResponse(
            status_code=422,
            content={
                "detail": "Request validation failed.",
                "code": "validation_error",
                "errors": [
                    {"loc": list(err["loc"]), "msg": err["msg"], "type": err["type"]}
                    for err in exc.errors()
                ],
            },
        )

    # Backstop only — `_catch_unhandled` above handles these first and does so
    # inside CORS. This stays registered so a failure in the middleware itself
    # still cannot return a stack trace to the client.
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _error_response(500, "Internal server error.", "internal_error")


app = create_app()
