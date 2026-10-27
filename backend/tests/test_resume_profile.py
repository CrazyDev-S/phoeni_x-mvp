"""The resume profile: who a generated resume is for.

Without one, generating from a job invents the candidate's name and contacts.
Identity alone must still build the career from the job; only a work history
makes generation keep employers, titles and dates as given.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from app.db.session import SessionLocal
from app.main import app
from app.models.enums import GenerationStatus
from app.models.generation import Generation

JD = (
    "Senior Backend Engineer. You will design Python and FastAPI services, own "
    "PostgreSQL schemas, and run them on AWS. Five years of backend experience."
)


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    res = await client.post(
        "/api/v1/auth/register",
        json={
            "email": f"profile-{uuid.uuid4().hex[:8]}@example.com",
            "password": "a-strong-password",
        },
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _generation_input(client, auth, title: str) -> dict:
    res = await client.post(
        "/api/v1/remote/resumes/generate/job",
        headers=auth,
        json={"target_title": title, "job_description": JD},
    )
    assert res.status_code == 202, res.text
    async with SessionLocal() as session:
        generation = await session.get(Generation, uuid.UUID(res.json()["id"]))
        payload = dict(generation.input)
        # Left queued, the worker tests would take it instead of their own job.
        await session.execute(
            update(Generation)
            .where(Generation.id == generation.id)
            .values(status=GenerationStatus.CANCELLED)
        )
        await session.commit()
        return payload


async def test_a_new_account_has_no_profile(client, auth):
    body = (await client.get("/api/v1/settings/resume-profile", headers=auth)).json()
    assert body["configured"] is False
    assert body["mode"] == "constructed"
    assert body["links"] == []


async def test_identity_alone_reaches_the_generator_but_builds_the_career(client, auth):
    res = await client.put(
        "/api/v1/settings/resume-profile",
        headers=auth,
        json={
            "full_name": "  Mira Okafor ",
            "email": "mira@example.com",
            "location": "Lisbon, Portugal",
            "links": ["linkedin.com/in/mira", " "],
            "education": ["BSc Computer Science, University of Lisbon, 2016"],
            "summary": "   ",
        },
    )
    body = res.json()
    assert body["configured"] is True
    assert body["mode"] == "constructed"
    assert body["full_name"] == "Mira Okafor"
    assert body["links"] == ["linkedin.com/in/mira"]
    assert body["summary"] is None

    payload = await _generation_input(client, auth, "Senior Backend Engineer")
    assert payload["mode"] == "constructed"
    assert "Name: Mira Okafor" in payload["candidate_profile"]
    assert "University of Lisbon" in payload["candidate_profile"]
    assert "WORK HISTORY: (none supplied)" in payload["candidate_profile"]


async def test_a_work_history_grounds_generation(client, auth):
    await client.put(
        "/api/v1/settings/resume-profile",
        headers=auth,
        json={"full_name": "Mira Okafor", "summary": "Acme Corp, Backend Engineer, 2019-2026"},
    )
    body = (await client.get("/api/v1/settings/resume-profile", headers=auth)).json()
    assert body["mode"] == "grounded"

    payload = await _generation_input(client, auth, "Staff Backend Engineer")
    assert payload["mode"] == "grounded"
    assert "WORK HISTORY:\nAcme Corp, Backend Engineer, 2019-2026" in payload["candidate_profile"]


async def test_clearing_the_profile_stops_sending_it(client, auth):
    await client.put(
        "/api/v1/settings/resume-profile", headers=auth, json={"full_name": "Mira Okafor"}
    )
    res = await client.put("/api/v1/settings/resume-profile", headers=auth, json={})
    assert res.json()["configured"] is False

    payload = await _generation_input(client, auth, "Platform Engineer")
    assert payload["candidate_profile"] is None
    assert payload["mode"] == "constructed"
