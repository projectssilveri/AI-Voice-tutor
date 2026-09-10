"""The audit net: every mutating request is recorded, whether or not anyone
remembered to record it.

Explicit `audit.record` calls carry meaning the middleware cannot infer, and
they are the right tool where the event *is* the point. But relying on them
alone means the trail is only as complete as the last person to remember —
and this codebase has already shipped three fully-written, fully-correct
components that nothing ever called (decisions 52, 86 and 129). A compliance
log that is missing whatever somebody forgot is not a compliance log.

So: explicit events for meaning, this for completeness.

WHAT IS RECORDED. Method, path, status, actor, IP, user agent. Never the
request body — decision 88 holds that no payload is logged, and that matters
more here than anywhere: `POST /auth/login` carries a password and
`POST /assignments/{id}/submit` carries a student's answer.

WHERE IT SITS. Inside the CORS layer. Decision 21 established that Starlette
routes its own error handler above every user middleware, so a 500 raised
outside CORS comes back with no `Access-Control-Allow-Origin` and the browser
reports it as "Failed to fetch" — indistinguishable from the backend being
down. Registration order in `main.py` is what enforces this.
"""

from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.audit import AuditAction
from app.services import audit

logger = logging.getLogger(__name__)

# GET/HEAD/OPTIONS change nothing. Recording every read would multiply the size
# of this table by an order of magnitude and bury the events that matter; reads
# of sensitive data are audited explicitly at the routes that serve them.
_MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Paths whose own handler already records a richer event, so the net would only
# duplicate it. Matched by prefix against the path after the API version.
_HAS_ITS_OWN_EVENT: tuple[str, ...] = (
    "/auth/logout",  # recorded with the actor resolved, in routers/auth.py
)

# Login is special. A SUCCESSFUL login is recorded in core/users.py, where
# fastapi-users has resolved the credentials and the actor is known. A FAILED
# one reaches no hook at all — and a repeated failed login is the single event
# a security review is most likely to ask about, so it must not be the one
# thing the trail is missing.
_LOGIN_PATH = "/auth/login"

# Never audited at all: health checks are machine traffic, and the Razorpay
# webhook is not a user action — payment events are recorded by the handler
# with the order id attached, which is the useful record.
_SKIP: tuple[str, ...] = (
    "/health",
    "/payments/webhook",
)

# Two years. Long enough that "the same browser as last time" stays meaningful
# across a whole compliance period, short enough that an abandoned browser does
# not carry an identifier forever.
_DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2


class AuditMiddleware(BaseHTTPMiddleware):
    """Records mutating requests after the response is produced."""

    def __init__(self, app: ASGIApp, api_prefix: str = "") -> None:
        super().__init__(app)
        self._api_prefix = api_prefix

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        try:
            if self._should_record(request, response):
                await self._write(request, response)
        except Exception as exc:
            # The audit net must never be the reason a request fails. A lost
            # event is bad; a 500 on a successful exam submission is worse.
            logger.warning("Audit middleware failed: %s", exc.__class__.__name__)

        # ISSUE THE DEVICE COOKIE IF THIS BROWSER HAS NONE.
        #
        # Set here, on every response, rather than at sign-in: a failed login
        # is one of the events most worth attributing to a device, and at that
        # point there is no session to hang it off.
        #
        # httpOnly so no script can read it, SameSite=Lax so it does not travel
        # on cross-site requests, and `secure` follows ENVIRONMENT exactly as
        # the session cookie does (decision 11) — otherwise it would not be set
        # at all over plain-HTTP localhost.
        if audit.DEVICE_COOKIE not in request.cookies:
            response.set_cookie(
                audit.DEVICE_COOKIE,
                audit.new_device_id(),
                max_age=_DEVICE_COOKIE_MAX_AGE,
                httponly=True,
                samesite="none" if settings.environment == "production" else "lax",
                secure=settings.environment == "production",
                path="/",
            )

        return response

    def _should_record(self, request: Request, response: Response) -> bool:
        if request.method not in _MUTATING:
            return False

        path = request.url.path
        if any(fragment in path for fragment in _SKIP):
            return False
        if any(fragment in path for fragment in _HAS_ITS_OWN_EVENT):
            return False

        # A successful login already has its own event; a failed one has none.
        if _LOGIN_PATH in path and response.status_code < 400:
            return False

        # 4xx is recorded as well as 2xx: a refused attempt to reach something
        # is exactly what an audit log is asked about afterwards. 5xx is left
        # to the application log, which carries the traceback the audit trail
        # deliberately does not.
        return response.status_code < 500

    async def _write(self, request: Request, response: Response) -> None:
        # `request.state.user` is set by the auth dependency on routes that
        # have one. Absent for an anonymous or unauthenticated call, which is
        # itself worth recording.
        actor = getattr(request.state, "user", None)

        # Set by `require_org_scope` when the route is inside a tenant. Takes
        # precedence over the actor's own organization, so platform staff
        # working in a customer's portal file the event under that CUSTOMER
        # rather than under the platform — where an ordinary admin would read
        # it. `record` falls back to the actor's organization when this is
        # absent, which is right for an ordinary org member's own activity.
        organization_id = getattr(request.state, "organization_id", None)

        path = request.url.path
        if self._api_prefix and path.startswith(self._api_prefix):
            path = path[len(self._api_prefix) :] or "/"

        failed_login = _LOGIN_PATH in path and response.status_code >= 400
        action = AuditAction.LOGIN_FAILED if failed_login else AuditAction.REQUEST

        # A failed login deliberately records the address and the agent but NOT
        # the identifier that was tried. Someone who types their password into
        # the username box is common, and storing that would put a live
        # credential in a table admins can read — which is the opposite of what
        # this table is for. IP and user agent are what answer "is somebody
        # brute-forcing us", which is the real question.
        metadata: dict[str, object] = {"status": response.status_code}
        if not failed_login:
            metadata["method"] = request.method
            metadata["path"] = path

        # `SessionLocal` is None when DATABASE_URL is unset — the app still
        # boots in that state so /health can report it, and an audit write is
        # not the thing to crash on.
        if SessionLocal is None:
            return

        # Its own session, not the request's: the request's session may have
        # been rolled back or already closed by the time the response exists,
        # and the net's whole job is to record the attempt regardless of what
        # happened to the work.
        async with SessionLocal() as session:
            await audit.record_safely(
                session,
                action=action,
                actor=actor,
                organization_id=organization_id,
                ip_address=audit.client_ip(request.headers, request.client),
                device_id=audit.device_id(request.headers, request.cookies),
                user_agent=request.headers.get("user-agent"),
                metadata=metadata,
            )
            await session.commit()
