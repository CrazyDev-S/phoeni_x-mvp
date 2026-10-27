"""An application and the tailored resume sent with it stay linked both ways."""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, update

from app.db.session import SessionLocal
from app.main import app
from app.models.application import JobApplication
from app.models.enums import GenerationKind, GenerationStatus, ResumeSource, ResumeStatus
from app.models.generation import Generation
from app.models.resume import BaseResume, TailoredResume
from app.models.user import User, UserSettings
from app.services.generation import enqueue, job_description_hash
from app.worker.runner import run_once
from tests.test_pipeline import CRITERIA_JSON
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
        "/api/v1/remote/resumes",
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
        "/api/v1/remote/applications",
        headers=auth,
        json={"company_name": "Acme", "role_title": "Senior AI Engineer",
              "tailored_resume_id": tailored_id},
    )
    assert res.status_code == 201, res.text
    application_id = res.json()["id"]
    assert str(await reverse_link(tailored_id)) == application_id

    res = await client.patch(
        f"/api/v1/remote/applications/{application_id}", headers=auth, json={"tailored_resume_id": None}
    )
    assert res.status_code == 200, res.text
    assert res.json()["resume"] is None
    assert await reverse_link(tailored_id) is None


async def test_an_unlinked_application_suggests_the_resume_for_its_posting(
    client, auth, aran_markdown
) -> None:
    base_id, tailored_id = await make_tailored(client, auth, aran_markdown)
    res = await client.post(
        "/api/v1/remote/applications",
        headers=auth,
        json={"company_name": "Acme", "role_title": "Senior AI Engineer", "job_url": JOB_URL},
    )
    detail = (await client.get(f"/api/v1/remote/applications/{res.json()['id']}", headers=auth)).json()

    assert detail["resume"] is None
    assert detail["suggested_resume"]["id"] == tailored_id
    assert detail["suggested_resume"]["reason"] == "tailored"
    # Lets "Tailor a resume for this job" start from the same base resume.
    assert detail["suggested_resume"]["base_resume_id"] == base_id


async def test_tailoring_from_an_application_uses_its_posting(client, auth, aran_markdown) -> None:
    base_id, _ = await make_tailored(client, auth, aran_markdown)
    without_jd = await client.post(
        "/api/v1/remote/applications", headers=auth,
        json={"company_name": "Blank", "role_title": "Engineer"},
    )
    refused = await client.post(
        f"/api/v1/remote/applications/{without_jd.json()['id']}/tailor",
        headers=auth, json={"base_resume_id": base_id},
    )
    assert refused.status_code == 409

    with_jd = await client.post(
        "/api/v1/remote/applications", headers=auth,
        json={"company_name": "Globex", "role_title": "Staff Engineer",
              "job_description_text": JD + " Globex only."},
    )
    application_id = with_jd.json()["id"]
    res = await client.post(
        f"/api/v1/remote/applications/{application_id}/tailor",
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

    use_provider(monkeypatch, StreamingStub([CRITERIA_JSON, aran_markdown]))
    assert await run_once() is True

    async with SessionLocal() as session:
        application = await session.get(JobApplication, application_id)
        assert application.tailored_resume_id is not None, "the result was not linked"
        tailored = await session.get(TailoredResume, application.tailored_resume_id)
        assert tailored.job_application_id == application_id
        assert tailored.must_have_total == 2


async def test_the_library_lists_the_jobs_each_resume_is_linked_to(
    client, auth, aran_markdown
) -> None:
    base_id, tailored_id = await make_tailored(client, auth, aran_markdown)
    # The side panel links the posting's form first; saving it as an application
    # keeps that link, and the library must not count the job twice.
    linked = await client.put(
        "/api/v1/remote/extension/job-links",
        headers=auth,
        json={"url": JOB_URL + "/application", "resume": {"kind": "tailored", "id": tailored_id}},
    )
    assert linked.status_code == 200, linked.text
    application = await client.post(
        "/api/v1/remote/applications",
        headers=auth,
        json={"company_name": "Acme", "role_title": "Senior AI Engineer", "job_url": JOB_URL,
              "tailored_resume_id": tailored_id},
    )
    assert application.status_code == 201, application.text
    other = "https://jobs.example.com/globex/9"
    linked = await client.put(
        "/api/v1/remote/extension/job-links",
        headers=auth,
        json={"url": other, "resume": {"kind": "base", "id": base_id},
              "job": {"url": other, "title": "Staff Engineer", "company": "Globex",
                      "description_text": JD}},
    )
    assert linked.status_code == 200, linked.text

    tailored = (await client.get("/api/v1/remote/tailored-resumes", headers=auth)).json()["items"]
    assert [row["linked_jobs"] for row in tailored if row["id"] == tailored_id] == [[{
        "application_id": application.json()["id"], "company_name": "Acme",
        "job_title": "Senior AI Engineer", "job_url": JOB_URL,
    }]]
    # The base is linked only where it was used as it is, not where its
    # tailored version was.
    bases = (await client.get("/api/v1/remote/resumes", headers=auth)).json()["items"]
    assert [row["linked_jobs"] for row in bases if row["id"] == base_id] == [[{
        "application_id": None, "company_name": "Globex",
        "job_title": "Staff Engineer", "job_url": other,
    }]]


async def run_only(generation_id: str) -> None:
    """Run one queued generation: run_once takes the oldest anywhere."""
    async with SessionLocal() as session:
        await session.execute(
            update(Generation)
            .where(
                Generation.status == GenerationStatus.QUEUED,
                Generation.id != uuid.UUID(generation_id),
            )
            .values(status=GenerationStatus.CANCELLED)
        )
        await session.commit()
    assert await run_once() is True
    async with SessionLocal() as session:
        generation = await session.get(Generation, uuid.UUID(generation_id))
        assert generation.status is not GenerationStatus.FAILED, generation.error_detail


async def test_an_application_can_go_with_a_base_resume(client, auth, aran_markdown) -> None:
    base_id, tailored_id = await make_tailored(client, auth, aran_markdown)
    res = await client.post(
        "/api/v1/remote/applications",
        headers=auth,
        json={"company_name": "Acme", "role_title": "Senior AI Engineer", "job_url": JOB_URL,
              "tailored_resume_id": tailored_id},
    )
    application_id = res.json()["id"]

    res = await client.patch(
        f"/api/v1/remote/applications/{application_id}",
        headers=auth,
        json={"resume": {"kind": "base", "id": base_id}},
    )
    assert res.status_code == 200, res.text
    resume = res.json()["resume"]
    assert (resume["kind"], resume["id"], resume["base_resume_id"]) == ("base", base_id, base_id)
    assert res.json()["tailored_resume_id"] is None
    # Never tailored to this job, so it has no coverage to show for it.
    assert resume["must_have_coverage_percent"] is None
    assert await reverse_link(tailored_id) is None

    # The side panel shows the same resume on the posting and its form.
    (tab,) = (
        await client.post(
            "/api/v1/remote/extension/job-links/lookup",
            headers=auth,
            json={"urls": [JOB_URL + "/application"]},
        )
    ).json()["items"]
    assert (tab["resume"]["kind"], tab["resume"]["id"]) == ("base", base_id)
    assert tab["application_id"] == application_id

    res = await client.patch(
        f"/api/v1/remote/applications/{application_id}", headers=auth, json={"resume": None}
    )
    assert res.json()["resume"] is None
    assert res.json()["base_resume_id"] is None
    (tab,) = (
        await client.post(
            "/api/v1/remote/extension/job-links/lookup", headers=auth, json={"urls": [JOB_URL]}
        )
    ).json()["items"]
    assert tab["linked"] is False

    missing = await client.patch(
        f"/api/v1/remote/applications/{application_id}",
        headers=auth,
        json={"resume": {"kind": "base", "id": str(uuid.uuid4())}},
    )
    assert missing.status_code == 404


async def test_tailoring_a_linked_base_resume_rewrites_it_in_place(
    client, auth, aran_markdown, monkeypatch
) -> None:
    base_id, _ = await make_tailored(client, auth, aran_markdown)
    res = await client.post(
        "/api/v1/remote/applications",
        headers=auth,
        json={"company_name": "Globex", "role_title": "Staff Engineer",
              "job_description_text": JD + " Globex only.",
              "resume": {"kind": "base", "id": base_id}},
    )
    application_id = res.json()["id"]

    res = await client.post(
        f"/api/v1/remote/applications/{application_id}/upgrade-resume",
        headers=auth,
        json={"strategy": "existing"},
    )
    assert res.status_code == 202, res.text
    again = await client.post(
        f"/api/v1/remote/applications/{application_id}/upgrade-resume", headers=auth, json={}
    )
    assert again.json()["id"] == res.json()["id"], "a run already going is reused"

    use_provider(monkeypatch, StreamingStub([CRITERIA_JSON, aran_markdown]))
    await run_only(res.json()["id"])

    async with SessionLocal() as session:
        generation = await session.get(Generation, uuid.UUID(res.json()["id"]))
        assert (generation.result_kind, str(generation.result_id)) == ("base_resume", base_id)
        base = await session.get(BaseResume, uuid.UUID(base_id))
        assert base.job_description_text == JD + " Globex only."
        tailored = await session.scalar(
            select(func.count()).where(
                TailoredResume.base_resume_id == base.id,
                TailoredResume.job_description_hash == job_description_hash(JD + " Globex only."),
            )
        )
        assert tailored == 0, "tailoring a linked resume must not add another"

    detail = (await client.get(f"/api/v1/remote/applications/{application_id}", headers=auth)).json()
    assert (detail["resume"]["kind"], detail["resume"]["id"]) == ("base", base_id)
    # Now scored against this job's description.
    assert detail["resume"]["must_have_total"] == 2


async def test_tailoring_a_resume_made_for_another_job_moves_it_to_this_one(
    client, auth, aran_markdown, monkeypatch
) -> None:
    base_id, tailored_id = await make_tailored(client, auth, aran_markdown)
    other_jd = JD + " Initech, payments team."
    res = await client.post(
        "/api/v1/remote/applications",
        headers=auth,
        json={"company_name": "Initech", "role_title": "Payments Engineer",
              "job_description_text": other_jd, "tailored_resume_id": tailored_id},
    )
    application_id = res.json()["id"]

    # The same base already has a resume for this job: refused before paying.
    async with SessionLocal() as session:
        base = await session.get(BaseResume, uuid.UUID(base_id))
        clash = TailoredResume(
            user_id=base.user_id, base_resume_id=base.id, display_name="Initech — clash",
            job_description_text=other_jd, job_description_hash=job_description_hash(other_jd),
            content_markdown=aran_markdown, content_text="x", status=ResumeStatus.FINAL,
        )
        session.add(clash)
        await session.commit()
        clash_id = clash.id
    refused = await client.post(
        f"/api/v1/remote/applications/{application_id}/upgrade-resume", headers=auth, json={}
    )
    assert refused.status_code == 409
    assert "Initech — clash" in refused.json()["detail"]
    await client.delete(f"/api/v1/remote/tailored-resumes/{clash_id}", headers=auth)

    res = await client.post(
        f"/api/v1/remote/applications/{application_id}/upgrade-resume", headers=auth, json={}
    )
    assert res.status_code == 202, res.text
    use_provider(monkeypatch, StreamingStub([CRITERIA_JSON, aran_markdown]))
    await run_only(res.json()["id"])

    async with SessionLocal() as session:
        tailored = await session.get(TailoredResume, uuid.UUID(tailored_id))
        assert tailored.job_description_hash == job_description_hash(other_jd)
        assert tailored.company_name == "Initech"
        assert tailored.job_application_id == uuid.UUID(application_id)
