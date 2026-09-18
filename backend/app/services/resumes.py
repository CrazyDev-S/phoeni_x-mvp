"""Resume persistence: parse, validate, derive, store."""

from __future__ import annotations

import re
import uuid

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.schemas import ScenarioLedger
from app.models.enums import ResumeSource, ResumeStatus
from app.models.resume import CURRENT_MARKDOWN_VERSION, BaseResume, TailoredResume
from app.orchestration import ats_report
from app.resume.document import Resume
from app.resume.parser import ResumeMarkdownError, parse
from app.resume.renderer import render_plain_text
from app.validation.rules import Context, Finding, validate

YOE_RE = re.compile(r"(\d{1,2})\+?\s*years?", re.IGNORECASE)


def parse_or_422(content_markdown: str) -> Resume:
    """Turn a parse failure into an actionable 422 rather than a 500."""
    try:
        return parse(content_markdown)
    except ResumeMarkdownError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "RESUME_MARKDOWN_PARSE_ERROR",
                "message": str(exc),
                "line": exc.line_no,
                "section": exc.state,
                "line_text": exc.line,
            },
        ) from exc


def claimed_years(resume: Resume) -> int | None:
    m = YOE_RE.search(resume.summary)
    return int(m.group(1)) if m else None


def run_validation(resume: Resume, **kw) -> list[Finding]:
    return validate(Context(resume=resume, claimed_years=claimed_years(resume), **kw))


def rescore_tailored(row: TailoredResume, resume: Resume) -> list[Finding]:
    """Re-check and re-score a tailored resume after a hand edit.

    Against its own keyword plan. Without it an edit left the coverage figures
    describing the version before it, and deleting a must-have keyword went
    unnoticed.
    """
    try:
        ledger = ScenarioLedger.model_validate(row.ledger) if row.ledger else None
    except ValidationError:
        ledger = None
    findings = validate(
        Context(
            resume=resume,
            claimed_years=(ledger.total_years if ledger and ledger.total_years else None)
            or claimed_years(resume),
            jd_keywords={"must": ats_report.must_keywords(ledger)},
        )
    )
    report = ats_report.build(
        resume,
        ledger,
        target_title=row.job_title or resume.header.title,
        findings_count=len(findings),
    )
    row.validation = {"findings": [f.as_dict() for f in findings]}
    row.ats_report = report
    for key, value in ats_report.coverage_columns(report).items():
        setattr(row, key, value)
    row.status = (
        ResumeStatus.NEEDS_REVIEW
        if any(f.severity == "error" for f in findings)
        else ResumeStatus.FINAL
    )
    return findings


async def create_base_resume(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    display_name: str,
    target_title: str,
    content_markdown: str,
    source: ResumeSource,
    stack_label: str | None = None,
    stack_tags: list[str] | None = None,
    **extra,
) -> tuple[BaseResume, list[Finding]]:
    ast = parse_or_422(content_markdown)
    findings = run_validation(ast)

    row = BaseResume(
        user_id=user_id,
        display_name=display_name,
        target_title=target_title,
        stack_label=stack_label,
        stack_tags=stack_tags or [],
        source=source,
        content_markdown=content_markdown,
        content_text=render_plain_text(ast),
        markdown_version=CURRENT_MARKDOWN_VERSION,
        validation={"findings": [f.as_dict() for f in findings]},
        status=(
            ResumeStatus.NEEDS_REVIEW
            if any(f.severity == "error" for f in findings)
            else ResumeStatus.FINAL
        ),
        **extra,
    )
    session.add(row)
    await session.flush()
    return row, findings
