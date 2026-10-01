"""The ``upwork-vibe~upwork-job-scraper`` actor: its input, and its dataset items.

The one place that knows this actor's field names, from its published input
schema and README (build 0.0.40, July 2026). Its input is flat with dotted
keys (``"budget.hourlyRate.min"``), money is sent as strings, and locations
are ``{"type", "value"}`` objects with ISO-2 country codes.

It searches its own index of Upwork jobs, newest first, and takes a ``limit``
and a posted-date window rather than a page number. So the next page of a
search is one more run for the jobs posted before the oldest one already
returned, keeping the same lower bound.

Keywords match any of them, in title, description and skills together. There
is no way to ask for "all of these", for a word in the title only, or for a
skill only, so those parameters are not offered for this actor; nor is a job
type or a sort order.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.config import Settings
from app.freelancing import countries
from app.freelancing.errors import JobSourceError
from app.freelancing.snapshot import parse_instant
from app.freelancing.sources.base import SourceCapabilities
from app.models.enums import FreelanceJobType
from app.schemas.freelancing import CategoryOption, FilterOption, JobSearchParams

ACTOR_ID = "upwork-vibe~upwork-job-scraper"

SUPPORTED_FILTERS = frozenset(
    {
        "query",
        "or_terms",
        "exact_terms",
        "exclude_terms",
        "category_ids",
        "subcategory_ids",
        "workload",
        "durations",
        "experience_level",
        "budget_min",
        "budget_max",
        "hourly_rate_min",
        "hourly_rate_max",
        "client_hires_min",
        "client_hires_max",
        "verified_payment_only",
        "phone_verified_only",
        "client_locations",
        "exclude_client_locations",
        "client_timezone",
        "client_min_rating",
        "client_min_spent",
        "client_max_spent",
        "client_min_hire_rate",
        "posted_within_hours",
        "connects_min",
        "connects_max",
        "english_level",
        "contractor_type",
        "featured_only",
        "exclude_with_questions",
    }
)
SUPPORTED_SORTS = ("recency",)

EXPERIENCE = {"entry_level": "BEGINNER", "intermediate": "INTERMEDIATE", "expert": "EXPERT"}
# Upwork's workload today is under or over 30 hours a week; "as needed" is part time.
WORKLOAD = {
    "full_time": "MORE_THAN_30_HOURS",
    "part_time": "LESS_THAN_30_HOURS",
    "as_needed": "LESS_THAN_30_HOURS",
    "not_sure": "UNSPECIFIED",
}
DURATION = {
    "week": "UP_TO_ONE_MONTH",
    "month": "UP_TO_ONE_MONTH",
    "quarter": "UP_TO_THREE_MONTHS",
    "semester": "UP_TO_SIX_MONTHS",
    "ongoing": "MORE_THAN_SIX_MONTHS",
}
# The actor's hire-history buckets, and the hire counts each covers.
HIRE_HISTORY = (("NONE", 0, 0), ("UP_TO", 1, 10), ("MORE_THAN", 11, None))
CONTRACTOR_TYPE = {"freelancer": "FREELANCER", "agency": "AGENCY"}

# The actor's category enum as of build 0.0.40, used when its live input
# schema cannot be read. Each "All - X" closes the group of the names before it.
FALLBACK_CATEGORIES = [
    "Accounting & Bookkeeping", "Financial Planning", "Management Consulting & Analysis",
    "Personal & Professional Coaching", "Recruiting & Human Resources",
    "Other - Accounting & Consulting", "All - Accounting & Consulting",
    "Data Entry & Transcription Services", "Market Research & Product Reviews",
    "Project Management (Admin)", "Virtual Assistance", "All - Admin Support",
    "Community Management & Tagging", "Customer Service & Tech Support", "All - Customer Service",
    "AI & Machine Learning", "Data Analysis & Testing", "Data Extraction/ETL",
    "Data Mining & Management", "All - Data Science & Analytics",
    "Art & Illustration", "Audio & Music Production", "Branding & Logo Design",
    "Graphic, Editorial & Presentation Design", "NFT, AR/VR & Game Art", "Performing Arts",
    "Photography", "Product Design (Creative)", "Video & Animation", "All - Design & Creative",
    "3D Modeling & CAD", "Building & Landscape Architecture", "Chemical Engineering",
    "Civil & Structural Engineering", "Contract Manufacturing",
    "Electrical & Electronic Engineering", "Energy & Mechanical Engineering",
    "Interior & Trade Show Design", "Physical Sciences", "All - Engineering & Architecture",
    "Database Management & Administration", "DevOps & Solution Architecture", "ERP/CRM Software",
    "Information Security & Compliance", "Network & System Administration", "All - IT & Networking",
    "Corporate & Contract Law", "Finance & Tax Law", "International & Immigration Law",
    "Public Law", "All - Legal",
    "Digital Marketing", "Lead Generation & Telemarketing", "Marketing, PR & Brand Strategy",
    "All - Sales & Marketing",
    "Language Tutoring & Interpretation", "Translation & Localization Services", "All - Translation",
    "AI Apps & Integration", "Blockchain, NFT & Cryptocurrency", "Desktop Application Development",
    "Ecommerce Development", "Game Design & Development", "Mobile Development",
    "Product Management & Scrum", "QA Testing", "Scripts & Utilities", "Web & Mobile Design",
    "Web Development", "Other - Software Development", "All - Web, Mobile & Software Dev",
    "Content Writing", "Editing & Proofreading Services", "Professional & Business Writing",
    "Sales & Marketing Copywriting", "All - Writing",
]

_CIPHERTEXT = re.compile(r"(~0[0-9a-zA-Z]+)")


def _utc(moment: datetime) -> str:
    """The actor's date format: "2026-09-24T10:00:00Z"."""
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _money(value: int | float) -> str:
    """The actor wants amounts as strings: "50", "4.5"."""
    return f"{value:g}"


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    for value in values:
        key = value.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(value.strip())
    return out


def keywords(params: JobSearchParams) -> list[str]:
    """The search box, split on commas, plus the "any of" and exact phrases."""
    parts = [p for p in (params.query or "").split(",")]
    return _dedupe([*parts, *params.or_terms, *params.exact_terms])


def location(text: str) -> dict[str, str]:
    """"Germany", "DE", "Europe", "Northern America" -> the actor's location object."""
    found = countries.area(text)
    if found:
        return {"type": found[0], "value": found[1]}
    code = countries.country_code(text)
    if code:
        return {"type": "COUNTRY", "value": code}
    raise JobSourceError(
        "UNKNOWN_LOCATION",
        f"“{text}” is not a country, region or subregion this source knows. Use a country "
        "name or ISO code (Germany, DE), a region (Europe, Asia) or a subregion "
        "(Northern America, Western Europe).",
        status=422,
    )


def _hire_history(low: int | None, high: int | None) -> list[str]:
    low = low or 0
    return [
        name
        for name, start, end in HIRE_HISTORY
        if (end is None or low <= end) and (high is None or start <= high)
    ]


def build_input(
    params: JobSearchParams,
    *,
    size: int,
    posted_from: str | None,
    posted_to: str | None,
    client_activity: bool = False,
    client_details: bool = False,
) -> dict[str, Any]:
    """The actor's run input. Unset parameters are omitted, not nulled."""
    run_input: dict[str, Any] = {"limit": size}
    if posted_from:
        run_input["fromDate"] = posted_from
    if posted_to:
        run_input["toDate"] = posted_to

    words = keywords(params)
    if words:
        run_input["includeKeywords.keywords"] = words
        run_input["includeKeywords.matchTitle"] = True
        run_input["includeKeywords.matchDescription"] = True
        run_input["includeKeywords.matchSkills"] = True
    if params.exclude_terms:
        run_input["excludeKeywords.keywords"] = _dedupe(params.exclude_terms)
        run_input["excludeKeywords.matchTitle"] = True
        run_input["excludeKeywords.matchDescription"] = True
        run_input["excludeKeywords.matchSkills"] = True

    categories = _dedupe([*params.category_ids, *params.subcategory_ids])
    if categories:
        run_input["jobCategories"] = categories

    if params.workload:
        run_input["budget.hourlyWorkloads"] = [WORKLOAD[params.workload]]
    if params.durations:
        run_input["budget.jobDurations"] = _dedupe([DURATION[d] for d in params.durations])
    if params.budget_min is not None:
        run_input["budget.fixedPrice.min"] = _money(params.budget_min)
    if params.budget_max is not None:
        run_input["budget.fixedPrice.max"] = _money(params.budget_max)
    if params.hourly_rate_min is not None:
        run_input["budget.hourlyRate.min"] = _money(params.hourly_rate_min)
    if params.hourly_rate_max is not None:
        run_input["budget.hourlyRate.max"] = _money(params.hourly_rate_max)
    if params.connects_min is not None:
        run_input["budget.connectsPrice.min"] = params.connects_min
    if params.connects_max is not None:
        run_input["budget.connectsPrice.max"] = params.connects_max
    if params.client_min_hire_rate is not None:
        run_input["budget.minClientHireRate"] = params.client_min_hire_rate

    if params.client_hires_min is not None or params.client_hires_max is not None:
        buckets = _hire_history(params.client_hires_min, params.client_hires_max)
        if buckets:
            run_input["client.hireHistory"] = buckets
    if params.verified_payment_only:
        run_input["client.paymentMethodVerified"] = True
    if params.phone_verified_only:
        run_input["client.phoneNumberVerified"] = True
    if params.client_locations:
        run_input["client.includeLocations"] = [location(x) for x in params.client_locations]
    if params.exclude_client_locations:
        run_input["client.excludeLocations"] = [location(x) for x in params.exclude_client_locations]
    if params.client_timezone:
        run_input["client.timezones"] = [params.client_timezone]
    if params.client_min_rating is not None:
        run_input["client.minFeedbackScore"] = _money(params.client_min_rating)
    if params.client_min_spent is not None:
        run_input["client.totalSpent.min"] = _money(params.client_min_spent)
    if params.client_max_spent is not None:
        run_input["client.totalSpent.max"] = _money(params.client_max_spent)

    if params.experience_level:
        run_input["vendor.experienceLevel"] = [EXPERIENCE[params.experience_level]]
    if params.english_level:
        run_input["vendor.englishProficiency"] = params.english_level.upper()
    if params.contractor_type:
        run_input["vendor.type"] = [CONTRACTOR_TYPE[params.contractor_type]]
    if params.featured_only:
        run_input["vendor.includeFeatured"] = True
    if params.exclude_with_questions:
        run_input["vendor.excludeWithQuestions"] = True
    if params.open_to_country:
        # Postings that accept this country, and those with no preference at
        # all - filtered by the actor, so the ones excluded are never billed.
        run_input["vendor.includeLocations"] = [location(params.open_to_country)]
        run_input["vendor.includeWithoutCountryPreference"] = True

    if client_activity:
        run_input["addons.enableClientActivity"] = True
    if client_details:
        run_input["addons.enableClientDetails"] = True
    return run_input


# --- the dataset --------------------------------------------------------------------------


def _number(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", "").replace("$", ""))
    except ValueError:
        return None


def _questions(raw: object) -> list[str]:
    out = []
    for entry in raw or []:
        if isinstance(entry, dict):
            text = entry.get("question") or entry.get("text") or entry.get("title")
        else:
            text = entry
        if text:
            out.append(str(text))
    return out


def snapshot_from_item(item: dict) -> dict[str, Any]:
    """Column values for ``FreelanceJob`` from one dataset item."""
    budget = item.get("budget") if isinstance(item.get("budget"), dict) else {}
    hourly = budget.get("hourlyRate") if isinstance(budget.get("hourlyRate"), dict) else {}
    hourly_min, hourly_max = _number(hourly.get("min")), _number(hourly.get("max"))
    fixed = _number(budget.get("fixedBudget"))
    if hourly_min is not None or hourly_max is not None:
        job_type = FreelanceJobType.HOURLY
    elif fixed:
        job_type = FreelanceJobType.FIXED
    else:
        job_type = None

    client = item.get("client") if isinstance(item.get("client"), dict) else {}
    stats = client.get("stats") if isinstance(client.get("stats"), dict) else {}
    vendor = item.get("vendor") if isinstance(item.get("vendor"), dict) else {}
    activity = item.get("activity") if isinstance(item.get("activity"), dict) else {}

    link = item.get("externalLink") or None
    ciphertext = item.get("ciphertext")
    if not ciphertext:
        match = _CIPHERTEXT.search(link or "")
        ciphertext = match.group(1) if match else None
    url = link or (f"https://www.upwork.com/jobs/{ciphertext}" if ciphertext else None)

    experience = str(vendor.get("experienceLevel") or "").upper()
    allowed = [
        countries.country_name(code) or code for code in (vendor.get("countryCodes") or []) if code
    ]
    featured = item.get("featured", item.get("isFeatured"))

    return {
        "upwork_id": str(item.get("uid") or ciphertext or url),
        "ciphertext": ciphertext,
        "url": url,
        "title": str(item.get("title") or "Untitled posting"),
        "description": item.get("description"),
        "job_type": job_type,
        "budget_amount": fixed if job_type is FreelanceJobType.FIXED else None,
        "budget_currency": "USD" if (fixed or hourly_min is not None or hourly_max is not None) else None,
        "hourly_min": hourly_min,
        "hourly_max": hourly_max,
        "duration_label": None,
        "workload": None,
        "experience_level": "ENTRY_LEVEL" if experience == "BEGINNER" else (experience or None),
        "category": item.get("category") or None,
        "subcategory": None,
        "skills": [str(s) for s in (item.get("skills") or []) if s],
        "client": {
            "company_name": client.get("companyName") or None,
            "country": countries.country_name(client.get("countryCode")),
            "timezone": client.get("timezone") or None,
            "industry": client.get("industry") or None,
            "payment_verified": client.get("paymentMethodVerified"),
            "phone_verified": client.get("phoneNumberVerified"),
            "total_spent": _number(stats.get("totalSpent")),
            "total_hires": stats.get("totalHires"),
            "hire_rate_percent": _number(stats.get("hireRate")),
            "avg_hourly_rate": _number(stats.get("avgRate")),
            "feedback": _number(stats.get("feedbackRate")),
            "total_reviews": stats.get("feedbackCount"),
        },
        "total_applicants": activity.get("totalApplicants"),
        "freelancers_to_hire": None,
        "is_premium": False,
        "is_enterprise": bool(client.get("enterprise")),
        "preferred_freelancer_location": allowed,
        "published_at": parse_instant(item.get("createdAt")),
        "renewed_at": None,
        "raw": {
            **item,
            "preferredFreelancerLocationMandatory": bool(allowed),
            "extras": {
                "screening_questions": _questions(item.get("questions")),
                "activity": {
                    "total_hired": activity.get("totalHired"),
                    "total_invited_to_interview": activity.get("totalInvitedToInterview"),
                    "total_unanswered_invites": activity.get("unansweredInvites"),
                    "last_client_activity": activity.get("lastBuyerActivity"),
                },
                "qualification": {
                    "contractorType": vendor.get("hireType"),
                    "englishProficiency": vendor.get("englishLevel"),
                    "languages": vendor.get("languages"),
                },
                "connects_required": item.get("applicationCost"),
                "featured": bool(featured),
                "job_score": _number(item.get("customJobScore")),
            },
        },
    }


def categories_from_enum(names: list[str]) -> list[CategoryOption]:
    """Groups from the flat enum: each "All - X" closes the group of the names before it."""
    groups: list[CategoryOption] = []
    pending: list[str] = []
    for name in names:
        if name.startswith("All - "):
            groups.append(
                CategoryOption(
                    id=name,
                    label=name.removeprefix("All - "),
                    subcategories=[FilterOption(value=n, label=n) for n in pending],
                )
            )
            pending = []
        else:
            pending.append(name)
    for name in pending:  # names after the last group, if the enum ever ends that way
        groups.append(CategoryOption(id=name, label=name, subcategories=[]))
    return groups


class VibeProfile:
    """The actor as the Apify job source drives it: newest first, one date window per step."""

    actor_id = ACTOR_ID
    label = "Apify · Upwork Job Scraper (upwork-vibe)"
    capabilities = SourceCapabilities(
        filters=SUPPORTED_FILTERS, sorts=SUPPORTED_SORTS, categories=True
    )
    cost_note = (
        "Billed per job returned, Apify platform usage included; no minimum per run. "
        "The optional client-activity and client-details add-ons are billed per job on top."
    )

    def run_size(self, params: JobSearchParams, settings: Settings) -> int:
        return params.page_size * settings.apify_pages_per_run

    def first_continuation(self, params: JobSearchParams, settings: Settings, now: datetime) -> dict:
        posted_from = (
            _utc(now - timedelta(hours=params.posted_within_hours))
            if params.posted_within_hours
            else None
        )
        return {"from": posted_from, "to": None}

    def build_input(
        self, params: JobSearchParams, *, size: int, cont: dict, settings: Settings
    ) -> dict[str, Any]:
        return build_input(
            params,
            size=size,
            posted_from=cont.get("from"),
            posted_to=cont.get("to"),
            client_activity=settings.apify_client_activity_addon,
            client_details=settings.apify_client_details_addon,
        )

    def next_continuation(self, cont: dict, final_slice: list[dict], settings: Settings) -> dict | None:
        """The jobs posted before the oldest one returned, in the same window."""
        posted = [parse_instant(item.get("createdAt")) for item in final_slice]
        posted = [p for p in posted if p is not None]
        if not posted:
            return None
        return {"from": cont.get("from"), "to": _utc(min(posted) - timedelta(seconds=1))}

    def describe_continuation(self, cont: dict) -> str:
        if cont.get("to"):
            return f"jobs posted before {cont['to'].replace('T', ' ').removesuffix('Z')} UTC"
        return "the newest jobs"

    def snapshot(self, item: dict) -> dict[str, Any]:
        return snapshot_from_item(item)

    def categories(self, input_schema: dict | None) -> list[CategoryOption]:
        names = FALLBACK_CATEGORIES
        try:
            live = input_schema["properties"]["jobCategories"]["items"]["enum"]  # type: ignore[index]
            if isinstance(live, list) and all(isinstance(n, str) for n in live) and live:
                names = live
        except (KeyError, TypeError):
            pass
        return categories_from_enum(names)
