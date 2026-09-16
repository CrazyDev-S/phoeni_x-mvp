"""Tailored resumes: the versions produced against a specific job posting.

Kept in their own table, and their own router, because they are not
interchangeable with base resumes - each one is tied to a posting and carries
its own ATS report.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import exists, func, or_, select

from app.core.deps import CurrentUser, Session
from app.models.application import JobApplication
from app.models.resume import TailoredResume
from app.resume.renderer import render_plain_text
from app.schemas.common import Page
from app.schemas.resume import (
    TailoredResumeOut,
    TailoredResumePatch,
    TailoredResumeSummary,
)
from app.services.resumes import parse_or_422, rescore_tailored

router = APIRouter(prefix="/tailored-resumes", tags=["resumes"])


async def _owned(
    session: Session, user: CurrentUser, resume_id: uuid.UUID
) -> TailoredResume:
    row = await session.scalar(
        select(TailoredResume).where(
            TailoredResume.id == resume_id, TailoredResume.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tailored resume not found"
        )
    return row


@router.get("", response_model=Page[TailoredResumeSummary])
async def list_tailored_resumes(
    user: CurrentUser,
    session: Session,
    base_resume_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, description="full-text search"),
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> Page[TailoredResumeSummary]:
    stmt = select(TailoredResume).where(
        TailoredResume.user_id == user.id,
        # Tailoring from the side panel is not saving it: that resume is listed
        # only once Save & track registers it as an application. Until then
        # the panel still finds it by its posting.
        or_(
            TailoredResume.job_source != "extension",
            exists().where(JobApplication.tailored_resume_id == TailoredResume.id),
        ),
    )
    if base_resume_id:
        stmt = stmt.where(TailoredResume.base_resume_id == base_resume_id)
    if q:
        stmt = stmt.where(
            TailoredResume.search_vector.op("@@")(func.plainto_tsquery("english", q))
        )

    total = await session.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = await session.scalars(
        stmt.order_by(TailoredResume.created_at.desc()).limit(limit).offset(offset)
    )
    return Page(
        items=[TailoredResumeSummary.model_validate(r) for r in rows],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.get("/{resume_id}", response_model=TailoredResumeOut)
async def get_tailored_resume(
    resume_id: uuid.UUID, user: CurrentUser, session: Session
) -> TailoredResume:
    return await _owned(session, user, resume_id)


@router.patch("/{resume_id}", response_model=TailoredResumeOut)
async def update_tailored_resume(
    resume_id: uuid.UUID,
    body: TailoredResumePatch,
    user: CurrentUser,
    session: Session,
) -> TailoredResume:
    row = await _owned(session, user, resume_id)

    if body.content_markdown is not None:
        parsed = parse_or_422(body.content_markdown)
        row.content_markdown = body.content_markdown
        row.content_text = render_plain_text(parsed)
        rescore_tailored(row, parsed)

    for field in ("display_name", "company_name", "job_title", "job_url", "status"):
        if (value := getattr(body, field)) is not None:
            setattr(row, field, value)
    return row


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tailored_resume(
    resume_id: uuid.UUID, user: CurrentUser, session: Session
) -> None:
    """Delete permanently.

    Any application pointing at this version keeps its own record; the link is
    ON DELETE SET NULL, so deleting the document does not delete the history of
    having applied.
    """
    row = await _owned(session, user, resume_id)
    await session.execute(
        JobApplication.__table__.update()
        .where(JobApplication.tailored_resume_id == row.id)
        .values(tailored_resume_id=None)
    )
    await session.delete(row)
