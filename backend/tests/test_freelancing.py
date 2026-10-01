"""The Freelancing category, end to end, against a mocked Upwork.

Upwork is replaced by an httpx MockTransport that answers the token endpoint
and the four GraphQL operations, and records what it was asked - so the test
checks the exact filter Upwork would receive, not just that "a search ran".
"""

from __future__ import annotations

import json
import uuid
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.timezone import app_today, utc_now
from app.db.session import SessionLocal
from app.freelancing.services.jobs import prune_stale
from app.freelancing.sources.base import SourceCapabilities, SourcePage
from app.freelancing.transport import set_transport
from app.freelancing.upwork import oauth
from app.freelancing.upwork.filters import to_search_variables
from app.freelancing.upwork.normalize import snapshot_from_search_node
from app.main import app
from app.models.enums import FreelanceJobType
from app.models.freelancing import FreelanceJob, UpworkConnection
from app.schemas.freelancing import JobSearchParams
from app.worker.runner import run_once

HOURLY_NODE = {
    "id": "2056488576136638272",
    "title": "Senior FastAPI developer for an AI product",
    "description": "We need a Python engineer to own our FastAPI backend. PostgreSQL and LLM APIs.",
    "ciphertext": "~022056488576136638272",
    "duration": "ONGOING",
    "durationLabel": "More than 6 months",
    "engagement": "30+ hrs/week",
    "amount": {"rawValue": "0.0", "currency": "USD", "displayValue": "0.0"},
    "experienceLevel": "EXPERT",
    "category": "Web Development",
    "subcategory": "Back-End Development",
    "freelancersToHire": 1,
    "totalApplicants": 12,
    "premium": False,
    "enterprise": False,
    "applied": False,
    "createdDateTime": "2026-09-23T10:00:00.000Z",
    "publishedDateTime": "2026-09-23T10:05:00.000Z",
    "hourlyBudgetType": "MANUAL",
    "hourlyBudgetMin": {"rawValue": "40", "currency": "USD", "displayValue": "$40.00"},
    "hourlyBudgetMax": {"rawValue": "70", "currency": "USD", "displayValue": "$70.00"},
    "skills": [{"name": "python", "prettyName": "Python"}, {"name": "fastapi", "prettyName": "FastAPI"}],
    "client": {
        "totalHires": 14,
        "totalPostedJobs": 20,
        "totalSpent": {"rawValue": "52000", "currency": "USD", "displayValue": "$52K"},
        "verificationStatus": "VERIFIED",
        "location": {"country": "Germany", "city": "Berlin"},
        "totalReviews": 9,
        "totalFeedback": 4.9,
    },
}

FIXED_NODE = {
    "id": "2056488576136638999",
    "title": "Landing page in Next.js",
    "description": "One page, one week.",
    "ciphertext": "~022056488576136638999",
    "amount": {"rawValue": "1500", "currency": "USD", "displayValue": "$1,500.00"},
    "experienceLevel": "INTERMEDIATE",
    "totalApplicants": 40,
    "premium": True,
    "enterprise": False,
    "applied": True,
    "publishedDateTime": "2026-09-22T08:00:00.000Z",
    "skills": [{"name": "next-js", "prettyName": "Next.js"}],
    "client": {"totalHires": 0, "totalPostedJobs": 1, "verificationStatus": "NOT_VERIFIED", "totalReviews": 0, "totalFeedback": 0},
}

DETAIL = {
    "id": HOURLY_NODE["id"],
    "workFlowState": {"status": "ACTIVE", "closeResult": None},
    "content": {"title": HOURLY_NODE["title"], "description": HOURLY_NODE["description"] + " Full brief attached."},
    "contractTerms": {
        "contractType": "HOURLY",
        "onSiteType": "REMOTE",
        "experienceLevel": "EXPERT",
        "hourlyContractTerms": {"hourlyBudgetMin": 40.0, "hourlyBudgetMax": 70.0, "engagementType": "FULL_TIME"},
    },
    "classification": {"skills": [{"preferredLabel": "Python"}]},
    "contractorSelection": {
        "proposalRequirement": {
            "coverLetterRequired": True,
            "screeningQuestions": [
                {"question": "Which FastAPI services have you shipped?", "sequenceNumber": 1},
            ],
        },
        "qualification": {"englishProficiency": "FLUENT"},
        "location": {"countries": []},
    },
    "activityStat": {
        "applicationsBidStats": {"avgRateBid": {"rawValue": "55", "currency": "USD", "displayValue": "$55"}},
        "jobActivity": {"lastClientActivity": "2026-09-23T12:00:00.000Z", "invitesSent": 3, "totalHired": 0},
    },
    "clientCompanyPublic": {"id": "1", "country": {"name": "Germany"}, "city": "Berlin", "paymentVerification": {"paymentVerified": True}},
    "attachments": [],
}


class FakeUpwork:
    """Answers like Upwork and remembers what it was asked."""

    def __init__(self) -> None:
        self.token_requests: list[dict] = []
        self.graphql_requests: list[dict] = []
        self.status_override: int | None = None
        self.refresh_count = 0

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "www.upwork.com" and request.url.path == "/api/v3/oauth2/token":
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            self.token_requests.append(form)
            if form.get("grant_type") == "refresh_token":
                self.refresh_count += 1
                return httpx.Response(200, json={
                    "access_token": f"oauth2v2_refreshed_{self.refresh_count}",
                    "refresh_token": "oauth2v2_refresh_new", "token_type": "Bearer", "expires_in": 86400,
                })
            if form.get("code") != "good-code":
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={
                "access_token": "oauth2v2_access", "refresh_token": "oauth2v2_refresh",
                "token_type": "Bearer", "expires_in": 86400,
            })

        assert request.url.host == "api.upwork.com", request.url
        assert request.headers["Authorization"].startswith("Bearer oauth2v2_")
        body = json.loads(request.content)
        self.graphql_requests.append({"headers": dict(request.headers), **body})
        if self.status_override:
            return httpx.Response(self.status_override, headers={"Retry-After": "7"}, json={})
        query = body["query"]
        if "PhoenixViewer" in query:
            return httpx.Response(200, json={"data": {
                "user": {"id": "u1", "nid": "n1", "name": "Aran Dev", "email": "aran@example.com"},
                "companySelector": {"items": [{"title": "Aran Dev", "organizationId": "org-1", "typeTitle": "Freelancer"}]},
            }})
        if "PhoenixJobSearch" in query:
            return httpx.Response(200, json={"data": {"marketplaceJobPostingsSearch": {
                "totalCount": 2,
                "pageInfo": {"endCursor": "20", "hasNextPage": True},
                "edges": [{"cursor": "1", "node": HOURLY_NODE}, {"cursor": "2", "node": FIXED_NODE}],
            }}})
        if "PhoenixJobDetail" in query:
            return httpx.Response(200, json={"data": {"marketplaceJobPosting": DETAIL}})
        if "PhoenixCategories" in query:
            return httpx.Response(200, json={"data": {"ontologyCategories": [
                {"id": "531770282580668418", "preferredLabel": "Web, Mobile & Software Dev",
                 "subcategories": [{"id": "531770282584862722", "preferredLabel": "Web Development"}]},
            ]}})
        if "PhoenixSkillSearch" in query:
            return httpx.Response(200, json={"data": {"ontologyElementsSearchByPrefLabel": [
                {"id": "s1", "preferredLabel": "FastAPI"},
            ]}})
        return httpx.Response(200, json={"errors": [{"message": f"unknown operation: {query[:40]}"}]})


@pytest.fixture
def upwork(monkeypatch):
    # These tests exercise Upwork's own API as the job source; Apify is the default.
    monkeypatch.setattr(get_settings(), "freelancing_job_source", "upwork")
    fake = FakeUpwork()
    set_transport(fake.transport())
    yield fake
    set_transport(None)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    email = f"freelance-{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post("/api/v1/auth/register", json={"email": email, "password": "a-strong-password"})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def connect(client, auth) -> None:
    """Store a key pair and complete the OAuth round trip."""
    res = await client.put(
        "/api/v1/freelancing/upwork/credentials", headers=auth,
        json={"client_id": "phoenix-client-id", "client_secret": "phoenix-client-secret-xyz9"},
    )
    assert res.status_code == 200, res.text
    res = await client.post("/api/v1/freelancing/upwork/authorize", headers=auth)
    assert res.status_code == 200, res.text
    state = parse_qs(urlsplit(res.json()["url"]).query)["state"][0]
    res = await client.get("/api/v1/freelancing/upwork/callback", params={"code": "good-code", "state": state})
    assert res.status_code == 303, res.text
    assert "upwork=connected" in res.headers["location"]


# --- pure pieces --------------------------------------------------------------


def test_every_parameter_maps_to_upworks_filter() -> None:
    params = JobSearchParams(
        query="python fastapi", title="backend", skills=["python", "fastapi"],
        category_ids=["1"], subcategory_ids=["2"], occupation_ids=["3"], ontology_skill_ids=["4"],
        job_type="hourly", workload="part_time", durations=["month", "ongoing"], experience_level="expert",
        budget_min=500, budget_max=5000, hourly_rate_min=40, hourly_rate_max=90,
        client_hires_min=1, proposals_max=20, verified_payment_only=True, previous_clients_only=False,
        client_locations=["Germany"], client_timezone="Europe/Berlin", enterprise_only=False,
        talent_cloud_only=False, talent_cloud_ids=["tc1"], user_location_match=True, visitor_country="de",
        area={"latitude": 52.5, "longitude": 13.4, "radius_miles": 50},
        sort="client_rating", page_size=30, cursor="30",
    )
    variables = to_search_variables(params)
    f = variables["marketPlaceJobFilter"]
    assert f == {
        "searchExpression_eq": "python fastapi",
        "titleExpression_eq": "backend",
        "skillExpression_eq": "python,fastapi",
        "categoryIds_any": ["1"], "subcategoryIds_any": ["2"],
        "occupationIds_any": ["3"], "ontologySkillIds_all": ["4"],
        "jobType_eq": "HOURLY", "workload_eq": "PART_TIME",
        "duration_any": ["MONTH", "ONGOING"], "experienceLevel_eq": "EXPERT",
        "budgetRange_eq": {"rangeStart": 500, "rangeEnd": 5000},
        "hourlyRate_eq": {"rangeStart": 40, "rangeEnd": 90},
        "clientHiresRange_eq": {"rangeStart": 1},
        "proposalRange_eq": {"rangeEnd": 20},
        "verifiedPaymentOnly_eq": True, "previousClients_eq": False,
        "locations_any": ["Germany"], "timezone_eq": "Europe/Berlin",
        "enterpriseOnly_eq": False, "ptcOnly_eq": False, "ptcIds_any": ["tc1"],
        "userLocationMatch_eq": True, "visitorCountry_eq": "DE",
        "area_eq": {"latitude": 52.5, "longitude": 13.4, "radius": 50.0},
        "pagination_eq": {"after": "30", "first": 30},
    }
    assert variables["sortAttributes"] == [{"field": "CLIENT_RATING"}]


def test_search_terms_are_dropped_when_a_query_is_given() -> None:
    """Upwork ignores searchTerm_eq next to searchExpression_eq, so it is not sent."""
    with_query = to_search_variables(JobSearchParams(query="x", and_terms=["a"]))["marketPlaceJobFilter"]
    assert "searchTerm_eq" not in with_query
    without = to_search_variables(JobSearchParams(and_terms=["a"], exclude_terms=["b"]))["marketPlaceJobFilter"]
    assert without["searchTerm_eq"] == {"andTerms_all": ["a"], "excludeTerms_any": ["b"]}
    assert without["pagination_eq"] == {"after": "0", "first": 20}


def test_an_inverted_range_is_rejected() -> None:
    with pytest.raises(ValueError):
        JobSearchParams(budget_min=100, budget_max=10)


def test_search_node_becomes_a_snapshot() -> None:
    hourly = snapshot_from_search_node(HOURLY_NODE)
    assert hourly["job_type"] is FreelanceJobType.HOURLY
    assert (hourly["hourly_min"], hourly["hourly_max"]) == (40.0, 70.0)
    assert hourly["budget_amount"] is None
    assert hourly["skills"] == ["Python", "FastAPI"]
    assert hourly["client"]["payment_verified"] is True
    assert hourly["client"]["total_spent"] == 52000.0
    assert hourly["url"] == "https://www.upwork.com/jobs/~022056488576136638272"
    assert hourly["published_at"].isoformat() == "2026-09-23T10:05:00+00:00"

    fixed = snapshot_from_search_node(FIXED_NODE)
    assert fixed["job_type"] is FreelanceJobType.FIXED
    assert fixed["budget_amount"] == 1500.0
    assert fixed["client"]["payment_verified"] is False
    assert fixed["is_premium"] is True


def test_oauth_state_names_the_user_and_nothing_else() -> None:
    user_id = uuid.uuid4()
    assert oauth.read_state(oauth.make_state(user_id)) == user_id
    with pytest.raises(Exception, match="expired or was tampered"):
        oauth.read_state("not-a-token")


# --- the flow -------------------------------------------------------------------


async def test_search_without_credentials_is_a_clear_409(client, auth, upwork) -> None:
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "python"})
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "UPWORK_NOT_CONFIGURED"

    res = await client.get("/api/v1/freelancing/jobs/filters", headers=auth)
    assert res.status_code == 200
    body = res.json()
    # The static controls are always there; the category tree needs a connection.
    assert body["source"]["key"] == "upwork" and body["source"]["detail"] is True
    assert "hourly_rate_min" in body["source"]["filters"]
    assert [o["value"] for o in body["job_types"]] == ["hourly", "fixed"]
    assert body["categories"] == []
    assert "Settings" in body["categories_error"]


async def test_connect_search_focus_propose_track_and_schedule(client, auth, upwork) -> None:
    # Not configured -> credentials stored -> authorized.
    res = await client.get("/api/v1/freelancing/upwork/connection", headers=auth)
    assert res.json()["status"] == "not_configured"
    assert res.json()["redirect_uri"].endswith("/api/v1/freelancing/upwork/callback")

    await connect(client, auth)
    assert upwork.token_requests[0]["grant_type"] == "authorization_code"
    assert upwork.token_requests[0]["redirect_uri"].endswith("/upwork/callback")

    res = await client.get("/api/v1/freelancing/upwork/connection", headers=auth)
    body = res.json()
    assert body["status"] == "connected" and body["connected"] is True
    assert body["upwork_user_name"] == "Aran Dev"
    assert body["tenant_id"] == "org-1"  # the only organisation was picked
    assert body["masked_client_secret"] == "...xyz9"
    assert body["credentials_source"] == "user"

    # The tenant goes on every call as the header Upwork documents.
    res = await client.post("/api/v1/freelancing/upwork/test", headers=auth)
    assert res.json()["ok"] is True
    assert upwork.graphql_requests[-1]["headers"]["x-upwork-api-tenantid"] == "org-1"

    # Search: the filter Upwork receives is exactly the one asked for.
    res = await client.post(
        "/api/v1/freelancing/jobs/search", headers=auth,
        json={"query": "fastapi", "job_type": "hourly", "hourly_rate_min": 40, "verified_payment_only": True, "page_size": 20},
    )
    assert res.status_code == 200, res.text
    page = res.json()
    sent = upwork.graphql_requests[-1]["variables"]["marketPlaceJobFilter"]
    assert sent["searchExpression_eq"] == "fastapi"
    assert sent["jobType_eq"] == "HOURLY"
    assert sent["hourlyRate_eq"] == {"rangeStart": 40}
    assert sent["verifiedPaymentOnly_eq"] is True
    assert sent["pagination_eq"] == {"after": "0", "first": 20}
    assert page["total"] == 2 and page["has_next_page"] is True and page["end_cursor"] == "20"
    assert [j["title"] for j in page["items"]] == [HOURLY_NODE["title"], FIXED_NODE["title"]]
    hourly = page["items"][0]
    assert hourly["job_type"] == "hourly" and hourly["hourly_max"] == 70.0
    assert hourly["client"]["payment_verified"] is True
    assert hourly["track_stage"] is None and hourly["focused_at"] is None
    assert page["items"][1]["applied"] is True

    # Searching again updates the same snapshot rather than adding a second.
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "fastapi"})
    assert [j["id"] for j in res.json()["items"]] == [j["id"] for j in page["items"]]

    # Hiding drops a job from later pages; hide_applied drops the one already bid on.
    res = await client.post(f"/api/v1/freelancing/jobs/{page['items'][1]['id']}/hide", headers=auth)
    assert res.json()["hidden_at"] is not None
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "fastapi"})
    assert len(res.json()["items"]) == 1 and res.json()["hidden_count"] == 1

    # Focus: the job joins the tracker at "focused".
    res = await client.post(f"/api/v1/freelancing/jobs/{hourly['id']}/focus", headers=auth)
    assert res.status_code == 200, res.text
    assert res.json()["track_stage"] == "focused" and res.json()["focused_at"] is not None
    res = await client.get("/api/v1/freelancing/jobs", headers=auth, params={"focused": "true"})
    assert res.json()["total"] == 1
    res = await client.get("/api/v1/freelancing/tracks/summary", headers=auth)
    assert res.json() == {"focused": 1, "proposal_drafted": 0, "submitted": 0, "viewed": 0, "interviewing": 0,
                          "hired": 0, "declined": 0, "withdrawn": 0, "closed": 0, "total": 1}

    # Opening the job fetches the deeper aggregate: screening questions and all.
    res = await client.get(f"/api/v1/freelancing/jobs/{hourly['id']}", headers=auth)
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["screening_questions"] == ["Which FastAPI services have you shipped?"]
    assert detail["cover_letter_required"] is True
    assert detail["description"].endswith("Full brief attached.")
    assert detail["activity"]["average_bid"] == 55.0
    assert detail["on_site_type"] == "REMOTE"
    assert detail["detail_fetched_at"] is not None
    detail_calls = [r for r in upwork.graphql_requests if "PhoenixJobDetail" in r["query"]]
    assert len(detail_calls) == 1
    # Fresh enough: opening again does not call Upwork again.
    await client.get(f"/api/v1/freelancing/jobs/{hourly['id']}", headers=auth)
    assert len([r for r in upwork.graphql_requests if "PhoenixJobDetail" in r["query"]]) == 1

    # The catalogue now carries Upwork's category tree, and skills autocomplete.
    res = await client.get("/api/v1/freelancing/jobs/filters", headers=auth)
    assert res.json()["categories"][0]["subcategories"][0]["label"] == "Web Development"
    res = await client.get("/api/v1/freelancing/jobs/skills", headers=auth, params={"q": "fast"})
    assert res.json() == [{"id": "s1", "label": "FastAPI"}]

    # Saved searches: create-or-replace by name, and run from the saved parameters.
    res = await client.put(
        "/api/v1/freelancing/jobs/saved-searches", headers=auth,
        json={"name": "FastAPI hourly", "params": {"query": "fastapi", "job_type": "hourly", "cursor": "999"}},
    )
    assert res.status_code == 201, res.text
    saved = res.json()
    assert saved["params"] == {"query": "fastapi", "job_type": "hourly"}
    res = await client.put(
        "/api/v1/freelancing/jobs/saved-searches", headers=auth,
        json={"name": "FastAPI hourly", "params": {"query": "fastapi", "job_type": "fixed"}},
    )
    assert res.json()["id"] == saved["id"]
    res = await client.post(f"/api/v1/freelancing/jobs/saved-searches/{saved['id']}/run", headers=auth)
    assert res.status_code == 200
    assert upwork.graphql_requests[-1]["variables"]["marketPlaceJobFilter"]["jobType_eq"] == "FIXED"

    # Phase 2, initial: a profile, and a draft from the template engine.
    res = await client.post(
        "/api/v1/freelancing/profiles", headers=auth,
        json={"name": "Aran", "title": "Senior Python engineer", "overview": "I build FastAPI backends. Ten years in.",
              "hourly_rate": 60, "skills": ["Python", "FastAPI", "PostgreSQL"],
              "portfolio": [{"title": "Phoenix", "url": "https://phoenix.example", "summary": "An AI job platform"}]},
    )
    assert res.status_code == 201, res.text
    profile = res.json()
    assert profile["is_default"] is True  # the first profile is the default

    res = await client.post(
        "/api/v1/freelancing/proposals/generate", headers=auth,
        json={"job_id": hourly["id"], "profile_id": profile["id"], "tone": "warm"},
    )
    assert res.status_code == 202, res.text
    queued = res.json()
    assert queued["engine_version"] == "template-v0"

    # The worker runs it like any other generation - no LLM key needed.
    for _ in range(20):
        if not await run_once():
            break
    res = await client.get(f"/api/v1/generations/{queued['generation_id']}", headers=auth)
    assert res.json()["status"] == "succeeded", res.text

    res = await client.get(f"/api/v1/freelancing/proposals/{queued['proposal_id']}", headers=auth)
    proposal = res.json()
    assert proposal["engine_version"] == "template-v0"
    assert proposal["status"] == "draft"
    assert proposal["cover_letter_markdown"].startswith("Hi there,")
    assert HOURLY_NODE["title"] in proposal["cover_letter_markdown"]
    assert "**Python**" in proposal["cover_letter_markdown"]
    assert proposal["answers"] == [{"question": "Which FastAPI services have you shipped?", "answer": ""}]
    assert proposal["bid_type"] == "hourly" and proposal["bid_amount"] == 60.0
    assert proposal["job"]["title"] == HOURLY_NODE["title"]
    assert proposal["generation_meta"]["matched_skills"] == ["Python", "FastAPI", "PostgreSQL"]

    # Phase 3: drafting moved the track on; submitting moves it again.
    res = await client.get("/api/v1/freelancing/tracks", headers=auth)
    (track,) = res.json()
    assert track["stage"] == "proposal_drafted"
    assert track["proposal"]["id"] == proposal["id"]

    res = await client.post(f"/api/v1/freelancing/proposals/{proposal['id']}/submit", headers=auth)
    assert res.json()["status"] == "submitted" and res.json()["submitted_at"]
    res = await client.get(f"/api/v1/freelancing/tracks/{track['id']}", headers=auth)
    track = res.json()
    assert track["stage"] == "submitted" and track["submitted_at"]
    assert track["bid_amount"] == 60.0 and track["connects_spent"] == 12
    assert [e["to_stage"] for e in track["events"]] == ["focused", "proposal_drafted", "submitted"]

    # The shared calendar books a client call against the track.
    day = app_today() + timedelta(days=2)
    res = await client.post(
        "/api/v1/shared/meetings", headers=auth,
        json={"title": "Intro call", "local_date": day.isoformat(), "local_time": "15:00",
              "duration_min": 30, "freelance_track_id": track["id"], "meeting_type": "client_call"},
    )
    assert res.status_code == 201, res.text
    meeting = res.json()
    assert meeting["kind"] == "freelance" and meeting["role_title"] == HOURLY_NODE["title"]
    assert meeting["track_id"] == track["id"]
    res = await client.get("/api/v1/shared/meetings/next", headers=auth)
    assert res.json()["kind"] == "freelance" and res.json()["role_title"] == HOURLY_NODE["title"]
    res = await client.get(f"/api/v1/freelancing/tracks/{track['id']}", headers=auth)
    assert res.json()["next_meeting"]["id"] == meeting["id"]

    res = await client.patch(
        f"/api/v1/freelancing/tracks/{track['id']}", headers=auth,
        json={"stage": "interviewing", "reason": "client booked a call", "notes_markdown": "Ask about scope."},
    )
    assert res.json()["stage"] == "interviewing" and res.json()["client_replied_at"]

    # A won bid becomes a maintained job in the shared Job Maintenance tool.
    res = await client.post(f"/api/v1/freelancing/tracks/{track['id']}/promote", headers=auth)
    assert res.status_code == 201, res.text
    maintained = res.json()
    assert maintained["role_title"] == HOURLY_NODE["title"]
    assert maintained["freelance_track_id"] == track["id"]
    res = await client.get(f"/api/v1/freelancing/tracks/{track['id']}", headers=auth)
    assert res.json()["stage"] == "hired" and res.json()["closed_at"]
    # Idempotent: promoting again returns the same maintained job.
    res = await client.post(f"/api/v1/freelancing/tracks/{track['id']}/promote", headers=auth)
    assert res.json()["id"] == maintained["id"]

    # Unfocusing a job whose track has history keeps the track.
    res = await client.delete(f"/api/v1/freelancing/jobs/{hourly['id']}/focus", headers=auth)
    assert res.json()["focused_at"] is None and res.json()["track_stage"] == "hired"

    # Disconnecting keeps the key pair and drops the tokens.
    res = await client.post("/api/v1/freelancing/upwork/disconnect", headers=auth)
    assert res.json()["status"] == "pending_authorization" and res.json()["configured"] is True
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "x"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "UPWORK_NOT_CONNECTED"


async def test_a_rate_limit_is_reported_as_429_with_retry_after(client, auth, upwork) -> None:
    await connect(client, auth)
    upwork.status_override = 429
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "x"})
    assert res.status_code == 429
    assert res.json()["detail"]["code"] == "UPWORK_RATE_LIMITED"
    assert res.headers["retry-after"] == "7"


async def test_an_expiring_token_is_refreshed_before_use(client, auth, upwork) -> None:
    await connect(client, auth)
    me = (await client.get("/api/v1/auth/me", headers=auth)).json()
    async with SessionLocal() as session:
        row = await session.get(UpworkConnection, uuid.UUID(me["id"]))
        row.access_token_expires_at = utc_now() + timedelta(minutes=2)
        await session.commit()

    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "x"})
    assert res.status_code == 200, res.text
    assert upwork.refresh_count == 1
    assert upwork.token_requests[-1]["grant_type"] == "refresh_token"
    assert upwork.graphql_requests[-1]["headers"]["authorization"] == "Bearer oauth2v2_refreshed_1"

    async with SessionLocal() as session:
        row = await session.get(UpworkConnection, uuid.UUID(me["id"]))
        assert row.access_token_expires_at > utc_now() + timedelta(hours=23)


async def test_a_refused_refresh_marks_the_connection_expired(client, auth, upwork) -> None:
    await connect(client, auth)
    me = (await client.get("/api/v1/auth/me", headers=auth)).json()

    def refuse(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v3/oauth2/token":
            return httpx.Response(400, json={"error": "invalid_grant", "error_description": "refresh token expired"})
        return upwork.handle(request)

    set_transport(httpx.MockTransport(refuse))
    async with SessionLocal() as session:
        row = await session.get(UpworkConnection, uuid.UUID(me["id"]))
        row.access_token_expires_at = utc_now() - timedelta(minutes=1)
        await session.commit()

    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "x"})
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "UPWORK_NOT_CONNECTED"
    assert "Connect again" in res.json()["detail"]["message"]
    res = await client.get("/api/v1/freelancing/upwork/connection", headers=auth)
    assert res.json()["status"] == "expired"


async def test_unreferenced_snapshots_are_pruned_after_a_day(client, auth, upwork) -> None:
    """Upwork's terms allow caching a posting for 24 hours; focused jobs are the user's own list."""
    await connect(client, auth)
    me = (await client.get("/api/v1/auth/me", headers=auth)).json()
    user_id = uuid.UUID(me["id"])
    page = (await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "x"})).json()
    focused_id, stale_id = page["items"][0]["id"], page["items"][1]["id"]
    await client.post(f"/api/v1/freelancing/jobs/{focused_id}/focus", headers=auth)

    async with SessionLocal() as session:
        for job_id in (focused_id, stale_id):
            row = await session.get(FreelanceJob, uuid.UUID(job_id))
            row.last_seen_at = utc_now() - timedelta(hours=25)
        await session.commit()

    async with SessionLocal() as session:
        assert await prune_stale(session, user_id) == 1
        await session.commit()
        assert await session.get(FreelanceJob, uuid.UUID(focused_id)) is not None
        assert await session.get(FreelanceJob, uuid.UUID(stale_id)) is None


# --- a second source plugs in without Upwork -----------------------------------------


class FakeSource:
    """A third-party provider: a narrower filter set, no details, no ontology."""

    key = "fake"
    label = "Fake Jobs API"
    capabilities = SourceCapabilities(filters=frozenset({"query", "job_type", "budget_min"}), sorts=("recency",))

    def __init__(self) -> None:
        self.calls: list[JobSearchParams] = []

    async def search(self, params: JobSearchParams) -> SourcePage:
        self.calls.append(params)
        return SourcePage(
            snapshots=[
                {
                    "upwork_id": "fake-1",
                    "ciphertext": None,
                    "url": "https://example.com/jobs/1",
                    "title": "Django contractor",
                    "description": "Three months, remote.",
                    "job_type": FreelanceJobType.FIXED,
                    "budget_amount": 900.0,
                    "budget_currency": "USD",
                    "skills": ["Django"],
                    "client": {"country": "Spain", "payment_verified": True},
                    "raw": {"provider": "fake"},
                },
            ],
            total=1,
            has_next_page=False,
        )

    async def detail(self, job):
        return None

    async def categories(self):
        return []

    async def suggest_skills(self, label, limit):
        return []


async def test_a_third_party_source_plugs_in_without_an_upwork_connection(client, auth, monkeypatch) -> None:
    from app.freelancing.sources import registry

    fake = FakeSource()

    async def factory(session, user_id):
        return fake

    registry.register(FakeSource, factory)
    monkeypatch.setattr(registry, "source_key", lambda: "fake")
    try:
        # The catalogue says which controls this source honours, and offers no
        # category tree or skill autocomplete.
        res = await client.get("/api/v1/freelancing/jobs/filters", headers=auth)
        assert res.status_code == 200, res.text
        catalogue = res.json()
        assert catalogue["source"] == {
            "key": "fake", "label": "Fake Jobs API",
            "filters": ["budget_min", "job_type", "query"], "sorts": ["recency"],
            "detail": False, "categories": False, "skills": False,
        }
        assert catalogue["categories"] == [] and catalogue["categories_error"] is None
        assert [o["value"] for o in catalogue["sorts"]] == ["recency"]
        assert (await client.get("/api/v1/freelancing/jobs/skills", headers=auth, params={"q": "x"})).json() == []

        # No Upwork key pair, no OAuth: the search still runs, through the source.
        res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "django", "job_type": "fixed"})
        assert res.status_code == 200, res.text
        page = res.json()
        assert fake.calls[-1].query == "django" and fake.calls[-1].job_type == "fixed"
        (job,) = page["items"]
        assert job["title"] == "Django contractor" and job["budget_amount"] == 900.0
        assert job["client"]["country"] == "Spain" and job["upwork_id"] == "fake-1"

        # Everything downstream is the same product: focus, the tracker, the detail page.
        res = await client.post(f"/api/v1/freelancing/jobs/{job['id']}/focus", headers=auth)
        assert res.json()["track_stage"] == "focused"
        res = await client.get(f"/api/v1/freelancing/jobs/{job['id']}", headers=auth)
        assert res.status_code == 200, res.text
        assert res.json()["detail_fetched_at"] is None and res.json()["screening_questions"] == []
        res = await client.get("/api/v1/freelancing/tracks/summary", headers=auth)
        assert res.json()["focused"] == 1

        # A source name nobody registered is a configuration error, said plainly.
        monkeypatch.setattr(registry, "source_key", lambda: "nope")
        res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "x"})
        assert res.status_code == 500
        assert res.json()["detail"]["code"] == "JOB_SOURCE_UNKNOWN"
        assert "fake" in res.json()["detail"]["message"] and "upwork" in res.json()["detail"]["message"]
    finally:
        registry.unregister("fake")
