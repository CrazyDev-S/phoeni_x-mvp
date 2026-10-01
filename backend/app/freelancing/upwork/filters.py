"""Search parameters to Upwork's filter input, and the catalogue the form renders.

This is the ONE place that knows Upwork's field names. ``JobSearchParams``
speaks this API's own vocabulary; ``to_search_variables`` translates it. A
field Upwork renames is a one-line change here and nowhere else.

Names come from ``MarketplaceJobPostingsSearchFilter`` in Upwork's schema
reference (August 2026). The deprecated ``MarketplaceJobFilter`` type has
different fields (``daysPosted_eq``, ``sinceId_eq``...) which the current
search does not accept, so they are deliberately absent.
"""

from __future__ import annotations

from typing import Any

from app.schemas.freelancing import FilterOption, JobSearchParams

FIRST_PAGE_CURSOR = "0"

# JobSearchParams fields ``to_search_filter`` maps. The search form hides the rest.
SUPPORTED_FILTERS = frozenset(
    {
        "query", "and_terms", "or_terms", "exact_terms", "exclude_terms", "title", "skills",
        "category_ids", "subcategory_ids", "occupation_ids", "ontology_skill_ids",
        "job_type", "workload", "durations", "experience_level",
        "budget_min", "budget_max", "hourly_rate_min", "hourly_rate_max",
        "client_hires_min", "client_hires_max", "proposals_min", "proposals_max",
        "verified_payment_only", "previous_clients_only", "client_locations",
        "client_timezone", "enterprise_only", "talent_cloud_only", "talent_cloud_ids",
        "user_location_match", "visitor_country", "area",
    }
)

JOB_TYPE = {"hourly": "HOURLY", "fixed": "FIXED"}
WORKLOAD = {
    "full_time": "FULL_TIME",
    "part_time": "PART_TIME",
    "as_needed": "AS_NEEDED",
    "not_sure": "NOT_SURE",
}
DURATION = {
    "week": "WEEK",
    "month": "MONTH",
    "quarter": "QUARTER",
    "semester": "SEMESTER",
    "ongoing": "ONGOING",
}
EXPERIENCE = {
    "entry_level": "ENTRY_LEVEL",
    "intermediate": "INTERMEDIATE",
    "expert": "EXPERT",
}
SORT = {
    "recency": "RECENCY",
    "relevance": "RELEVANCE",
    "client_total_charge": "CLIENT_TOTAL_CHARGE",
    "client_rating": "CLIENT_RATING",
}

JOB_TYPE_OPTIONS = [
    FilterOption(value="hourly", label="Hourly"),
    FilterOption(value="fixed", label="Fixed price"),
]
WORKLOAD_OPTIONS = [
    FilterOption(value="full_time", label="Full time", hint="30+ hrs/week"),
    FilterOption(value="part_time", label="Part time", hint="Less than 30 hrs/week"),
    FilterOption(value="as_needed", label="As needed"),
    FilterOption(value="not_sure", label="Client not sure"),
]
DURATION_OPTIONS = [
    FilterOption(value="week", label="Less than a week"),
    FilterOption(value="month", label="Less than a month"),
    FilterOption(value="quarter", label="1 to 3 months"),
    FilterOption(value="semester", label="3 to 6 months"),
    FilterOption(value="ongoing", label="More than 6 months"),
]
EXPERIENCE_OPTIONS = [
    FilterOption(value="entry_level", label="Entry level"),
    FilterOption(value="intermediate", label="Intermediate"),
    FilterOption(value="expert", label="Expert"),
]
SORT_OPTIONS = [
    FilterOption(value="recency", label="Newest first"),
    FilterOption(value="relevance", label="Best match"),
    FilterOption(value="client_total_charge", label="Client spend"),
    FilterOption(value="client_rating", label="Client rating"),
]
PAGE_SIZES = [10, 20, 30, 50]


def _range(low: int | None, high: int | None) -> dict[str, int] | None:
    if low is None and high is None:
        return None
    out: dict[str, int] = {}
    if low is not None:
        out["rangeStart"] = low
    if high is not None:
        out["rangeEnd"] = high
    return out


def to_search_filter(params: JobSearchParams) -> dict[str, Any]:
    """The ``marketPlaceJobFilter`` variable. Unset parameters are omitted, not nulled."""
    f: dict[str, Any] = {}

    if params.query:
        f["searchExpression_eq"] = params.query
    elif any((params.and_terms, params.or_terms, params.exact_terms, params.exclude_terms)):
        # Upwork ignores searchTerm_eq when searchExpression_eq is present.
        term: dict[str, list[str]] = {}
        if params.and_terms:
            term["andTerms_all"] = params.and_terms
        if params.or_terms:
            term["orTerms_any"] = params.or_terms
        if params.exact_terms:
            term["exactTerms_any"] = params.exact_terms
        if params.exclude_terms:
            term["excludeTerms_any"] = params.exclude_terms
        f["searchTerm_eq"] = term
    if params.title:
        f["titleExpression_eq"] = params.title
    if params.skills:
        f["skillExpression_eq"] = ",".join(params.skills)

    if params.category_ids:
        f["categoryIds_any"] = params.category_ids
    if params.subcategory_ids:
        f["subcategoryIds_any"] = params.subcategory_ids
    if params.occupation_ids:
        f["occupationIds_any"] = params.occupation_ids
    if params.ontology_skill_ids:
        f["ontologySkillIds_all"] = params.ontology_skill_ids

    if params.job_type:
        f["jobType_eq"] = JOB_TYPE[params.job_type]
    if params.workload:
        f["workload_eq"] = WORKLOAD[params.workload]
    if params.durations:
        f["duration_any"] = [DURATION[d] for d in params.durations]
    if params.experience_level:
        f["experienceLevel_eq"] = EXPERIENCE[params.experience_level]

    budget = _range(params.budget_min, params.budget_max)
    if budget:
        f["budgetRange_eq"] = budget
    hourly = _range(params.hourly_rate_min, params.hourly_rate_max)
    if hourly:
        f["hourlyRate_eq"] = hourly
    hires = _range(params.client_hires_min, params.client_hires_max)
    if hires:
        f["clientHiresRange_eq"] = hires
    proposals = _range(params.proposals_min, params.proposals_max)
    if proposals:
        f["proposalRange_eq"] = proposals

    if params.verified_payment_only is not None:
        f["verifiedPaymentOnly_eq"] = params.verified_payment_only
    if params.previous_clients_only is not None:
        f["previousClients_eq"] = params.previous_clients_only
    if params.client_locations:
        f["locations_any"] = params.client_locations
    if params.client_timezone:
        f["timezone_eq"] = params.client_timezone
    if params.enterprise_only is not None:
        f["enterpriseOnly_eq"] = params.enterprise_only
    if params.talent_cloud_only is not None:
        f["ptcOnly_eq"] = params.talent_cloud_only
    if params.talent_cloud_ids:
        f["ptcIds_any"] = params.talent_cloud_ids
    if params.user_location_match is not None:
        f["userLocationMatch_eq"] = params.user_location_match
    if params.visitor_country:
        f["visitorCountry_eq"] = params.visitor_country.upper()
    if params.area:
        f["area_eq"] = {
            "latitude": params.area.latitude,
            "longitude": params.area.longitude,
            "radius": params.area.radius_miles,
        }

    f["pagination_eq"] = {"after": params.cursor or FIRST_PAGE_CURSOR, "first": params.page_size}
    return f


def to_search_variables(params: JobSearchParams) -> dict[str, Any]:
    return {
        "marketPlaceJobFilter": to_search_filter(params),
        "sortAttributes": [{"field": SORT[params.sort]}],
    }
