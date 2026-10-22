"""Sending email over SMTP, provider-agnostic and dormant until configured.

No vendor SDK and no new dependency: the standard library speaks SMTP, and any
provider accepts it (a company mailbox, Gmail, Zoho, Mailgun, SendGrid, SES).

The whole module is a no-op until `settings.email_enabled`, so the product runs
unchanged with no credentials. Every send is wrapped, so a mail failure can
never take down the thing that triggered it: a sign-up must not fail because the
mail server was slow or wrong.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import settings

logger = logging.getLogger(__name__)


def _send_blocking(message: EmailMessage) -> None:
    """The blocking SMTP conversation, run off the event loop by `send_email`."""
    host = settings.smtp_host or ""
    port = settings.smtp_port
    if settings.smtp_ssl:
        server: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=20)
    else:
        server = smtplib.SMTP(host, port, timeout=20)
    try:
        server.ehlo()
        if settings.smtp_starttls and not settings.smtp_ssl:
            server.starttls()
            server.ehlo()
        if settings.smtp_user and settings.smtp_password:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(message)
    finally:
        try:
            server.quit()
        except Exception:
            # The mail is already sent or already failed; a messy close is not
            # worth surfacing over whatever the caller was doing.
            pass


async def send_email(
    *, to: str, subject: str, text: str, html: str | None = None
) -> bool:
    """Send one email. Returns whether it was actually sent.

    A no-op that returns False when email is not configured, so callers never
    have to check first. Never raises: a failure is logged and swallowed,
    because the caller is usually mid-signup and the mail is a side effect.
    """
    if not settings.email_enabled:
        logger.info("Email disabled (no SMTP config); skipping send to %s", to)
        return False

    from_addr = settings.smtp_from or settings.smtp_user or ""
    message = EmailMessage()
    message["From"] = formataddr((settings.smtp_from_name, from_addr))
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")

    try:
        await asyncio.to_thread(_send_blocking, message)
        logger.info("Email sent to %s (%s)", to, subject)
        return True
    except Exception:
        logger.exception("Could not send email to %s (%s)", to, subject)
        return False
