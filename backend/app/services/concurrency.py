"""Making "read a counter, then insert" safe under concurrency.

Three places number a row by looking at what already exists — quiz attempts,
certification attempts, assignment submissions:

    n = SELECT max(attempt_number) ... + 1
    INSERT ... attempt_number = n

Between the read and the insert, nothing stops a second request doing the same.
Two submissions from one student — a double-click, a retried request on a flaky
connection, two open tabs — both read the same number and both try to insert it.

Every one of those tables has a UNIQUE constraint on (user, parent, attempt
number), so the database *does* stop the duplicate. That is the good news: the
certification cap cannot be exceeded this way. The bad news is what the student
sees, which was an unhandled IntegrityError — a 500, on the submit button of a
capped exam, with no way to tell whether the attempt was recorded.

The fix is to treat the conflict as what it is: a lost race, not a failure.
Roll back, re-derive the number from the now-current state, and try again.
Re-deriving matters for certification specifically — if the request that won the
race consumed the last attempt, the retry recomputes the allowance and correctly
refuses instead of squeezing in an extra one.

Retry rather than locking because contention is per-student and therefore rare;
taking a row lock on every submission would serialise a whole exam to protect
against something that happens when one person clicks twice.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Three is not arbitrary: each retry re-reads committed state, so a second
# collision means three requests arrived together for one student. Beyond that
# something is wrong that retrying will not fix.
MAX_ATTEMPTS = 3


async def commit_with_retry[T](
    session: AsyncSession,
    build: Callable[[], Awaitable[T]],
    *,
    max_attempts: int = MAX_ATTEMPTS,
    description: str = "row",
) -> T:
    """Run `build`, commit, and retry the whole thing on a unique conflict.

    `build` must do ALL of its reads itself and add to the session — it is
    called again from scratch on each try, so anything it computed before the
    conflict is stale by definition.

    Any exception `build` raises other than a conflict propagates untouched, so
    a genuine refusal (the attempt cap, say) is not mistaken for a race.
    """
    for attempt in range(1, max_attempts + 1):
        try:
            result = await build()
            await session.commit()
            return result
        except IntegrityError:
            await session.rollback()
            if attempt == max_attempts:
                logger.warning(
                    "Gave up inserting %s after %d conflicting attempts",
                    description,
                    max_attempts,
                )
                raise
            logger.info(
                "Conflict inserting %s (try %d of %d); re-deriving and retrying",
                description,
                attempt,
                max_attempts,
            )

    # Unreachable: the loop either returns or raises.
    raise AssertionError("commit_with_retry exhausted without returning")
