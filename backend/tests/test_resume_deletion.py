"""Deleting a resume.

Delete means permanently gone. The only thing guarded is collateral damage:
tailored versions are the documents somebody actually applied with, so they are
never destroyed as an invisible side effect of deleting their parent.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import SessionLocal
from app.main import app
from app.models.application import JobApplication
from app.models.resume import BaseResume, TailoredResume


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    email = f"delete-{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "a-strong-password"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def make_base(headers, client, markdown: str, name: str) -> str:
    res = await client.post(
        "/api/v1/resumes",
        headers=headers,
        json={"display_name": name, "target_title": "Engineer", "content_markdown": markdown},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def add_tailored(base_id: str) -> uuid.UUID:
    async with SessionLocal() as session:
        base = await session.get(BaseResume, uuid.UUID(base_id))
        row = TailoredResume(
            user_id=base.user_id,
            base_resume_id=base.id,
            display_name=f"Acme — {uuid.uuid4().hex[:6]}",
            job_description_text="jd",
            job_description_hash=b"0" * 32,
            content_markdown=base.content_markdown,
            content_text=base.content_text,
        )
        session.add(row)
        await session.commit()
        return row.id


async def test_delete_removes_it_permanently(client, auth, aran_markdown) -> None:
    resume_id = await make_base(auth, client, aran_markdown, "Solo")

    assert (await client.delete(f"/api/v1/resumes/{resume_id}", headers=auth)).status_code == 204
    assert (await client.get(f"/api/v1/resumes/{resume_id}", headers=auth)).status_code == 404

    # Really gone from the table, not merely hidden.
    async with SessionLocal() as session:
        assert await session.get(BaseResume, uuid.UUID(resume_id)) is None


async def test_delete_is_refused_while_tailored_versions_exist(
    client, auth, aran_markdown
) -> None:
    resume_id = await make_base(auth, client, aran_markdown, "HasChildren")
    await add_tailored(resume_id)

    res = await client.delete(f"/api/v1/resumes/{resume_id}", headers=auth)
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "HAS_TAILORED_VERSIONS"
    # The count is what lets the UI name the damage in its confirmation.
    assert detail["tailored_count"] == 1

    # And nothing was destroyed by the refused attempt.
    assert (await client.get(f"/api/v1/resumes/{resume_id}", headers=auth)).status_code == 200


async def test_cascade_deletes_the_tailored_versions_too(
    client, auth, aran_markdown
) -> None:
    resume_id = await make_base(auth, client, aran_markdown, "Cascade")
    tailored_id = await add_tailored(resume_id)

    res = await client.delete(f"/api/v1/resumes/{resume_id}?cascade=true", headers=auth)
    assert res.status_code == 204

    async with SessionLocal() as session:
        assert await session.get(BaseResume, uuid.UUID(resume_id)) is None
        assert await session.get(TailoredResume, tailored_id) is None


async def test_deleting_a_tailored_version_keeps_the_application(
    client, auth, aran_markdown
) -> None:
    """You applied. Deleting the document does not delete that fact."""
    resume_id = await make_base(auth, client, aran_markdown, "WithApplication")
    tailored_id = await add_tailored(resume_id)

    async with SessionLocal() as session:
        base = await session.get(BaseResume, uuid.UUID(resume_id))
        application = JobApplication(
            user_id=base.user_id,
            tailored_resume_id=tailored_id,
            company_name="Acme",
            role_title="Senior Engineer",
        )
        session.add(application)
        await session.commit()
        application_id = application.id

    res = await client.delete(f"/api/v1/tailored-resumes/{tailored_id}", headers=auth)
    assert res.status_code == 204

    async with SessionLocal() as session:
        assert await session.get(TailoredResume, tailored_id) is None
        kept = await session.get(JobApplication, application_id)
        assert kept is not None
        assert kept.tailored_resume_id is None


async def test_archive_hides_without_destroying(client, auth, aran_markdown) -> None:
    resume_id = await make_base(auth, client, aran_markdown, "Archivable")

    assert (await client.post(f"/api/v1/resumes/{resume_id}/archive", headers=auth)).status_code == 200
    listed = (await client.get("/api/v1/resumes", headers=auth)).json()
    assert resume_id not in [r["id"] for r in listed["items"]]

    with_archived = (
        await client.get("/api/v1/resumes?include_archived=true", headers=auth)
    ).json()
    assert resume_id in [r["id"] for r in with_archived["items"]]

    assert (await client.post(f"/api/v1/resumes/{resume_id}/restore", headers=auth)).status_code == 200
    back = (await client.get("/api/v1/resumes", headers=auth)).json()
    assert resume_id in [r["id"] for r in back["items"]]


async def test_you_cannot_delete_someone_elses_resume(client, auth, aran_markdown) -> None:
    resume_id = await make_base(auth, client, aran_markdown, "Mine")

    other = await client.post(
        "/api/v1/auth/register",
        json={"email": f"other-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    assert (await client.delete(f"/api/v1/resumes/{resume_id}", headers=headers)).status_code == 404
    async with SessionLocal() as session:
        assert await session.get(BaseResume, uuid.UUID(resume_id)) is not None
