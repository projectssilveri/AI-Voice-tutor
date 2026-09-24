"""Security headers on every API response, and no caching of signed-in reads.

Found by testing: no response from this API carried `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy` or `Strict-Transport-Security`, and a
signed-in read (someone's dossier, the audit trail, a training report) came
back with no `Cache-Control` at all, so a shared proxy or the browser's own
cache was free to keep it.

Pure ASGI rather than `BaseHTTPMiddleware`, for two reasons. The audit CSV is
a `StreamingResponse`, and headers have to be added to the start message
without buffering the body. And the voice tutor is a WebSocket, which this must
pass straight through untouched.

Content-Security-Policy is deliberately not set here. This API returns JSON
and files, not pages, so a CSP on it protects nothing; the website sets its
own headers in `frontend/next.config.ts`.
"""

from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

#: Sent on every HTTP response.
ALWAYS = (
    # A JSON body must never be sniffed into something executable.
    (b"x-content-type-options", b"nosniff"),
    # Nothing this API returns belongs in somebody else's frame.
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
)

#: Production only. Browsers ignore HSTS over plain HTTP, and sending it from
#: a local server would be a promise about HTTPS that localhost cannot keep.
HSTS = (b"strict-transport-security", b"max-age=31536000; includeSubDomains")

#: The session cookie's name, as `core.users.cookie_transport` sets it.
SESSION_COOKIE = b"vtlms_session="


class SecurityHeaders:
    def __init__(self, app: ASGIApp, *, hsts: bool = False) -> None:
        self.app = app
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        signed_in = any(
            name == b"cookie" and SESSION_COOKIE in value
            for name, value in scope.get("headers", [])
        )

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {name.lower() for name, _ in headers}
                extra = list(ALWAYS)
                if self.hsts:
                    extra.append(HSTS)
                # Anything read with a session is somebody's data. A route that
                # sets its own Cache-Control keeps it; everything else is not
                # stored anywhere between here and the person who asked.
                if signed_in:
                    extra.append((b"cache-control", b"no-store"))
                headers.extend((k, v) for k, v in extra if k not in present)
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)
