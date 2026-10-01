"""The Apify job source with the upwork-vibe actor, against a mocked Apify.

This actor takes flat dotted keys, money as strings, ISO country codes, and a
posted-date window instead of a page number. The mock plays it: it records
the exact run input, serves the dataset with Apify's pagination headers, and
serves the actor's build so the category list is read live.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.freelancing.apify.vibe_scraper import (
    VibeProfile,
    build_input,
    categories_from_enum,
    keywords,
    location,
    snapshot_from_item,
)
from app.freelancing.errors import JobSourceError
from app.freelancing.sources import apify_upwork
from app.freelancing.transport import set_transport
from app.main import app
from app.models.enums import FreelanceJobType
from app.schemas.freelancing import JobSearchParams
from app.worker.runner import run_once

TOKEN = "apify_api_vibe_token_5678"
ACTOR = "upwork-vibe~upwork-job-scraper"
NEWEST = datetime(2026, 9, 24, 9, 0, tzinfo=UTC)


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def make_job(index: int, **overrides: Any) -> dict:
    job = {
        "uid": f"19550200568471{index:05d}",
        "title": f"Posting number {index}",
        "description": f"Description of posting {index}.",
        "createdAt": iso(NEWEST - timedelta(minutes=index)),
        "skills": ["Python"],
        "externalLink": f"https://www.upwork.com/jobs/~0219550200568471{index:05d}",
        "applicationCost": 4,
        "featured": False,
        "category": "Web Development",
        "ciphertext": f"~0219550200568471{index:05d}",
        "questions": None,
        "budget": {"fixedBudget": 800, "hourlyRate": None},
        "client": {
            "timezone": "Europe/Berlin",
            "industry": "Technology",
            "companySize": 10,
            "countryCode": "DE",
            "phoneNumberVerified": True,
            "paymentMethodVerified": True,
            "enterprise": False,
            "stats": {"totalSpent": 9000, "totalHires": 7, "hireRate": 60, "avgRate": 35,
                      "feedbackRate": 4.7, "feedbackCount": 5},
        },
        "vendor": {"hireType": "FREELANCER", "countryCodes": None, "experienceLevel": "INTERMEDIATE",
                   "englishLevel": "FLUENT", "languages": None},
        "customJobScore": 4.1,
    }
    job.update(overrides)
    return job


LEAD = make_job(
    0,
    title="React developer for a SaaS platform",
    description="Build and scale our React front end.",
    skills=["React", "TypeScript"],
    applicationCost=6,
    featured=True,
    questions=["What have you built with React?", {"question": "Your availability?"}],
    budget={"fixedBudget": 0, "hourlyRate": {"min": 40, "max": 80}},
    client={
        "timezone": "America/New_York", "industry": "Technology", "countryCode": "US",
        "phoneNumberVerified": True, "paymentMethodVerified": True, "enterprise": True,
        "companyName": "Acme",
        "stats": {"totalSpent": 125000, "totalHires": 42, "hireRate": 85, "avgRate": 65,
                  "feedbackRate": 4.95, "feedbackCount": 38},
    },
    vendor={"hireType": "FREELANCER", "countryCodes": ["TH", "US"], "experienceLevel": "EXPERT",
            "englishLevel": "FLUENT", "languages": ["English"]},
    activity={"totalApplicants": 12, "totalHired": 0, "totalInvitedToInterview": 3,
              "unansweredInvites": 1, "lastBuyerActivity": "2026-09-24T08:30:00.000Z"},
    customJobScore=4.8,
)
US_ONLY = make_job(1, vendor={"hireType": "ANY", "countryCodes": ["US"], "experienceLevel": "BEGINNER"})

LIVE_CATEGORIES = [
    "Web Development", "Mobile Development", "All - Web, Mobile & Software Dev",
    "Content Writing", "All - Writing",
]


class FakeVibe:
    """Answers like Apify running the upwork-vibe actor."""

    def __init__(self) -> None:
        self.runs: dict[str, dict] = {}
        self.datasets: dict[str, list[dict]] = {}
        self.started: list[dict] = []
        # Dataset items per run, in the order runs start.
        self.batches: list[list[dict]] = []
        self.start_status = "RUNNING"

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.apify.com", request.url
        path = request.url.path
        if path == f"/v2/acts/{ACTOR}/builds/default":
            # Public, and read for the category list.
            return httpx.Response(200, json={"data": {"inputSchema": json.dumps(
                {"properties": {"jobCategories": {"items": {"enum": LIVE_CATEGORIES}}}}
            )}})
        if request.headers.get("Authorization") != f"Bearer {TOKEN}":
            return httpx.Response(401, json={"error": {"type": "user-or-token-not-found", "message": "bad token"}})
        if request.method == "POST" and path == f"/v2/acts/{ACTOR}/runs":
            self.started.append({"input": json.loads(request.content), "params": dict(request.url.params)})
            number = len(self.started)
            run = {"id": f"run-{number}", "status": self.start_status, "statusMessage": None,
                   "startedAt": "2026-09-24T10:00:00.000Z", "defaultDatasetId": f"ds-{number}"}
            self.runs[run["id"]] = run
            batch = self.batches[number - 1] if number <= len(self.batches) else []
            self.datasets[run["defaultDatasetId"]] = list(batch)
            return httpx.Response(201, json={"data": run})
        if request.method == "GET" and path.startswith("/v2/actor-runs/"):
            run = self.runs[path.rsplit("/", 1)[1]]
            run["status"] = "SUCCEEDED"
            return httpx.Response(200, json={"data": run})
        if request.method == "GET" and path.startswith("/v2/datasets/"):
            items = self.datasets[path.split("/")[3]]
            offset = int(request.url.params.get("offset", 0))
            limit = int(request.url.params.get("limit", 1000))
            chunk = items[offset : offset + limit]
            return httpx.Response(200, json=chunk, headers={"X-Apify-Pagination-Total": str(len(items))})
        if path == "/v2/users/me":
            return httpx.Response(200, json={"data": {"username": "aran", "plan": {"id": "STARTER"}}})
        if path == f"/v2/acts/{ACTOR}":
            return httpx.Response(200, json={"data": {"title": "Upwork Job Scraper", "pricingInfos": [
                {"pricingPerEvent": {"actorChargeEvents": {"result-item": {
                    "eventTieredPricingUsd": {"FREE": {"tieredEventPriceUsd": 0.0105}}}}}}]}})
        return httpx.Response(404, json={"error": {"type": "record-not-found", "message": path}})


@pytest.fixture
def vibe(monkeypatch):
    settings = get_settings()
    # The default actor, unpinned: these tests are also what says it is the default.
    monkeypatch.setattr(settings, "freelancing_job_source", "apify")
    monkeypatch.setattr(settings, "apify_token", "")
    monkeypatch.setattr(settings, "apify_pages_per_run", 1)
    monkeypatch.setattr(settings, "apify_client_activity_addon", False)
    monkeypatch.setattr(settings, "apify_client_details_addon", False)
    apify_upwork._recent_runs.clear()
    fake = FakeVibe()
    set_transport(httpx.MockTransport(fake.handle))
    yield fake
    set_transport(None)
    apify_upwork._recent_runs.clear()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    email = f"vibe-{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post("/api/v1/auth/register", json={"email": email, "password": "a-strong-password"})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def search(client, auth, **body) -> dict:
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json=body)
    assert res.status_code == 200, res.text
    return res.json()


async def search_until_done(client, auth, **body) -> dict:
    page = await search(client, auth, **body)
    for _ in range(5):
        if not page["pending"]:
            return page
        page = await search(client, auth, **{**body, "cursor": page["end_cursor"]})
    raise AssertionError("the search never finished")


# --- pure pieces --------------------------------------------------------------


def test_every_supported_parameter_maps_to_the_actor_input() -> None:
    params = JobSearchParams(
        query="react, next.js", or_terms=["vue"], exact_terms=["design system"], exclude_terms=["wordpress"],
        category_ids=["All - Web, Mobile & Software Dev"], subcategory_ids=["Web Development"],
        workload="full_time", durations=["week", "month", "ongoing"], experience_level="entry_level",
        budget_min=500, budget_max=5000, hourly_rate_min=40, hourly_rate_max=120,
        connects_min=2, connects_max=16, client_min_hire_rate=50,
        client_hires_min=5, verified_payment_only=True, phone_verified_only=True,
        client_locations=["Europe", "US", "Northern America"], exclude_client_locations=["Pakistan"],
        client_timezone="America/New_York", client_min_rating=4.5, client_min_spent=1000, client_max_spent=50000,
        english_level="fluent", contractor_type="freelancer", featured_only=True, exclude_with_questions=True,
        open_to_country="Thailand",
    )
    assert build_input(
        params, size=20, posted_from="2026-09-23T09:00:00Z", posted_to=None,
        client_activity=True, client_details=True,
    ) == {
        "limit": 20,
        "fromDate": "2026-09-23T09:00:00Z",
        "includeKeywords.keywords": ["react", "next.js", "vue", "design system"],
        "includeKeywords.matchTitle": True,
        "includeKeywords.matchDescription": True,
        "includeKeywords.matchSkills": True,
        "excludeKeywords.keywords": ["wordpress"],
        "excludeKeywords.matchTitle": True,
        "excludeKeywords.matchDescription": True,
        "excludeKeywords.matchSkills": True,
        "jobCategories": ["All - Web, Mobile & Software Dev", "Web Development"],
        "budget.hourlyWorkloads": ["MORE_THAN_30_HOURS"],
        "budget.jobDurations": ["UP_TO_ONE_MONTH", "MORE_THAN_SIX_MONTHS"],
        "budget.fixedPrice.min": "500",
        "budget.fixedPrice.max": "5000",
        "budget.hourlyRate.min": "40",
        "budget.hourlyRate.max": "120",
        "budget.connectsPrice.min": 2,
        "budget.connectsPrice.max": 16,
        "budget.minClientHireRate": 50,
        "client.hireHistory": ["UP_TO", "MORE_THAN"],
        "client.paymentMethodVerified": True,
        "client.phoneNumberVerified": True,
        "client.includeLocations": [
            {"type": "REGION", "value": "europe"},
            {"type": "COUNTRY", "value": "US"},
            {"type": "SUBREGION", "value": "northern-america"},
        ],
        "client.excludeLocations": [{"type": "COUNTRY", "value": "PK"}],
        "client.timezones": ["America/New_York"],
        "client.minFeedbackScore": "4.5",
        "client.totalSpent.min": "1000",
        "client.totalSpent.max": "50000",
        "vendor.experienceLevel": ["BEGINNER"],
        "vendor.englishProficiency": "FLUENT",
        "vendor.type": ["FREELANCER"],
        "vendor.includeFeatured": True,
        "vendor.excludeWithQuestions": True,
        "vendor.includeLocations": [{"type": "COUNTRY", "value": "TH"}],
        "vendor.includeWithoutCountryPreference": True,
        "addons.enableClientActivity": True,
        "addons.enableClientDetails": True,
    }


def test_the_smaller_pieces() -> None:
    # Commas split the search box; duplicates collapse, case-insensitively.
    assert keywords(JobSearchParams(query="Python, python , FastAPI,", or_terms=["fastapi"])) == ["Python", "FastAPI"]
    # A place this actor cannot filter by is refused before any run is paid for.
    with pytest.raises(JobSourceError) as refused:
        location("Atlantis")
    assert refused.value.code == "UNKNOWN_LOCATION" and refused.value.status == 422
    assert location("united kingdom") == {"type": "COUNTRY", "value": "GB"}
    # No hires at all is its own bucket.
    assert build_input(JobSearchParams(client_hires_max=0), size=10, posted_from=None, posted_to=None) == {
        "limit": 10, "client.hireHistory": ["NONE"],
    }
    groups = categories_from_enum(LIVE_CATEGORIES)
    assert [(g.id, g.label, [s.value for s in g.subcategories]) for g in groups] == [
        ("All - Web, Mobile & Software Dev", "Web, Mobile & Software Dev", ["Web Development", "Mobile Development"]),
        ("All - Writing", "Writing", ["Content Writing"]),
    ]
    # With no live schema, the bundled list stands in.
    bundled = VibeProfile().categories(None)
    assert len(bundled) == 12
    assert sum(1 + len(g.subcategories) for g in bundled) == 76  # every name, in a group


def test_a_dataset_item_becomes_a_snapshot() -> None:
    lead = snapshot_from_item(LEAD)
    assert lead["job_type"] is FreelanceJobType.HOURLY
    assert (lead["hourly_min"], lead["hourly_max"], lead["budget_amount"]) == (40.0, 80.0, None)
    assert lead["upwork_id"] == LEAD["uid"] and lead["url"] == LEAD["externalLink"]
    assert lead["experience_level"] == "EXPERT" and lead["is_enterprise"] is True
    assert lead["client"] == {
        "company_name": "Acme", "country": "United States", "timezone": "America/New_York",
        "industry": "Technology", "payment_verified": True, "phone_verified": True,
        "total_spent": 125000.0, "total_hires": 42, "hire_rate_percent": 85.0, "avg_hourly_rate": 65.0,
        "feedback": 4.95, "total_reviews": 38,
    }
    assert lead["preferred_freelancer_location"] == ["Thailand", "United States"]
    assert lead["total_applicants"] == 12
    assert lead["published_at"] == NEWEST
    extras = lead["raw"]["extras"]
    assert extras["screening_questions"] == ["What have you built with React?", "Your availability?"]
    assert (extras["connects_required"], extras["featured"], extras["job_score"]) == (6, True, 4.8)
    assert extras["qualification"]["englishProficiency"] == "FLUENT"

    fixed = snapshot_from_item(US_ONLY)
    assert fixed["job_type"] is FreelanceJobType.FIXED and fixed["budget_amount"] == 800.0
    assert fixed["experience_level"] == "ENTRY_LEVEL"

    # No link: the posting URL is rebuilt from the ciphertext.
    bare = snapshot_from_item(make_job(3, externalLink=None))
    assert bare["url"] == "https://www.upwork.com/jobs/~021955020056847100003"


def test_the_next_page_is_the_jobs_posted_before_the_oldest_one_seen() -> None:
    profile = VibeProfile()
    settings = get_settings()
    now = datetime(2026, 9, 24, 12, 0, tzinfo=UTC)
    first = profile.first_continuation(JobSearchParams(posted_within_hours=24), settings, now)
    assert first == {"from": "2026-09-23T12:00:00Z", "to": None}
    following = profile.next_continuation(first, [LEAD, US_ONLY], settings)
    # One second before the oldest, so it is not fetched (and billed) twice.
    assert following == {"from": "2026-09-23T12:00:00Z", "to": "2026-09-24T08:58:59Z"}
    assert profile.next_continuation(first, [{"title": "no date"}], settings) is None


# --- the flow -------------------------------------------------------------------


async def test_the_default_actor_end_to_end(client, auth, vibe) -> None:
    await client.put("/api/v1/freelancing/apify/token", headers=auth, json={"token": TOKEN})

    source = (await client.get("/api/v1/freelancing/source", headers=auth)).json()
    assert source["key"] == "apify" and source["ready"] is True
    assert "upwork-vibe" in source["label"]
    assert source["sorts"] == ["recency"] and source["categories"] is True
    for offered in ("client_min_rating", "connects_max", "english_level", "posted_within_hours", "category_ids"):
        assert offered in source["filters"]
    for hidden in ("title", "skills", "and_terms", "job_type", "proposals_min", "occupation_ids"):
        assert hidden not in source["filters"]

    connection = (await client.get("/api/v1/freelancing/apify/connection", headers=auth)).json()
    assert connection["actor_id"] == ACTOR and "upwork-vibe" in connection["actor_label"]
    assert "no minimum per run" in connection["cost_note"]
    test = (await client.post("/api/v1/freelancing/apify/test", headers=auth)).json()
    assert test["ok"] is True and test["price_per_job_usd"] == 0.0105

    # The category tree comes from the actor's live input schema.
    catalogue = (await client.get("/api/v1/freelancing/jobs/filters", headers=auth)).json()
    assert [c["label"] for c in catalogue["categories"]] == ["Web, Mobile & Software Dev", "Writing"]

    # A full first run, then a second for the jobs posted before its oldest.
    vibe.batches = [[LEAD, US_ONLY, *(make_job(i) for i in range(2, 10))], [make_job(i) for i in range(10, 13)]]
    query = {"query": "react", "page_size": 10, "posted_within_hours": 24, "open_to_country": "Thailand",
             "client_locations": ["Europe", "US"], "client_min_rating": 4.5}
    before = datetime.now(UTC)
    page = await search(client, auth, **query)
    assert page["pending"] is True and "the newest jobs" in page["progress_note"]

    (first,) = vibe.started
    sent = first["input"]
    assert sent["limit"] == 10 and "toDate" not in sent
    posted_from = datetime.strptime(sent["fromDate"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    assert abs((before - timedelta(hours=24)) - posted_from) < timedelta(minutes=1)
    assert sent["includeKeywords.keywords"] == ["react"]
    assert sent["client.includeLocations"] == [{"type": "REGION", "value": "europe"}, {"type": "COUNTRY", "value": "US"}]
    assert sent["client.minFeedbackScore"] == "4.5"
    assert sent["vendor.includeLocations"] == [{"type": "COUNTRY", "value": "TH"}]
    assert sent["vendor.includeWithoutCountryPreference"] is True
    assert "addons.enableClientActivity" not in sent
    assert first["params"]["maxItems"] == "10"

    page = await search(client, auth, **query, cursor=page["end_cursor"])
    # The US-only posting is dropped here too, in case the actor let it through.
    assert len(page["items"]) == 9 and page["hidden_count"] == 1 and page["has_next_page"] is True
    lead = page["items"][0]
    assert lead["title"] == LEAD["title"]
    assert (lead["connects_required"], lead["featured"], lead["job_score"]) == (6, True, 4.8)
    assert lead["client"]["country"] == "United States" and lead["client"]["hire_rate_percent"] == 85.0

    more = await search_until_done(client, auth, **query, cursor=page["end_cursor"])
    assert len(more["items"]) == 3 and more["has_next_page"] is False
    second = vibe.started[1]["input"]
    assert second["fromDate"] == sent["fromDate"]
    assert second["toDate"] == "2026-09-24T08:50:59Z"  # a second before posting 9, the oldest seen

    # The posting page reads questions and requirements from the dataset.
    detail = (await client.get(f"/api/v1/freelancing/jobs/{lead['id']}", headers=auth)).json()
    assert detail["screening_questions"] == ["What have you built with React?", "Your availability?"]
    assert detail["qualification"]["englishProficiency"] == "FLUENT"
    assert detail["activity"]["total_invited_to_interview"] == 3

    # A draft bids what the posting actually costs in connects.
    await client.post(f"/api/v1/freelancing/jobs/{lead['id']}/focus", headers=auth)
    res = await client.post("/api/v1/freelancing/proposals/generate", headers=auth, json={"job_id": lead["id"]})
    queued = res.json()
    for _ in range(20):
        if not await run_once():
            break
    proposal = (await client.get(f"/api/v1/freelancing/proposals/{queued['proposal_id']}", headers=auth)).json()
    assert proposal["connects_estimate"] == 6
    assert proposal["answers"][1] == {"question": "Your availability?", "answer": ""}

    # A place the actor cannot filter by is refused before a run is paid for.
    runs = len(vibe.started)
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth,
                            json={"query": "react", "client_locations": ["Atlantis"]})
    assert res.status_code == 422 and res.json()["detail"]["code"] == "UNKNOWN_LOCATION"
    assert len(vibe.started) == runs


async def test_add_ons_and_an_unsupported_actor(client, auth, vibe, monkeypatch) -> None:
    await client.put("/api/v1/freelancing/apify/token", headers=auth, json={"token": TOKEN})
    settings = get_settings()
    monkeypatch.setattr(settings, "apify_client_activity_addon", True)
    monkeypatch.setattr(settings, "apify_client_details_addon", True)
    vibe.start_status = "SUCCEEDED"
    vibe.batches = [[LEAD]]
    page = await search_until_done(client, auth, query="addons")
    sent = vibe.started[0]["input"]
    assert sent["addons.enableClientActivity"] is True and sent["addons.enableClientDetails"] is True
    assert page["items"][0]["total_applicants"] == 12
    assert page["items"][0]["client"]["company_name"] == "Acme"

    monkeypatch.setattr(settings, "apify_upwork_actor_id", "someone~another-scraper")
    res = await client.get("/api/v1/freelancing/source", headers=auth)
    assert res.status_code == 500
    assert res.json()["detail"]["code"] == "APIFY_ACTOR_UNSUPPORTED"
    assert "upwork-vibe~upwork-job-scraper" in res.json()["detail"]["message"]
