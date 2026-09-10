"""Auth: register, login, logout, and "who am I".

fastapi-users supplies register/login/logout; `/me` is ours because the
frontend needs a signed-out answer that is not an error.

Password reset and email verification are deliberately not mounted yet — both
need an email transport, which does not exist.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.users import auth_backend, fastapi_users
from app.deps import CurrentUser, DbSession, OptionalUser
from app.models.audit import AuditAction
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services import audit

router = APIRouter(prefix="/auth", tags=["auth"])


async def _audit_logout(
    request: Request, session: DbSession, user: CurrentUser
) -> None:
    """Record who signed out, before fastapi-users clears the cookie.

    Mounted as a dependency on fastapi-users' own logout route rather than
    replacing it, so the library keeps owning the actual cookie invalidation
    and this only adds the record.

    Without it the trail showed logouts as "(anonymous)": the middleware net
    catches the request, but it runs after the response and by then there is no
    resolved user to attribute it to. `CurrentUser` resolves the session here,
    while the cookie is still valid — and, as a side effect, sets
    `request.state.user`, so the net attributes its own row correctly too.
    """
    await audit.record_safely(
        session,
        action=AuditAction.LOGOUT,
        actor=user,
        target_type="user",
        target_id=user.id,
        ip_address=audit.client_ip(request.headers, request.client),
        user_agent=request.headers.get("user-agent"),
    )
    await session.commit()


# POST /auth/login, POST /auth/logout
_auth_router = fastapi_users.get_auth_router(auth_backend)
for _route in _auth_router.routes:
    # Attach only to logout. Login is audited in `core/users.py`, where
    # fastapi-users has resolved the credentials and the actor is known;
    # a dependency here would run before that and see nobody.
    if getattr(_route, "path", "") == "/logout":
        _route.dependencies.append(Depends(_audit_logout))

router.include_router(_auth_router)
# POST /auth/register
router.include_router(fastapi_users.get_register_router(UserRead, UserCreate))

users_router = APIRouter(prefix="/users", tags=["users"])


@users_router.get("/session", response_model=UserRead | None)
async def read_session(user: OptionalUser) -> UserRead | None:
    """Current user, or null when signed out.

    Deliberately not `/users/me` — fastapi-users owns that path and 401s when
    signed out. The frontend asks this on every page load, where "nobody is
    signed in" is a normal answer rather than an error.
    """
    return user


# GET/PATCH /users/me and /users/{id}. fastapi-users guards these so a user can
# only edit themselves unless they are a superuser.
users_router.include_router(fastapi_users.get_users_router(UserRead, UserUpdate))
