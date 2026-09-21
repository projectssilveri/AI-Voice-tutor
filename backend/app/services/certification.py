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
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.certification import (
    AttemptGrant,
    CertAttempt,
    CertExam,
    Certificate,
)
from app.models.course import Module
from app.models.enrollment import ModuleProgress, ProgressStatus
from app.models.user import User
from app.services.concurrency import commit_with_retry

# A score at or above this passes. Config rather than a literal so it can move
# without a code edit.
PASS_MARK = 70.0


@dataclass(frozen=True)
class CourseStanding:
    """How far through the course this person is, and whether the exam opens.

    NOTHING GATED THE EXAM BEFORE THIS. A student could open any course, click
    through to the last module without reading a word, reach the certification
    page, pass and download a certificate while their progress still read 0 of
    4 modules. Reported as issues 13, 14 and 20, and reproduced exactly as
    written.
    """

    modules_total: int
    modules_completed: int
    unlocked: bool
    #: Said in full on screen, so a locked exam explains itself rather than
    #: looking broken.
    reason: str | None


async def course_standing(
    session: AsyncSession,
    user: User,
    course_id: uuid.UUID,
) -> CourseStanding:
    """Whether `user` has finished enough of `course_id` to sit its exam.

    The bar is every module, not a percentage. A certificate says the person
    completed the course; anything less than all of it makes that sentence
    untrue, and a threshold invites the question of which modules were the
    skippable ones.

    ONE ANSWER, FOR EVERYBODY. There used to be a `staff_exempt` flag, on by
    default, so staff could READ a paper for a course they had not finished
    while nobody could SUBMIT one. The intention was fair — an author has to be
    able to open the exam on a course they are writing — and the result was
    not: the cover page offered Start, took them through full screen, a
    proctor, an attempt counter and ten questions, and refused at the last step
    with a sentence about finishing a course the same screen had just called 4
    of 4 complete. Reported from a real account.

    The submit side could not move. A certificate is checkable in public at
    /verify, and one issued for a course nobody finished is a false statement
    about a real person. So the read side came down to meet it.

    AN AUTHOR IS NOT LOCKED OUT. The course authoring screen lists every
    question WITH its correct answer, and has since certification was built —
    `list_questions_with_answers`. Reviewing a paper never needed this flag;
    it needed the screen that already existed.
    """
    total = await session.scalar(
        select(func.count()).select_from(Module).where(Module.course_id == course_id)
    ) or 0

    done = await session.scalar(
        select(func.count())
        .select_from(ModuleProgress)
        .join(Module, Module.id == ModuleProgress.module_id)
        .where(
            Module.course_id == course_id,
            ModuleProgress.user_id == user.id,
            ModuleProgress.status == ProgressStatus.COMPLETED,
        )
    ) or 0

    # A course with no modules yet. Nothing to complete, so nothing to withhold
    # — and refusing here would lock an exam nobody could ever unlock.
    if total == 0:
        return CourseStanding(0, 0, True, None)

    if done >= total:
        return CourseStanding(total, done, True, None)

    left = total - done
    return CourseStanding(
        modules_total=total,
        modules_completed=done,
        unlocked=False,
        reason=(
            f"Finish the course first. You have completed {done} of {total} "
            f"modules; {left} to go before the exam opens."
        ),
    )


class CourseIncompleteError(PermissionError):
    """The exam is locked because the course is not finished."""

    def __init__(self, standing: CourseStanding) -> None:
        super().__init__(standing.reason or "Finish the course first.")
        self.standing = standing


async def assert_course_complete(
    session: AsyncSession,
    user: User,
    course_id: uuid.UUID,
) -> CourseStanding:
    """Raise unless the exam may be sat.

    Nobody opens the paper, and nobody is handed a credential, for a course
    they did not complete — whatever their job title. The routes that read the
    paper and the route that issues the certificate now ask this one question
    and get one answer.
    """
    standing = await course_standing(session, user, course_id)
    if not standing.unlocked:
        raise CourseIncompleteError(standing)
    return standing


class NoOpenAttemptError(RuntimeError):
    """Submitted without an open paper.

    The client called out of order: the paper is fetched first, and fetching it
    is what spends the attempt. Scoring a submission with nothing open would
    record a sitting nobody was charged for.
    """

    def __init__(self) -> None:
        super().__init__(
            "This exam is not open. Start it again from the exam page."
        )


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


async def open_attempt(session: AsyncSession, *, user_id: uuid.UUID, exam_id: uuid.UUID) -> CertAttempt:
    """Hand over a paper, spending an attempt, or hand back the open one.

    THIS IS WHERE AN ATTEMPT IS SPENT, as of migration 0026. It used to be
    spent at submission, which left the questions free to read as often as
    anybody liked.

    RESUMING IS NOT A SECOND ATTEMPT. A student who opens a paper and closes
    the tab, or whose laptop dies, comes back to the one they already paid for.
    Without that, a misclick costs a third of an allowance, and the first thing
    anybody would learn is not to click Start.

    Wrapped in the same retry as submission: two tabs pressing Start together
    both see no open attempt, and the partial unique index decides which one
    wins. The loser recomputes and finds the row the winner made.
    """
    state: dict[str, object] = {}

    async def build() -> None:
        existing = await session.scalar(
            select(CertAttempt).where(
                CertAttempt.user_id == user_id,
                CertAttempt.cert_exam_id == exam_id,
                CertAttempt.submitted_at.is_(None),
            )
        )
        if existing is not None:
            state["attempt"] = existing
            return

        allowance = await get_allowance(session, user_id, exam_id)
        if not allowance.can_attempt:
            raise AttemptLimitReachedError(
                allowance.used_attempts, allowance.allowed_attempts
            )

        attempt = CertAttempt(
            user_id=user_id,
            cert_exam_id=exam_id,
            attempt_number=allowance.used_attempts + 1,
            score=0,
            passed=False,
        )
        session.add(attempt)
        state["attempt"] = attempt

    await commit_with_retry(session, build, description="opening a certification paper")
    attempt = state["attempt"]
    await session.refresh(attempt)
    return attempt


#: Departures allowed before the attempt ends. NONE.
#:
#: Leaving the exam, by any route, ends the attempt there and then. No
#: warnings, no strikes. The rule asked for is "three attempts, and any
#: violation costs one of them", and since the attempt is already spent when
#: the paper opens, "costs one" and "ends this one" are the same act.
#:
#: A budget of warnings is a different product: it teaches a student how much
#: they can get away with before it matters.
ALLOWED_LAPSES = 0


async def open_attempt_for(
    session: AsyncSession, user_id: uuid.UUID, exam_id: uuid.UUID
) -> CertAttempt | None:
    """The unsubmitted paper for this student and exam, if there is one."""
    return await session.scalar(
        select(CertAttempt).where(
            CertAttempt.user_id == user_id,
            CertAttempt.cert_exam_id == exam_id,
            CertAttempt.submitted_at.is_(None),
        )
    )


async def record_lapse(
    session: AsyncSession, *, user_id: uuid.UUID, exam_id: uuid.UUID
) -> tuple[int, bool]:
    """Record a departure from the open paper. Returns (total, must_submit).

    `must_submit` is True whenever there was a paper to leave, because one
    departure is enough. The count is still kept: "why did this attempt end"
    is what a student appeals with, and a number on the row answers it.

    NOT AN ERROR IF THERE IS NO OPEN PAPER. The page exits full screen on its
    way out of a submission, which fires the same browser event a student
    switching tabs does, and that must not answer an error to somebody who has
    just finished.
    """
    attempt = await open_attempt_for(session, user_id, exam_id)
    if attempt is None:
        return 0, False

    attempt.lapses += 1
    total = attempt.lapses
    await session.commit()
    return total, total > ALLOWED_LAPSES


async def submit_attempt(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    exam_id: uuid.UUID,
    score: float,
) -> tuple[CertAttempt, Certificate | None]:
    """Mark the open paper, if there is one.

    THE ATTEMPT WAS ALREADY SPENT, when the paper was opened. This closes it:
    the score goes on, `submitted_at` is filled in, and it stops being
    resumable.

    A submission with no open paper is refused rather than quietly creating
    one. It means the client called out of order, and inventing a row to score
    would be inventing an attempt nobody was charged for.
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
        attempt = await session.scalar(
            select(CertAttempt).where(
                CertAttempt.user_id == user_id,
                CertAttempt.cert_exam_id == exam_id,
                CertAttempt.submitted_at.is_(None),
            )
        )
        if attempt is None:
            raise NoOpenAttemptError()

        passed = score >= PASS_MARK
        attempt.score = score
        attempt.passed = passed
        attempt.submitted_at = datetime.now(UTC)

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
