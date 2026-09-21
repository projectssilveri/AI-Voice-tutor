"""A NUL byte anywhere in a request is a 500, and there are two ways in.

FOUND BY TESTING, twice.

FIRST, THE URL. `GET /admin/users?q=a%00b` answered "Internal server error".
So did eight others:

    /admin/users?q=            /admin/audit?q=
    /admin/audit?action=       /admin/audit?ip_address=
    /admin/audit?path=         /admin/audit/actors?q=
    /admin/messages?q=         /messages/recipients?q=
    /reports/training?search=

THEN THE BODY, which the first version of this file did not cover. A JSON
payload carrying a unicode-escaped NUL decodes to a real one and reaches the
database the same way, so `POST /messages` with five thousand of them in the
body answered 500.

WHY. Postgres text cannot hold a NUL, and asyncpg refuses to send one rather
than silently truncating: it raises `ValueError: A string literal cannot
contain NUL characters` while binding the parameter. Nothing catches that, so
it comes out as a 500.

WHY IT MATTERS. A 500 is never the right answer to a malformed request. Any
signed-in person could produce one on demand, which fills the error log with
noise that looks like a fault in the application and buries the faults that
are. It is also a sign of untrusted input reaching the driver unchecked.

WHY HERE AND NOT IN THE HANDLERS. The nine URL cases are the ones that happen
to reach a parameterised query today, and the body case is every string field
in the API. A tenth appears the next time somebody writes a search box or a
text area. There is no legitimate NUL in an HTTP request to this service, so it
is refused once, at the door.

400 rather than 422: the request is malformed at the transport level, not
semantically invalid at the field level.

A NOTE ON THE CONSTANTS BELOW. They are built with `chr()` and string
concatenation rather than written as escapes. Ruff's formatter rewrites an
escape sequence inside a literal into the character it denotes, which for this
particular character puts a real NUL in the source and stops Python importing
the file at all. Learned the hard way, one restart ago.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

#: The character itself, and the percent-encoding a browser sends for it.
NUL = chr(0)
NUL_PERCENT = "%" + "00"

#: In a JSON body it arrives one of two ways: as the raw byte inside a string,
#: or as a unicode escape in the source text. Both are checked against the
#: bytes, before any parsing, so a payload that would not parse anyway does not
#: need decoding first.
NUL_BYTE = NUL.encode()
NUL_ESCAPE = ("\\" + "u0000").encode()

#: Only methods that carry a body. A GET body is never read.
_WITH_BODY = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: Uploads are binary and legitimately full of NULs: a PNG's signature has one
#: in its second byte. They are checked by magic number in `services/avatars`
#: and `services/materials`, which is the check that belongs to them.
_BINARY = (
    "multipart/form-data",
    "application/octet-stream",
    "image/",
    "application/pdf",
)


class RejectNulBytes(BaseHTTPMiddleware):
    """Refuse any request carrying a NUL in its path, query string or body."""

    async def dispatch(self, request: Request, call_next) -> Response:
        target = request.url.path + "?" + (request.url.query or "")
        if NUL in target or NUL_PERCENT in target.lower():
            return self._refuse()

        if request.method in _WITH_BODY:
            content_type = request.headers.get("content-type", "").lower()
            if not any(kind in content_type for kind in _BINARY):
                # Reading the body here consumes the ASGI receive channel, so
                # it is replayed for whatever runs next. Without the replay the
                # route downstream sees an empty body and answers 422 to every
                # request that has one.
                body = await request.body()
                if NUL_BYTE in body or NUL_ESCAPE in body.lower():
                    return self._refuse()

                async def replay() -> dict:
                    return {
                        "type": "http.request",
                        "body": body,
                        "more_body": False,
                    }

                request._receive = replay

        return await call_next(request)

    @staticmethod
    def _refuse() -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={
                # The same shape as every other error this API returns, so a
                # client needs no special case for it.
                "detail": "That request contains a character we cannot store.",
                "code": "bad_request",
            },
        )
