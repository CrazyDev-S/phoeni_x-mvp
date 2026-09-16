from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import GenerationStatus, ResumeStatus

FieldType = Literal[
    "text", "email", "tel", "url", "number", "date", "textarea",
    "select", "radio", "checkbox", "combobox", "richtext", "file", "unknown",
]
ResumeKind = Literal["base", "tailored"]
# Where an answer came from: the linked resume, the autofill profile, or the model.
AnswerSource = Literal["resume", "profile", "model", ""]


class ScrapedJob(BaseModel):
    """What the panel extracted from the page.

    Deliberately NOT raw HTML: a Workday page is 0.5-2MB of markup that costs a
    fortune in tokens and produces worse answers than clean text. The panel
    reads the whole page and normalises before sending.
    """

    url: str | None = None
    title: str | None = None
    company: str | None = None
    location: str | None = None
    description_text: str = Field(min_length=1, max_length=60_000)
    json_ld: dict | None = None
    ats: str | None = None


class ExtensionTailorRequest(BaseModel):
    base_resume_id: uuid.UUID
    job: ScrapedJob
    profile: Literal["designed", "ats_plain"] = "designed"
    strategy: Literal["existing", "full"] = "existing"


class FormOption(BaseModel):
    label: str
    value: str = ""


class FormFieldIn(BaseModel):
    id: str
    type: FieldType = "unknown"
    label: str = ""
    help: str = ""
    name: str = ""
    autocomplete: str = ""
    required: bool = False
    max_length: int | None = None
    current_value: str = ""
    options: list[FormOption] = Field(default_factory=list)
    options_unknown: bool = False
    group: str = ""
    # A file input's accept attribute, so a PDF-only upload is not sent a .docx.
    accept: str = ""


class FormFrame(BaseModel):
    frame_key: str
    url: str = ""
    fields: list[FormFieldIn] = Field(default_factory=list)


class ResumeRef(BaseModel):
    kind: ResumeKind
    id: uuid.UUID


class AutofillRequest(BaseModel):
    job: ScrapedJob | None = None
    # The page the form is on. When no resume is named, the resume linked to
    # its posting answers the form.
    job_url: str | None = Field(default=None, max_length=4000)
    resume: ResumeRef | None = None
    base_resume_id: uuid.UUID | None = None
    frames: list[FormFrame] = Field(min_length=1)
    step: str = ""


class AutofillAnswer(BaseModel):
    id: str
    type: FieldType
    label: str = ""
    answer: str = ""
    checked: bool | None = None
    needs_user_input: bool = False
    reason: str = ""
    matched_fuzzily: bool = False
    source: AnswerSource = ""


class FactPair(BaseModel):
    label: str
    value: str


class ResumeFacts(BaseModel):
    """The candidate's details as one resume states them."""

    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    city: str | None = None
    country: str | None = None
    linkedin: str | None = None
    github: str | None = None
    website: str | None = None
    headline: str | None = None
    current_title: str | None = None
    current_company: str | None = None
    years_experience: int | None = None
    work_preference: str | None = None
    availability: str | None = None
    summary: str | None = None
    skills: list[FactPair] = Field(default_factory=list)
    education: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)


class LinkedResume(BaseModel):
    kind: ResumeKind
    id: uuid.UUID
    display_name: str
    status: ResumeStatus
    company_name: str | None = None
    job_title: str | None = None
    must_have_coverage_percent: float | None = None
    base_resume_id: uuid.UUID | None = None
    # The application a tailored resume was saved with. Until it has one, a
    # resume tailored in the panel is not listed with the saved resumes.
    application_id: uuid.UUID | None = None


class AutofillResponse(BaseModel):
    answers: list[AutofillAnswer]
    unanswered: list[AutofillAnswer] = Field(default_factory=list)
    # False when part of the form went unanswered for a reason that can pass -
    # no model key, a timeout, an unreadable reply. Such a result is never
    # cached, or every Re-scan would replay the failure.
    complete: bool = True
    cached: bool = False
    form_fingerprint: str = ""
    resume: LinkedResume | None = None
    facts: ResumeFacts | None = None


class SaveApplicationRequest(BaseModel):
    tailored_resume_id: uuid.UUID | None = None
    company_name: str = Field(min_length=1, max_length=160)
    role_title: str = Field(min_length=1, max_length=160)
    job_url: str | None = None
    job_description_text: str | None = None
    location: str | None = None
    notes_markdown: str | None = None


class LinkGeneration(BaseModel):
    id: uuid.UUID
    status: GenerationStatus
    phase: str | None = None
    progress_percent: int = 0
    error_detail: str | None = None


class JobLinkOut(BaseModel):
    """What one open tab's posting has: a resume, a run in flight, or neither."""

    url: str
    job_key: str
    # True when a resume was chosen for this posting, rather than found by URL.
    linked: bool
    company_name: str | None = None
    job_title: str | None = None
    base_resume_id: uuid.UUID | None = None
    resume: LinkedResume | None = None
    generation: LinkGeneration | None = None


class JobLinkLookup(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=60)


class JobLinkLookupOut(BaseModel):
    items: list[JobLinkOut]


class JobLinkIn(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    # None unlinks the posting's resume.
    resume: ResumeRef | None = None
    job: ScrapedJob | None = None


class ResumeFactsOut(BaseModel):
    resume: LinkedResume
    facts: ResumeFacts
