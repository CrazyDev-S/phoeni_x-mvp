"""Declarative base, constraint naming, and shared column mixins."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, MetaData, text
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.ids import uuid7
from app.core.timezone import utc_now

# Every constraint gets a predictable name instead of one PostgreSQL invents,
# so an error message names something you can grep for.
#
# The KEYS are SQLAlchemy's own API and cannot be renamed. The two-letter
# prefixes in the values are kept deliberately: PostgreSQL truncates
# identifiers at 63 characters, and the longest foreign key here already
# reaches 60. Spelling them out ("foreign_key_") would silently truncate and
# risk two constraints colliding on the same name.
#
#   ix = index      uq = unique      ck = check
#   fk = foreign key                 pk = primary key
CONSTRAINT_NAMING = {
    "ix": "ix_%(column_0_N_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=CONSTRAINT_NAMING)


class PrimaryKey:
    """A time-ordered UUID primary key.

    UUIDv7 sorts by creation time, which keeps inserts at the right-hand edge
    of the index. Random v4 keys scatter writes across the whole index and
    degrade insert performance as a table grows.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        PostgresUUID(as_uuid=True), primary_key=True, default=uuid7
    )


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        onupdate=utc_now,
        nullable=False,
    )
