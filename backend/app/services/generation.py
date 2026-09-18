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
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now
from app.db.session import SessionLocal
from app.models.enums import GenerationKind, GenerationStatus
from app.models.generation import Generation, GenerationEvent, LLMCall

# A job is retried this many times before it is called dead.
MAX_ATTEMPTS = 3


def idempotency_key(*parts: Any) -> str:
    raw = "|".join(str(p) for p in parts if p is not None)
    return hashlib.sha256(raw.encode()).hexdigest()


def job_description_hash(job_description: str) -> bytes:
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
        if existing is not None and existing.status not in (
            GenerationStatus.FAILED,
            GenerationStatus.CANCELLED,
        ):
            # A double-clicked button costs nothing.
            return existing
        if existing is not None:
            # Reusing a failed run made the same request fail forever: the
            # client was handed the old error every time it tried again.
            # Release the key so a fresh run can take it.
            existing.idempotency_key = None
            await session.flush()

    row = Generation(
        user_id=user_id,
        kind=kind,
        status=GenerationStatus.QUEUED,
        idempotency_key=key,
        input=payload,
    )
    session.add(row)
    await session.flush()
    await emit(session, row.id, "phase", {"phase": "queued", "label": "Queued", "percent": 0})
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


async def emit_now(generation_id: uuid.UUID, type_: str, payload: dict) -> None:
    """Record progress in its own transaction, committed immediately.

    Progress has to be visible to OTHER connections while the job is still
    running, and the worker holds one long transaction for the whole job - so
    anything written there stays invisible until it finishes. A reader would
    sit at 0% for the entire run and then jump straight to done.

    Committing here also doubles as the worker's heartbeat: ``locked_at`` moves
    forward on every event, which is what lets reclaim_stale tell a slow job
    from a dead one.
    """
    async with SessionLocal() as session:
        await emit(session, generation_id, type_, payload)
        values: dict = {"locked_at": utc_now()}
        if type_ == "phase":
            values["phase"] = payload.get("phase")
            if "percent" in payload:
                values["progress_percent"] = payload["percent"]
        await session.execute(
            update(Generation).where(Generation.id == generation_id).values(**values)
        )
        await session.commit()


async def reclaim_stale(session: AsyncSession, *, older_than: timedelta) -> int:
    """Return jobs whose worker died to the queue.

    A worker that is restarted or killed mid-job leaves its row in RUNNING
    forever, and nothing else will ever pick it up. Anything that has not
    produced an event within `older_than` is presumed dead.
    """
    cutoff = utc_now() - older_than
    stale = list(
        await session.scalars(
            select(Generation).where(
                Generation.status == GenerationStatus.RUNNING,
                Generation.locked_at < cutoff,
            )
        )
    )
    for row in stale:
        if row.attempt >= MAX_ATTEMPTS:
            row.status = GenerationStatus.FAILED
            row.error_code = "WORKER_LOST"
            row.error_detail = (
                f"No progress for {older_than} across {row.attempt} attempts; "
                "the worker was most likely restarted mid-run."
            )
            row.finished_at = utc_now()
            await emit(session, row.id, "error",
                       {"code": row.error_code, "detail": row.error_detail})
        else:
            row.status = GenerationStatus.QUEUED
            row.locked_at = None
    return len(stale)


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
