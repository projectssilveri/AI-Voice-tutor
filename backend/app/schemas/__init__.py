"""Pydantic request/response models.

Every route takes and returns one of these — no raw dicts cross the API
boundary. Populated per domain in later build-order steps.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    """Base for response schemas built from ORM instances."""

    model_config = ConfigDict(from_attributes=True)


class ErrorResponse(BaseModel):
    """The single error shape every failing endpoint returns.

    Structured and predictable so the frontend never has to parse a stack
    trace — see the global handlers in main.py.
    """

    detail: str
    code: str | None = None


__all__ = ["ErrorResponse", "ORMModel"]
