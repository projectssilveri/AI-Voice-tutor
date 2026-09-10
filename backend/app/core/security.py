"""Password hashing and JWT helpers.

Argon2id via pwdlib — the same primitive fastapi-users uses, so hashes written
here verify there and vice versa. No hand-rolled crypto anywhere in this file.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.config import settings

_password_hash = PasswordHash((Argon2Hasher(),))

JWT_ALGORITHM = "HS256"


def hash_password(plain_password: str) -> str:
    return _password_hash.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    valid, _ = _password_hash.verify_and_update(plain_password, password_hash)
    return valid


def _require_jwt_secret() -> str:
    if not settings.jwt_secret:
        raise RuntimeError(
            "JWT_SECRET is not set. Generate one with "
            "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"` "
            "and add it to backend/.env"
        )
    return settings.jwt_secret


def create_access_token(subject: str, extra_claims: dict[str, Any] | None = None) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(seconds=settings.jwt_lifetime_seconds),
        **(extra_claims or {}),
    }
    return jwt.encode(payload, _require_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and verify a token. Raises jwt.PyJWTError on any failure."""
    return jwt.decode(token, _require_jwt_secret(), algorithms=[JWT_ALGORITHM])
