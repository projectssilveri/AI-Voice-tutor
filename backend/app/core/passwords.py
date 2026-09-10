"""What counts as an acceptable password.

THE GAP THIS FILLS. `UserManager` never overrode `validate_password`, and
fastapi-users' default implementation accepts anything — a single character, a
space, the user's own email address. The sign-up form asked for eight
characters, so the rule existed only in the browser, and the browser is not
where a rule lives: `POST /auth/register` with `{"password": "a"}` created a
real account. Every path that sets a password goes through here now — public
sign-up, an admin creating an account, an org admin adding a member, and a
reset.

THE RULES, in full: eight characters, one digit, one special character. That is
the whole policy, and it is deliberately identical to the list the sign-up form
shows. Anything enforced here that is NOT on that list produces the worst
outcome a sign-up form has — every requirement ticked green and the submit
still refused — so the two are kept in step on purpose.

WHAT IS DELIBERATELY NOT HERE, and the trade each one carries:

  * A COMMON-PASSWORD BLOCKLIST. Removed on request. It is the check that
    stopped `password`, `qwerty123` and the rest, and without it `Password1!`
    is accepted — it satisfies all three rules. Worth restoring if
    credential-stuffing ever shows up in the logs; `git log` on this file has
    the list.
  * A NAME/EMAIL ECHO CHECK. Also removed. It was the most arbitrary of the
    set — somebody called Sam could not put "sam" anywhere — and it turned away
    strong passphrases for containing an ordinary word.
  * A MINIMUM VARIETY OF CHARACTERS. Removed for the reason at the top: it was
    invisible on the form, so `aaaa1!aa` ticked every box and was then refused.

The digit and symbol requirements are themselves a PRODUCT DECISION worth
knowing the trade on. NIST SP 800-63B says verifiers "shall not impose
composition rules", because in practice they push people towards `Password1!`
— a small, predictable set of substitutions — while blocking long memorable
passphrases that are harder to guess. Most consumer sites require them anyway
and people expect them; that expectation is why they are here.

None of this is a substitute for rate limiting on the login route, which is
what actually stops guessing at scale.
"""

from __future__ import annotations

#: Shorter than this is guessable however clever it looks. Eight is the floor
#: the sign-up form has always shown; the backend now agrees with it.
MINIMUM_LENGTH = 8

#: Argon2 has no practical upper bound, but an unbounded field is a way to make
#: the server do expensive work on a large input. 128 is far past any real
#: passphrase.
MAXIMUM_LENGTH = 128

#: What the sign-up form lists, in order, with a live tick beside each. Kept
#: here so the screen and the server describe the same rules — a checklist
#: showing anything other than what is enforced is worse than no checklist.
REQUIREMENTS = (
    f"At least {MINIMUM_LENGTH} characters",
    "At least one number (0-9)",
    "At least one special character (!@#$...)",
)

class WeakPassword(ValueError):
    """Raised with a message written for the person choosing the password."""


def check(password: str, *, email: str | None = None, name: str | None = None) -> None:
    """Raise `WeakPassword` if this one should not be accepted.

    Messages say what to do, not what went wrong: "Use at least 8 characters"
    rather than "Password too short". Somebody stuck at a sign-up form wants
    the instruction.

    `email` and `name` are still accepted so every caller keeps working, and
    are deliberately unused: the rule that read them has gone.
    """
    if not password:
        raise WeakPassword("Choose a password")

    if len(password) < MINIMUM_LENGTH:
        raise WeakPassword(f"Use at least {MINIMUM_LENGTH} characters")

    if len(password) > MAXIMUM_LENGTH:
        raise WeakPassword(f"Keep it under {MAXIMUM_LENGTH} characters")

    if password.strip() != password:
        # A leading or trailing space is almost always a paste accident, and it
        # is the sort of thing that locks somebody out of their own account the
        # next day when they type it without.
        raise WeakPassword("Remove the space at the start or end")

    if not password.strip():
        raise WeakPassword("A password cannot be only spaces")

    if not any(character.isdigit() for character in password):
        raise WeakPassword("Add at least one number")

    if not any(not character.isalnum() for character in password):
        raise WeakPassword("Add at least one special character, such as ! or @")

