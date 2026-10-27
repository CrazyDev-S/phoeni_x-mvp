"""Interview prep written for a resume that has none - an upload, or an older run."""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import SessionLocal
from app.main import app
from app.models.enums import GenerationKind, GenerationStatus
from app.models.generation import Generation
from app.models.resume import BaseResume
from app.models.user import UserSettings
from app.worker.runner import run_once
from tests.test_resume_repair import StreamingStub, use_provider

PREP = {
    "must_verify": ["Veeva: 214 life-sciences customers"],
    "estimated_figures": [
        {"figure": "36 hours", "where": "Veeva", "derivation": "backlog after", "how_to_reconstruct": "queue logs"}
    ],
    "uncovered_requirements": [{"requirement": "Kafka", "how_to_close": "Point to Event Hubs work"}],
    "interview_probes": [{"question": "How did you cut the backlog?", "suggested_answer": "OCR pipeline"}],
    "notes": "Lead with the Veeva backlog result.",
}


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", timeout=30
    ) as c:
        yield c


@pytest.fixture
async def account(client) -> tuple[dict[str, str], uuid.UUID]:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": f"prep-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    user_id = uuid.UUID((await client.get("/api/v1/auth/me", headers=headers)).json()["id"])
    async with SessionLocal() as session:
        if await session.get(UserSettings, user_id) is None:
            session.add(UserSettings(user_id=user_id))
            await session.commit()
    return headers, user_id


async def uploaded(client, headers, markdown: str) -> str:
    res = await client.post(
        "/api/v1/remote/resumes",
        headers=headers,
        json={"display_name": f"Aran {uuid.uuid4().hex[:6]}", "target_title": "Senior Engineer",
              "content_markdown": markdown},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def test_prep_is_written_and_the_resume_is_left_alone(
    client, account, monkeypatch, aran_markdown
) -> None:
    headers, _ = account
    resume_id = await uploaded(client, headers, aran_markdown)
    async with SessionLocal() as session:
        before = await session.get(BaseResume, uuid.UUID(resume_id))
        validation, report = before.validation, before.ats_report

    stub = StreamingStub([json.dumps(PREP)])
    use_provider(monkeypatch, stub)
    res = await client.post(f"/api/v1/remote/resumes/{resume_id}/prep", headers=headers)
    assert res.status_code == 202, res.text
    assert await run_once() is True

    async with SessionLocal() as session:
        generation = await session.get(Generation, uuid.UUID(res.json()["id"]))
        assert generation.status is GenerationStatus.SUCCEEDED, generation.error_detail
        assert generation.result_kind == "base_resume"
        row = await session.get(BaseResume, uuid.UUID(resume_id))
        assert row.flags["interview_probes"][0]["question"] == "How did you cut the backlog?"
        assert row.content_markdown == aran_markdown
        assert row.validation == validation and row.ats_report == report

    # The model was told what the resume is and where it came from.
    sent = stub.requests[0]
    assert "uploaded by them" in sent.messages[0]["content"]
    assert "interview" in sent.system[0].text.lower()


async def test_an_unreadable_reply_keeps_the_existing_prep(
    client, account, monkeypatch, aran_markdown
) -> None:
    headers, _ = account
    resume_id = await uploaded(client, headers, aran_markdown)
    async with SessionLocal() as session:
        row = await session.get(BaseResume, uuid.UUID(resume_id))
        row.flags = PREP
        await session.commit()

    use_provider(monkeypatch, StreamingStub(["not json"]))
    res = await client.post(f"/api/v1/remote/resumes/{resume_id}/prep", headers=headers)
    assert await run_once() is True

    async with SessionLocal() as session:
        generation = await session.get(Generation, uuid.UUID(res.json()["id"]))
        assert generation.status is GenerationStatus.FAILED
        assert generation.error_code == "PREP_UNREADABLE"
        assert (await session.get(BaseResume, uuid.UUID(resume_id))).flags == PREP


async def test_asking_twice_reuses_the_run_in_flight(client, account, aran_markdown) -> None:
    headers, _ = account
    resume_id = await uploaded(client, headers, aran_markdown)
    first = await client.post(f"/api/v1/remote/resumes/{resume_id}/prep", headers=headers)
    second = await client.post(f"/api/v1/remote/resumes/{resume_id}/prep", headers=headers)
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["kind"] == GenerationKind.RESUME_PREP
    async with SessionLocal() as session:
        (await session.get(Generation, uuid.UUID(first.json()["id"]))).status = (
            GenerationStatus.CANCELLED  # keep the shared queue empty
        )
        await session.commit()


async def test_someone_elses_resume_gets_no_prep(client, account) -> None:
    headers, _ = account
    for path in ("resumes", "tailored-resumes"):
        res = await client.post(f"/api/v1/remote/{path}/{uuid.uuid4()}/prep", headers=headers)
        assert res.status_code == 404
