"""Email notices for the approval queues and completed purchases.

Dormant and best-effort. Every send goes through `services.email`, which is a
no-op until SMTP is configured, so these do nothing with no credentials. Nothing
here ever raises: a notice is a side effect of an action that has ALREADY been
committed, so it must not undo it, and these are only ever called after the
caller commits. Recipients are read from committed data, so a post-commit
session sees them.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.services import email, email_messages

logger = logging.getLogger(__name__)


async def _org_admins(session: AsyncSession, organization_id: uuid.UUID) -> list[User]:
    result = await session.execute(
        select(User).where(
            User.organization_id == organization_id,
            User.role == UserRole.ORG_ADMIN,
            User.is_active.is_(True),
            User.closed_at.is_(None),
        )
    )
    return list(result.scalars().all())


async def _super_admins(session: AsyncSession) -> list[User]:
    result = await session.execute(
        select(User).where(
            User.role == UserRole.SUPER_ADMIN,
            User.is_active.is_(True),
            User.closed_at.is_(None),
        )
    )
    return list(result.scalars().all())


async def _send_to(users: list[User], subject: str, text: str, html: str) -> None:
    for user in users:
        if user.email:
            await email.send_email(
                to=user.email, subject=subject, text=text, html=html
            )


def _admin_url(path: str) -> str:
    return f"{settings.frontend_base_url.rstrip('/')}{path}"


async def org_change_requested(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    actor_name: str,
    action: str,
    label: str,
) -> None:
    """Tell the organisation's admins a branch or department change is waiting."""
    if not settings.email_enabled:
        return
    try:
        admins = await _org_admins(session, organization_id)
        if not admins:
            return
        org = await session.get(Organization, organization_id)
        slug = org.slug if org else ""
        summary = f"{actor_name} asked to {action} {label}."
        subject, text, html = email_messages.approval_waiting_email(
            summary, "People page", _admin_url(f"/org/{slug}/admin")
        )
        await _send_to(admins, subject, text, html)
    except Exception:
        logger.exception(
            "Could not send change-requested notice (org=%s)", organization_id
        )


async def org_change_decided(
    session: AsyncSession,
    *,
    requested_by: uuid.UUID,
    approved: bool,
    label: str,
    note: str | None,
) -> None:
    """Tell the requester their change was approved or declined."""
    if not settings.email_enabled:
        return
    try:
        requester = await session.get(User, requested_by)
        if requester is None or not requester.email:
            return
        subject, text, html = email_messages.change_decided_email(
            requester.name, approved, label, note
        )
        await email.send_email(
            to=requester.email, subject=subject, text=text, html=html
        )
    except Exception:
        logger.exception("Could not send change-decided notice (user=%s)", requested_by)


async def account_approval_requested(
    session: AsyncSession, *, subject_name: str
) -> None:
    """Tell the super admins a platform admin's new organisation admin is waiting."""
    if not settings.email_enabled:
        return
    try:
        admins = await _super_admins(session)
        if not admins:
            return
        summary = (
            f"A new organisation administrator account for {subject_name} is "
            "waiting for your approval."
        )
        subject, text, html = email_messages.approval_waiting_email(
            summary, "Admin approvals page", _admin_url("/admin")
        )
        await _send_to(admins, subject, text, html)
    except Exception:
        logger.exception("Could not send account-approval notice")


async def course_review_requested(
    session: AsyncSession, *, course_title: str
) -> None:
    """Tell the super admins a course has been submitted for approval."""
    if not settings.email_enabled:
        return
    try:
        admins = await _super_admins(session)
        if not admins:
            return
        summary = f'The course "{course_title}" is waiting for your approval.'
        subject, text, html = email_messages.approval_waiting_email(
            summary, "Course approvals page", _admin_url("/admin")
        )
        await _send_to(admins, subject, text, html)
    except Exception:
        logger.exception("Could not send course-review notice")


def _money(amount_minor: int, currency: str) -> str:
    major = amount_minor / 100
    if (currency or "INR").upper() == "INR":
        return f"₹{major:,.2f}"
    return f"{major:,.2f} {currency}"


async def purchase_receipt_for_orders(
    session: AsyncSession, *, user: User, orders: list
) -> None:
    """Send the buyer a receipt once their orders are paid.

    Reachable only when payments are configured, so it is untested in practice
    while Razorpay is off. Called AFTER the payment is committed, dormant
    without SMTP, and best-effort, so it can never affect a payment.
    """
    if not settings.email_enabled or not user.email or not orders:
        return
    try:
        from app.models.course import Course

        lines: list[str] = []
        total = 0
        currency = "INR"
        for order in orders:
            total += order.amount_minor
            currency = order.currency or currency
            if order.course_id is not None:
                course = await session.get(Course, order.course_id)
                name = course.title if course else "Course"
            else:
                name = "Subscription plan"
            lines.append(f"{name} - {_money(order.amount_minor, order.currency)}")
        subject, text, html = email_messages.purchase_receipt_email(
            user.name, lines, _money(total, currency)
        )
        await email.send_email(
            to=user.email, subject=subject, text=text, html=html
        )
    except Exception:
        logger.exception("Could not send purchase receipt to %s", user.email)
