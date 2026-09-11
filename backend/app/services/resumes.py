"""Resume persistence: parse, validate, derive, store."""

from __future__ import annotations

import re
import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import ResumeSource, ResumeStatus
from app.models.resume import CURRENT_DIALECT_VERSION, BaseResume
from app.resume.ast import Resume
from app.resume.parser import CrmParseError, parse
from app.resume.renderer import to_plain_text
from app.validation.rules import Context, Finding, validate

YOE_RE = re.compile(r"(\d{1,2})\+?\s*years?", re.IGNORECASE)


def parse_or_422(content_md: str) -> Resume:
    """Turn a parse failure into an actionable 422 rather than a 500."""
    try:
        return parse(content_md)
    except CrmParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "CRM_PARSE_ERROR",
                "message": str(exc),
                "line": exc.line_no,
                "section": exc.state,
                "line_text": exc.line,
            },
        ) from exc


def claimed_yoe(resume: Resume) -> int | None:
    m = YOE_RE.search(resume.summary)
    return int(m.group(1)) if m else None


def run_validation(resume: Resume, **kw) -> list[Finding]:
    return validate(Context(resume=resume, claimed_yoe=claimed_yoe(resume), **kw))


async def create_base_resume(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    display_name: str,
    target_title: str,
    content_md: str,
    source: ResumeSource,
    stack_label: str | None = None,
    stack_tags: list[str] | None = None,
    **extra,
) -> tuple[BaseResume, list[Finding]]:
    ast = parse_or_422(content_md)
    findings = run_validation(ast)

    row = BaseResume(
        user_id=user_id,
        display_name=display_name,
        target_title=target_title,
        stack_label=stack_label,
        stack_tags=stack_tags or [],
        source=source,
        content_md=content_md,
        content_text=to_plain_text(ast),
        dialect_version=CURRENT_DIALECT_VERSION,
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
