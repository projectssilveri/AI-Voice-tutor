"""Certification exams: the attempt cap, grading, and certificates.

THE RULE (confirmed):

    allowed = cert_exams.default_max_attempts
            + SUM(attempt_grants.extra_attempts_granted for this user + exam)
    used    = COUNT(cert_attempts for this user + exam)

    if used >= allowed:  block
    else:                allow

An attempt is consumed ON SUBMIT — every submitted attempt counts, pass or
fail. Starting an exam and abandoning it costs nothing, so the INSERT happens
at submission time, never at start.

`allowed` is recomputed from the database on every request. A count sent by the
frontend is never trusted, and the value is never cached.

The comparison is `>=`, not `>`. With 3 allowed and 3 used, the student has
already had all three — a 4th must be blocked. This is the off-by-one the brief
warns about, and `tests/test_attempt_limits.py` pins both sides of the boundary.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.certification import (
    AttemptGrant,
    CertAttempt,
    CertExam,
    Certificate,
)
from app.services.concurrency import commit_with_retry

# A score at or above this passes. Config rather than a literal so it can move
# without a code edit.
PASS_MARK = 70.0


class ExamNotFoundError(LookupError):
    pass


class AttemptLimitReachedError(PermissionError):
    """No attempts left. The student must ask an admin for more."""

    def __init__(self, used: int, allowed: int) -> None:
        self.used = used
        self.allowed = allowed
        super().__init__(
            f"You have used all {allowed} attempts for this exam. "
            "Contact an admin to request more."
        )


@dataclass(slots=True)
class AttemptAllowance:
    """A snapshot of one student's standing on one exam."""

    base_attempts: int
    granted_attempts: int
    used_attempts: int

    @property
    def allowed_attempts(self) -> int:
        return self.base_attempts + self.granted_attempts

    @property
    def remaining_attempts(self) -> int:
        # Clamped at zero: a negative remaining count would be nonsense to
        # display, and can happen if an admin ever revokes a grant.
        return max(0, self.allowed_attempts - self.used_attempts)

    @property
    def can_attempt(self) -> bool:
        return self.used_attempts < self.allowed_attempts


async def get_exam(session: AsyncSession, exam_id: uuid.UUID) -> CertExam:
    exam = await session.get(CertExam, exam_id)
    if exam is None:
        raise ExamNotFoundError(str(exam_id))
    return exam


async def get_allowance(
    session: AsyncSession, user_id: uuid.UUID, exam_id: uuid.UUID
) -> AttemptAllowance:
    """Recompute the allowance from scratch. Never cached, never trusted."""
    exam = await get_exam(session, exam_id)

    granted = await session.scalar(
        select(func.coalesce(func.sum(AttemptGrant.extra_attempts_granted), 0)).where(
            AttemptGrant.user_id == user_id,
            AttemptGrant.cert_exam_id == exam_id,
        )
    )

    used = await session.scalar(
        select(func.count())
        .select_from(CertAttempt)
        .where(
            CertAttempt.user_id == user_id,
            CertAttempt.cert_exam_id == exam_id,
        )
    )

    return AttemptAllowance(
        base_attempts=exam.default_max_attempts,
        granted_attempts=int(granted or 0),
        used_attempts=int(used or 0),
    )


async def submit_attempt(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    exam_id: uuid.UUID,
    score: float,
) -> tuple[CertAttempt, Certificate | None]:
    """Record a submitted attempt, if the student still has one.

    The allowance is checked here rather than at the route so the rule cannot
    be bypassed by a future caller that forgets to check.
    """
    # Everything below is inside `build` because it all has to be re-derived if
    # two submissions race: the allowance, the attempt number, and whether a
    # certificate already exists. See services/concurrency.py.
    #
    # This is what makes the cap hold under a double-click. If the request that
    # won the race consumed the last attempt, the retry recomputes the
    # allowance and raises AttemptLimitReachedError — it does not squeeze in an
    # extra attempt, and it does not surface a 500.
    state: dict[str, object] = {}

    async def build() -> None:
        allowance = await get_allowance(session, user_id, exam_id)
        if not allowance.can_attempt:
            raise AttemptLimitReachedError(
                allowance.used_attempts, allowance.allowed_attempts
            )

        passed = score >= PASS_MARK
        attempt = CertAttempt(
            user_id=user_id,
            cert_exam_id=exam_id,
            # used_attempts is the count *before* this one, so the next number
            # is used + 1.
            attempt_number=allowance.used_attempts + 1,
            score=score,
            passed=passed,
        )
        session.add(attempt)

        certificate: Certificate | None = None
        if passed:
            existing = await session.scalar(
                select(Certificate).where(
                    Certificate.user_id == user_id,
                    Certificate.cert_exam_id == exam_id,
                )
            )
            # uq_certificates_user_exam allows only one; passing twice must not
            # raise an integrity error.
            #
            # On a re-pass this stays None ON PURPOSE. The returned certificate
            # means "the one THIS attempt issued", and the router reports it to
            # the student as "Your certificate has been issued." Handing back
            # the pre-existing row made a second pass announce an issue that
            # never happened. The row itself was never duplicated — the unique
            # constraint saw to that — so this was the API describing the
            # database wrongly, not corrupting it. Whether a certificate exists
            # at all is a separate question, and `standing.passed` answers it.
            if existing is None:
                certificate = Certificate(user_id=user_id, cert_exam_id=exam_id)
                session.add(certificate)

        state["attempt"] = attempt
        state["certificate"] = certificate

    await commit_with_retry(session, build, description="certification attempt")

    attempt = state["attempt"]
    certificate = state["certificate"]
    await session.refresh(attempt)
    if certificate is not None:
        await session.refresh(certificate)
    return attempt, certificate


async def grant_extra_attempts(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    exam_id: uuid.UUID,
    granted_by: uuid.UUID,
    extra: int,
    reason: str | None,
) -> AttemptGrant:
    """Admin grants extra attempts.

    Grants accumulate rather than replace: two grants of 1 give two extra
    attempts. Each row is kept so the admin history stays auditable.
    """
    if extra < 1:
        raise ValueError("Must grant at least one extra attempt.")

    grant = AttemptGrant(
        user_id=user_id,
        cert_exam_id=exam_id,
        extra_attempts_granted=extra,
        granted_by=granted_by,
        reason=reason,
    )
    session.add(grant)
    await session.commit()
    await session.refresh(grant)
    return grant


async def list_attempts(
    session: AsyncSession, user_id: uuid.UUID, exam_id: uuid.UUID
) -> list[CertAttempt]:
    result = await session.execute(
        select(CertAttempt)
        .where(
            CertAttempt.user_id == user_id,
            CertAttempt.cert_exam_id == exam_id,
        )
        .order_by(CertAttempt.attempt_number.desc())
    )
    return list(result.scalars().all())


async def list_exams_for_course(
    session: AsyncSession, course_id: uuid.UUID
) -> list[CertExam]:
    result = await session.execute(
        select(CertExam).where(CertExam.course_id == course_id).order_by(CertExam.title)
    )
    return list(result.scalars().all())


async def get_certificate(
    session: AsyncSession, user_id: uuid.UUID, exam_id: uuid.UUID
) -> Certificate | None:
    return await session.scalar(
        select(Certificate).where(
            Certificate.user_id == user_id,
            Certificate.cert_exam_id == exam_id,
        )
    )
