"""Request and response shapes for the Freelancing category."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.enums import (
    FreelanceAlertKind,
    FreelanceJobType,
    FreelanceTrackStage,
    ProposalStatus,
)
from app.schemas.common import ORMModel

# --- Capture: the browser extension registers what it sees on Upwork -------------

# "~021858964253717283346", or "~01" and hex for older postings.
JOB_KEY_PATTERN = r"^~0[12][0-9a-fA-F]{10,40}$"
# A posting's store is a few tens of kilobytes; this is headroom, not a target.
STATE_MAX_BYTES = 400_000


def bounded_state(value: dict | None) -> dict | None:
    if value is not None and len(json.dumps(value, default=str)) > STATE_MAX_BYTES:
        raise ValueError(f"state is larger than {STATE_MAX_BYTES} bytes")
    return value


class CapturedJob(BaseModel):
    """One posting as the extension harvested it from an Upwork page.

    Raw on purpose: the backend reads Upwork's vocabulary out of it
    (``app.freelancing.capture``), so a change to Upwork's pages is fixed there.
    """

    upwork_id: str = Field(pattern=JOB_KEY_PATTERN, description="The ~0... key in every job URL")
    view: Literal["tile", "detail", "store"] = Field(
        description="A search/feed tile, the posting's own page, or the page's own app state"
    )
    url: str | None = Field(default=None, max_length=2000)
    # The "store" view: Upwork's job-details state ({job, buyer, sands}) as the page holds it.
    state: dict | None = None
    title: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=30_000)
    skills: list[str] = Field(default_factory=list, max_length=80)
    # Every element Upwork names with data-test / data-qa: name -> visible text.
    labels: dict[str, str] = Field(default_factory=dict)
    # The posting's block as the page shows it, one line per rendered line.
    text: str = Field(default="", max_length=60_000)

    @field_validator("upwork_id")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.lower()

    @field_validator("skills")
    @classmethod
    def _short_skills(cls, value: list[str]) -> list[str]:
        return [v.strip()[:80] for v in value if v and v.strip()]

    @field_validator("labels")
    @classmethod
    def _bounded_labels(cls, value: dict[str, str]) -> dict[str, str]:
        return {str(k)[:80]: str(v)[:2000] for k, v in list(value.items())[:150]}

    @field_validator("state")
    @classmethod
    def _bounded_state(cls, value: dict | None) -> dict | None:
        return bounded_state(value)

    @model_validator(mode="after")
    def _store_has_state(self) -> CapturedJob:
        if (self.view == "store") != (self.state is not None):
            raise ValueError("a store capture carries state, and only a store capture does")
        return self


class CaptureIn(BaseModel):
    jobs: list[CapturedJob] = Field(min_length=1, max_length=100)


class CapturedRef(BaseModel):
    upwork_id: str
    id: uuid.UUID
    title: str
    # True when this capture put the posting in the shared list.
    created: bool


class CaptureOut(BaseModel):
    received: int
    created: int
    jobs: list[CapturedRef]


# --- Browsing the shared list ---------------------------------------------------

JobTypeParam = Literal["hourly", "fixed"]
ExperienceParam = Literal["entry_level", "intermediate", "expert"]
SortParam = Literal["recency", "captured"]


class JobFilter(BaseModel):
    """What the job view can ask of the shared list: every filter is answered from it.

    Pay filters each constrain their own kind of job, as on Upwork: an hourly
    floor leaves fixed-price postings alone, and the other way round.
    """

    query: str | None = Field(default=None, max_length=300, description="Every word, in the title, description or skills")
    skills: list[str] = Field(default_factory=list, max_length=30, description="Any of these")
    exclude_terms: list[str] = Field(default_factory=list, max_length=20)

    job_type: JobTypeParam | None = None
    experience_level: ExperienceParam | None = None
    hourly_rate_min: int | None = Field(default=None, ge=0)
    budget_min: int | None = Field(default=None, ge=0)
    budget_max: int | None = Field(default=None, ge=0)
    posted_within_hours: int | None = Field(default=None, ge=1, le=24 * 365)

    verified_payment_only: bool = False
    client_min_spent: int | None = Field(default=None, ge=0)
    client_min_rating: float | None = Field(default=None, ge=0, le=5)
    client_locations: list[str] = Field(default_factory=list, max_length=20)
    exclude_client_locations: list[str] = Field(default_factory=list, max_length=20)
    proposals_max: int | None = Field(default=None, ge=0)
    # Drop postings that only accept applicants from other countries.
    open_to_country: str | None = Field(default=None, max_length=80)

    hide_hidden: bool = True
    sort: SortParam = "recency"
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)

    @field_validator("skills", "exclude_terms", "client_locations", "exclude_client_locations", mode="before")
    @classmethod
    def _strip_blank(cls, value: object) -> object:
        if isinstance(value, list):
            return [str(v).strip() for v in value if str(v).strip()]
        return value

    @model_validator(mode="after")
    def _ranges_in_order(self):
        if self.budget_min is not None and self.budget_max is not None and self.budget_min > self.budget_max:
            raise ValueError("budget_min must not exceed budget_max")
        return self


# --- Jobs -----------------------------------------------------------------------


class JobClient(BaseModel):
    company_name: str | None = None
    hire_rate_percent: float | None = None
    avg_hourly_rate: float | None = None
    industry: str | None = None
    company_size: str | None = None
    phone_verified: bool | None = None
    country: str | None = None
    city: str | None = None
    payment_verified: bool | None = None
    total_spent: float | None = None
    total_spent_display: str | None = None
    total_hires: int | None = None
    total_posted_jobs: int | None = None
    total_reviews: int | None = None
    feedback: float | None = None
    member_since: str | None = None


class Teammate(BaseModel):
    name: str
    you: bool = False


class Watcher(Teammate):
    """Someone whose extension has the posting open right now."""

    # Their extension checks the client and alerts them.
    notify: bool
    # Theirs is the watch whose findings go to everyone.
    relay: bool


class JobCard(ORMModel):
    id: uuid.UUID
    upwork_id: str
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
    preferred_freelancer_location: list[str]
    published_at: datetime | None
    # When the posting entered the shared list, and when anyone last saw it.
    created_at: datetime
    last_seen_at: datetime
    # This user's own marks and history with the posting.
    focused_at: datetime | None = None
    hidden_at: datetime | None = None
    track_stage: FreelanceTrackStage | None = None
    proposal_count: int = 0
    # As Upwork words it ("10 to 15"); ``total_applicants`` is the tier's top.
    proposals_label: str | None = None
    connects_required: int | None = None
    # Live, from whoever watches the posting: see ``services.watch``.
    client_activity_at: datetime | None = None
    interviewing: int | None = None
    watchers: list[Watcher] = Field(default_factory=list)


class JobDetail(JobCard):
    # Null until someone opened the posting's own page with the extension on;
    # until then the description is the search tile's.
    detail_captured_at: datetime | None = None
    screening_questions: list[str] = Field(default_factory=list)
    activity: dict = Field(default_factory=dict)
    # Whose extension posted it to the shared list first; null once that account is gone.
    posted_by: Teammate | None = None


class SavedSearchIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    params: JobFilter


class SavedSearchOut(ORMModel):
    id: uuid.UUID
    name: str
    params: dict
    last_run_at: datetime | None
    created_at: datetime



# --- Watching a posting's client -----------------------------------------------------


class WatchReport(BaseModel):
    """A heartbeat from the extension for a posting open in this user's browser.

    With ``state`` it is also a fresh reading of the posting (the page just
    loaded, or a background refresh), which updates the shared row and is
    checked for client activity. Without it, it only says "still watching".
    """

    upwork_id: str = Field(pattern=JOB_KEY_PATTERN)
    url: str | None = Field(default=None, max_length=2000)
    state: dict | None = None

    @field_validator("upwork_id")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.lower()

    @field_validator("state")
    @classmethod
    def _bounded_state(cls, value: dict | None) -> dict | None:
        return bounded_state(value)


class WatchPatch(BaseModel):
    notify: bool


class WatchEvent(BaseModel):
    """Something this user's own watch just saw, for their extension to announce."""

    kind: FreelanceAlertKind
    client_activity_at: datetime | None = None
    interviewing: int | None = None
    previous_interviewing: int | None = None


class WatchOut(BaseModel):
    job_id: uuid.UUID
    upwork_id: str
    title: str
    url: str | None
    notify: bool
    relay: bool
    watchers: list[Watcher]
    total_applicants: int | None
    activity: dict
    events: list[WatchEvent] = Field(default_factory=list)


class AlertOut(BaseModel):
    id: int
    kind: FreelanceAlertKind
    job_id: uuid.UUID
    title: str
    url: str | None
    relay_name: str | None
    # This user's own watch alerted them already.
    local: bool
    client_activity_at: datetime | None
    interviewing: int | None
    previous_interviewing: int | None
    occurred_at: datetime


class AlertFeed(BaseModel):
    items: list[AlertOut]
    # The newest alert id there is. Ask with ``after=cursor`` for what follows.
    cursor: int


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
    # The writer version the form was built from, when it was; the save becomes the next whole version.
    version_id: uuid.UUID | None = None


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
    version_id: uuid.UUID | None = None


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
    # The latest saved version's number; none until the profile is first saved.
    version: int | None = None
    created_at: datetime
    updated_at: datetime


class ProfilePageView(BaseModel):
    """One Upwork page of the freelancer, as the extension read it in the user's browser."""

    url: str = Field(max_length=2000)
    title: str | None = Field(default=None, max_length=500)
    text: str = Field(max_length=50_000)


class ProfileImportIn(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    # The link's own page first, then the other views of the freelancer it links to.
    views: list[ProfilePageView] = Field(min_length=1, max_length=12)


class FreelancerProfileDraft(BaseModel):
    """A profile read from its Upwork pages: what the form fills in, not saved."""

    name: str | None
    title: str | None
    overview: str | None
    hourly_rate: float | None
    skills: list[str]
    portfolio: list[PortfolioItem]
    specialized_profiles: list[SpecializedProfile]
    raw_profile_markdown: str | None


class ProfileMaterial(BaseModel):
    """The profile form as it is when the writer is asked: what it writes from."""

    title: str | None = Field(default=None, max_length=200)
    overview: str | None = Field(default=None, max_length=8000)
    hourly_rate: float | None = Field(default=None, ge=0, le=10_000)
    skills: list[str] = Field(default_factory=list, max_length=100)
    portfolio: list[PortfolioItem] = Field(default_factory=list, max_length=50)
    specialized_profiles: list[SpecializedProfile] = Field(default_factory=list, max_length=10)
    raw_profile_markdown: str | None = Field(default=None, max_length=40_000)


class ProfileWriteIn(BaseModel):
    # None writes for a profile not created yet.
    profile_id: uuid.UUID | None = None
    # The version being revised; None writes the first draft.
    based_on_id: uuid.UUID | None = None
    instruction: str = Field(min_length=1, max_length=20_000)
    material: ProfileMaterial = Field(default_factory=ProfileMaterial)


class ProfileWriteAccepted(BaseModel):
    id: uuid.UUID
    status: str


class ProfileVersionOut(ORMModel):
    id: uuid.UUID
    profile_id: uuid.UUID | None
    major: int
    minor: int
    instruction: str | None
    document: dict
    based_on_id: uuid.UUID | None
    generation_id: uuid.UUID | None
    created_at: datetime


class ProfileVersions(BaseModel):
    items: list[ProfileVersionOut]
    # A draft still being written for this profile, to follow after a reload.
    running_generation_id: uuid.UUID | None


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
    # The version the editor was built from; a save records the next whole version over it.
    version_id: uuid.UUID | None = None


class ProposalWriting(BaseModel):
    """The letter and answers as the editor holds them, hand edits included."""

    cover_letter_markdown: str = Field(default="", max_length=40_000)
    answers: list[ProposalAnswer] = Field(default_factory=list, max_length=20)


class ProposalGenerateIn(BaseModel):
    """Ask the writer for the next draft. Returns the queued generation, not the proposal."""

    job_id: uuid.UUID
    profile_id: uuid.UUID | None = None
    # Writes the next version of an existing proposal rather than starting another.
    proposal_id: uuid.UUID | None = None
    # The version being revised, and the editor's text now; neither on a first draft.
    based_on_id: uuid.UUID | None = None
    current: ProposalWriting | None = None
    instruction: str | None = Field(default=None, max_length=20_000)


class ProposalVersionOut(ORMModel):
    id: uuid.UUID
    proposal_id: uuid.UUID
    major: int
    minor: int
    instruction: str | None
    document: dict
    based_on_id: uuid.UUID | None
    generation_id: uuid.UUID | None
    created_at: datetime


class ProposalVersions(BaseModel):
    items: list[ProposalVersionOut]
    # A draft still being written for this proposal, to follow after a reload.
    running_generation_id: uuid.UUID | None


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
    version_id: uuid.UUID | None
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
