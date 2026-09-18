"""Base resume CRUD."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.core.deps import CurrentUser, Session
from app.models.application import JobApplication
from app.models.enums import ResumeSource
from app.models.resume import BaseResume, TailoredResume
from app.resume.renderer import render_plain_text
from app.schemas.common import Page
from app.schemas.resume import (
    ResumeCreated,
    ResumeOut,
    ResumePatch,
    ResumeSummaryOut,
    ResumeUpload,
)
from app.services.resumes import create_base_resume, parse_or_422, run_validation

router = APIRouter(prefix="/resumes", tags=["resumes"])


async def _owned(session: Session, user: CurrentUser, resume_id: uuid.UUID) -> BaseResume:
    row = await session.scalar(
        select(BaseResume).where(
            BaseResume.id == resume_id, BaseResume.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found")
    return row


@router.post("", response_model=ResumeCreated, status_code=status.HTTP_201_CREATED)
async def upload_resume(
    body: ResumeUpload, user: CurrentUser, session: Session
) -> ResumeCreated:
    """Store a resume the user pasted in, as Resume Markdown.

    Parsing happens on the way in: a document that cannot be read back cannot
    be exported, so it is rejected at the boundary rather than at download time.
    """
    row, findings = await create_base_resume(
        session,
        user.id,
        display_name=body.display_name,
        target_title=body.target_title,
        content_markdown=body.content_markdown,
        stack_label=body.stack_label,
        stack_tags=body.stack_tags,
        source=ResumeSource.UPLOAD,
    )
    return ResumeCreated(
        **ResumeOut.model_validate(row).model_dump(),
        findings=[f.as_dict() for f in findings],  # type: ignore[arg-type]
    )


@router.get("", response_model=Page[ResumeSummaryOut])
async def list_resumes(
    user: CurrentUser,
    session: Session,
    q: str | None = Query(default=None, description="full-text search"),
    include_archived: bool = False,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> Page[ResumeSummaryOut]:
    stmt = select(BaseResume).where(BaseResume.user_id == user.id)
    if not include_archived:
        stmt = stmt.where(BaseResume.is_archived.is_(False))
    if q:
        stmt = stmt.where(BaseResume.search_vector.op("@@")(func.plainto_tsquery("english", q)))

    total = await session.scalar(
        select(func.count()).select_from(stmt.subquery())
    )
    rows = await session.scalars(
        stmt.order_by(BaseResume.created_at.desc()).limit(limit).offset(offset)
    )
    return Page(
        items=[ResumeSummaryOut.model_validate(r) for r in rows],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


@router.get("/{resume_id}", response_model=ResumeOut)
async def get_resume(
    resume_id: uuid.UUID, user: CurrentUser, session: Session
) -> BaseResume:
    return await _owned(session, user, resume_id)


@router.patch("/{resume_id}", response_model=ResumeCreated)
async def update_resume(
    resume_id: uuid.UUID, body: ResumePatch, user: CurrentUser, session: Session
) -> ResumeCreated:
    row = await _owned(session, user, resume_id)
    findings = []

    if body.content_markdown is not None:
        ast = parse_or_422(body.content_markdown)
        findings = run_validation(ast)
        row.content_markdown = body.content_markdown
        row.content_text = render_plain_text(ast)
        row.validation = {"findings": [f.as_dict() for f in findings]}

    for field in ("display_name", "target_title", "stack_label", "stack_tags", "is_archived"):
        if (value := getattr(body, field)) is not None:
            setattr(row, field, value)

    await session.flush()
    return ResumeCreated(
        **ResumeOut.model_validate(row).model_dump(),
        findings=[f.as_dict() for f in findings],  # type: ignore[arg-type]
    )


@router.post("/{resume_id}/archive", response_model=ResumeOut)
async def archive_resume(
    resume_id: uuid.UUID, user: CurrentUser, session: Session
) -> BaseResume:
    """Hide a resume without destroying it. Reversible."""
    row = await _owned(session, user, resume_id)
    row.is_archived = True
    return row


@router.post("/{resume_id}/restore", response_model=ResumeOut)
async def restore_resume(
    resume_id: uuid.UUID, user: CurrentUser, session: Session
) -> BaseResume:
    row = await _owned(session, user, resume_id)
    row.is_archived = False
    return row


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resume(
    resume_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    cascade: bool = Query(
        default=False,
        description="Also delete the tailored versions built from this resume.",
    ),
) -> None:
    """Delete permanently. This cannot be undone.

    Tailored versions are the documents somebody actually applied with, so
    they are never destroyed as an invisible side effect: without ``cascade``
    the request is refused and the response says how many there are, which is
    what lets the caller name the number in its confirmation.
    """
    row = await _owned(session, user, resume_id)
    dependents = list(
        await session.scalars(
            select(TailoredResume).where(TailoredResume.base_resume_id == row.id)
        )
    )
    if dependents and not cascade:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "HAS_TAILORED_VERSIONS",
                "message": (
                    f"This resume has {len(dependents)} tailored version"
                    f"{'s' if len(dependents) != 1 else ''} built from it. "
                    "Deleting it will delete them too."
                ),
                "tailored_count": len(dependents),
            },
        )

    for tailored in dependents:
        # Keep the record of having applied; only the document goes.
        await session.execute(
            JobApplication.__table__.update()
            .where(JobApplication.tailored_resume_id == tailored.id)
            .values(tailored_resume_id=None)
        )
        await session.delete(tailored)
    await session.flush()
    await session.delete(row)
