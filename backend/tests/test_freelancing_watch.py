"""Watching a posting's client from the extension, and telling the team.

Readings are posted the way the extension sends them: Upwork's job-details
store for the open posting, as the page holds it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from app.freelancing.capture import normalize, stored_view
from app.main import app
from app.models.enums import FreelanceJobType

TITLE = "Realtime dashboard in FastAPI"


def _upwork_time(at: datetime) -> str:
    """Upwork writes UTC without a zone: "2026-11-21T12:00:00.000"."""
    return at.astimezone(UTC).replace(tzinfo=None).isoformat(timespec="milliseconds")


def store(key: str, *, seen_ago: timedelta, interviewing: int) -> dict:
    now = datetime.now(UTC)
    return {
        "job": {
            "ciphertext": key,
            "title": TITLE,
            "description": "Build a live dashboard over our event stream.\n\nFastAPI, WebSockets, Postgres.",
            "postedOn": _upwork_time(now - timedelta(hours=3)),
            "contractorTier": 3,
            "durationLabel": "1 to 3 months",
            "category": {"name": "Back-End Development"},
            "categoryGroup": {"name": "Web, Mobile & Software Dev"},
            "extendedBudgetInfo": {"hourlyBudgetMin": 45, "hourlyBudgetMax": 80},
            "questions": [{"question": "Which realtime systems have you built?", "position": 1}],
            "clientActivity": {
                "totalApplicants": 12,
                "totalHired": 0,
                "totalInvitedToInterview": interviewing,
                "invitationsSent": 3,
                "unansweredInvites": 1,
                "lastBuyerActivity": _upwork_time(now - seen_ago),
            },
        },
        "buyer": {
            "isPaymentMethodVerified": True,
            "location": {"country": "United States", "city": "Austin"},
            "stats": {"totalCharges": {"amount": 52000, "currencyCode": "USD"}, "feedbackCount": 23, "score": 4.9},
            "company": {"contractDate": "2015-03-10T00:00:00.000Z"},
        },
        "sands": {
            "ontologySkills": [{"prefLabel": "Python", "children": [{"prefLabel": "FastAPI"}]}],
            "additionalSkills": [{"prefLabel": "WebSockets"}],
        },
        # The viewer's own, which never reaches the shared row.
        "applicationContext": {"availableConnects": 140},
    }


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _user(client, name: str) -> dict[str, str]:
    email = f"{name.lower()}-{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "a-strong-password", "display_name": name},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_the_store_reads_into_the_shared_columns() -> None:
    key = "~021000000000000000001"
    raw = {"store": stored_view({"view": "store", "state": store(key, seen_ago=timedelta(seconds=30), interviewing=2)},
                                datetime.now(UTC))}
    assert "applicationContext" not in raw["store"]["state"]

    out = normalize(raw)
    assert out["title"] == TITLE and out["description"].endswith("Postgres.")
    assert out["job_type"] is FreelanceJobType.HOURLY and (out["hourly_min"], out["hourly_max"]) == (45, 80)
    assert (out["category"], out["subcategory"]) == ("Web, Mobile & Software Dev", "Back-End Development")
    assert out["experience_level"] == "EXPERT" and out["duration_label"] == "1 to 3 months"
    # The store counts proposals exactly, where a tile only gives a tier.
    assert out["total_applicants"] == 12
    assert out["skills"] == ["Python", "FastAPI", "WebSockets"]
    assert out["client"] == {
        "payment_verified": True, "total_spent": 52000.0, "total_reviews": 23, "feedback": 4.9,
        "country": "United States", "city": "Austin", "member_since": "Mar 10, 2015",
    }
    assert out["extras"]["screening_questions"] == ["Which realtime systems have you built?"]
    activity = out["extras"]["activity"]
    assert activity["total_invited_to_interview"] == 2 and activity["invites_sent"] == 3
    assert datetime.fromisoformat(activity["last_client_activity"]).tzinfo is not None


async def test_one_relay_tells_the_team_and_each_watcher_hears_only_their_own(client) -> None:
    alex, sam, kim = await _user(client, "Alex"), await _user(client, "Sam"), await _user(client, "Kim")
    key = "~02" + uuid.uuid4().int.__str__()[:18]
    url = f"https://www.upwork.com/jobs/{key}"

    async def report(who, **reading):
        body = {"upwork_id": key, "url": url}
        if reading:
            body["state"] = store(key, **reading)
        res = await client.post("/api/v1/freelancing/watches", headers=who, json=body)
        assert res.status_code == 200, res.text
        return res.json()

    async def feed(who):
        res = await client.get("/api/v1/freelancing/alerts?limit=100", headers=who)
        return [a for a in res.json()["items"] if a["job_id"] == job_id]

    # Alex opens the posting while its client is on it: alerts on, Alex relays,
    # and the shared row now has the posting and its live activity.
    first = await report(alex, seen_ago=timedelta(seconds=30), interviewing=1)
    job_id = first["job_id"]
    assert first["notify"] and first["relay"]
    assert [e["kind"] for e in first["events"]] == ["client_viewed"]
    card = (await client.get(f"/api/v1/freelancing/jobs/{job_id}", headers=kim)).json()
    assert card["title"] == TITLE and card["total_applicants"] == 12 and card["interviewing"] == 1
    assert card["client_activity_at"] is not None and card["detail_captured_at"] is not None
    assert [(w["name"], w["relay"]) for w in card["watchers"]] == [("Alex", True)]
    # The panel finds it by the key in the address bar: Alex posted it to the list.
    by_key = (await client.get(f"/api/v1/freelancing/jobs/upwork/{key}", headers=kim)).json()
    assert by_key["id"] == job_id and by_key["posted_by"] == {"name": "Alex", "you": False}
    assert (await client.get(f"/api/v1/freelancing/jobs/upwork/{key}", headers=alex)).json()["posted_by"]["you"]

    # Everyone else hears it from the relay; Alex already heard it locally.
    (told,) = await feed(kim)
    assert told["kind"] == "client_viewed" and told["relay_name"] == "Alex" and not told["local"]
    assert (await feed(alex))[0]["local"]

    # Sam opens it too. Alex already relays it, so Sam's alerts start off.
    joined = await report(sam, seen_ago=timedelta(seconds=40), interviewing=1)
    assert not joined["notify"] and not joined["relay"] and joined["events"] == []
    assert [(w["name"], w["notify"], w["relay"]) for w in joined["watchers"]] == [
        ("Alex", True, True), ("Sam", False, False),
    ]
    # A heartbeat with no reading keeps the watch and sees nothing new.
    assert (await report(sam))["watchers"][1]["you"]

    # The client starts interviewing; Alex's refresh sees it and the team is told.
    seen = await report(alex, seen_ago=timedelta(seconds=50), interviewing=2)
    assert [e["kind"] for e in seen["events"]] == ["interview_started"]
    latest = (await feed(sam))[0]
    assert (latest["kind"], latest["previous_interviewing"], latest["interviewing"]) == ("interview_started", 1, 2)
    assert not latest["local"]

    # Sam turns alerts on and now hears their own watch - and not the relay's copy.
    res = await client.patch(f"/api/v1/freelancing/watches/{job_id}", headers=sam, json={"notify": True})
    assert res.json()["notify"] and not res.json()["relay"]
    mine = await report(sam, seen_ago=timedelta(seconds=55), interviewing=3)
    assert [(e["kind"], e["interviewing"]) for e in mine["events"]] == [("interview_started", 3)]
    assert len(await feed(kim)) == 2  # Sam does not relay
    await report(alex, seen_ago=timedelta(seconds=58), interviewing=3)
    assert len(await feed(kim)) == 3
    assert (await feed(sam))[0]["local"] and (await feed(alex))[0]["local"]
    assert not (await feed(kim))[0]["local"]

    # Alex closes the posting; Sam takes over the relay.
    assert (await client.delete(f"/api/v1/freelancing/watches/{job_id}", headers=alex)).status_code == 204
    handed = await report(sam, seen_ago=timedelta(seconds=59), interviewing=4)
    assert handed["relay"] and [w["name"] for w in handed["watchers"]] == ["Sam"]
    latest = (await feed(kim))[0]
    assert (latest["relay_name"], latest["interviewing"]) == ("Sam", 4)

    # A heartbeat for a posting nobody has captured is refused.
    res = await client.post(
        "/api/v1/freelancing/watches", headers=kim, json={"upwork_id": "~02" + "9" * 18},
    )
    assert res.status_code == 404
    assert (await client.get(f"/api/v1/freelancing/jobs/upwork/~02{'9' * 18}", headers=kim)).status_code == 404
