"""Request and response shapes for the Freelancing category."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.enums import (
    FreelanceJobType,
    FreelanceTrackStage,
    ProposalStatus,
    UpworkConnectionStatus,
)
from app.schemas.common import ORMModel

# --- Upwork connection ---------------------------------------------------------


class UpworkCredentialsIn(BaseModel):
    client_id: str = Field(min_length=8, max_length=200)
    client_secret: str = Field(min_length=8, max_length=400)


class UpworkOrganization(BaseModel):
    organization_id: str
    title: str
    type_title: str | None = None


class UpworkConnectionOut(BaseModel):
    status: UpworkConnectionStatus
    # A key pair exists, in Settings ("user") or the environment ("environment").
    configured: bool
    credentials_source: Literal["user", "environment", "none"]
    client_id: str | None = None
    masked_client_secret: str | None = None
    connected: bool
    upwork_user_name: str | None = None
    upwork_user_id: str | None = None
    tenant_id: str | None = None
    # What to register on the Upwork key as the redirect URI. Shown so the two
    # cannot silently disagree.
    redirect_uri: str
    access_token_expires_at: datetime | None = None
    connected_at: datetime | None = None
    last_used_at: datetime | None = None
    last_error: str | None = None


class UpworkAuthorizeOut(BaseModel):
    url: str


class UpworkTenantIn(BaseModel):
    tenant_id: str | None = Field(default=None, max_length=100)


class UpworkTestOut(BaseModel):
    ok: bool
    detail: str
    upwork_user_name: str | None = None
    organizations: list[UpworkOrganization] = Field(default_factory=list)


# --- Job search ---------------------------------------------------------------

JobTypeParam = Literal["hourly", "fixed"]
WorkloadParam = Literal["full_time", "part_time", "as_needed", "not_sure"]
DurationParam = Literal["week", "month", "quarter", "semester", "ongoing"]
ExperienceParam = Literal["entry_level", "intermediate", "expert"]
SortParam = Literal["recency", "relevance", "client_total_charge", "client_rating"]


class AreaParam(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_miles: float = Field(gt=0, le=5000)


class JobSearchParams(BaseModel):
    """Every filter Upwork's job search accepts, in this API's own words.

    Each field maps to exactly one entry of ``MarketplaceJobPostingsSearchFilter``
    (see ``app.freelancing.upwork.filters``). Nothing here is invented: a
    filter Upwork does not offer, such as "posted in the last N days", is not
    offered either.
    """

    # Text
    query: str | None = Field(default=None, max_length=500, description="Lucene-style search")
    title: str | None = Field(default=None, max_length=200, description="Words in the title")
    skills: list[str] = Field(default_factory=list, max_length=30, description="Skill slugs, OR")
    and_terms: list[str] = Field(default_factory=list, max_length=20)
    or_terms: list[str] = Field(default_factory=list, max_length=20)
    exact_terms: list[str] = Field(default_factory=list, max_length=20)
    exclude_terms: list[str] = Field(default_factory=list, max_length=20)

    # Taxonomy
    category_ids: list[str] = Field(default_factory=list, max_length=30)
    subcategory_ids: list[str] = Field(default_factory=list, max_length=60)
    occupation_ids: list[str] = Field(default_factory=list, max_length=60)
    ontology_skill_ids: list[str] = Field(default_factory=list, max_length=30, description="AND")

    # Contract shape
    job_type: JobTypeParam | None = None
    workload: WorkloadParam | None = None
    durations: list[DurationParam] = Field(default_factory=list)
    experience_level: ExperienceParam | None = None

    # Money
    budget_min: int | None = Field(default=None, ge=0)
    budget_max: int | None = Field(default=None, ge=0)
    hourly_rate_min: int | None = Field(default=None, ge=0)
    hourly_rate_max: int | None = Field(default=None, ge=0)

    # Client
    client_hires_min: int | None = Field(default=None, ge=0)
    client_hires_max: int | None = Field(default=None, ge=0)
    proposals_min: int | None = Field(default=None, ge=0)
    proposals_max: int | None = Field(default=None, ge=0)
    verified_payment_only: bool | None = None
    previous_clients_only: bool | None = None
    client_locations: list[str] = Field(default_factory=list, max_length=20)
    client_timezone: str | None = Field(default=None, max_length=80)
    enterprise_only: bool | None = None
    talent_cloud_only: bool | None = None
    talent_cloud_ids: list[str] = Field(default_factory=list, max_length=20)
    user_location_match: bool | None = None
    visitor_country: str | None = Field(default=None, max_length=2)
    area: AreaParam | None = None
    # Only postings published within this many hours. Not every source can.
    posted_within_hours: int | None = Field(default=None, ge=1, le=24 * 60)

    # Client quality, beyond hires and verification. Not every source can.
    client_min_rating: float | None = Field(default=None, ge=0, le=5)
    client_min_spent: int | None = Field(default=None, ge=0)
    client_max_spent: int | None = Field(default=None, ge=0)
    client_min_hire_rate: int | None = Field(default=None, ge=0, le=100)
    phone_verified_only: bool | None = None
    exclude_client_locations: list[str] = Field(default_factory=list, max_length=20)

    # What applying costs and who may apply.
    connects_min: int | None = Field(default=None, ge=0, le=100)
    connects_max: int | None = Field(default=None, ge=0, le=100)
    english_level: Literal["basic", "conversational", "fluent", "native"] | None = None
    contractor_type: Literal["freelancer", "agency"] | None = None
    featured_only: bool | None = None
    exclude_with_questions: bool | None = None

    # Ordering and paging
    sort: SortParam = "recency"
    page_size: int = Field(default=20, ge=1, le=50)
    cursor: str | None = Field(default=None, description="pageInfo.end_cursor of the previous page")

    # Applied on this side, after the source answers.
    hide_hidden: bool = True
    hide_applied: bool = False
    # Drop postings that only accept applicants from other countries.
    open_to_country: str | None = Field(default=None, max_length=80)

    @field_validator(
        "skills", "and_terms", "or_terms", "exact_terms", "exclude_terms",
        "category_ids", "subcategory_ids", "occupation_ids", "ontology_skill_ids",
        "client_locations", "talent_cloud_ids", "exclude_client_locations", mode="before",
    )
    @classmethod
    def _strip_blank(cls, value: object) -> object:
        if isinstance(value, list):
            return [str(v).strip() for v in value if str(v).strip()]
        return value

    @model_validator(mode="after")
    def _ranges_in_order(self):
        for low, high in (
            ("budget_min", "budget_max"),
            ("hourly_rate_min", "hourly_rate_max"),
            ("client_hires_min", "client_hires_max"),
            ("proposals_min", "proposals_max"),
            ("client_min_spent", "client_max_spent"),
            ("connects_min", "connects_max"),
        ):
            lo, hi = getattr(self, low), getattr(self, high)
            if lo is not None and hi is not None and lo > hi:
                raise ValueError(f"{low} must not exceed {high}")
        return self


class FilterOption(BaseModel):
    value: str
    label: str
    hint: str | None = None


class CategoryOption(BaseModel):
    id: str
    label: str
    subcategories: list[FilterOption] = Field(default_factory=list)


class JobSourceInfo(BaseModel):
    """Which provider answers searches, and which controls it honours."""

    key: str
    label: str
    # JobSearchParams field names the source applies. The form hides the rest.
    filters: list[str]
    sorts: list[str]
    detail: bool
    categories: bool
    skills: bool


class JobSourceStatus(JobSourceInfo):
    """The source, and whether this user can search with it right now."""

    ready: bool
    setup_hint: str | None = None


class ApifyConnectionOut(BaseModel):
    configured: bool
    token_source: Literal["user", "environment", "none"]
    masked_token: str | None = None
    status: str
    apify_username: str | None = None
    actor_id: str
    # The actor profile in service: how it is described and billed.
    actor_label: str | None = None
    cost_note: str | None = None
    last_verified_at: datetime | None = None
    last_error: str | None = None
    last_run_id: str | None = None
    last_run_at: datetime | None = None


class ApifyTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class ApifyTestOut(BaseModel):
    ok: bool
    detail: str
    apify_username: str | None = None
    plan: str | None = None
    actor_title: str | None = None
    price_per_job_usd: float | None = None


class FilterCatalogue(BaseModel):
    """Everything the search form needs to render its controls."""

    source: JobSourceInfo
    job_types: list[FilterOption]
    workloads: list[FilterOption]
    durations: list[FilterOption]
    experience_levels: list[FilterOption]
    sorts: list[FilterOption]
    page_sizes: list[int]
    categories: list[CategoryOption] = Field(default_factory=list)
    categories_error: str | None = None


class SkillSuggestion(BaseModel):
    id: str
    label: str


# --- Jobs -----------------------------------------------------------------------


class JobClient(BaseModel):
    company_name: str | None = None
    # A first name to greet, when a source can infer one with confidence.
    contact_name: str | None = None
    hire_rate_percent: float | None = None
    avg_hourly_rate: float | None = None
    industry: str | None = None
    phone_verified: bool | None = None
    country: str | None = None
    city: str | None = None
    state: str | None = None
    timezone: str | None = None
    payment_verified: bool | None = None
    verification_status: str | None = None
    total_spent: float | None = None
    total_spent_display: str | None = None
    total_hires: int | None = None
    total_posted_jobs: int | None = None
    total_reviews: int | None = None
    feedback: float | None = None
    last_contract_platform: str | None = None
    has_financial_privacy: bool | None = None


class JobCard(ORMModel):
    id: uuid.UUID
    upwork_id: str
    ciphertext: str | None
    url: str | None
    title: str
    description: str | None
    job_type: FreelanceJobType | None
    budget_amount: float | None
    budget_currency: str | None
    hourly_min: float | None
    hourly_max: float | None
    duration_label: str | None
    workload: str | None
    experience_level: str | None
    category: str | None
    subcategory: str | None
    skills: list[str]
    client: JobClient
    total_applicants: int | None
    freelancers_to_hire: int | None
    is_premium: bool
    is_enterprise: bool
    preferred_freelancer_location: list[str]
    published_at: datetime | None
    renewed_at: datetime | None
    last_seen_at: datetime
    focused_at: datetime | None
    hidden_at: datetime | None
    # Read off the raw node for the card, not stored as columns.
    applied: bool = False
    track_stage: FreelanceTrackStage | None = None
    proposal_count: int = 0
    # From the source's own record, when it has them.
    connects_required: int | None = None
    featured: bool = False
    job_score: float | None = None


class JobDetail(JobCard):
    detail_fetched_at: datetime | None = None
    # The deeper aggregate from marketplaceJobPosting, when it has been fetched.
    screening_questions: list[str] = Field(default_factory=list)
    cover_letter_required: bool | None = None
    activity: dict = Field(default_factory=dict)
    qualification: dict = Field(default_factory=dict)
    location_preference: dict = Field(default_factory=dict)
    attachments: list[dict] = Field(default_factory=list)
    on_site_type: str | None = None
    status: str | None = None


class JobSearchPage(BaseModel):
    items: list[JobCard]
    total: int | None = None
    has_next_page: bool = False
    end_cursor: str | None = None
    # How many of the page the source returned were dropped by this side's filters.
    hidden_count: int = 0
    # The source is still working (an Apify run). Ask again with ``end_cursor``.
    pending: bool = False
    progress_note: str | None = None
    # Something the source said about this search, e.g. an exhausted quota.
    notice: str | None = None


class SavedSearchIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    params: JobSearchParams


class SavedSearchOut(ORMModel):
    id: uuid.UUID
    name: str
    params: dict
    last_run_at: datetime | None
    created_at: datetime


# --- Freelancer profile ----------------------------------------------------------


class PortfolioItem(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    url: str | None = Field(default=None, max_length=2000)
    summary: str | None = Field(default=None, max_length=2000)


class SpecializedProfile(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    title: str | None = Field(default=None, max_length=200)
    overview: str | None = Field(default=None, max_length=8000)


class FreelancerProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_default: bool = False
    title: str | None = Field(default=None, max_length=200)
    overview: str | None = Field(default=None, max_length=8000)
    hourly_rate: float | None = Field(default=None, ge=0, le=10_000)
    skills: list[str] = Field(default_factory=list, max_length=100)
    portfolio: list[PortfolioItem] = Field(default_factory=list, max_length=50)
    specialized_profiles: list[SpecializedProfile] = Field(default_factory=list, max_length=10)
    upwork_profile_url: str | None = Field(default=None, max_length=2000)
    raw_profile_markdown: str | None = Field(default=None, max_length=40_000)


class FreelancerProfilePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_default: bool | None = None
    title: str | None = Field(default=None, max_length=200)
    overview: str | None = Field(default=None, max_length=8000)
    hourly_rate: float | None = Field(default=None, ge=0, le=10_000)
    skills: list[str] | None = Field(default=None, max_length=100)
    portfolio: list[PortfolioItem] | None = Field(default=None, max_length=50)
    specialized_profiles: list[SpecializedProfile] | None = Field(default=None, max_length=10)
    upwork_profile_url: str | None = Field(default=None, max_length=2000)
    raw_profile_markdown: str | None = Field(default=None, max_length=40_000)


class FreelancerProfileOut(ORMModel):
    id: uuid.UUID
    name: str
    is_default: bool
    title: str | None
    overview: str | None
    hourly_rate: float | None
    skills: list[str]
    portfolio: list
    specialized_profiles: list
    upwork_profile_url: str | None
    raw_profile_markdown: str | None
    created_at: datetime
    updated_at: datetime


# --- Proposals ------------------------------------------------------------------


class ProposalAnswer(BaseModel):
    question: str = Field(max_length=1000)
    answer: str = Field(default="", max_length=8000)


class ProposalCreate(BaseModel):
    job_id: uuid.UUID
    profile_id: uuid.UUID | None = None
    bid_type: FreelanceJobType | None = None
    bid_amount: float | None = Field(default=None, ge=0)
    bid_currency: str | None = Field(default=None, max_length=3)
    connects_estimate: int | None = Field(default=None, ge=0, le=200)
    cover_letter_markdown: str = Field(default="", max_length=40_000)
    answers: list[ProposalAnswer] = Field(default_factory=list, max_length=20)


class ProposalPatch(BaseModel):
    profile_id: uuid.UUID | None = None
    status: ProposalStatus | None = None
    bid_type: FreelanceJobType | None = None
    bid_amount: float | None = Field(default=None, ge=0)
    bid_currency: str | None = Field(default=None, max_length=3)
    connects_estimate: int | None = Field(default=None, ge=0, le=200)
    cover_letter_markdown: str | None = Field(default=None, max_length=40_000)
    answers: list[ProposalAnswer] | None = Field(default=None, max_length=20)


class ProposalGenerateIn(BaseModel):
    """Ask the engine for a draft. Returns the queued generation, not the proposal."""

    job_id: uuid.UUID
    profile_id: uuid.UUID | None = None
    # Rewrites an existing proposal in place rather than adding another.
    proposal_id: uuid.UUID | None = None
    instructions: str | None = Field(default=None, max_length=4000)
    tone: Literal["direct", "warm", "formal"] = "direct"


class JobBrief(BaseModel):
    id: uuid.UUID
    title: str
    url: str | None
    job_type: FreelanceJobType | None
    budget_amount: float | None
    hourly_min: float | None
    hourly_max: float | None
    client_country: str | None = None
    total_applicants: int | None = None
    published_at: datetime | None = None
    focused_at: datetime | None = None
    description: str | None = None
    skills: list[str] = Field(default_factory=list)


class ProposalOut(ORMModel):
    id: uuid.UUID
    job_id: uuid.UUID
    profile_id: uuid.UUID | None
    status: ProposalStatus
    bid_type: FreelanceJobType | None
    bid_amount: float | None
    bid_currency: str | None
    connects_estimate: int | None
    cover_letter_markdown: str
    answers: list
    engine_version: str | None
    generation_id: uuid.UUID | None
    generation_meta: dict
    submitted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    job: JobBrief | None = None


class ProposalGenerated(BaseModel):
    # ``id`` is the generation, the same shape every other "accepted" response
    # has, so the portal's generation hook can follow it unchanged.
    id: uuid.UUID
    generation_id: uuid.UUID
    proposal_id: uuid.UUID
    status: str
    engine_version: str


# --- Tracking -------------------------------------------------------------------


class TrackEventOut(ORMModel):
    id: int
    from_stage: FreelanceTrackStage | None
    to_stage: FreelanceTrackStage
    reason: str | None
    actor: str
    occurred_at: datetime


class TrackMeetingBrief(BaseModel):
    id: uuid.UUID
    title: str
    starts_at: datetime
    ends_at: datetime
    status: str
    conferencing_url: str | None = None


class ProposalBrief(BaseModel):
    id: uuid.UUID
    status: ProposalStatus
    bid_type: FreelanceJobType | None
    bid_amount: float | None
    submitted_at: datetime | None


class TrackOut(ORMModel):
    id: uuid.UUID
    job_id: uuid.UUID
    proposal_id: uuid.UUID | None
    stage: FreelanceTrackStage
    submitted_at: datetime | None
    bid_type: FreelanceJobType | None
    bid_amount: float | None
    connects_spent: int | None
    client_replied_at: datetime | None
    next_action_at: datetime | None
    notes_markdown: str | None
    outcome_notes: str | None
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    job: JobBrief
    proposal: ProposalBrief | None = None
    next_meeting: TrackMeetingBrief | None = None


class TrackDetail(TrackOut):
    events: list[TrackEventOut] = Field(default_factory=list)
    meetings: list[TrackMeetingBrief] = Field(default_factory=list)


class TrackPatch(BaseModel):
    stage: FreelanceTrackStage | None = None
    reason: str | None = Field(default=None, max_length=500)
    proposal_id: uuid.UUID | None = None
    bid_type: FreelanceJobType | None = None
    bid_amount: float | None = Field(default=None, ge=0)
    connects_spent: int | None = Field(default=None, ge=0, le=500)
    submitted_at: datetime | None = None
    client_replied_at: datetime | None = None
    next_action_at: datetime | None = None
    notes_markdown: str | None = Field(default=None, max_length=40_000)
    outcome_notes: str | None = Field(default=None, max_length=8000)


class TrackSummary(BaseModel):
    """Counts per stage, for the dashboard and the sidebar."""

    focused: int = 0
    proposal_drafted: int = 0
    submitted: int = 0
    viewed: int = 0
    interviewing: int = 0
    hired: int = 0
    declined: int = 0
    withdrawn: int = 0
    closed: int = 0
    total: int = 0
