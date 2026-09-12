from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

FieldType = Literal[
    "text", "email", "tel", "url", "number", "date", "textarea",
    "select", "radio", "checkbox", "combobox", "richtext", "file", "unknown",
]


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


class FormFrame(BaseModel):
    frame_key: str
    url: str = ""
    fields: list[FormFieldIn] = Field(default_factory=list)


class AutofillRequest(BaseModel):
    job: ScrapedJob | None = None
    base_resume_id: uuid.UUID | None = None
    frames: list[FormFrame] = Field(min_length=1)
    step: str = ""


class AutofillAnswer(BaseModel):
    id: str
    type: FieldType
    answer: str = ""
    checked: bool | None = None
    needs_user_input: bool = False
    reason: str = ""
    matched_fuzzily: bool = False


class AutofillResponse(BaseModel):
    answers: list[AutofillAnswer]
    unanswered: list[AutofillAnswer] = Field(default_factory=list)
    cached: bool = False
    form_fingerprint: str = ""


class SaveApplicationRequest(BaseModel):
    tailored_resume_id: uuid.UUID | None = None
    company_name: str = Field(min_length=1, max_length=160)
    role_title: str = Field(min_length=1, max_length=160)
    job_url: str | None = None
    job_description_text: str | None = None
    location: str | None = None
    notes_markdown: str | None = None
