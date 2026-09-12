"""Async LLM generation jobs, their event stream, and per-call accounting."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, PrimaryKey, Timestamps
from app.models.enums import GenerationKind, GenerationStatus, LLMProvider, pg_enum
from app.models.user import PROVIDER_ENUM

GENERATION_KIND_ENUM = pg_enum(GenerationKind, "generation_kind")
GENERATION_STATUS_ENUM = pg_enum(GenerationStatus, "generation_status")


class Generation(PrimaryKey, Timestamps, Base):
    """The durable record of one generation request.

    Worker pickup uses ``FOR UPDATE SKIP LOCKED`` against this table, which is
    sufficient at this scale and removes Redis from the stack entirely.
    """

    __tablename__ = "generations"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key"),
        Index(
            "ix_generations_queue",
            "created_at",
            postgresql_where=text("status IN ('queued','running')"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[GenerationKind] = mapped_column(GENERATION_KIND_ENUM, nullable=False)
    status: Mapped[GenerationStatus] = mapped_column(
        GENERATION_STATUS_ENUM,
        nullable=False,
        server_default=GenerationStatus.QUEUED.value,
    )
    idempotency_key: Mapped[str | None] = mapped_column(Text)

    input: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    provider: Mapped[LLMProvider | None] = mapped_column(PROVIDER_ENUM)
    model: Mapped[str | None] = mapped_column(Text)
    # Correlates a quality regression to a specific prompt revision.
    prompt_version: Mapped[str] = mapped_column(Text, nullable=False, server_default="v1")

    phase: Mapped[str | None] = mapped_column(Text)
    progress_percent: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default="0"
    )

    result_kind: Mapped[str | None] = mapped_column(Text)
    result_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    result_payload: Mapped[dict | None] = mapped_column(JSONB)

    error_code: Mapped[str | None] = mapped_column(Text)
    error_detail: Mapped[str | None] = mapped_column(Text)
    attempt: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="0")

    total_cost_usd_micros: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GenerationEvent(Base):
    """Append-only event log. SSE is a view over this, so reconnects are lossless.

    Essential for a Chrome side panel, whose document is destroyed whenever the
    panel is closed mid-job.
    """

    __tablename__ = "generation_events"
    __table_args__ = (UniqueConstraint("generation_id", "seq"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    generation_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("generations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class LLMCall(PrimaryKey, Base):
    """One row per HTTP call to a provider.

    ``cache_read_tokens`` is asserted in tests: cache regressions are silent
    and otherwise only surface on the bill.
    """

    __tablename__ = "llm_calls"
    __table_args__ = (Index("ix_llm_calls_user_created", "user_id", text("created_at DESC")),)

    generation_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("generations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[LLMProvider] = mapped_column(PROVIDER_ENUM, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)

    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    cache_read_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    cache_write_5m_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    cache_write_1h_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )

    stop_reason: Mapped[str | None] = mapped_column(Text)
    http_status: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    cost_usd_micros: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
