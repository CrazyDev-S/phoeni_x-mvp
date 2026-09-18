"""Reviewing and editing a tailored resume by hand."""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import SessionLocal
from app.main import app
from app.models.resume import BaseResume, TailoredResume

LEDGER = {
    "mode": "grounded",
    "total_years": 9,
    "keyword_plan": [
        {"keyword": "FastAPI", "priority": "MUST"},
        {"keyword": "Rust", "priority": "MUST"},
    ],
}


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": f"edit-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def make_tailored(client, headers, markdown: str) -> str:
    res = await client.post(
        "/api/v1/resumes",
        headers=headers,
        json={"display_name": "Base", "target_title": "Engineer", "content_markdown": markdown},
    )
    assert res.status_code == 201, res.text
    async with SessionLocal() as session:
        base = await session.get(BaseResume, uuid.UUID(res.json()["id"]))
        row = TailoredResume(
            user_id=base.user_id,
            base_resume_id=base.id,
            display_name="Acme — Engineer",
            job_title="Senior AI Engineer",
            job_description_text="Must have FastAPI and Rust.",
            job_description_hash=uuid.uuid4().bytes * 2,
            content_markdown=markdown,
            content_text="x",
            ledger=LEDGER,
            must_have_covered=0,
            must_have_total=0,
        )
        session.add(row)
        await session.commit()
        return str(row.id)


async def test_an_edit_rescores_against_the_keyword_plan(client, auth, aran_markdown) -> None:
    """Regression: an edit re-ran the rules without the plan and left the
    coverage figures describing the version before it."""
    resume_id = await make_tailored(client, auth, aran_markdown)

    res = await client.patch(
        f"/api/v1/tailored-resumes/{resume_id}",
        headers=auth,
        json={"content_markdown": aran_markdown},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["must_have_covered"], body["must_have_total"]) == (1, 2)  # no Rust
    assert body["status"] == "final"  # a missing keyword is not a rule error
    assert any(f["rule_id"] == "MUST_HAVE_COVERAGE" for f in body["validation"]["findings"])


async def test_an_edit_that_breaks_a_rule_is_held_for_review(client, auth, aran_markdown) -> None:
    resume_id = await make_tailored(client, auth, aran_markdown)
    broken = aran_markdown.replace("Mentored 4 engineers", "Mentored several engineers")

    res = await client.patch(
        f"/api/v1/tailored-resumes/{resume_id}",
        headers=auth,
        json={"content_markdown": broken},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "needs_review"
