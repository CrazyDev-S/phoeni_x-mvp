"""Each open posting keeps its resume, across tabs and panel restarts."""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from app.db.session import SessionLocal
from app.main import app
from app.models.enums import GenerationStatus, ResumeStatus
from app.models.generation import Generation
from app.models.resume import BaseResume, TailoredResume
from app.services.generation import job_description_hash
from app.worker.runner import run_once
from tests.test_pipeline import ANALYSIS_JSON, StubProvider
from tests.test_resume_repair import StreamingStub, use_provider

POSTING = "https://jobs.ashbyhq.com/acme/5b1e"
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
        json={"email": f"jobs-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def upload_base(client, auth, markdown: str) -> str:
    res = await client.post(
        "/api/v1/resumes",
        headers=auth,
        json={"display_name": "Base", "target_title": "Engineer", "content_markdown": markdown},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def tailor_body(base_id: str) -> dict:
    return {
        "base_resume_id": base_id,
        "job": {"url": POSTING, "title": "Senior AI Engineer", "company": "Acme", "description_text": JD},
    }


async def lookup(client, auth, *urls: str) -> list[dict]:
    res = await client.post(
        "/api/v1/extension/job-links/lookup", headers=auth, json={"urls": list(urls)}
    )
    assert res.status_code == 200, res.text
    return res.json()["items"]


async def set_status(generation_id: str, status: GenerationStatus) -> None:
    async with SessionLocal() as session:
        await session.execute(
            update(Generation).where(Generation.id == uuid.UUID(generation_id)).values(status=status)
        )
        await session.commit()


async def test_a_resume_linked_without_tailoring_follows_the_posting_to_its_form(
    client, auth, aran_markdown
) -> None:
    base_id = await upload_base(client, auth, aran_markdown)
    res = await client.put(
        "/api/v1/extension/job-links",
        headers=auth,
        json={"url": POSTING + "?utm_source=linkedin", "resume": {"kind": "base", "id": base_id}},
    )
    assert res.status_code == 200, res.text
    assert res.json()["resume"]["id"] == base_id

    form_tab, other_tab = await lookup(
        client, auth, POSTING + "/application", "https://jobs.example.com/other"
    )
    assert form_tab["resume"] == res.json()["resume"]
    assert form_tab["linked"] is True
    assert other_tab["resume"] is None

    facts = await client.get(
        "/api/v1/extension/resume-facts",
        headers=auth,
        params={"kind": "base", "resume_id": base_id},
    )
    assert facts.status_code == 200, facts.text
    assert facts.json()["facts"]["email"] == "aran.thammasiri@outlook.com"
    assert facts.json()["facts"]["current_company"] == "Veeva Systems"

    res = await client.put(
        "/api/v1/extension/job-links", headers=auth, json={"url": POSTING, "resume": None}
    )
    assert res.json()["resume"] is None


async def test_tailoring_from_a_tab_links_the_result_to_its_posting(
    client, auth, aran_markdown, monkeypatch
) -> None:
    base_id = await upload_base(client, auth, aran_markdown)
    res = await client.post("/api/v1/extension/tailor", headers=auth, json=tailor_body(base_id))
    assert res.status_code == 202, res.text
    generation_id = res.json()["id"]

    (queued,) = await lookup(client, auth, POSTING)
    assert queued["generation"]["status"] == "queued"
    assert queued["resume"] is None

    # run_once takes the oldest queued job anywhere, which must be this one.
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
    use_provider(monkeypatch, StreamingStub([ANALYSIS_JSON, aran_markdown]))
    assert await run_once() is True

    # Found from the application form as well, with no panel left to wait for it.
    (done,) = await lookup(client, auth, POSTING + "/application")
    assert done["generation"]["status"] in ("succeeded", "needs_review")
    assert done["resume"]["kind"] == "tailored"
    assert done["resume"]["base_resume_id"] == base_id


async def test_a_failed_tailoring_can_be_tried_again(client, auth, aran_markdown) -> None:
    base_id = await upload_base(client, auth, aran_markdown)
    first = (await client.post("/api/v1/extension/tailor", headers=auth, json=tailor_body(base_id))).json()
    double_click = (
        await client.post("/api/v1/extension/tailor", headers=auth, json=tailor_body(base_id))
    ).json()
    assert double_click["id"] == first["id"]

    await set_status(first["id"], GenerationStatus.FAILED)
    retry = await client.post("/api/v1/extension/tailor", headers=auth, json=tailor_body(base_id))
    assert retry.status_code == 202, retry.text
    assert retry.json()["id"] != first["id"]

    (link,) = await lookup(client, auth, POSTING)
    assert link["generation"]["id"] == retry.json()["id"]
    # Not for the worker in another test to pick up.
    await set_status(retry.json()["id"], GenerationStatus.CANCELLED)


async def test_a_form_is_answered_from_its_postings_resume(
    client, auth, aran_markdown, monkeypatch
) -> None:
    base_id = await upload_base(client, auth, aran_markdown)
    await client.put(
        "/api/v1/extension/job-links",
        headers=auth,
        json={
            "url": POSTING,
            "resume": {"kind": "base", "id": base_id},
            "job": {"url": POSTING, "company": "Acme", "description_text": JD},
        },
    )
    stub = StubProvider(["{}"])

    async def fast_model(session, user_id, tier):
        return stub

    monkeypatch.setattr("app.api.v1.extension.get_provider", fast_model)

    fields = [
        {"id": "f0:0", "type": "email", "label": "Email"},
        {"id": "f0:1", "type": "file", "label": "Resume"},
        {"id": "f0:2", "type": "textarea", "label": "Anything else we should know?"},
    ]
    body = {"job_url": POSTING + "/application", "frames": [{"frame_key": "f0", "fields": fields}]}
    res = await client.post("/api/v1/extension/autofill", headers=auth, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["resume"]["id"] == base_id
    assert [a["answer"] for a in data["answers"]] == ["aran.thammasiri@outlook.com", "resume"]
    assert data["facts"]["full_name"] == "Aran Thammasiri"
    # The posting's description reached the model, not the form page's text.
    assert "Must have FastAPI" in stub.requests[0].messages[0]["content"]

    again = (await client.post("/api/v1/extension/autofill", headers=auth, json=body)).json()
    assert again["cached"] is True
    assert again["facts"]["full_name"] == "Aran Thammasiri"
    assert len(stub.requests) == 1

    # A reply that could not be read is never cached, so Re-scan really retries.
    stub.replies = ["not json", "not json"]
    body["frames"][0]["fields"].append({"id": "f0:3", "type": "text", "label": "Pronunciation"})
    for _ in range(2):
        retried = (await client.post("/api/v1/extension/autofill", headers=auth, json=body)).json()
        assert retried["cached"] is False
        assert retried["complete"] is False


async def tailored_row(base_id: str, markdown: str, *, source: str, url: str | None) -> str:
    async with SessionLocal() as session:
        base = await session.get(BaseResume, uuid.UUID(base_id))
        row = TailoredResume(
            user_id=base.user_id,
            base_resume_id=base.id,
            display_name=f"Acme — {source}",
            job_url=url,
            job_source=source,
            job_description_text=JD,
            # One saved row per (base, posting): each source gets its own.
            job_description_hash=job_description_hash(f"{JD} {source}"),
            content_markdown=markdown,
            content_text="x",
            status=ResumeStatus.FINAL,
        )
        session.add(row)
        await session.commit()
        return str(row.id)


async def test_a_resume_tailored_in_the_panel_is_listed_once_it_is_saved(
    client, auth, aran_markdown
) -> None:
    base_id = await upload_base(client, auth, aran_markdown)
    from_panel = await tailored_row(base_id, aran_markdown, source="extension", url=POSTING)
    from_portal = await tailored_row(base_id, aran_markdown, source="web", url=None)

    async def listed() -> set[str]:
        res = await client.get("/api/v1/tailored-resumes", headers=auth)
        assert res.status_code == 200, res.text
        assert res.json()["total"] == len(res.json()["items"])
        return {item["id"] for item in res.json()["items"]}

    assert await listed() == {from_portal}
    # Still the posting's resume in the panel, to fill the form with and save.
    (tab,) = await lookup(client, auth, POSTING)
    assert tab["resume"]["id"] == from_panel
    assert tab["resume"]["application_id"] is None

    res = await client.post(
        "/api/v1/extension/save-application",
        headers=auth,
        json={
            "tailored_resume_id": from_panel,
            "company_name": "Acme",
            "role_title": "Senior AI Engineer",
            "job_url": POSTING + "/application",
        },
    )
    assert res.status_code == 201, res.text
    assert await listed() == {from_panel, from_portal}
    (tab,) = await lookup(client, auth, POSTING)
    assert tab["resume"]["application_id"] == res.json()["id"]
