"""Base resume CRUD."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select

from app.core.deps import CurrentUser, Session
from app.models.application import JobApplication
from app.models.enums import GenerationKind, GenerationStatus, ResumeSource
from app.models.resume import BaseResume, TailoredResume
from app.remote.resume.parser import ResumeMarkdownError, parse
from app.remote.resume.renderer import render_plain_text
from app.remote.services import documents
from app.remote.services.links import linked_jobs
from app.remote.services.resumes import (
    create_base_resume,
    free_display_name,
    parse_or_422,
    run_validation,
)
from app.schemas.common import Page
from app.schemas.generation import ImportAccepted
from app.schemas.resume import (
    ResumeCreated,
    ResumeOut,
    ResumePatch,
    ResumeRow,
    ResumeSummaryOut,
    ResumeUpload,
)
from app.services.generation import enqueue

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


@router.post(
    "/import",
    response_model=ImportAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def import_resume(
    user: CurrentUser,
    session: Session,
    file: UploadFile | None = File(default=None),
    text: str | None = Form(default=None, max_length=documents.MAX_CHARS),
    display_name: str | None = Form(default=None, max_length=160),
    target_title: str | None = Form(default=None, max_length=160),
) -> ImportAccepted:
    """Take in a resume from any document, and restyle it into the house format.

    A PDF, Word, OpenDocument, RTF, HTML, Markdown or plain-text file - or
    pasted text - is read, then restructured and checked by a background job
    that streams its progress like any other generation. A file that already is
    Resume Markdown skips the model and is saved straight away.
    """
    if file is None and not (text and text.strip()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "NOTHING_TO_IMPORT", "message": "Attach a file or paste your resume."},
        )
    filename = (file.filename if file and file.filename else "pasted-resume.txt")[:200]
    data = (
        await file.read(documents.MAX_BYTES + 1) if file is not None else (text or "").encode()
    )
    try:
        doc = documents.extract(filename, data)
    except documents.DocumentError as exc:
        raise HTTPException(
            status_code=(
                status.HTTP_413_CONTENT_TOO_LARGE
                if exc.code == "FILE_TOO_LARGE"
                else status.HTTP_422_UNPROCESSABLE_ENTITY
            ),
            detail={"code": exc.code, "message": exc.message},
        ) from exc

    stem = filename.rsplit(".", 1)[0].replace("_", " ").replace("-", " ").strip()
    label = (display_name or "").strip() or None
    accepted = {
        "source_kind": doc.kind,
        "characters": len(doc.text),
        "warnings": doc.warnings,
    }

    ready = _already_resume_markdown(doc.text)
    if ready is not None:
        row, _ = await create_base_resume(
            session,
            user.id,
            display_name=await free_display_name(
                session, user.id, label or ready.header.name or stem or "Imported resume"
            ),
            target_title=(target_title or "").strip() or ready.header.title,
            content_markdown=doc.text,
            source=ResumeSource.UPLOAD,
            imported=True,
        )
        return ImportAccepted(
            id=row.id,
            status=GenerationStatus.SUCCEEDED,
            kind=GenerationKind.RESUME_IMPORT,
            reused=True,
            direct=True,
            result_kind="base_resume",
            result_id=row.id,
            **accepted,
        )

    gen = await enqueue(
        session,
        user_id=user.id,
        kind=GenerationKind.RESUME_IMPORT,
        payload={
            "source_text": doc.for_model(),
            "filename": filename,
            "source_kind": doc.kind,
            "target_title": (target_title or "").strip(),
            "display_name": label,
            "mode": "grounded",
        },
    )
    return ImportAccepted(id=gen.id, status=gen.status, kind=gen.kind, **accepted)


def _already_resume_markdown(text: str):
    """The parsed resume when the text is already in the house format."""
    if not text.lstrip().startswith("---"):
        return None
    try:
        return parse(text)
    except ResumeMarkdownError:
        return None


@router.get("", response_model=Page[ResumeRow])
async def list_resumes(
    user: CurrentUser,
    session: Session,
    q: str | None = Query(default=None, description="full-text search"),
    include_archived: bool = False,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> Page[ResumeRow]:
    stmt = select(BaseResume).where(BaseResume.user_id == user.id)
    if not include_archived:
        stmt = stmt.where(BaseResume.is_archived.is_(False))
    if q:
        stmt = stmt.where(BaseResume.search_vector.op("@@")(func.plainto_tsquery("english", q)))

    total = await session.scalar(
        select(func.count()).select_from(stmt.subquery())
    )
    rows = list(
        await session.scalars(
            stmt.order_by(BaseResume.created_at.desc()).limit(limit).offset(offset)
        )
    )
    linked = await linked_jobs(session, user.id, "base", [r.id for r in rows])
    return Page(
        items=[
            ResumeRow(
                **ResumeSummaryOut.model_validate(r).model_dump(),
                linked_jobs=linked.get(r.id, []),  # type: ignore[arg-type]
            )
            for r in rows
        ],
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
