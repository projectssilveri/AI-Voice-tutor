"""Logging setup.

Errors must carry enough context to debug (which user, which endpoint, what
failed) without ever logging secrets. `REDACTED_KEYS` is the single list of
field names that get masked before a record is emitted.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from app.core.config import settings

REDACTED_KEYS = frozenset(
    {
        "password",
        "password_hash",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "api_key",
        "gemini_api_key",
        "jwt_secret",
        "database_url",
        "ephemeral_token",
        "resumption_handle",
        # Payments. The key secret and the webhook secret are what sign and
        # verify a purchase — anyone holding either can forge a paid order —
        # and a captured signature is enough to replay one callback.
        "razorpay_key_secret",
        "razorpay_webhook_secret",
        "key_secret",
        "webhook_secret",
        "secret",
        "signature",
        "razorpay_signature",
        "x-razorpay-signature",
        # We never touch card data (Razorpay's widget collects it), but a
        # provider payload echoing it back must not land in a log file.
        "card",
        "card_number",
        "cvv",
    }
)

_MASK = "***REDACTED***"


def redact(payload: dict[str, Any]) -> dict[str, Any]:
    """Mask sensitive values before a dict is logged.

    Recurses into nested dicts AND into lists, because provider payloads nest
    credentials inside arrays as readily as inside objects — Razorpay's webhook
    body, for one, wraps each entity in `payload.<type>.entity`. Handling only
    dicts would mask the top level and leak everything one array down.
    """
    return {key: _clean(key, value) for key, value in payload.items()}


def _clean(key: str, value: Any) -> Any:
    if key.lower() in REDACTED_KEYS:
        return _MASK
    if isinstance(value, dict):
        return redact(value)
    if isinstance(value, (list, tuple)):
        # Keep the container type so a logged structure still reads correctly.
        cleaned = [_clean(key, item) for item in value]
        return cleaned if isinstance(value, list) else tuple(cleaned)
    return value


def configure_logging() -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)-8s %(name)s | %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S",
        )
    )

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # uvicorn installs its own handlers; let them propagate to ours instead so
    # every line goes through one formatter.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
