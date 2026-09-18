from __future__ import annotations

import uuid
from datetime import date, datetime, time

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.enums import (
    ApplicationStatus,
    MaintainedJobStatus,
    MeetingStatus,
    StageStatus,
    WorkMode,
)
from app.schemas.common import ORMModel


class MeetingOut(ORMModel):
    id: uuid.UUID
    title: str
    meeting_type: str
    starts_at: datetime
    ends_at: datetime
    display_timezone: str
    status: MeetingStatus
    location: str | None
    conferencing_url: str | None
    agenda: str | None
    preparation_notes: str | None
    notes: str | None
    stage_id: uuid.UUID | None
    maintained_job_id: uuid.UUID | None
    series_id: uuid.UUID | None
    is_exception: bool
    reminder_minutes: int


class CalendarMeetingOut(MeetingOut):
    """A meeting with its owner named, so a calendar block can say who it is with."""

    kind: str = "maintained"  # application | maintained
    application_id: uuid.UUID | None = None
    company_name: str | None = None
    role_title: str | None = None
    stage_name: str | None = None
    stage_kind: str | None = None


class StageOut(ORMModel):
    id: uuid.UUID
    seq: int
    name: str
    kind: str
    status: StageStatus
    scheduled_for: datetime | None
    outcome_notes: str | None
    preparation_markdown: str | None
    decided_at: datetime | None
    # Every meeting booked for the stage, earliest first. Empty when the caller
    # did not load them (the ORM row has no such attribute).
    meetings: list[MeetingOut] = Field(default_factory=list)


class ApplicationOut(ORMModel):
    id: uuid.UUID
    company_name: str
    company_domain: str | None = None
    role_title: str
    job_url: str | None
    location: str | None
    work_mode: WorkMode | None
    salary_min: int | None = None
    salary_max: int | None = None
    salary_currency: str | None = None
    status: ApplicationStatus
    origin: str
    applied_at: datetime | None
    next_action_at: datetime | None
    notes_markdown: str | None
    tailored_resume_id: uuid.UUID | None
    created_at: datetime


class TailoredResumeBrief(BaseModel):
    """The resume an application was sent with, and how well it covered the posting."""

    id: uuid.UUID
    display_name: str
    base_resume_id: uuid.UUID
    base_resume_name: str | None = None
    status: str
    job_url: str | None
    job_source: str
    must_have_covered: int | None
    must_have_total: int | None
    must_have_coverage_percent: float | None
    nice_to_have_coverage_percent: float | None
    years_required: int | None
    years_shown: float | None
    content_markdown: str
    flags: dict | None = None
    created_at: datetime


class TailoredResumeOption(BaseModel):
    id: uuid.UUID
    display_name: str
    base_resume_id: uuid.UUID
    must_have_coverage_percent: float | None = None
    created_at: datetime


class ApplicationDetail(ApplicationOut):
    job_description_text: str | None
    stages: list[StageOut] = Field(default_factory=list)
    tailored_resume: TailoredResumeBrief | None = None
    # When nothing is linked: the tailored resume written for this posting.
    suggested_tailored_resume: TailoredResumeOption | None = None


class ApplicationRow(ApplicationOut):
    """The tracking table row: every stage, plus the current one and next meeting."""

    stages: list[StageOut] = Field(default_factory=list)
    current_stage: StageOut | None = None
    next_meeting: MeetingOut | None = None
    stage_count: int = 0
    stages_passed: int = 0
    must_have_coverage_percent: float | None = None


class ApplicationCreate(BaseModel):
    company_name: str = Field(min_length=1, max_length=160)
    role_title: str = Field(min_length=1, max_length=160)
    job_url: str | None = Field(default=None, max_length=2000)
    job_description_text: str | None = None
    location: str | None = None
    work_mode: WorkMode | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    salary_currency: str | None = Field(default=None, max_length=3)
    tailored_resume_id: uuid.UUID | None = None
    status: ApplicationStatus = ApplicationStatus.APPLIED
    origin: str = "web"
    notes_markdown: str | None = None
    stage_template_id: uuid.UUID | None = None


class ApplicationPatch(BaseModel):
    company_name: str | None = Field(default=None, min_length=1, max_length=160)
    company_domain: str | None = Field(default=None, max_length=255)
    role_title: str | None = Field(default=None, min_length=1, max_length=160)
    job_url: str | None = Field(default=None, max_length=2000)
    job_description_text: str | None = None
    location: str | None = None
    work_mode: WorkMode | None = None
    salary_min: int | None = Field(default=None, ge=0)
    salary_max: int | None = Field(default=None, ge=0)
    salary_currency: str | None = Field(default=None, max_length=3)
    status: ApplicationStatus | None = None
    notes_markdown: str | None = None
    next_action_at: datetime | None = None
    applied_at: datetime | None = None
    # Null unlinks; the resume itself is never touched.
    tailored_resume_id: uuid.UUID | None = None


class StageCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = "other"
    seq: int | None = None


class StagePatch(BaseModel):
    name: str | None = None
    status: StageStatus | None = None
    outcome_notes: str | None = None
    preparation_markdown: str | None = None
    reason: str | None = None


class NextStepSuggestion(BaseModel):
    """Returned when a stage passes, so both surfaces can offer scheduling."""

    stage_id: uuid.UUID | None
    name: str | None
    kind: str | None
    already_scheduled: bool = False
    suggested_duration_min: int | None = None


class StageUpdated(BaseModel):
    stage: StageOut
    application_status: ApplicationStatus
    suggested_next_stage: NextStepSuggestion | None = None


class MeetingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    # Local wall-clock in the display zone. Storing the local intent and
    # deriving the instant is what keeps a recurring 10:00 ET meeting at 10:00
    # across a DST boundary.
    local_date: date
    local_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    duration_min: int = Field(default=30, ge=5, le=600)
    meeting_type: str = "interview"
    stage_id: uuid.UUID | None = None
    maintained_job_id: uuid.UUID | None = None
    location: str | None = None
    conferencing_url: str | None = None
    agenda: str | None = None
    preparation_notes: str | None = None
    reminder_minutes: int = 30

    @model_validator(mode="after")
    def _exactly_one_owner(self):
        if bool(self.stage_id) == bool(self.maintained_job_id):
            raise ValueError("supply exactly one of stage_id or maintained_job_id")
        return self


class MeetingPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    meeting_type: str | None = None
    local_date: date | None = None
    local_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    duration_min: int | None = Field(default=None, ge=5, le=600)
    status: MeetingStatus | None = None
    location: str | None = None
    conferencing_url: str | None = None
    agenda: str | None = None
    preparation_notes: str | None = None
    notes: str | None = None
    reminder_minutes: int | None = None


class MaintainedJobOut(ORMModel):
    id: uuid.UUID
    employer_name: str
    role_title: str
    start_date: date
    end_date: date | None
    manager_name: str | None
    team: str | None
    status: MaintainedJobStatus
    notes_markdown: str | None
    onboarding_notes: str | None


class MaintainedJobCreate(BaseModel):
    employer_name: str = Field(min_length=1, max_length=160)
    role_title: str = Field(min_length=1, max_length=160)
    start_date: date
    manager_name: str | None = None
    team: str | None = None
    employment_type: str | None = None
    job_application_id: uuid.UUID | None = None
    onboarding_notes: str | None = None


class SeriesCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    recurrence_rule: str = Field(min_length=6, max_length=400)
    start_date: date
    start_time_local: str = Field(pattern=r"^\d{2}:\d{2}$")
    duration_min: int = Field(default=30, ge=5, le=600)
    meeting_type: str = "team_sync"
    conferencing_url: str | None = None
    agenda_template: str | None = None
    preparation_template: str | None = None
    until_date: date | None = None


class SeriesOut(ORMModel):
    id: uuid.UUID
    title: str
    recurrence_rule: str
    start_date: date
    # Stored as a `time`; rendered as HH:MM so the client can round-trip it
    # straight back into an <input type="time">.
    start_time_local: str

    @field_validator("start_time_local", mode="before")
    @classmethod
    def _hhmm(cls, v: object) -> str:
        return v.strftime("%H:%M") if isinstance(v, time) else str(v)[:5]
    timezone_name: str
    duration_min: int
    meeting_type: str
    is_active: bool
    materialized_through: date | None
    agenda_template: str | None
    preparation_template: str | None


class UpcomingOut(BaseModel):
    meeting: MeetingOut
    company_name: str | None = None
    role_title: str | None = None
    stage_name: str | None = None
    kind: str  # application | maintained
    starts_in_minutes: int
