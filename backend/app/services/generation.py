"""Generation jobs: enqueue, run, and stream.

The queue is Postgres (``FOR UPDATE SKIP LOCKED``), not Redis. At this scale
it is sufficient and removes a whole piece of infrastructure; the durable
``generations`` row is the record either way.

SSE is a view over the append-only ``generation_events`` table, so a reconnect
replays losslessly from ``Last-Event-ID``. That matters most for the Chrome
side panel, whose document is destroyed whenever the panel is closed mid-job.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now
from app.models.enums import GenerationKind, GenerationStatus
from app.models.generation import Generation, GenerationEvent, LLMCall


def idempotency_key(*parts: Any) -> str:
    raw = "|".join(str(p) for p in parts if p is not None)
    return hashlib.sha256(raw.encode()).hexdigest()


def jd_hash(job_description: str) -> bytes:
    """Normalised so trivial whitespace edits still hit the instant path."""
    normalised = " ".join(job_description.split()).lower()
    return hashlib.sha256(normalised.encode()).digest()


async def enqueue(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: GenerationKind,
    payload: dict,
    key: str | None = None,
) -> Generation:
    if key:
        existing = await session.scalar(
            select(Generation).where(
                Generation.user_id == user_id, Generation.idempotency_key == key
            )
        )
        if existing is not None:
            # A double-clicked button costs nothing.
            return existing

    row = Generation(
        user_id=user_id,
        kind=kind,
        status=GenerationStatus.QUEUED,
        idempotency_key=key,
        input=payload,
    )
    session.add(row)
    await session.flush()
    await emit(session, row.id, "phase", {"phase": "queued", "label": "Queued", "pct": 0})
    return row


async def emit(
    session: AsyncSession, generation_id: uuid.UUID, type_: str, payload: dict
) -> GenerationEvent:
    seq = (
        await session.scalar(
            select(func.coalesce(func.max(GenerationEvent.seq), -1)).where(
                GenerationEvent.generation_id == generation_id
            )
        )
    ) + 1
    event = GenerationEvent(
        generation_id=generation_id, seq=seq, type=type_, payload=_jsonable(payload)
    )
    session.add(event)
    await session.flush()
    return event


def _jsonable(payload: dict) -> dict:
    return json.loads(json.dumps(payload, default=str))


async def claim_next(session: AsyncSession) -> Generation | None:
    """Atomically take one queued job. SKIP LOCKED keeps workers from colliding."""
    row = await session.scalar(
        select(Generation)
        .where(Generation.status == GenerationStatus.QUEUED)
        .order_by(Generation.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if row is None:
        return None
    row.status = GenerationStatus.RUNNING
    row.started_at = utc_now()
    row.locked_at = utc_now()
    row.attempt += 1
    await session.flush()
    return row


async def record_calls(
    session: AsyncSession, generation: Generation, calls: list[dict]
) -> None:
    total = 0
    for call in calls:
        total += call.get("cost_usd_micros", 0)
        session.add(
            LLMCall(
                generation_id=generation.id,
                user_id=generation.user_id,
                provider=generation.provider,
                model=call.get("model", ""),
                purpose=call.get("purpose", ""),
                input_tokens=call.get("input_tokens", 0),
                output_tokens=call.get("output_tokens", 0),
                cache_read_tokens=call.get("cache_read_tokens", 0),
                cache_write_5m_tokens=call.get("cache_write_5m_tokens", 0),
                cache_write_1h_tokens=call.get("cache_write_1h_tokens", 0),
                stop_reason=call.get("stop_reason"),
                latency_ms=call.get("latency_ms"),
                cost_usd_micros=call.get("cost_usd_micros", 0),
            )
        )
    generation.total_cost_usd_micros = total
