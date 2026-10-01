"""The Apify job source with the neatrat actor, end to end, against a mocked Apify.

Apify is replaced by an httpx MockTransport that plays the actor: it records
the exact run input and query parameters, holds a run in RUNNING until it is
polled, and serves the run's dataset by offset with Apify's pagination
headers. So these tests check what the actor would be asked to do, and that a
slow run, "load more" and a repeated search cost what they should.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.freelancing.apify.neatrat_scraper import (
    _amounts,
    build_input,
    snapshot_from_item,
    upwork_page_size,
)
from app.freelancing.sources import apify_upwork
from app.freelancing.transport import set_transport
from app.main import app
from app.models.enums import FreelanceJobType
from app.schemas.freelancing import JobSearchParams
from app.worker.runner import run_once

GOOD_TOKEN = "apify_api_good_token_1234"
ACTOR = "neatrat~upwork-job-scraper"


def make_item(index: int, **overrides: Any) -> dict:
    item = {
        "id": f"20564885761366{index:05d}",
        "subId": None,
        "title": f"Posting number {index}",
        "description": f"Description of posting {index}.",
        "url": f"https://www.upwork.com/jobs/Posting-{index}_~0220564885761366{index:05d}/?referrer_url_path=/nx/search/jobs",
        "budget": "$500.00",
        "relativeDate": "Posted 2 hours ago",
        "absoluteDate": "2026-09-23T10:05:00.000Z",
        "jobType": "Fixed",
        "experienceLevel": "Intermediate",
        "clientLocation": "Canada",
        "paymentVerified": True,
        "allowedApplicantCountries": None,
        "clientName": None,
        "clientNameConfidence": None,
        "clientAvgHourlyRate": None,
        "clientRating": 4.5,
        "clientHireRatePercent": 50,
        "clientTotalSpent": 1200,
        "hasHired": False,
        "proposals": 8,
        "questions": None,
        "tags": ["Python"],
    }
    item.update(overrides)
    return item


HOURLY = make_item(
    0,
    id="2056488576136638272",
    title="Senior FastAPI developer for an AI product",
    description="Own our FastAPI backend. PostgreSQL and LLM APIs.",
    url="https://www.upwork.com/jobs/Senior-FastAPI-developer_~022056488576136638272/",
    budget="$25.00 - $50.00",
    jobType="Hourly",
    experienceLevel="Expert",
    clientLocation="Germany",
    clientName="Anna",
    clientNameConfidence=0.9,
    clientAvgHourlyRate=42.5,
    clientRating=4.9,
    clientHireRatePercent=75,
    clientTotalSpent=52000,
    proposals=12,
    questions=["Which FastAPI services have you shipped?"],
    tags=["Python", "FastAPI"],
)
US_ONLY = make_item(1, budget="$1,500.00", paymentVerified="unknown", allowedApplicantCountries=["United States"])


class FakeApify:
    """Answers like the Apify API and the actor, and remembers what it was asked."""

    def __init__(self) -> None:
        self.runs: dict[str, dict] = {}
        self.datasets: dict[str, list[dict]] = {}
        self.started: list[dict] = []  # {"input", "params"}
        self.requests: list[httpx.Request] = []
        # Dataset items by the Upwork page a run starts from.
        self.pages: dict[int, list[dict]] = {}
        self.start_status = "SUCCEEDED"
        self.status_message: str | None = None
        self.respond_with: httpx.Response | None = None

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.apify.com", request.url
        self.requests.append(request)
        if self.respond_with is not None:
            return self.respond_with
        if request.headers.get("Authorization") != f"Bearer {GOOD_TOKEN}":
            return httpx.Response(401, json={"error": {"type": "user-or-token-not-found", "message": "Authentication token is not valid"}})

        path = request.url.path
        if request.method == "POST" and path == f"/v2/acts/{ACTOR}/runs":
            run_input = json.loads(request.content)
            self.started.append({"input": run_input, "params": dict(request.url.params)})
            number = len(self.started)
            run = {
                "id": f"run-{number}",
                "status": self.start_status,
                "statusMessage": self.status_message,
                "startedAt": "2026-09-24T10:00:00.000Z",
                "defaultDatasetId": f"ds-{number}",
            }
            self.runs[run["id"]] = run
            self.datasets[run["defaultDatasetId"]] = list(self.pages.get(run_input.get("page", 1), []))
            return httpx.Response(201, json={"data": run})
        if request.method == "GET" and path.startswith("/v2/actor-runs/"):
            run = self.runs[path.rsplit("/", 1)[1]]
            if run["status"] == "RUNNING":
                run["status"] = "SUCCEEDED"  # finishes while being waited on
            return httpx.Response(200, json={"data": run})
        if request.method == "GET" and path.startswith("/v2/datasets/"):
            items = self.datasets[path.split("/")[3]]
            offset = int(request.url.params.get("offset", 0))
            limit = int(request.url.params.get("limit", 1000))
            chunk = items[offset : offset + limit]
            return httpx.Response(
                200,
                json=chunk,
                headers={
                    "X-Apify-Pagination-Total": str(len(items)),
                    "X-Apify-Pagination-Offset": str(offset),
                    "X-Apify-Pagination-Count": str(len(chunk)),
                },
            )
        if path == "/v2/users/me":
            return httpx.Response(200, json={"data": {"username": "aran", "plan": {"id": "FREE"}}})
        if path == f"/v2/acts/{ACTOR}":
            return httpx.Response(200, json={"data": {
                "title": "Upwork Job Scraper",
                "pricingInfos": [{"pricingPerEvent": {"actorChargeEvents": {"job": {
                    "eventTieredPricingUsd": {"FREE": {"tieredEventPriceUsd": 0.0035}},
                }}}}],
            }})
        return httpx.Response(404, json={"error": {"type": "record-not-found", "message": f"no route {path}"}})

    @property
    def run_starts(self) -> int:
        return len(self.started)


@pytest.fixture
def apify(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "freelancing_job_source", "apify")
    # These tests drive the neatrat actor; upwork-vibe has its own file.
    monkeypatch.setattr(settings, "apify_upwork_actor_id", ACTOR)
    monkeypatch.setattr(settings, "apify_token", "")
    monkeypatch.setattr(settings, "apify_pages_per_run", 1)
    monkeypatch.setattr(settings, "apify_wait_seconds", 25)
    apify_upwork._recent_runs.clear()
    fake = FakeApify()
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
    email = f"apify-{uuid.uuid4().hex[:8]}@example.com"
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
        query="fastapi", title="backend", skills=["python"], exclude_terms=["wordpress"],
        job_type="hourly", experience_level="expert", hourly_rate_min=40, budget_min=500,
        client_hires_min=1, verified_payment_only=True, client_locations=["Europe", "Canada"],
        posted_within_hours=24, sort="relevance", page_size=30,
    )
    assert build_input(params, page=3, pages_per_run=2, per_page=upwork_page_size(params.page_size)) == {
        "page": 3,
        "pagesToScrape": 2,
        "perPage": 50,
        "sort": "relevance",
        "query": "fastapi",
        "jobType": ["hourly"],
        "experienceLevel": ["expert"],
        "fixedPriceRange": [500, 1_000_000],
        "hourlyRateRange": [40, 1_000],
        "clientHistory": ["1to9Hires", "10+Hires"],
        "paymentVerified": True,
        "location": ["Europe", "Canada"],
        "maxJobAge": {"value": 24, "unit": "hours"},
        "customFilters": [
            {"key": "title", "operator": "includes", "value": "backend"},
            {"key": "tags", "operator": "includes", "value": ["python"]},
            {"key": "title", "operator": "notIncludes", "value": ["wordpress"]},
            {"key": "description", "operator": "notIncludes", "value": ["wordpress"]},
        ],
    }


def test_advanced_terms_become_upwork_boolean_syntax_and_buckets_are_exact() -> None:
    params = JobSearchParams(and_terms=["python", "api"], exact_terms=["rest api"], or_terms=["django", "flask"],
                             client_hires_max=0)
    run_input = build_input(params, page=1, pages_per_run=1, per_page=10)
    assert run_input["query"] == 'python api "rest api" (django OR flask)'
    assert run_input["clientHistory"] == ["noHires"]
    assert "customFilters" not in run_input and "paymentVerified" not in run_input
    assert run_input["sort"] == "newest"
    assert [upwork_page_size(n) for n in (10, 20, 30, 50)] == [10, 20, 50, 50]


def test_a_dataset_item_becomes_a_snapshot() -> None:
    hourly = snapshot_from_item(HOURLY)
    assert hourly["job_type"] is FreelanceJobType.HOURLY
    assert (hourly["hourly_min"], hourly["hourly_max"], hourly["budget_amount"]) == (25.0, 50.0, None)
    assert hourly["ciphertext"] == "~022056488576136638272"
    assert hourly["upwork_id"] == "2056488576136638272"
    assert hourly["client"]["contact_name"] == "Anna"
    assert hourly["client"]["payment_verified"] is True
    assert hourly["published_at"].isoformat() == "2026-09-23T10:05:00+00:00"
    assert hourly["raw"]["extras"]["screening_questions"] == ["Which FastAPI services have you shipped?"]

    fixed = snapshot_from_item(US_ONLY)
    assert fixed["job_type"] is FreelanceJobType.FIXED and fixed["budget_amount"] == 1500.0
    assert fixed["client"]["payment_verified"] is None  # "unknown"
    assert fixed["preferred_freelancer_location"] == ["United States"]

    # A name inferred with low confidence is not one to greet anybody by.
    unsure = snapshot_from_item(make_item(2, clientName="Bob", clientNameConfidence=0.5))
    assert unsure["client"]["contact_name"] is None
    assert _amounts("$1.5K") == [1500.0] and _amounts(None) == []


# --- the flow -------------------------------------------------------------------


async def test_token_setup_and_the_source_status(client, auth, apify) -> None:
    res = await client.get("/api/v1/freelancing/source", headers=auth)
    source = res.json()
    assert source["key"] == "apify" and source["ready"] is False
    assert "Apify API token" in source["setup_hint"]
    assert "posted_within_hours" in source["filters"] and "hourly_rate_min" in source["filters"]
    assert "occupation_ids" not in source["filters"]
    assert source["sorts"] == ["recency", "relevance"]

    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "x"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "JOB_SOURCE_NOT_CONFIGURED"

    # A wrong token: the test says so, and the source is not ready.
    await client.put("/api/v1/freelancing/apify/token", headers=auth, json={"token": "apify_api_wrong_0000"})
    res = await client.post("/api/v1/freelancing/apify/test", headers=auth)
    assert res.json()["ok"] is False and "rejected" in res.json()["detail"]
    assert (await client.get("/api/v1/freelancing/apify/connection", headers=auth)).json()["status"] == "invalid"
    assert (await client.get("/api/v1/freelancing/source", headers=auth)).json()["ready"] is False

    # The right one.
    res = await client.put("/api/v1/freelancing/apify/token", headers=auth, json={"token": GOOD_TOKEN})
    assert res.json()["masked_token"] == "apify_api_...1234" and res.json()["token_source"] == "user"
    res = await client.post("/api/v1/freelancing/apify/test", headers=auth)
    body = res.json()
    assert body == {"ok": True, "detail": "Connected as aran", "apify_username": "aran", "plan": "FREE",
                    "actor_title": "Upwork Job Scraper", "price_per_job_usd": 0.0035}
    connection = (await client.get("/api/v1/freelancing/apify/connection", headers=auth)).json()
    assert connection["status"] == "valid" and connection["actor_id"] == ACTOR
    assert (await client.get("/api/v1/freelancing/source", headers=auth)).json()["ready"] is True
    # Testing never starts a run: it costs nothing.
    assert apify.run_starts == 0

    # The catalogue offers this source's controls, with no category tree.
    catalogue = (await client.get("/api/v1/freelancing/jobs/filters", headers=auth)).json()
    assert catalogue["source"]["key"] == "apify"
    assert [o["value"] for o in catalogue["sorts"]] == ["recency", "relevance"]
    assert catalogue["categories"] == [] and catalogue["categories_error"] is None


async def test_a_slow_run_then_its_dataset_page_by_page(client, auth, apify) -> None:
    await client.put("/api/v1/freelancing/apify/token", headers=auth, json={"token": GOOD_TOKEN})
    apify.pages[1] = [HOURLY, US_ONLY, *(make_item(i) for i in range(2, 35))]
    apify.start_status = "RUNNING"

    query = {
        "query": "fastapi", "title": "backend", "skills": ["python"], "exclude_terms": ["wordpress"],
        "job_type": "hourly", "experience_level": "expert", "hourly_rate_min": 40, "client_hires_min": 1,
        "verified_payment_only": True, "client_locations": ["Europe"], "posted_within_hours": 24,
        "page_size": 30, "open_to_country": "Thailand",
    }

    # The run is still going: the answer says so, with a cursor to ask again.
    page = await search(client, auth, **query)
    assert page["pending"] is True and page["items"] == []
    assert page["end_cursor"].startswith("apify.")
    assert "Upwork page 1" in page["progress_note"]

    (started,) = apify.started
    assert started["params"] == {"waitForFinish": "25", "maxItems": "50", "timeout": "300"}
    assert started["input"]["perPage"] == 50 and started["input"]["page"] == 1
    assert started["input"]["jobType"] == ["hourly"] and started["input"]["maxJobAge"] == {"value": 24, "unit": "hours"}
    assert apify.requests[0].headers["Authorization"] == f"Bearer {GOOD_TOKEN}"

    # Asking again waits on the run, which finishes: the first 30 of 35 jobs,
    # minus the one only open to applicants from the United States.
    page = await search(client, auth, **query, cursor=page["end_cursor"])
    assert page["pending"] is False
    assert page["total"] == 35 and page["hidden_count"] == 1 and len(page["items"]) == 29
    assert page["has_next_page"] is True
    first = page["items"][0]
    assert first["title"] == HOURLY["title"]
    assert first["job_type"] == "hourly" and (first["hourly_min"], first["hourly_max"]) == (25.0, 50.0)
    assert first["client"]["country"] == "Germany" and first["client"]["total_spent"] == 52000
    assert first["client"]["hire_rate_percent"] == 75 and first["client"]["contact_name"] == "Anna"
    assert first["total_applicants"] == 12 and first["skills"] == ["Python", "FastAPI"]
    assert first["url"].startswith("https://www.upwork.com/jobs/")

    # "Load more" reads the rest of the same dataset: no second run.
    more = await search(client, auth, **query, cursor=page["end_cursor"])
    assert len(more["items"]) == 5 and more["has_next_page"] is False and more["end_cursor"] is None
    assert apify.run_starts == 1

    # The same search again reuses the run rather than paying for it twice.
    again = await search_until_done(client, auth, **query)
    assert len(again["items"]) == 29 and apify.run_starts == 1

    # The posting page has the screening questions straight from the dataset,
    # with no further call to Apify.
    calls = len(apify.requests)
    detail = (await client.get(f"/api/v1/freelancing/jobs/{first['id']}", headers=auth)).json()
    assert detail["screening_questions"] == ["Which FastAPI services have you shipped?"]
    assert detail["activity"]["client_has_hired"] is False
    assert detail["detail_fetched_at"] is None
    assert len(apify.requests) == calls

    # Focus it and draft a proposal: the template greets the client by name.
    res = await client.post(f"/api/v1/freelancing/jobs/{first['id']}/focus", headers=auth)
    assert res.json()["track_stage"] == "focused"
    res = await client.post("/api/v1/freelancing/proposals/generate", headers=auth, json={"job_id": first["id"]})
    assert res.status_code == 202, res.text
    queued = res.json()
    for _ in range(20):
        if not await run_once():
            break
    proposal = (await client.get(f"/api/v1/freelancing/proposals/{queued['proposal_id']}", headers=auth)).json()
    assert proposal["cover_letter_markdown"].startswith("Hi Anna,")
    assert proposal["answers"] == [{"question": "Which FastAPI services have you shipped?", "answer": ""}]
    assert proposal["bid_type"] == "hourly" and proposal["bid_amount"] == 50.0

    connection = (await client.get("/api/v1/freelancing/apify/connection", headers=auth)).json()
    assert connection["last_run_id"] == "run-1" and connection["last_run_at"]


async def test_a_full_dataset_means_the_next_page_is_another_run(client, auth, apify) -> None:
    await client.put("/api/v1/freelancing/apify/token", headers=auth, json={"token": GOOD_TOKEN})
    apify.pages[1] = [make_item(i) for i in range(10)]
    apify.pages[2] = [make_item(i) for i in range(10, 14)]

    page = await search_until_done(client, auth, query="django", page_size=10)
    assert len(page["items"]) == 10 and page["has_next_page"] is True
    more = await search_until_done(client, auth, query="django", page_size=10, cursor=page["end_cursor"])
    assert len(more["items"]) == 4 and more["has_next_page"] is False
    assert [s["input"]["page"] for s in apify.started] == [1, 2]
    assert all(s["input"]["perPage"] == 10 for s in apify.started)


async def test_failures_are_reported_plainly(client, auth, apify) -> None:
    await client.put("/api/v1/freelancing/apify/token", headers=auth, json={"token": GOOD_TOKEN})

    # A failed run with nothing to show.
    apify.start_status, apify.status_message = "FAILED", "Proxy error while loading page 1"
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "one"})
    assert res.status_code == 502
    assert res.json()["detail"]["code"] == "APIFY_RUN_FAILED"
    assert "Proxy error" in res.json()["detail"]["message"]

    # A run that exits cleanly with a message and no jobs: the message is shown,
    # rather than "nothing matched".
    apify.start_status = "SUCCEEDED"
    apify.status_message = "Free-tier quota exhausted. Get an Apify paid plan to continue."
    page = await search(client, auth, query="two")
    assert page["items"] == [] and page["notice"].startswith("Apify: Free-tier quota exhausted")

    # Out of credit.
    apify.respond_with = httpx.Response(402, json={"error": {"type": "not-enough-usage-to-run-paid-actor", "message": "Not enough credit"}})
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "three"})
    assert res.status_code == 402 and res.json()["detail"]["code"] == "APIFY_OUT_OF_CREDIT"

    # A token revoked on Apify: never a 401 (that would read as a PhoeniX
    # sign-out), and the Settings card learns about it.
    apify.respond_with = None
    await client.put("/api/v1/freelancing/apify/token", headers=auth, json={"token": "apify_api_revoked_0000"})
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "four"})
    assert res.status_code == 409 and res.json()["detail"]["code"] == "APIFY_TOKEN_REJECTED"
    assert (await client.get("/api/v1/freelancing/apify/connection", headers=auth)).json()["status"] == "invalid"
    assert (await client.get("/api/v1/freelancing/source", headers=auth)).json()["ready"] is False

    # A cursor from somewhere else is refused, not guessed at.
    res = await client.post("/api/v1/freelancing/jobs/search", headers=auth, json={"query": "x", "cursor": "not-ours"})
    assert res.status_code == 400 and res.json()["detail"]["code"] == "BAD_CURSOR"


async def test_a_deployment_token_is_the_fallback(client, auth, apify, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "apify_token", GOOD_TOKEN)
    connection = (await client.get("/api/v1/freelancing/apify/connection", headers=auth)).json()
    assert connection["configured"] is True and connection["token_source"] == "environment"
    assert connection["masked_token"] == "apify_api_...1234"
    apify.pages[1] = [make_item(0)]
    page = await search_until_done(client, auth, query="environment")
    assert len(page["items"]) == 1
