"""The ``neatrat~upwork-job-scraper`` actor: its input, and its dataset items.

Selected with ``APIFY_UPWORK_ACTOR_ID=neatrat~upwork-job-scraper``. It reads
Upwork's search pages directly, so it pages by Upwork result page.

This is the one place that knows the actor's field names, from its published
input schema and dataset schema (build 0.0.86, September 2026). Everything
else speaks this API's own vocabulary.

Input fields used: ``query``, ``experienceLevel``, ``jobType``,
``paymentVerified``, ``fixedPriceRange``, ``hourlyRateRange``,
``clientHistory``, ``location``, ``customFilters``, ``page``,
``pagesToScrape``, ``perPage``, ``sort``, ``maxJobAge``. Not used: ``rawUrl``
(the parameters say the same thing, checked) and ``cookies`` (the actor
authenticates with its own).
"""

from __future__ import annotations

import re
from typing import Any

from app.core.config import Settings
from app.freelancing.snapshot import parse_instant
from app.freelancing.sources.base import SourceCapabilities
from app.models.enums import FreelanceJobType
from app.schemas.freelancing import CategoryOption, JobSearchParams

DEFAULT_ACTOR_ID = "neatrat~upwork-job-scraper"

# JobSearchParams fields this actor applies. The search form hides the rest.
SUPPORTED_FILTERS = frozenset(
    {
        "query",
        "and_terms",
        "or_terms",
        "exact_terms",
        "exclude_terms",
        "title",
        "skills",
        "job_type",
        "experience_level",
        "budget_min",
        "budget_max",
        "hourly_rate_min",
        "hourly_rate_max",
        "client_hires_min",
        "client_hires_max",
        "verified_payment_only",
        "client_locations",
        "posted_within_hours",
    }
)
SUPPORTED_SORTS = ("recency", "relevance")

SORT = {"recency": "newest", "relevance": "relevance"}
JOB_TYPE = {"hourly": "hourly", "fixed": "fixed"}
EXPERIENCE = {"entry_level": "entry", "intermediate": "intermediate", "expert": "expert"}

# Upwork's own result-page sizes; the actor passes this through.
UPWORK_PAGE_SIZES = (10, 20, 50)
# Open ends of a range. Upwork's URL filter needs both ends.
FIXED_PRICE_CEILING = 1_000_000
HOURLY_RATE_CEILING = 1_000

# The actor's client-history buckets and the hire counts each covers.
CLIENT_HISTORY = (("noHires", 0, 0), ("1to9Hires", 1, 9), ("10+Hires", 10, None))


def upwork_page_size(page_size: int) -> int:
    """The smallest Upwork page that holds one of our pages."""
    return next((n for n in UPWORK_PAGE_SIZES if n >= page_size), UPWORK_PAGE_SIZES[-1])


def _client_history(low: int | None, high: int | None) -> list[str]:
    low = low or 0
    buckets = []
    for name, start, end in CLIENT_HISTORY:
        overlaps = (end is None or low <= end) and (high is None or start <= high)
        if overlaps:
            buckets.append(name)
    return buckets


def _query(params: JobSearchParams) -> str:
    """The search box, with Upwork's boolean syntax for the advanced terms."""
    parts: list[str] = []
    if params.query:
        parts.append(params.query.strip())
    parts.extend(t for t in params.and_terms)
    parts.extend(f'"{t}"' for t in params.exact_terms)
    if params.or_terms:
        parts.append("(" + " OR ".join(params.or_terms) + ")")
    return " ".join(p for p in parts if p)


def build_input(
    params: JobSearchParams, *, page: int, pages_per_run: int, per_page: int
) -> dict[str, Any]:
    """The actor's run input. Unset parameters are omitted, not nulled."""
    run_input: dict[str, Any] = {
        "page": page,
        "pagesToScrape": pages_per_run,
        "perPage": per_page,
        "sort": SORT.get(params.sort, "newest"),
    }
    query = _query(params)
    if query:
        run_input["query"] = query

    if params.job_type:
        run_input["jobType"] = [JOB_TYPE[params.job_type]]
    if params.experience_level:
        run_input["experienceLevel"] = [EXPERIENCE[params.experience_level]]
    if params.budget_min is not None or params.budget_max is not None:
        run_input["fixedPriceRange"] = [params.budget_min or 0, params.budget_max or FIXED_PRICE_CEILING]
    if params.hourly_rate_min is not None or params.hourly_rate_max is not None:
        run_input["hourlyRateRange"] = [
            params.hourly_rate_min or 0,
            params.hourly_rate_max or HOURLY_RATE_CEILING,
        ]
    if params.client_hires_min is not None or params.client_hires_max is not None:
        buckets = _client_history(params.client_hires_min, params.client_hires_max)
        if buckets:
            run_input["clientHistory"] = buckets
    if params.verified_payment_only:
        run_input["paymentVerified"] = True
    if params.client_locations:
        run_input["location"] = params.client_locations
    if params.posted_within_hours:
        run_input["maxJobAge"] = {"value": params.posted_within_hours, "unit": "hours"}

    # Applied by the actor to each scraped job, case-insensitively.
    custom: list[dict[str, Any]] = []
    if params.title:
        custom.append({"key": "title", "operator": "includes", "value": params.title})
    if params.skills:
        custom.append({"key": "tags", "operator": "includes", "value": params.skills})
    if params.exclude_terms:
        custom.append({"key": "title", "operator": "notIncludes", "value": params.exclude_terms})
        custom.append({"key": "description", "operator": "notIncludes", "value": params.exclude_terms})
    if custom:
        run_input["customFilters"] = custom
    return run_input


# --- the dataset --------------------------------------------------------------------------

_NUMBER = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?")
_CIPHERTEXT = re.compile(r"(~0[0-9a-zA-Z]+)")


def _amounts(budget: object) -> list[float]:
    """"$25.00 - $50.00" -> [25.0, 50.0]; "$1.5K" -> [1500.0]."""
    if isinstance(budget, (int, float)):
        return [float(budget)]
    if not isinstance(budget, str):
        return []
    values = []
    for digits, suffix in _NUMBER.findall(budget):
        value = float(digits.replace(",", ""))
        if suffix in ("k", "K"):
            value *= 1_000
        elif suffix in ("m", "M"):
            value *= 1_000_000
        values.append(value)
    return values


def _job_type(item: dict) -> FreelanceJobType | None:
    kind = str(item.get("jobType") or "").lower()
    if kind.startswith("hour"):
        return FreelanceJobType.HOURLY
    if kind.startswith("fix"):
        return FreelanceJobType.FIXED
    return None


def _payment_verified(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in ("true", "false"):
        return value.lower() == "true"
    return None  # "unknown"


def snapshot_from_item(item: dict) -> dict[str, Any]:
    """Column values for ``FreelanceJob`` from one dataset item."""
    job_type = _job_type(item)
    amounts = _amounts(item.get("budget"))
    hourly_min = hourly_max = budget_amount = None
    if job_type is FreelanceJobType.HOURLY and amounts:
        hourly_min, hourly_max = amounts[0], amounts[-1]
    elif job_type is FreelanceJobType.FIXED and amounts:
        budget_amount = amounts[-1]

    url = item.get("url") or None
    match = _CIPHERTEXT.search(url or "")
    confidence = item.get("clientNameConfidence")
    # The actor infers a first name from past freelancers' feedback. Only a
    # clear winner is worth greeting someone by.
    contact_name = (
        item.get("clientName")
        if item.get("clientName") and isinstance(confidence, (int, float)) and confidence >= 0.6
        else None
    )
    allowed = [str(c) for c in (item.get("allowedApplicantCountries") or []) if c]
    questions = [
        str(q.get("question") if isinstance(q, dict) else q)
        for q in (item.get("questions") or [])
        if (q.get("question") if isinstance(q, dict) else q)
    ]
    has_hired = item.get("hasHired")

    return {
        "upwork_id": str(item.get("id") or item.get("subId") or url),
        "ciphertext": match.group(1) if match else item.get("subId"),
        "url": url,
        "title": str(item.get("title") or "Untitled posting"),
        "description": item.get("description"),
        "job_type": job_type,
        "budget_amount": budget_amount,
        "budget_currency": "USD" if amounts else None,
        "hourly_min": hourly_min,
        "hourly_max": hourly_max,
        "duration_label": None,
        "workload": None,
        "experience_level": item.get("experienceLevel") or None,
        "category": None,
        "subcategory": None,
        "skills": [str(t) for t in (item.get("tags") or []) if t],
        "client": {
            "company_name": None,
            "contact_name": contact_name,
            "country": item.get("clientLocation") or None,
            "payment_verified": _payment_verified(item.get("paymentVerified")),
            "total_spent": item.get("clientTotalSpent"),
            "feedback": item.get("clientRating"),
            "hire_rate_percent": item.get("clientHireRatePercent"),
            "avg_hourly_rate": item.get("clientAvgHourlyRate"),
        },
        "total_applicants": item.get("proposals"),
        "freelancers_to_hire": None,
        "is_premium": False,
        "is_enterprise": False,
        # Only these countries may apply: the same meaning as Upwork's
        # mandatory preferred location.
        "preferred_freelancer_location": allowed,
        "published_at": parse_instant(item.get("absoluteDate")),
        "renewed_at": None,
        "raw": {
            **item,
            "preferredFreelancerLocationMandatory": bool(allowed),
            "extras": {
                "screening_questions": questions,
                "activity": {"client_has_hired": has_hired if isinstance(has_hired, bool) else None},
            },
        },
    }


class NeatratProfile:
    """The actor as the Apify job source drives it: one Upwork result page per step."""

    actor_id = DEFAULT_ACTOR_ID
    label = "Apify · Upwork Job Scraper (neatrat)"
    capabilities = SourceCapabilities(filters=SUPPORTED_FILTERS, sorts=SUPPORTED_SORTS)
    cost_note = (
        "Billed per job returned, with a minimum of ten jobs per run; Apify platform "
        "usage is billed on top."
    )

    def run_size(self, params: JobSearchParams, settings: Settings) -> int:
        return upwork_page_size(params.page_size) * settings.apify_pages_per_run

    def first_continuation(self, params: JobSearchParams, settings: Settings, now) -> dict:
        return {"page": 1, "per_page": upwork_page_size(params.page_size)}

    def build_input(
        self, params: JobSearchParams, *, size: int, cont: dict, settings: Settings
    ) -> dict[str, Any]:
        return build_input(
            params,
            page=int(cont["page"]),
            pages_per_run=settings.apify_pages_per_run,
            per_page=int(cont["per_page"]),
        )

    def next_continuation(self, cont: dict, final_slice: list[dict], settings: Settings) -> dict | None:
        return {**cont, "page": int(cont["page"]) + settings.apify_pages_per_run}

    def describe_continuation(self, cont: dict) -> str:
        return f"Upwork page {cont.get('page', 1)}"

    def snapshot(self, item: dict) -> dict[str, Any]:
        return snapshot_from_item(item)

    def categories(self, input_schema: dict | None) -> list[CategoryOption]:
        return []
