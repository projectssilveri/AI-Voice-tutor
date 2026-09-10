"""The bundles a signed-in student holds.

One route. The dashboard needs to show "you bought the Java stack, here are its
four courses and how far you are through each" — a question `/enrollments`
cannot answer, because enrolment is per course and knows nothing about what was
bought together.

Everything is scoped to the caller: `user.id` comes from the session, never from
the request, so there is no id here to tamper with and no other student's
subscription to reach.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel

from app.deps import CurrentUser, DbSession
from app.services import subscriptions as subscription_service

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


class BundleCourseRead(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    total_modules: int
    completed_modules: int
    in_progress_modules: int
    percent_complete: int
    #: A bundle unlocks a course; starting it is still a separate act, so the
    #: dashboard can offer "Start" rather than "Continue".
    enrolled: bool


class HeldPlanRead(BaseModel):
    subscription_id: uuid.UUID
    plan_id: uuid.UUID
    name: str
    description: str | None
    price_minor: int
    currency: str
    billing_interval: str
    status: str
    started_at: datetime
    #: When the current period ends. Called renews_at because that is what it
    #: means while the subscription is live; `cancelled` says when it does not.
    renews_at: datetime
    cancelled: bool
    covers_everything: bool
    course_count: int
    completed_courses: int
    courses: list[BundleCourseRead]


@router.get("/mine", response_model=list[HeldPlanRead])
async def list_my_subscriptions(
    session: DbSession, user: CurrentUser
) -> list[HeldPlanRead]:
    """Bundles and subscriptions this student currently holds.

    Empty is a normal answer, not an error: most students buy courses outright,
    and the dashboard simply does not draw the panel.
    """
    held = await subscription_service.list_held_plans(session, user)
    return [
        HeldPlanRead(
            subscription_id=plan.subscription_id,
            plan_id=plan.plan_id,
            name=plan.name,
            description=plan.description,
            price_minor=plan.price_minor,
            currency=plan.currency,
            billing_interval=plan.billing_interval,
            status=plan.status,
            started_at=plan.started_at,
            renews_at=plan.renews_at,
            cancelled=plan.cancelled,
            covers_everything=plan.covers_everything,
            course_count=len(plan.courses),
            completed_courses=plan.completed_courses,
            courses=[
                BundleCourseRead(
                    id=row.course.id,
                    title=row.course.title,
                    description=row.course.description,
                    total_modules=row.total_modules,
                    completed_modules=row.completed_modules,
                    in_progress_modules=row.in_progress_modules,
                    percent_complete=row.percent_complete,
                    enrolled=row.enrolled,
                )
                for row in plan.courses
            ],
        )
        for plan in held
    ]
