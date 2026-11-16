"""The actual emails the product sends. Plain and warm, no marketing voice.

Each builder returns (subject, text, html). The text part is what most matters:
every client renders it, and it is what a screen reader reads. The name is
HTML-escaped in the html part because it is user-supplied and would otherwise
let a '<' break the markup.
"""

from __future__ import annotations

from html import escape


def verification_email(name: str, verify_url: str) -> tuple[str, str, str]:
    """Sent on sign-up: welcomes the person and asks them to confirm the email."""
    safe_name = escape(name or "there")
    subject = "Confirm your email to start learning"
    text = (
        f"Hi {name or 'there'},\n\n"
        "Welcome to Silveri Tutor. One quick step before you start: confirm this "
        "is your email by opening the link below.\n\n"
        f"{verify_url}\n\n"
        "If you did not create this account, you can ignore this message and "
        "nothing will happen.\n"
    )
    html = (
        f"<p>Hi {safe_name},</p>"
        "<p>Welcome to Silveri Tutor. One quick step before you start: confirm "
        "this is your email.</p>"
        f'<p><a href="{escape(verify_url)}">Confirm my email</a></p>'
        f"<p>Or paste this link into your browser:<br>{escape(verify_url)}</p>"
        "<p>If you did not create this account, you can ignore this message.</p>"
    )
    return subject, text, html


def account_invite_email(
    name: str, login_email: str, set_password_url: str
) -> tuple[str, str, str]:
    """Sent when an admin creates an account: the login and a set-password link.

    No password is ever put in the email. The link lets the person choose their
    own, so the admin never has to invent or hand one over.
    """
    safe_name = escape(name or "there")
    subject = "You have been added to Silveri Tutor"
    text = (
        f"Hi {name or 'there'},\n\n"
        "An account has been created for you on Silveri Tutor. Your sign-in "
        f"email is {login_email}.\n\n"
        "Set your password with the link below, then sign in. The link works "
        "for 7 days.\n\n"
        f"{set_password_url}\n\n"
        "If you were not expecting this, you can ignore this message.\n"
    )
    html = (
        f"<p>Hi {safe_name},</p>"
        "<p>An account has been created for you on Silveri Tutor. Your sign-in "
        f"email is <strong>{escape(login_email)}</strong>.</p>"
        "<p>Set your password with the link below, then sign in. It works for "
        "7 days.</p>"
        f'<p><a href="{escape(set_password_url)}">Set my password</a></p>'
        f"<p>Or paste this link into your browser:<br>{escape(set_password_url)}</p>"
        "<p>If you were not expecting this, you can ignore this message.</p>"
    )
    return subject, text, html


def reset_password_email(name: str, reset_url: str) -> tuple[str, str, str]:
    """Sent on a forgot-password request: the link to choose a new password."""
    safe_name = escape(name or "there")
    subject = "Reset your Silveri Tutor password"
    text = (
        f"Hi {name or 'there'},\n\n"
        "We got a request to reset your password. Open the link below to "
        "choose a new one. The link works for about an hour.\n\n"
        f"{reset_url}\n\n"
        "If you did not ask for this, you can ignore this message and your "
        "password stays exactly as it is.\n"
    )
    html = (
        f"<p>Hi {safe_name},</p>"
        "<p>We got a request to reset your password. Choose a new one with the "
        "link below. It works for about an hour.</p>"
        f'<p><a href="{escape(reset_url)}">Reset my password</a></p>'
        f"<p>Or paste this link into your browser:<br>{escape(reset_url)}</p>"
        "<p>If you did not ask for this, you can ignore this message and your "
        "password stays exactly as it is.</p>"
    )
    return subject, text, html


def password_changed_email(name: str) -> tuple[str, str, str]:
    """Sent after a successful reset: a plain heads-up that it happened."""
    safe_name = escape(name or "there")
    subject = "Your Silveri Tutor password was changed"
    text = (
        f"Hi {name or 'there'},\n\n"
        "Your password was just changed. If this was you, there is nothing to "
        "do. If it was not, reset your password straight away and tell us.\n"
    )
    html = (
        f"<p>Hi {safe_name},</p>"
        "<p>Your password was just changed. If this was you, there is nothing "
        "to do. If it was not, reset your password straight away and tell us.</p>"
    )
    return subject, text, html


def approval_waiting_email(
    summary: str, where: str, url: str
) -> tuple[str, str, str]:
    """To an approver: something is waiting for them to review."""
    subject = "Something is waiting for your approval"
    text = (
        "Hi,\n\n"
        f"{summary}\n\n"
        f"Review it on the {where}:\n{url}\n"
    )
    html = (
        f"<p>{escape(summary)}</p>"
        f'<p>Review it on the {escape(where)}: '
        f'<a href="{escape(url)}">{escape(url)}</a></p>'
    )
    return subject, text, html


def change_decided_email(
    name: str, approved: bool, what: str, note: str | None
) -> tuple[str, str, str]:
    """To the requester: their change was approved or declined."""
    safe_name = escape(name or "there")
    word = "approved" if approved else "declined"
    subject = f"Your request was {word}"
    note_line = f"\n\nNote from the administrator: {note}" if note else ""
    text = (
        f"Hi {name or 'there'},\n\n"
        f"Your request ({what}) was {word} by your organisation administrator."
        f"{note_line}\n"
    )
    note_html = (
        f"<p>Note from the administrator: {escape(note)}</p>" if note else ""
    )
    html = (
        f"<p>Hi {safe_name},</p>"
        f"<p>Your request (<strong>{escape(what)}</strong>) was {word} by your "
        "organisation administrator.</p>"
        f"{note_html}"
    )
    return subject, text, html


def purchase_receipt_email(
    name: str, lines: list[str], total: str
) -> tuple[str, str, str]:
    """To the buyer: what they just bought."""
    safe_name = escape(name or "there")
    items_text = "\n".join(f"  - {line}" for line in lines)
    subject = "Your Silveri Tutor receipt"
    text = (
        f"Hi {name or 'there'},\n\n"
        "Thank you for your purchase. Here is what you bought:\n\n"
        f"{items_text}\n\n"
        f"Total: {total}\n\n"
        "You can start any of these from your dashboard.\n"
    )
    items_html = "".join(f"<li>{escape(line)}</li>" for line in lines)
    html = (
        f"<p>Hi {safe_name},</p>"
        "<p>Thank you for your purchase. Here is what you bought:</p>"
        f"<ul>{items_html}</ul>"
        f"<p><strong>Total: {escape(total)}</strong></p>"
        "<p>You can start any of these from your dashboard.</p>"
    )
    return subject, text, html


def welcome_email(name: str, app_url: str) -> tuple[str, str, str]:
    """Sent once the email is confirmed: the account is ready."""
    safe_name = escape(name or "there")
    subject = "You are all set on Silveri Tutor"
    text = (
        f"Hi {name or 'there'},\n\n"
        "Your email is confirmed and your account is ready. Sign in and open "
        "any course to start learning with the voice tutor.\n\n"
        f"{app_url}\n"
    )
    html = (
        f"<p>Hi {safe_name},</p>"
        "<p>Your email is confirmed and your account is ready. Sign in and open "
        "any course to start learning with the voice tutor.</p>"
        f'<p><a href="{escape(app_url)}">Go to Silveri Tutor</a></p>'
    )
    return subject, text, html
