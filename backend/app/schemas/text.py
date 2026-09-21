"""Text a person typed, with the outer whitespace taken off.

`Field(min_length=1)` counts CHARACTERS, and a space is a character. So every
required name, title and question in this API accepted `"   "` and stored it.
Found by generating a validation case per field from the OpenAPI schema and
sending all 536 of them:

    POST /admin/organizations  {"name": "   "}  ->  201, stored as ""
    POST /courses              {"title": "   "} ->  201, stored as "   "
    POST /auth/register        {"name": "   "}  ->  201

The organisation is the worst of the three: `name` is stripped somewhere on the
way to the database, so a customer record was created with a genuinely empty
name, and every screen that lists customers had a blank row on it.

`schemas/assignment.py` already had this rule, written out by hand on two
fields, after a student submitted a space and it was scored and queued for
review as though they had answered. The rule was right and the other seventeen
fields never got it, which is what a rule living in one file does.

STRIPPED, NOT JUST REJECTED. A title typed with a trailing space is a title,
not an error, and storing the space makes two records that look identical sort
and compare as different.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, Field


def _not_blank(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        # The sentence a person reads. Pydantic puts it in the `errors` list
        # against the field that caused it, so it does not need to name it.
        raise ValueError("This cannot be blank.")
    return cleaned


def _not_blank_if_given(value: str | None) -> str | None:
    """Absent means "leave it alone". Present and blank is a mistake.

    A PATCH that sends `null` is asking for no change, and a PATCH that sends
    `"   "` is somebody who typed spaces into the box. Quietly turning the
    second into an empty name is how a customer ended up with a blank one.
    """
    if value is None:
        return None
    return _not_blank(value)


#: A required line of text: a name, a title, a subject.
NonBlank = Annotated[str, Field(min_length=1), AfterValidator(_not_blank)]

#: The same, capped at the length of a `String(255)` column.
NonBlankName = Annotated[
    str, Field(min_length=1, max_length=255), AfterValidator(_not_blank)
]

#: A required block of prose: a question, a prompt, the body of a message.
#: Capped by the caller, because those caps differ and are worth reading at the
#: field rather than hidden in here.
NonBlankText = NonBlank

#: Optional text on a PATCH. Absent means "leave it alone"; present and blank
#: is a mistake, so it is refused rather than quietly clearing the field.
OptionalNonBlankName = Annotated[
    str | None,
    Field(default=None, max_length=255),
    AfterValidator(_not_blank_if_given),
]

#: Optional prose on a PATCH, with no length cap of its own.
OptionalNonBlankText = Annotated[
    str | None, Field(default=None), AfterValidator(_not_blank_if_given)
]
