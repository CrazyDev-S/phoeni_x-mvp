"""Progress has to be readable while the job is still running.

Both bugs these cover were invisible in normal testing: the pipeline produced
the right answer, and the tests that read events did so after the job had
already committed. Only a reader watching a live job could tell.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.timezone import utc_now
from app.db.session import SessionLocal
from app.models.enums import GenerationKind, GenerationStatus
from app.models.generation import Generation, GenerationEvent
from app.models.user import User
from app.services.generation import (
    MAX_ATTEMPTS,
    claim_next,
    emit_now,
    enqueue,
    reclaim_stale,
)


@pytest.fixture
async def user_id() -> uuid.UUID:
    async with SessionLocal() as session:
        row = User(
            email=f"progress-{uuid.uuid4().hex[:8]}@example.com",
            password_hash="x",
        )
        session.add(row)
        await session.commit()
        return row.id


async def make_generation(user_id: uuid.UUID) -> uuid.UUID:
    async with SessionLocal() as session:
        row = await enqueue(
            session,
            user_id=user_id,
            kind=GenerationKind.RESUME_STORY,
            payload={"target_title": "Engineer"},
        )
        await session.commit()
        return row.id


async def test_progress_is_visible_to_another_connection_mid_run(user_id) -> None:
    """The regression: events written inside the worker's long transaction
    stayed invisible until the job finished, so the UI sat at 0% throughout."""
    generation_id = await make_generation(user_id)

    async with SessionLocal() as worker_session:
        await claim_next(worker_session)
        await worker_session.commit()

        # The worker is now mid-job and holds an open transaction.
        await emit_now(generation_id, "phase", {"phase": "scenario", "percent": 45})

        # A different connection - this is what the SSE endpoint does.
        async with SessionLocal() as reader:
            events = list(
                await reader.scalars(
                    select(GenerationEvent)
                    .where(GenerationEvent.generation_id == generation_id)
                    .order_by(GenerationEvent.seq)
                )
            )
            phases = [e for e in events if e.type == "phase"]
            assert any(e.payload.get("phase") == "scenario" for e in phases), (
                "progress was not visible to another connection while the job ran"
            )

            row = await reader.get(Generation, generation_id)
            assert row.phase == "scenario"
            assert row.progress_percent == 45


async def test_emitting_moves_the_heartbeat_forward(user_id) -> None:
    generation_id = await make_generation(user_id)
    async with SessionLocal() as session:
        await claim_next(session)
        await session.commit()
        before = (await session.get(Generation, generation_id)).locked_at

    await emit_now(generation_id, "phase", {"phase": "draft", "percent": 60})

    async with SessionLocal() as session:
        after = (await session.get(Generation, generation_id)).locked_at
    assert after > before


async def test_a_job_whose_worker_died_is_returned_to_the_queue(user_id) -> None:
    """A restart used to strand a job in RUNNING forever."""
    generation_id = await make_generation(user_id)

    async with SessionLocal() as session:
        await claim_next(session)
        row = await session.get(Generation, generation_id)
        row.locked_at = utc_now() - timedelta(hours=1)  # worker vanished
        await session.commit()

    async with SessionLocal() as session:
        assert await reclaim_stale(session, older_than=timedelta(minutes=10)) == 1
        await session.commit()
        row = await session.get(Generation, generation_id)
        assert row.status is GenerationStatus.QUEUED
        assert row.locked_at is None

    # And it can actually be picked up again.
    async with SessionLocal() as session:
        assert await claim_next(session) is not None
        await session.commit()


async def test_a_healthy_slow_job_is_left_alone(user_id) -> None:
    generation_id = await make_generation(user_id)
    async with SessionLocal() as session:
        await claim_next(session)
        await session.commit()

    await emit_now(generation_id, "phase", {"phase": "scenario", "percent": 5})

    async with SessionLocal() as session:
        assert await reclaim_stale(session, older_than=timedelta(minutes=10)) == 0
        assert (await session.get(Generation, generation_id)).status is GenerationStatus.RUNNING


async def test_a_job_that_keeps_dying_eventually_fails(user_id) -> None:
    generation_id = await make_generation(user_id)

    for _ in range(MAX_ATTEMPTS):
        async with SessionLocal() as session:
            await claim_next(session)
            row = await session.get(Generation, generation_id)
            row.locked_at = utc_now() - timedelta(hours=1)
            await session.commit()
        async with SessionLocal() as session:
            await reclaim_stale(session, older_than=timedelta(minutes=10))
            await session.commit()

    async with SessionLocal() as session:
        row = await session.get(Generation, generation_id)
        assert row.status is GenerationStatus.FAILED
        assert row.error_code == "WORKER_LOST"
