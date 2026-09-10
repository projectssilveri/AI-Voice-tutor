"""One live voice session per student.

THE COST THIS EXISTS FOR. Opening the same module in five tabs opened five
Gemini Live sessions, each billed by the minute against our key, and nothing in
the product needs more than one at a time. The organisation AI budget
(`services/limits.assert_ai_available`) caps a customer's monthly total, but it
does nothing about one person quietly running four sessions in parallel inside
that allowance — they simply burn it four times as fast.

TAKE OVER, DO NOT REFUSE. Both cap the bill identically; the difference is what
happens to the person.

The realistic cause of a second session is not abuse, it is a stale tab: one
left open in the background, a laptop that slept, a page navigated away from
while the socket was still up. Refusing would lock a student out of their own
lesson because of a ghost tab they may not be able to find, and leave them
waiting out Gemini's ~10-minute connection cap before they could start again.
Taking over means the newest tab always wins, which is the one the person is
actually looking at.

The displaced tab is TOLD why. Closing a socket with no explanation looks
exactly like the network dropping, and the student would simply press start
again — which is the loop this is meant to end.

SCOPE. This registry is per-process. One uvicorn worker is what
`docker-compose.yml` and the current deployment run, so it holds today; behind
several workers a student could still hold one session per worker. The database
sweep below is what keeps the ACCOUNTING correct regardless, and a
cross-process limiter would need Redis or a database advisory lock — which is a
bigger decision than this, and not one to make silently.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Protocol

logger = logging.getLogger(__name__)


class Closeable(Protocol):
    """The bit of a WebSocket this module needs.

    A protocol rather than the concrete class so the registry can be tested
    without a running server.
    """

    async def send_json(self, data: dict) -> None: ...

    async def close(self, code: int = 1000) -> None: ...


#: Everyone currently holding a live session, and the socket they hold it on.
#: One entry per user by construction — taking over replaces it.
_active: dict[uuid.UUID, Closeable] = {}

#: Guards the read-modify-write below. Two sockets for the same student
#: arriving together would otherwise both read "nobody there" and both register,
#: leaving one session unregistered and un-supersedable — which is the exact
#: leak this module exists to prevent.
_lock = asyncio.Lock()

#: Sent to the tab being displaced. A distinct type rather than a generic error
#: so the client can say "you started this lesson in another tab" instead of
#: "something went wrong".
SUPERSEDED = {
    "type": "superseded",
    "message": (
        "This lesson was opened in another tab or window, so this one has "
        "stopped. Only one voice session can run at a time."
    ),
}


async def claim(user_id: uuid.UUID, websocket: Closeable) -> bool:
    """Register this socket as the student's session, displacing any other.

    Returns True when an earlier session was taken over, so the caller can log
    it. The new socket is registered either way.
    """
    async with _lock:
        previous = _active.get(user_id)
        _active[user_id] = websocket

    if previous is None or previous is websocket:
        return False

    # Outside the lock: telling the old socket may block on a dead connection,
    # and holding the lock through that would stall every other student.
    try:
        await previous.send_json(SUPERSEDED)
    except Exception:
        # Already gone. Nothing to say to it, and nothing worth logging — a
        # closed socket is the ordinary case here.
        pass
    try:
        # 1000, not 1008: this is a normal closure the client should not treat
        # as a policy violation or a reason to retry.
        await previous.close(code=1000)
    except Exception:
        pass

    logger.info("Voice session for user %s taken over by a newer tab", user_id)
    return True


async def release(user_id: uuid.UUID, websocket: Closeable) -> None:
    """Drop this socket's claim, if it still holds one.

    Checks identity before deleting. Without that, a tab that was ALREADY
    displaced would remove the claim belonging to the tab that displaced it on
    its way out, and the newer session would stop being protected.
    """
    async with _lock:
        if _active.get(user_id) is websocket:
            del _active[user_id]


def holder(user_id: uuid.UUID) -> Closeable | None:
    """Whoever currently holds this student's session. For tests."""
    return _active.get(user_id)


def count() -> int:
    """How many live sessions this process is holding. For tests and health."""
    return len(_active)
