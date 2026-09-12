"""The progress stream must always tell a client how the job ended.

The reported symptom was a tab that span forever while the result sat finished
in the database. The cause was a reconnecting client receiving an empty,
immediately-closed stream: it reconnected, got nothing again, and never learned
the outcome it had been waiting for.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import SessionLocal
from app.main import app
from app.models.enums import GenerationKind, GenerationStatus
from app.models.generation import Generation
from app.services.generation import emit, emit_now, enqueue

STREAM_TIMEOUT = 8


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
        json={"email": f"stream-{uuid.uuid4().hex[:8]}@example.com",
              "password": "a-strong-password"},
    )
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    me = await client.get("/api/v1/auth/me", headers=headers)
    return headers, uuid.UUID(me.json()["id"])


async def finished_generation(user_id: uuid.UUID, status: GenerationStatus) -> uuid.UUID:
    async with SessionLocal() as session:
        row = await enqueue(
            session, user_id=user_id, kind=GenerationKind.RESUME_STORY, payload={}
        )
        await session.commit()
        generation_id = row.id

    await emit_now(generation_id, "phase", {"phase": "draft", "percent": 45})

    async with SessionLocal() as session:
        row = await session.get(Generation, generation_id)
        row.status = status
        row.result_kind = "base_resume"
        row.result_id = uuid.uuid4()
        if status is GenerationStatus.FAILED:
            row.error_code = "BOOM"
            row.error_detail = "it broke"
        else:
            await emit(session, generation_id, "complete", {"result_id": str(row.result_id)})
        await session.commit()
    return generation_id


async def read_stream(client, headers, generation_id, last_event_id=None) -> list[str]:
    seen: list[str] = []
    request_headers = dict(headers)
    if last_event_id is not None:
        request_headers["Last-Event-ID"] = str(last_event_id)
    async with asyncio.timeout(STREAM_TIMEOUT):
        async with client.stream(
            "GET", f"/api/v1/generations/{generation_id}/events", headers=request_headers
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("event:"):
                    seen.append(line.split(":", 1)[1].strip())
    return seen


async def test_a_live_job_streams_its_phases_then_closes(client, auth) -> None:
    headers, user_id = auth
    async with SessionLocal() as session:
        row = await enqueue(
            session, user_id=user_id, kind=GenerationKind.RESUME_STORY, payload={}
        )
        await session.commit()
        generation_id = row.id

    async def produce():
        await asyncio.sleep(0.5)
        await emit_now(generation_id, "phase", {"phase": "scenario", "percent": 5})
        await asyncio.sleep(0.5)
        async with SessionLocal() as session:
            g = await session.get(Generation, generation_id)
            g.status = GenerationStatus.SUCCEEDED
            await emit(session, generation_id, "complete", {})
            await session.commit()

    seen, _ = await asyncio.gather(
        read_stream(client, headers, generation_id), produce()
    )
    assert seen[-1] == "complete"


async def test_reconnecting_after_seeing_everything_still_gets_the_outcome(
    client, auth
) -> None:
    """The regression. Previously this returned an empty, closed stream, and a
    client that reconnects on close would loop on it forever."""
    headers, user_id = auth
    generation_id = await finished_generation(user_id, GenerationStatus.SUCCEEDED)

    # Pretend the tab already consumed every event, then reconnected.
    seen = await read_stream(client, headers, generation_id, last_event_id=99)
    assert seen == ["complete"], f"a reconnecting client learned nothing: {seen}"


async def test_connecting_to_an_already_finished_job_replays_and_closes(
    client, auth
) -> None:
    headers, user_id = auth
    generation_id = await finished_generation(user_id, GenerationStatus.SUCCEEDED)
    seen = await read_stream(client, headers, generation_id)
    assert seen[-1] == "complete"


async def test_a_failed_job_reports_the_failure_on_reconnect(client, auth) -> None:
    headers, user_id = auth
    generation_id = await finished_generation(user_id, GenerationStatus.FAILED)
    seen = await read_stream(client, headers, generation_id, last_event_id=99)
    assert seen == ["error"], "a failed job left the client waiting"


async def test_a_running_job_holds_the_connection_open(client, auth) -> None:
    """The opposite failure: closing on a live job would make the UI give up
    while the work is still going."""
    headers, user_id = auth
    async with SessionLocal() as session:
        row = await enqueue(
            session, user_id=user_id, kind=GenerationKind.RESUME_STORY, payload={}
        )
        await session.commit()
        generation_id = row.id
        running = await session.get(Generation, generation_id)
        running.status = GenerationStatus.RUNNING
        await session.commit()

    with pytest.raises(TimeoutError):
        await read_stream(client, headers, generation_id, last_event_id=99)
