"""Writing to the audit trail.

Two ways in, and both are needed:

  `record(...)`     — an explicit domain event with meaning. "This person
                      submitted exam X", "this admin changed that role". Called
                      from the service or route that knows what happened.

  the middleware    — a net under everything (app/middleware/audit.py). Every
                      mutating request that succeeds is recorded even if nobody
                      remembered to call `record`.

Either alone is insufficient. Explicit calls carry meaning the middleware
cannot infer, and the middleware catches what explicit calls forget — which,
given this codebase has already shipped three fully-written components that
nothing called (decisions 52, 86, 129), is not a hypothetical failure mode.

WHAT NEVER GOES IN. No request bodies, no passwords, no quiz or exam answers,
no transcript text. `metadata` is for identifiers, counts and outcomes: the
event says an exam was submitted and what it scored, never what was written in
it. `redact.py` handles anything sourced from a third party.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent
from app.models.user import User

logger = logging.getLogger(__name__)

# A user agent is attacker-controlled and unbounded; the column is 400 and
# truncating beats losing the event to a DataError.
_MAX_USER_AGENT = 400


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    return trimmed[:limit]


async def record(
    session: AsyncSession,
    *,
    action: str,
    actor: User | None = None,
    actor_id: uuid.UUID | None = None,
    organization_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    device_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    """Append one event. Does NOT commit — it joins the caller's transaction.

    That is deliberate: an event describing something that then failed to save
    would be a lie, and one written in its own transaction would survive a
    rollback of the thing it describes. Flushing without committing means the
    event lives or dies with the change it records.

    `actor` or `actor_id` — the object when the caller has it, the id when it
    only has that. Passing the object avoids a lookup; passing neither is a
    legitimate anonymous event, such as a failed login.
    """
    event = AuditEvent(
        action=action,
        actor_user_id=actor.id if actor is not None else actor_id,
        organization_id=organization_id
        or (getattr(actor, "organization_id", None) if actor is not None else None),
        target_type=target_type,
        target_id=target_id,
        ip_address=_clip(ip_address, 45),
        user_agent=_clip(user_agent, _MAX_USER_AGENT),
        device_id=_clip(device_id, 64),
        meta=metadata or None,
    )
    session.add(event)
    # Flush rather than commit so the row exists for anything later in the same
    # transaction, without deciding on the caller's behalf that the work is done.
    await session.flush()
    return event


async def record_safely(
    session: AsyncSession,
    *,
    action: str,
    **kwargs: Any,
) -> None:
    """`record`, but a failure here never takes down the request.

    For the middleware net and for background paths, where the audit write is
    genuinely secondary to the work: a student who has just finished an exam
    must not see it fail because the trail could not be written.

    NOT for anything a compliance claim rests on. Where the event is the point —
    a role change, a permission grant — use `record`, so a failed write fails
    the operation rather than quietly losing the record of it.
    """
    try:
        await record(session, action=action, **kwargs)
    except Exception as exc:
        # The id, never the payload: this log line is the application log, which
        # decision 88 holds to UUIDs only.
        logger.warning(
            "Audit write failed for action=%s: %s", action, exc.__class__.__name__
        )


#: Name of the cookie carrying the device identifier. Not the session cookie:
#: this one outlives sign-out on purpose, because "the same browser signed in
#: as two different people" is a thing a security review wants to see.
DEVICE_COOKIE = "vtlms_device"


def new_device_id() -> str:
    """A fresh opaque device identifier.

    Random, not derived. The alternative — fingerprinting from canvas, fonts
    and screen metrics — identifies a person across sites they never agreed to
    be tracked on, and browsers are closing it off anyway. A value we issue in
    our own first-party cookie answers the only question an audit trail asks
    ("same browser as last time?") and tells nobody else anything.
    """
    return uuid.uuid4().hex


def device_id(headers: Any, cookies: Any) -> str | None:
    """The device identifier on this request, if the browser has one yet."""
    if not cookies:
        return None
    value = cookies.get(DEVICE_COOKIE)
    return value[:64] if value else None


def client_ip(headers: Any, client: Any) -> str | None:
    """The caller's address, preferring the proxy header when there is one.

    X-Forwarded-For is client-controlled and only trustworthy when a proxy we
    run is known to overwrite it. It is recorded as-is rather than validated:
    an audit trail that drops an address because it was malformed has lost
    evidence, and a forged value is itself worth having on the record.
    """
    forwarded = headers.get("x-forwarded-for") if headers else None
    if forwarded:
        # First entry is the original client; the rest are proxies.
        return forwarded.split(",")[0].strip()[:45]
    return getattr(client, "host", None)
