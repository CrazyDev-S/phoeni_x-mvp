"""The Freelancing category, end to end: the extension fills one shared list.

Captures are posted the way the extension sends them - the job key, the
harvested title, description, skills, labelled elements and visible text - so
these tests check the parser against Upwork's real wording as well as the API.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.timezone import app_today
from app.freelancing.capture import normalize, stored_view
from app.llm.provider import LLMEvent
from app.main import app
from app.models.enums import FreelanceJobType
from app.worker.runner import run_once

KEY = "~022056488576136638272"
TITLE = "Senior FastAPI developer for an AI product"

TILE = {
    "upwork_id": KEY,
    "view": "tile",
    "url": f"https://www.upwork.com/jobs/Senior-FastAPI_{KEY}/?referrer_url_path=/nx/search/jobs/",
    "title": TITLE,
    "description": "We need a Python engineer to own our FastAPI backend. PostgreSQL and LLM APIs…",
    "skills": ["Python", "FastAPI", "PostgreSQL", "+2"],
    "labels": {"job-pubilshed-date": "Posted 2 hours ago", "location": "Location\nUnited States"},
    "text": (
        f"Posted 2 hours ago\n{TITLE}\nHourly: $40.00 - $70.00\nExpert\n"
        "Est. time: More than 6 months, 30+ hrs/week\n"
        "We need a Python engineer to own our FastAPI backend. PostgreSQL and LLM APIs…\n"
        "Python\nFastAPI\nPostgreSQL\n+2\nPayment verified\nRating is 4.9 out of 5.\n"
        "$10K+ spent\nLocation\nUnited States\nProposals: 10 to 15"
    ),
}

DETAIL = {
    "upwork_id": KEY,
    "view": "detail",
    "url": f"https://www.upwork.com/jobs/{KEY}",
    "title": TITLE,
    "description": (
        "We need a Python engineer to own our FastAPI backend.\n\n"
        "PostgreSQL and LLM APIs. You will work with the founders. Full brief attached."
    ),
    "skills": ["Python", "FastAPI", "PostgreSQL", "LLM", "Docker"],
    "labels": {"client-company-profile-industry": "Tech & IT"},
    "text": (
        f"{TITLE}\nPosted 3 hours ago\nWorldwide\n"
        "We need a Python engineer to own our FastAPI backend.\n"
        "PostgreSQL and LLM APIs. You will work with the founders. Full brief attached.\n"
        "More than 30 hrs/week\nHourly\nMore than 6 months\nProject Length\nExpert\n"
        "$40.00\n-\n$70.00\nHourly\n"
        "You will be asked to answer the following questions when submitting a proposal:\n"
        "1. Which FastAPI services have you shipped?\nSkills and Expertise\nPython\n"
        "Activity on this job\nProposals:\n10 to 15\nInterviewing:\n2\nInvites sent:\n5\n"
        "Send a proposal for: 16 Connects\nAvailable Connects: 140\n"
        "About the client\nPayment method verified\n4.95 of 23 reviews\nUnited States\n"
        "San Francisco 10:41 AM\n45 jobs posted\n80% hire rate, 2 open jobs\n$52K total spent\n"
        "30 hires, 5 active\n$35.00 /hr avg hourly rate paid\nMember since Mar 10, 2015\n"
        "Similar jobs on Upwork\nFixed-price - Est. budget: $900.00"
    ),
}

FIXED_TILE = {
    "upwork_id": "~01a1b2c3d4e5f6a7b8c9",
    "view": "tile",
    "url": "https://www.upwork.com/jobs/~01a1b2c3d4e5f6a7b8c9",
    "title": "Logo for a bakery",
    "skills": ["Logo Design"],
    "text": "Fixed-price - Intermediate - Est. Budget: $300\nPayment unverified\nGermany\n"
            "Proposals: Less than 5\nPosted yesterday",
}


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _user(client) -> dict[str, str]:
    email = f"freelance-{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post("/api/v1/auth/register", json={"email": email, "password": "a-strong-password"})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
async def auth(client) -> dict[str, str]:
    return await _user(client)


# --- the parser ----------------------------------------------------------------------


def test_a_tile_and_a_detail_read_as_one_posting() -> None:
    at = datetime(2026, 11, 21, 12, 0, tzinfo=UTC)
    raw = {"tile": stored_view(TILE, at), "detail": stored_view(DETAIL, at)}
    # What only the viewer sees never reaches the shared row.
    assert "Available Connects" not in raw["detail"]["text"]

    out = normalize(raw)
    assert out["title"] == TITLE
    assert out["job_type"] is FreelanceJobType.HOURLY
    assert (out["hourly_min"], out["hourly_max"], out["budget_amount"]) == (40.0, 70.0, None)
    assert out["experience_level"] == "EXPERT"
    assert out["duration_label"] == "More than 6 months"
    # The detail's full description and skill list beat the tile's.
    assert out["description"].endswith("Full brief attached.")
    assert out["skills"] == ["Python", "FastAPI", "PostgreSQL", "LLM", "Docker"]
    # A tier's top, so "at most 15 proposals" never admits a busier posting.
    assert out["total_applicants"] == 15 and out["extras"]["proposals_label"] == "10 to 15"
    # The freshest "posted ... ago" is the precise one.
    assert out["published_at"] == at - timedelta(hours=2)
    assert out["client"] == {
        "payment_verified": True, "feedback": 4.95, "total_reviews": 23, "total_spent": 52000.0,
        "total_spent_display": "$52K", "total_hires": 30, "hire_rate_percent": 80.0,
        "total_posted_jobs": 45, "avg_hourly_rate": 35.0, "member_since": "Mar 10, 2015",
        "industry": "Tech & IT", "country": "United States", "city": "San Francisco",
    }
    assert out["extras"]["screening_questions"] == ["Which FastAPI services have you shipped?"]
    assert out["extras"]["connects_required"] == 16
    assert out["extras"]["activity"] == {"total_invited_to_interview": 2, "invites_sent": 5}

    # A feed tile states the type before its figures; a restriction is read too.
    fixed = normalize({"tile": stored_view({**FIXED_TILE, "text": FIXED_TILE["text"] + "\nU.S. only"}, at)})
    assert fixed["job_type"] is FreelanceJobType.FIXED and fixed["budget_amount"] == 300.0
    assert fixed["client"] == {"payment_verified": False, "country": "Germany"}
    assert fixed["total_applicants"] == 4 and fixed["published_at"] == at - timedelta(days=1)
    assert fixed["preferred_freelancer_location"] == ["United States"]


# --- one shared list --------------------------------------------------------------------


class ProposalWriter:
    """Streams one proposal document, answering the posting's screening question."""

    model = "stub-writer"

    async def stream(self, req):
        reply = {
            "read": {"fear": "A slow build.", "anchor": "FastAPI", "outcome": "A shipped product.", "mirror": "AI"},
            "spike": {"name": "Billing API", "basis": "profile", "source": "Overview"},
            "cover_letter": "I build FastAPI backends.",
            "answers": [{"question": "Which FastAPI services have you shipped?", "answer": "Billing and search."}],
            "questions": [],
            "change_note": "Leads with the billing API.",
        }
        yield LLMEvent("text_delta", {"text": json.dumps(reply)})
        yield LLMEvent("done", {"stop_reason": "end_turn"})


async def test_two_people_share_one_list_and_keep_their_own_marks(client, monkeypatch) -> None:
    async def provider(session, user_id, tier):
        return ProposalWriter()

    monkeypatch.setattr("app.api.v1.freelancing.proposals.get_provider", provider)
    monkeypatch.setattr("app.freelancing.proposals.run.get_provider", provider)
    alex, sam = await _user(client), await _user(client)

    # Alex's browser sees two tiles; both are new to everyone.
    res = await client.post("/api/v1/freelancing/jobs/capture", headers=alex, json={"jobs": [TILE, FIXED_TILE]})
    assert res.status_code == 200, res.text
    assert res.json()["created"] == 2
    ids = {j["upwork_id"]: j["id"] for j in res.json()["jobs"]}

    # Sam opens the posting itself: the same row, now with the whole page.
    res = await client.post("/api/v1/freelancing/jobs/capture", headers=sam, json={"jobs": [DETAIL]})
    assert res.json()["created"] == 0 and res.json()["jobs"][0]["id"] == ids[KEY]

    # Both see the same list, filtered by what the captures said.
    for who in (alex, sam):
        res = await client.post("/api/v1/freelancing/jobs/search", headers=who, json={"query": "fastapi postgres"})
        assert [j["id"] for j in res.json()["items"]] == [ids[KEY]]
    res = await client.post(
        "/api/v1/freelancing/jobs/search", headers=sam,
        json={"hourly_rate_min": 60, "verified_payment_only": True, "client_min_spent": 50000, "proposals_max": 15},
    )
    assert [j["id"] for j in res.json()["items"]] == [ids[KEY]]
    res = await client.post("/api/v1/freelancing/jobs/search", headers=sam, json={"budget_min": 200, "job_type": "fixed"})
    assert [j["title"] for j in res.json()["items"]] == ["Logo for a bakery"]
    res = await client.post("/api/v1/freelancing/jobs/search", headers=sam, json={"skills": ["docker"], "client_locations": ["US"]})
    assert res.json()["total"] == 1
    res = await client.post("/api/v1/freelancing/jobs/search", headers=sam, json={"exclude_client_locations": ["DE"]})
    assert [j["id"] for j in res.json()["items"]] == [ids[KEY]]

    # Hiding is Sam's alone.
    res = await client.post(f"/api/v1/freelancing/jobs/{ids[FIXED_TILE['upwork_id']]}/hide", headers=sam)
    assert res.json()["hidden_at"] is not None
    assert (await client.post("/api/v1/freelancing/jobs/search", headers=sam, json={})).json()["total"] == 1
    assert (await client.post("/api/v1/freelancing/jobs/search", headers=alex, json={})).json()["total"] == 2

    # So is focus: Alex stars the posting and it joins Alex's tracker only.
    job_id = ids[KEY]
    res = await client.post(f"/api/v1/freelancing/jobs/{job_id}/focus", headers=alex)
    assert res.json()["track_stage"] == "focused" and res.json()["focused_at"] is not None
    assert (await client.get("/api/v1/freelancing/jobs?focused=true", headers=alex)).json()["total"] == 1
    assert (await client.get("/api/v1/freelancing/jobs?focused=true", headers=sam)).json()["total"] == 0
    res = await client.get(f"/api/v1/freelancing/jobs/{job_id}", headers=sam)
    detail = res.json()
    assert detail["focused_at"] is None and detail["track_stage"] is None
    assert detail["screening_questions"] == ["Which FastAPI services have you shipped?"]
    assert detail["connects_required"] == 16 and detail["proposals_label"] == "10 to 15"
    assert detail["detail_captured_at"] is not None

    # A later tile never blanks out what only the detail page showed.
    await client.post("/api/v1/freelancing/jobs/capture", headers=alex, json={"jobs": [TILE]})
    res = await client.get(f"/api/v1/freelancing/jobs/{job_id}", headers=alex)
    assert res.json()["description"].endswith("Full brief attached.")
    assert res.json()["client"]["total_posted_jobs"] == 45

    # Saved searches: create-or-replace by name, and run from the saved filter.
    res = await client.put(
        "/api/v1/freelancing/jobs/saved-searches", headers=alex,
        json={"name": "FastAPI hourly", "params": {"query": "fastapi", "job_type": "hourly", "offset": 40}},
    )
    assert res.status_code == 201 and res.json()["params"] == {"query": "fastapi", "job_type": "hourly"}
    saved = res.json()
    res = await client.post(f"/api/v1/freelancing/jobs/saved-searches/{saved['id']}/run", headers=alex)
    assert [j["id"] for j in res.json()["items"]] == [job_id]

    # A profile and a draft, which answers the captured questions and bids the connects.
    res = await client.post(
        "/api/v1/freelancing/profiles", headers=alex,
        json={"name": "Alex", "title": "Senior Python engineer", "overview": "I build FastAPI backends.",
              "hourly_rate": 60, "skills": ["Python", "FastAPI", "PostgreSQL"]},
    )
    profile = res.json()
    res = await client.post(
        "/api/v1/freelancing/proposals/generate", headers=alex,
        json={"job_id": job_id, "profile_id": profile["id"], "tone": "warm"},
    )
    assert res.status_code == 202, res.text
    queued = res.json()
    for _ in range(20):
        if not await run_once():
            break
    proposal = (await client.get(f"/api/v1/freelancing/proposals/{queued['proposal_id']}", headers=alex)).json()
    assert proposal["answers"] == [{"question": "Which FastAPI services have you shipped?", "answer": "Billing and search."}]
    assert proposal["bid_type"] == "hourly" and proposal["bid_amount"] == 60.0
    assert proposal["job"]["title"] == TITLE and proposal["job"]["focused_at"] is not None

    # Submitting moves Alex's track on, spending the posting's real connects.
    await client.post(f"/api/v1/freelancing/proposals/{proposal['id']}/submit", headers=alex)
    (track,) = (await client.get("/api/v1/freelancing/tracks", headers=alex)).json()
    assert track["stage"] == "submitted" and track["connects_spent"] == 16
    assert track["job"]["focused_at"] is not None

    # The shared calendar books a client call against the track.
    day = app_today() + timedelta(days=2)
    res = await client.post(
        "/api/v1/shared/meetings", headers=alex,
        json={"title": "Intro call", "local_date": day.isoformat(), "local_time": "15:00",
              "duration_min": 30, "freelance_track_id": track["id"], "meeting_type": "client_call"},
    )
    assert res.status_code == 201, res.text
    assert res.json()["kind"] == "freelance" and res.json()["role_title"] == TITLE

    # Unfocusing a posting whose track has history keeps the track.
    res = await client.delete(f"/api/v1/freelancing/jobs/{job_id}/focus", headers=alex)
    assert res.json()["focused_at"] is None and res.json()["track_stage"] == "submitted"


async def test_simultaneous_captures_of_one_posting_make_one_row(client) -> None:
    people = [await _user(client) for _ in range(4)]
    key = "~01" + uuid.uuid4().hex[:18]
    capture = {**TILE, "upwork_id": key, "url": f"https://www.upwork.com/jobs/{key}"}

    responses = await asyncio.gather(
        *(client.post("/api/v1/freelancing/jobs/capture", headers=who, json={"jobs": [capture]}) for who in people)
    )
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    assert sum(r.json()["created"] for r in responses) == 1
    assert len({r.json()["jobs"][0]["id"] for r in responses}) == 1
    # The key is case-blind, as Upwork's links are.
    res = await client.post(
        "/api/v1/freelancing/jobs/capture", headers=people[0],
        json={"jobs": [{**capture, "upwork_id": key.upper()}]},
    )
    assert res.json()["created"] == 0


async def test_deleting_a_proposal_takes_it_out_of_the_pipeline(client, auth) -> None:
    res = await client.post("/api/v1/freelancing/jobs/capture", headers=auth, json={"jobs": [TILE]})
    job_id = res.json()["jobs"][0]["id"]
    first, second = [
        (await client.post(
            "/api/v1/freelancing/proposals", headers=auth,
            json={"job_id": job_id, "cover_letter_markdown": f"Draft {n}"},
        )).json()
        for n in (1, 2)
    ]
    (track,) = (await client.get("/api/v1/freelancing/tracks", headers=auth)).json()
    assert track["proposal"]["id"] == first["id"]

    # Another proposal for the job still carries the track.
    assert (await client.delete(f"/api/v1/freelancing/proposals/{first['id']}", headers=auth)).status_code == 204
    (track,) = (await client.get("/api/v1/freelancing/tracks", headers=auth)).json()
    assert track["proposal"]["id"] == second["id"]

    # The last one takes the job out of the pipeline, focus and all.
    await client.delete(f"/api/v1/freelancing/proposals/{second['id']}", headers=auth)
    assert (await client.get("/api/v1/freelancing/tracks", headers=auth)).json() == []
    job = (await client.get(f"/api/v1/freelancing/jobs/{job_id}", headers=auth)).json()
    assert job["focused_at"] is None and job["track_stage"] is None
