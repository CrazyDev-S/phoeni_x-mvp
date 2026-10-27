"""Stopping a generation.

The cancel endpoint used to flip a status flag the worker never read, so a
"stopped" run kept going, spent the money, and then overwrote the status with
its own result.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from app.db.session import SessionLocal
from app.main import app
from app.models.enums import GenerationKind, GenerationStatus
from app.models.generation import Generation, GenerationEvent
from app.models.resume import BaseResume
from app.services.generation import enqueue
from app.worker import runner
from app.worker.runner import run_once


@pytest.fixture(autouse=True)
async def empty_queue():
    """run_once takes the oldest queued job, so a leftover would be run instead."""
    async with SessionLocal() as session:
        await session.execute(
            update(Generation)
            .where(Generation.status.in_([GenerationStatus.QUEUED, GenerationStatus.RUNNING]))
            .values(status=GenerationStatus.CANCELLED)
        )
        await session.commit()


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", timeout=30
    ) as c:
        yield c


@pytest.fixture
async def auth(client) -> tuple[dict[str, str], uuid.UUID]:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": f"stop-{uuid.uuid4().hex[:8]}@example.com",
              "password": "a-strong-password"},
    )
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    me = await client.get("/api/v1/auth/me", headers=headers)
    return headers, uuid.UUID(me.json()["id"])


async def queued(user_id: uuid.UUID) -> uuid.UUID:
    async with SessionLocal() as session:
        row = await enqueue(
            session, user_id=user_id, kind=GenerationKind.RESUME_STORY,
            payload={"target_title": "Engineer"},
        )
        await session.commit()
        return row.id


async def event_types(generation_id: uuid.UUID) -> list[str]:
    async with SessionLocal() as session:
        return list(
            await session.scalars(
                select(GenerationEvent.type)
                .where(GenerationEvent.generation_id == generation_id)
                .order_by(GenerationEvent.seq)
            )
        )


async def test_stopping_a_queued_job_cancels_it_and_says_so(client, auth) -> None:
    headers, user_id = auth
    generation_id = await queued(user_id)

    res = await client.post(f"/api/v1/generations/{generation_id}/cancel", headers=headers)
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"
    assert res.json()["finished_at"] is not None
    assert (await event_types(generation_id))[-1] == "cancelled"

    # Never picked up afterwards.
    assert await run_once() is False


async def test_stopping_a_finished_job_is_refused(client, auth) -> None:
    headers, user_id = auth
    generation_id = await queued(user_id)
    async with SessionLocal() as session:
        (await session.get(Generation, generation_id)).status = GenerationStatus.SUCCEEDED
        await session.commit()

    res = await client.post(f"/api/v1/generations/{generation_id}/cancel", headers=headers)
    assert res.status_code == 409
    async with SessionLocal() as session:
        assert (await session.get(Generation, generation_id)).status is GenerationStatus.SUCCEEDED


async def test_another_users_job_cannot_be_stopped(client, auth) -> None:
    headers, _ = auth
    other = await client.post(
        "/api/v1/auth/register",
        json={"email": f"other-{uuid.uuid4().hex[:8]}@example.com",
              "password": "a-strong-password"},
    )
    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {other.json()['access_token']}"}
    )
    generation_id = await queued(uuid.UUID(me.json()["id"]))
    res = await client.post(f"/api/v1/generations/{generation_id}/cancel", headers=headers)
    assert res.status_code == 404


async def test_a_running_job_is_abandoned_when_stopped(client, auth, monkeypatch) -> None:
    headers, user_id = auth
    generation_id = await queued(user_id)
    started = asyncio.Event()
    interrupted = asyncio.Event()

    async def long_model_call(session, generation):
        started.set()
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            interrupted.set()
            raise

    monkeypatch.setattr(runner, "_process", long_model_call)
    monkeypatch.setattr(runner, "STOP_POLL_SECONDS", 0.05)

    async def stop_once_running():
        await started.wait()
        return await client.post(f"/api/v1/generations/{generation_id}/cancel", headers=headers)

    async with asyncio.timeout(10):
        worked, res = await asyncio.gather(run_once(), stop_once_running())

    assert worked is True
    assert res.status_code == 200
    assert interrupted.is_set(), "the in-flight work kept running after Stop"
    async with SessionLocal() as session:
        row = await session.get(Generation, generation_id)
        # Not turned into a failure, and not overwritten.
        assert row.status is GenerationStatus.CANCELLED
        assert row.error_code is None
    assert await event_types(generation_id) == ["phase", "cancelled"]


async def test_a_job_stopped_as_it_finishes_saves_nothing(auth) -> None:
    """The result is ready but the user already pressed Stop: it is dropped."""
    _, user_id = auth
    generation_id = await queued(user_id)
    async with SessionLocal() as session:
        row = await session.get(Generation, generation_id)
        row.status = GenerationStatus.CANCELLED
        await session.commit()

    async with SessionLocal() as session:
        row = await session.get(Generation, generation_id)
        assert await runner._was_stopped(session, row) is True

    async with SessionLocal() as session:
        saved = await session.scalar(
            select(BaseResume).where(BaseResume.user_id == user_id)
        )
        assert saved is None


async def test_a_reconnecting_client_is_told_the_job_was_stopped(client, auth) -> None:
    headers, user_id = auth
    generation_id = await queued(user_id)
    await client.post(f"/api/v1/generations/{generation_id}/cancel", headers=headers)

    seen: list[str] = []
    async with asyncio.timeout(8):
        async with client.stream(
            "GET",
            f"/api/v1/generations/{generation_id}/events",
            headers={**headers, "Last-Event-ID": "99"},
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("event:"):
                    seen.append(line.split(":", 1)[1].strip())
    assert seen == ["cancelled"]
