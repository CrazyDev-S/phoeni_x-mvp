"""Scheduling an interview, and the tracking table that has to agree with it.

A stage's status and its meetings describe one fact from two sides. Every test
here changes one side and checks the other followed.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.timezone import app_today
from app.db.session import SessionLocal
from app.main import app
from app.models.resume import BaseResume, TailoredResume
from app.services.seed import DEFAULT_PIPELINE


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    email = f"schedule-{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "a-strong-password"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def make_application(client, auth) -> dict:
    res = await client.post(
        "/api/v1/applications",
        headers=auth,
        json={
            "company_name": "Acme",
            "role_title": "Staff Engineer",
            "job_url": "https://acme.example/jobs/1",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


def stage_of(application: dict, kind: str) -> dict:
    return next(s for s in application["stages"] if s["kind"] == kind)


async def book(client, auth, stage_id: str, *, local_time: str = "10:00") -> dict:
    day = app_today() + timedelta(days=3)
    res = await client.post(
        "/api/v1/meetings",
        headers=auth,
        json={
            "title": "Recruiter Screen — Acme",
            "local_date": day.isoformat(),
            "local_time": local_time,
            "duration_min": 30,
            "stage_id": stage_id,
            "meeting_type": "recruiter_screen",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


async def row_for(client, auth, application_id: str) -> dict:
    res = await client.get("/api/v1/applications", headers=auth)
    assert res.status_code == 200, res.text
    return next(r for r in res.json()["items"] if r["id"] == application_id)


async def test_each_row_carries_every_stage_in_pipeline_order(client, auth) -> None:
    application = await make_application(client, auth)
    row = await row_for(client, auth, application["id"])

    assert [s["name"] for s in row["stages"]] == [name for name, _, _ in DEFAULT_PIPELINE]
    assert stage_of(row, "applied")["status"] == "passed"
    assert all(s["meetings"] == [] for s in row["stages"])


async def test_booking_a_stage_schedules_it_everywhere(client, auth) -> None:
    application = await make_application(client, auth)
    screen = stage_of(application, "recruiter_screen")

    meeting = await book(client, auth, screen["id"])
    # The calendar block can say who the call is with.
    assert meeting["company_name"] == "Acme"
    assert meeting["stage_name"] == "Recruiter Screen"
    assert meeting["application_id"] == application["id"]

    row = await row_for(client, auth, application["id"])
    cell = stage_of(row, "recruiter_screen")
    assert cell["status"] == "scheduled"
    assert cell["scheduled_for"] == meeting["starts_at"]
    assert [m["id"] for m in cell["meetings"]] == [meeting["id"]]
    assert row["next_meeting"]["id"] == meeting["id"]
    # A booked interview means the application reached a conversation.
    assert row["status"] == "in_process"

    day = meeting["starts_at"][:10]
    res = await client.get(
        f"/api/v1/meetings?from={app_today().isoformat()}&to={day}", headers=auth
    )
    listed = next(m for m in res.json() if m["id"] == meeting["id"])
    assert listed["company_name"] == "Acme"


async def test_moving_the_meeting_moves_the_stage(client, auth) -> None:
    application = await make_application(client, auth)
    screen = stage_of(application, "recruiter_screen")
    meeting = await book(client, auth, screen["id"])

    res = await client.patch(
        f"/api/v1/meetings/{meeting['id']}", headers=auth, json={"local_time": "15:30"}
    )
    assert res.status_code == 200, res.text
    moved = res.json()
    assert moved["starts_at"] != meeting["starts_at"]

    cell = stage_of(await row_for(client, auth, application["id"]), "recruiter_screen")
    assert cell["scheduled_for"] == moved["starts_at"]
    assert cell["status"] == "scheduled"


@pytest.mark.parametrize(
    ("meeting_status", "stage_status"),
    [("cancelled", "pending"), ("held", "waiting_feedback"), ("no_show", "no_show")],
)
async def test_meeting_outcome_is_reflected_on_the_stage(
    client, auth, meeting_status: str, stage_status: str
) -> None:
    application = await make_application(client, auth)
    screen = stage_of(application, "recruiter_screen")
    meeting = await book(client, auth, screen["id"])

    res = await client.patch(
        f"/api/v1/meetings/{meeting['id']}", headers=auth, json={"status": meeting_status}
    )
    assert res.status_code == 200, res.text

    cell = stage_of(await row_for(client, auth, application["id"]), "recruiter_screen")
    assert cell["status"] == stage_status
    if meeting_status == "cancelled":
        # The table must stop claiming a call that will not happen.
        assert cell["scheduled_for"] is None


async def test_deleting_the_only_meeting_returns_the_stage_to_pending(client, auth) -> None:
    application = await make_application(client, auth)
    screen = stage_of(application, "recruiter_screen")
    meeting = await book(client, auth, screen["id"])

    res = await client.delete(f"/api/v1/meetings/{meeting['id']}", headers=auth)
    assert res.status_code == 204

    cell = stage_of(await row_for(client, auth, application["id"]), "recruiter_screen")
    assert cell["status"] == "pending"
    assert cell["scheduled_for"] is None
    assert cell["meetings"] == []


async def test_a_decided_stage_is_not_overruled_by_the_calendar(client, auth) -> None:
    application = await make_application(client, auth)
    screen = stage_of(application, "recruiter_screen")
    meeting = await book(client, auth, screen["id"])

    res = await client.patch(
        f"/api/v1/stages/{screen['id']}", headers=auth, json={"status": "passed"}
    )
    assert res.status_code == 200, res.text
    await client.patch(
        f"/api/v1/meetings/{meeting['id']}", headers=auth, json={"status": "held"}
    )

    cell = stage_of(await row_for(client, auth, application["id"]), "recruiter_screen")
    assert cell["status"] == "passed"


async def test_undoing_a_failed_stage_reopens_the_application(client, auth) -> None:
    application = await make_application(client, auth)
    screen = stage_of(application, "recruiter_screen")

    res = await client.patch(
        f"/api/v1/stages/{screen['id']}", headers=auth, json={"status": "failed"}
    )
    assert res.json()["application_status"] == "rejected"

    res = await client.patch(
        f"/api/v1/stages/{screen['id']}", headers=auth, json={"status": "pending"}
    )
    assert res.json()["application_status"] == "in_process"


async def test_detail_carries_the_resume_sent_and_the_company(
    client, auth, aran_markdown
) -> None:
    res = await client.post(
        "/api/v1/resumes",
        headers=auth,
        json={
            "display_name": "Platform Engineer",
            "target_title": "Engineer",
            "content_markdown": aran_markdown,
        },
    )
    assert res.status_code == 201, res.text
    base_id = uuid.UUID(res.json()["id"])

    async with SessionLocal() as session:
        base = await session.get(BaseResume, base_id)
        tailored = TailoredResume(
            user_id=base.user_id,
            base_resume_id=base.id,
            display_name="Acme — Staff Engineer",
            company_name="Acme",
            job_description_text="jd",
            job_description_hash=uuid.uuid4().bytes * 2,
            content_markdown=base.content_markdown,
            content_text=base.content_text,
            must_have_covered=9,
            must_have_total=10,
            must_have_coverage_percent=90,
        )
        session.add(tailored)
        await session.commit()
        tailored_id = str(tailored.id)

    application = await make_application(client, auth)
    res = await client.patch(
        f"/api/v1/applications/{application['id']}",
        headers=auth,
        json={
            "tailored_resume_id": tailored_id,
            "company_domain": "acme.example",
            "salary_min": 180000,
            "salary_max": 220000,
            "salary_currency": "USD",
        },
    )
    assert res.status_code == 200, res.text

    detail = (
        await client.get(f"/api/v1/applications/{application['id']}", headers=auth)
    ).json()
    assert detail["job_url"] == "https://acme.example/jobs/1"
    assert detail["company_domain"] == "acme.example"
    assert (detail["salary_min"], detail["salary_max"]) == (180000, 220000)
    resume = detail["tailored_resume"]
    assert resume["id"] == tailored_id
    assert resume["base_resume_name"] == "Platform Engineer"
    assert resume["must_have_coverage_percent"] == 90.0
    assert resume["content_markdown"]

    # Unlinking forgets the association and leaves the resume alone.
    res = await client.patch(
        f"/api/v1/applications/{application['id']}",
        headers=auth,
        json={"tailored_resume_id": None},
    )
    assert res.json()["tailored_resume"] is None
    assert (
        await client.get(f"/api/v1/tailored-resumes/{tailored_id}", headers=auth)
    ).status_code == 200


async def test_linking_a_resume_you_do_not_own_is_refused(client, auth) -> None:
    application = await make_application(client, auth)
    res = await client.patch(
        f"/api/v1/applications/{application['id']}",
        headers=auth,
        json={"tailored_resume_id": str(uuid.uuid4())},
    )
    assert res.status_code == 404
