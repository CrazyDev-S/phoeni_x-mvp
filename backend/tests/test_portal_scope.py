"""Calendar and job maintenance are shared tools, scoped to one portal at a time.

Freelancing and Remote are separate portals. A meeting or a maintained job shows
in exactly the portal it belongs to, and in neither when the filter names the
other.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.timezone import app_today
from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": f"portal-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def add_job(client, auth, category: str | None, employer: str) -> dict:
    body = {"employer_name": employer, "role_title": "Engineer", "start_date": "2026-09-01"}
    if category:
        body["category"] = category
    res = await client.post("/api/v1/shared/maintained-jobs", headers=auth, json=body)
    assert res.status_code == 201, res.text
    return res.json()


async def add_meeting(client, auth, job_id: str) -> dict:
    day = app_today() + timedelta(days=2)
    res = await client.post(
        "/api/v1/shared/meetings",
        headers=auth,
        json={
            "title": "Weekly sync",
            "local_date": day.isoformat(),
            "local_time": "10:00",
            "duration_min": 30,
            "maintained_job_id": job_id,
            "meeting_type": "team_sync",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_jobs_are_listed_in_their_own_portal_only(client, auth):
    remote = await add_job(client, auth, None, "Acme")
    freelance = await add_job(client, auth, "freelancing", "Globex")
    assert remote["category"] == "remote"
    assert freelance["category"] == "freelancing"

    async def ids(category: str | None) -> set[str]:
        params = {"category": category} if category else {}
        res = await client.get("/api/v1/shared/maintained-jobs", headers=auth, params=params)
        assert res.status_code == 200, res.text
        return {j["id"] for j in res.json()}

    assert await ids("remote") == {remote["id"]}
    assert await ids("freelancing") == {freelance["id"]}
    assert await ids(None) == {remote["id"], freelance["id"]}


async def test_meetings_follow_the_job_they_belong_to(client, auth):
    remote_job = await add_job(client, auth, "remote", "Acme")
    freelance_job = await add_job(client, auth, "freelancing", "Globex")
    remote_meeting = await add_meeting(client, auth, remote_job["id"])
    freelance_meeting = await add_meeting(client, auth, freelance_job["id"])

    today = app_today()
    window = {"from": today.isoformat(), "to": (today + timedelta(days=7)).isoformat()}

    async def ids(path: str, **params) -> set[str]:
        res = await client.get(f"/api/v1/shared/meetings{path}", headers=auth, params=params)
        assert res.status_code == 200, res.text
        body = res.json()
        return {item.get("meeting", item)["id"] for item in body}

    assert await ids("", category="remote", **window) == {remote_meeting["id"]}
    assert await ids("", category="freelancing", **window) == {freelance_meeting["id"]}
    assert await ids("", **window) == {remote_meeting["id"], freelance_meeting["id"]}
    # The notification feed and the "next call" banner are scoped the same way.
    assert await ids("/upcoming", category="freelancing") == {freelance_meeting["id"]}
    res = await client.get(
        "/api/v1/shared/meetings/next", headers=auth, params={"category": "remote"}
    )
    assert res.json()["meeting"]["id"] == remote_meeting["id"]
