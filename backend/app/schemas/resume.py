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


class PreviewBorder(BaseModel):
    color: str
    width_pt: float
    space_pt: float


class PreviewStyle(BaseModel):
    """One named carrier style, in the units Word itself uses."""

    size_pt: float
    bold: bool
    italic: bool
    all_caps: bool
    color: str | None
    space_before_pt: float
    space_after_pt: float
    line_spacing: float
    justify: bool
    left_indent_pt: float
    first_line_indent_pt: float
    keep_with_next: bool
    border_bottom: PreviewBorder | None


class PreviewLayout(BaseModel):
    font: str
    page_width_pt: float
    page_height_pt: float
    margin_top_pt: float
    margin_right_pt: float
    margin_bottom_pt: float
    margin_left_pt: float
    date_color: str
    skills_label_pt: float
    cell_right_margin_pt: float
    table_rule_color: str
    table_rule_pt: float


class PreviewSkillRow(BaseModel):
    label: str
    value: str


class PreviewBlock(BaseModel):
    """One paragraph of the .docx, or the skills table."""

    kind: str = Field(pattern="^(paragraph|role|bullet|skill_line|skills_table)$")
    style: str
    text: str = ""
    right: str | None = None
    label: str | None = None
    rows: list[PreviewSkillRow] | None = None


class PreviewOut(BaseModel):
    profile: str
    layout: PreviewLayout
    styles: dict[str, PreviewStyle]
    blocks: list[PreviewBlock]


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
    must_have_covered: int | None = None
    must_have_total: int | None = None
    nice_to_have_coverage_percent: float | None = None
    years_required: int | None = None
    years_shown: float | None = None
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
