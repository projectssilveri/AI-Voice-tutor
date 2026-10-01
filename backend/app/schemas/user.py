"""User request/response schemas.

`UserRead` is what leaves the API. It deliberately has no password field of any
kind — the hash must never appear in a response body, and the only way to
guarantee that is for the schema not to know about it.
"""

from __future__ import annotations

import uuid

from fastapi_users import schemas
from pydantic import EmailStr, Field, field_validator

from app.models.user import UserRole
from app.schemas.text import NonBlankName, OptionalNonBlankName


def _clean_phone(value: str | None) -> str | None:
    """Trim a phone number, and treat "cleared to blank" as null.

    An empty string and NULL would otherwise be two different ways to say the
    same thing, and only one of them renders as "not set".
    """
    if value is None:
        return None
    trimmed = " ".join(value.split())
    return trimmed or None


class UserRead(schemas.BaseUser[uuid.UUID]):
    name: str
    role: UserRole
    phone: str | None = None
    # Read-only, and the frontend's cue for the walled garden: an organization
    # member must not be shown prices, Buy buttons or the marketplace nav.
    # Presentation only — `services/access.py` is what actually keeps the two
    # catalogues apart, and it does so whatever the browser renders.
    organization_id: uuid.UUID | None = None


class SessionUser(UserRead):
    """`UserRead` plus what the header needs to draw this person.

    `has_photo` is here so the avatar asks for a picture only when there is
    one. Without it every page requested the photo of an account that had
    none, got a 404, and the browser logged it as a blocked request.
    """

    has_photo: bool = False


class UserCreate(schemas.BaseUserCreate):
    name: NonBlankName
    email: EmailStr

    # `role` is intentionally absent. If it were accepted here, anyone could
    # register as an admin by adding one field to the signup request. Roles are
    # only changed by an existing admin (build-order step 10).


class UserUpdate(schemas.BaseUserUpdate):
    name: OptionalNonBlankName
    # Deliberately unvalidated beyond a length cap. E.164, national formats,
    # extensions and in-country spacing are all legitimate, and a regex that
    # guesses wrong stops someone saving their own number.
    phone: str | None = Field(default=None, max_length=32)
    # PROOF, NOT A FIELD. Checked by `UserManager.update` before a new password
    # is accepted on `PATCH /users/me`, and never written anywhere.
    current_password: str | None = Field(default=None, max_length=256)

    @field_validator("phone")
    @classmethod
    def normalise_phone(cls, value: str | None) -> str | None:
        return _clean_phone(value)

    # Both dicts are what fastapi-users writes onto the row, so the proof is
    # taken out of each. Left in, it would be set on the User object as a
    # stray attribute.
    def create_update_dict(self):
        data = super().create_update_dict()
        data.pop("current_password", None)
        return data

    def create_update_dict_superuser(self):
        data = super().create_update_dict_superuser()
        data.pop("current_password", None)
        return data
