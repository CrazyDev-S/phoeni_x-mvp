from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import ResumeMode, ResumeSource, ResumeStatus
from app.schemas.common import ORMModel


class ValidationFinding(BaseModel):
    rule_id: str
    severity: str
    message: str
    path: str = ""
    excerpt: str = ""
    suggested_fix: str = ""


class ResumeUpload(BaseModel):
    display_name: str = Field(min_length=1, max_length=160)
    target_title: str = Field(min_length=1, max_length=160)
    content_markdown: str = Field(min_length=1)
    stack_label: str | None = Field(default=None, max_length=120)
    stack_tags: list[str] = Field(default_factory=list, max_length=20)


class ResumePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    target_title: str | None = Field(default=None, min_length=1, max_length=160)
    content_markdown: str | None = None
    stack_label: str | None = None
    stack_tags: list[str] | None = None
    is_archived: bool | None = None


class ResumeSummaryOut(ORMModel):
    id: uuid.UUID
    display_name: str
    target_title: str
    stack_label: str | None
    stack_tags: list[str]
    source: ResumeSource
    mode: ResumeMode
    status: ResumeStatus
    is_archived: bool
    created_at: datetime
    updated_at: datetime


class ResumeOut(ResumeSummaryOut):
    content_markdown: str
    content_text: str
    markdown_version: int
    ledger: dict | None = None
    ats_report: dict | None = None
    flags: dict | None = None
    validation: dict | None = None


class ResumeCreated(ResumeOut):
    findings: list[ValidationFinding] = Field(default_factory=list)


class ExportRequest(BaseModel):
    """Export a stored resume, or raw markdown that was never saved.

    The raw-markdown path is what the extension uses: its tailor-then-download
    flow deliberately does not persist anything.
    """

    resume_id: uuid.UUID | None = None
    kind: str = Field(default="base", pattern="^(base|tailored)$")
    content_markdown: str | None = None
    profile: str = Field(default="designed", pattern="^(designed|ats_plain)$")
    page: str = Field(default="letter", pattern="^(letter|a4)$")
    filename: str | None = None


class TailoredResumeSummary(ORMModel):
    id: uuid.UUID
    display_name: str
    company_name: str | None
    job_title: str | None
    job_url: str | None
    job_source: str
    base_resume_id: uuid.UUID
    status: ResumeStatus
    must_have_coverage_percent: float | None
    created_at: datetime
    updated_at: datetime


class TailoredResumeOut(TailoredResumeSummary):
    content_markdown: str
    content_text: str
    markdown_version: int
    job_description_text: str
    ledger: dict | None = None
    ats_report: dict | None = None
    flags: dict | None = None
    validation: dict | None = None


class TailoredResumePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    company_name: str | None = None
    job_title: str | None = None
    job_url: str | None = None
    content_markdown: str | None = None
    status: ResumeStatus | None = None
