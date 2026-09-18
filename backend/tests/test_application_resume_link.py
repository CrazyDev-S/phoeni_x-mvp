"""An application and the tailored resume sent with it stay linked both ways."""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from app.db.session import SessionLocal
from app.main import app
from app.models.application import JobApplication
from app.models.enums import GenerationKind, GenerationStatus, ResumeSource, ResumeStatus
from app.models.generation import Generation
from app.models.resume import BaseResume, TailoredResume
from app.models.user import User, UserSettings
from app.services.generation import enqueue, job_description_hash
from app.worker.runner import run_once
from tests.test_pipeline import ANALYSIS_JSON
from tests.test_resume_repair import StreamingStub, use_provider

JOB_URL = "https://jobs.example.com/acme/123"
JD = "Senior AI engineer. Must have FastAPI and React. Kafka is a plus. Remote."


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": f"link-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def make_tailored(client, headers, markdown: str) -> tuple[str, str]:
    res = await client.post(
        "/api/v1/resumes",
        headers=headers,
        json={"display_name": f"Base {uuid.uuid4().hex[:6]}", "target_title": "Engineer",
              "content_markdown": markdown},
    )
    assert res.status_code == 201, res.text
    base_id = res.json()["id"]
    async with SessionLocal() as session:
        base = await session.get(BaseResume, uuid.UUID(base_id))
        row = TailoredResume(
            user_id=base.user_id,
            base_resume_id=base.id,
            display_name="Acme — Senior AI Engineer",
            job_url=JOB_URL,
            job_description_text=JD,
            job_description_hash=job_description_hash(JD),
            content_markdown=markdown,
            content_text="x",
            status=ResumeStatus.FINAL,
        )
        session.add(row)
        await session.commit()
        return base_id, str(row.id)


async def reverse_link(tailored_id: str) -> uuid.UUID | None:
    async with SessionLocal() as session:
        return (await session.get(TailoredResume, uuid.UUID(tailored_id))).job_application_id


async def test_linking_and_unlinking_is_written_on_both_sides(client, auth, aran_markdown) -> None:
    """Regression: only the application's side was ever written."""
    _, tailored_id = await make_tailored(client, auth, aran_markdown)
    res = await client.post(
        "/api/v1/applications",
        headers=auth,
        json={"company_name": "Acme", "role_title": "Senior AI Engineer",
              "tailored_resume_id": tailored_id},
    )
    assert res.status_code == 201, res.text
    application_id = res.json()["id"]
    assert str(await reverse_link(tailored_id)) == application_id

    res = await client.patch(
        f"/api/v1/applications/{application_id}", headers=auth, json={"tailored_resume_id": None}
    )
    assert res.status_code == 200, res.text
    assert res.json()["tailored_resume"] is None
    assert await reverse_link(tailored_id) is None


async def test_an_unlinked_application_suggests_the_resume_for_its_posting(
    client, auth, aran_markdown
) -> None:
    base_id, tailored_id = await make_tailored(client, auth, aran_markdown)
    res = await client.post(
        "/api/v1/applications",
        headers=auth,
        json={"company_name": "Acme", "role_title": "Senior AI Engineer", "job_url": JOB_URL},
    )
    detail = (await client.get(f"/api/v1/applications/{res.json()['id']}", headers=auth)).json()

    assert detail["tailored_resume"] is None
    assert detail["suggested_tailored_resume"]["id"] == tailored_id
    # Lets "Tailor a resume for this job" start from the same base resume.
    assert detail["suggested_tailored_resume"]["base_resume_id"] == base_id


async def test_tailoring_from_an_application_uses_its_posting(client, auth, aran_markdown) -> None:
    base_id, _ = await make_tailored(client, auth, aran_markdown)
    without_jd = await client.post(
        "/api/v1/applications", headers=auth,
        json={"company_name": "Blank", "role_title": "Engineer"},
    )
    refused = await client.post(
        f"/api/v1/applications/{without_jd.json()['id']}/tailor",
        headers=auth, json={"base_resume_id": base_id},
    )
    assert refused.status_code == 409

    with_jd = await client.post(
        "/api/v1/applications", headers=auth,
        json={"company_name": "Globex", "role_title": "Staff Engineer",
              "job_description_text": JD + " Globex only."},
    )
    application_id = with_jd.json()["id"]
    res = await client.post(
        f"/api/v1/applications/{application_id}/tailor",
        headers=auth, json={"base_resume_id": base_id, "strategy": "full"},
    )
    assert res.status_code == 202, res.text

    async with SessionLocal() as session:
        generation = await session.get(Generation, uuid.UUID(res.json()["id"]))
        assert generation.input["application_id"] == application_id
        assert generation.input["strategy"] == "full"
        assert generation.input["company_name"] == "Globex"
        # Not for the worker in the other tests to pick up.
        await session.execute(
            update(Generation).where(Generation.id == generation.id)
            .values(status=GenerationStatus.CANCELLED)
        )
        await session.commit()


async def test_a_finished_tailoring_links_itself_to_its_application(
    monkeypatch, aran_markdown
) -> None:
    async with SessionLocal() as session:
        user = User(email=f"link-worker-{uuid.uuid4().hex[:8]}@example.com", password_hash="x")
        session.add(user)
        await session.flush()
        session.add(UserSettings(user_id=user.id))
        base = BaseResume(
            user_id=user.id, display_name="Base", target_title="Engineer",
            source=ResumeSource.GENERATED_STORY, content_markdown=aran_markdown, content_text="x",
        )
        application = JobApplication(
            user_id=user.id, company_name="Acme", role_title="Senior AI Engineer",
            job_description_text=JD,
        )
        session.add_all([base, application])
        await session.flush()
        await enqueue(
            session, user_id=user.id, kind=GenerationKind.TAILOR_JOB,
            payload={
                "base_resume_id": str(base.id), "base_resume_md": aran_markdown,
                "job_description": JD, "target_title": "Senior AI Engineer",
                "mode": "grounded", "strategy": "existing",
                "application_id": str(application.id),
            },
        )
        await session.commit()
        application_id = application.id

    use_provider(monkeypatch, StreamingStub([ANALYSIS_JSON, aran_markdown]))
    assert await run_once() is True

    async with SessionLocal() as session:
        application = await session.get(JobApplication, application_id)
        assert application.tailored_resume_id is not None, "the result was not linked"
        tailored = await session.get(TailoredResume, application.tailored_resume_id)
        assert tailored.job_application_id == application_id
        assert tailored.must_have_total == 2
