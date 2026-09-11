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


class StageOut(ORMModel):
    id: uuid.UUID
    seq: int
    name: str
    kind: str
    status: StageStatus
    scheduled_for: datetime | None
    outcome_notes: str | None
    preparation_md: str | None
    decided_at: datetime | None


class MeetingOut(ORMModel):
    id: uuid.UUID
    title: str
    meeting_type: str
    starts_at: datetime
    ends_at: datetime
    display_tz: str
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


class ApplicationOut(ORMModel):
    id: uuid.UUID
    company_name: str
    role_title: str
    job_url: str | None
    location: str | None
    work_mode: WorkMode | None
    status: ApplicationStatus
    origin: str
    applied_at: datetime | None
    next_action_at: datetime | None
    notes_md: str | None
    tailored_resume_id: uuid.UUID | None
    created_at: datetime


class ApplicationDetail(ApplicationOut):
    job_description_text: str | None
    stages: list[StageOut] = Field(default_factory=list)


class ApplicationRow(ApplicationOut):
    """The tracking table row: current stage and next meeting inlined."""

    current_stage: StageOut | None = None
    next_meeting: MeetingOut | None = None
    stage_count: int = 0
    stages_passed: int = 0
    must_have_coverage_pct: float | None = None


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
    notes_md: str | None = None
    stage_template_id: uuid.UUID | None = None


class ApplicationPatch(BaseModel):
    company_name: str | None = None
    role_title: str | None = None
    job_url: str | None = None
    location: str | None = None
    work_mode: WorkMode | None = None
    status: ApplicationStatus | None = None
    notes_md: str | None = None
    next_action_at: datetime | None = None


class StageCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = "other"
    seq: int | None = None


class StagePatch(BaseModel):
    name: str | None = None
    status: StageStatus | None = None
    outcome_notes: str | None = None
    preparation_md: str | None = None
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
    title: str | None = None
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
    notes_md: str | None
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
    rrule: str = Field(min_length=6, max_length=400)
    dtstart_date: date
    dtstart_local: str = Field(pattern=r"^\d{2}:\d{2}$")
    duration_min: int = Field(default=30, ge=5, le=600)
    meeting_type: str = "team_sync"
    conferencing_url: str | None = None
    agenda_template: str | None = None
    preparation_template: str | None = None
    until_date: date | None = None


class SeriesOut(ORMModel):
    id: uuid.UUID
    title: str
    rrule: str
    dtstart_date: date
    # Stored as a `time`; rendered as HH:MM so the client can round-trip it
    # straight back into an <input type="time">.
    dtstart_local: str

    @field_validator("dtstart_local", mode="before")
    @classmethod
    def _hhmm(cls, v: object) -> str:
        return v.strftime("%H:%M") if isinstance(v, time) else str(v)[:5]
    tz: str
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
