"""Declarative base and shared column helpers.

Primary keys are UUIDs rather than sequential integers. The brief does not
specify a type; UUIDs are chosen because these ids appear in URLs
(`/courses/{id}`, `/modules/{id}`) and sequential ids would let anyone read off
how many students or courses exist, and walk records that aren't theirs.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, MetaData, Uuid, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Without this, Postgres invents names for foreign keys and primary keys, and
# migrations end up dropping constraints by a name nobody chose.
#
# `ck` is deliberately absent. Its convention token is %(constraint_name)s,
# which wraps the name you already gave — so an explicitly named
# "ck_users_role" would come out as "ck_users_ck_users_role". Every check
# constraint here is named at its definition instead.
#
# `ix` and `uq` must be present even though most are named explicitly: once a
# convention dict exists, SQLAlchemy stops falling back to its built-in
# auto-naming, so `index=True` / `unique=True` columns would produce unnamed
# indexes and fail to compile.
#
# Set before the first migration exists; changing it later means renaming every
# constraint already in the database.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base. Alembic's env.py targets Base.metadata."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def uuid_pk() -> Mapped[uuid.UUID]:
    """Standard UUID primary key, generated application-side."""
    return mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    """created_at / updated_at, both maintained by the database."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
