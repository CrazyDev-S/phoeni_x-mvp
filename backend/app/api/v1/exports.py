"""On-demand document export. Nothing binary is ever stored."""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.core.deps import CurrentUser, Session
from app.export.docx_renderer import render_docx
from app.export.preview import render_preview
from app.export.profiles import ExportOptions, PageSize, RenderProfile
from app.models.resume import BaseResume, TailoredResume
from app.schemas.resume import ExportRequest, PreviewOut
from app.services.resumes import parse_or_422

router = APIRouter(prefix="/export", tags=["export"])

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def safe_filename(name: str) -> str:
    """Strip characters that are illegal in a filename on any common OS."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name).strip(" .")
    return (cleaned or "Resume")[:120]


def content_disposition(stem: str) -> str:
    """RFC 6266 attachment header.

    HTTP headers are latin-1, but resume names routinely contain em dashes and
    non-Latin scripts, so a bare ``filename="..."`` raises
    UnicodeEncodeError. Emit an ASCII-safe fallback plus an RFC 5987
    ``filename*`` that every current browser prefers.
    """
    ascii_stem = (
        unicodedata.normalize("NFKD", stem)
        .encode("ascii", "ignore")
        .decode("ascii")
        .strip()
    )
    ascii_stem = re.sub(r"\s+", " ", ascii_stem) or "Resume"
    return (
        f'attachment; filename="{ascii_stem}.docx"; '
        f"filename*=UTF-8''{quote(stem + '.docx', safe='')}"
    )


async def _source(
    body: ExportRequest, user: CurrentUser, session: Session
) -> tuple[str, str]:
    """The markdown to render and its default filename stem."""
    if body.content_markdown:
        return body.content_markdown, "Resume"
    if body.resume_id:
        model = BaseResume if body.kind == "base" else TailoredResume
        row = await session.scalar(
            select(model).where(model.id == body.resume_id, model.user_id == user.id)
        )
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found"
            )
        return row.content_markdown, row.display_name
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Supply either resume_id or content_markdown",
    )


def _options(body: ExportRequest) -> ExportOptions:
    return ExportOptions(profile=RenderProfile(body.profile), page=PageSize(body.page))


@router.post(
    "/docx",
    responses={200: {"content": {DOCX_MIME: {}}, "description": "The .docx file"}},
)
async def export_docx(
    body: ExportRequest, user: CurrentUser, session: Session
) -> Response:
    """Render a stored resume, or unsaved markdown, to .docx.

    The extension's tailor-and-download flow uses the raw-markdown path: at
    that point nothing has been saved, by design.
    """
    content_markdown, default_name = await _source(body, user, session)
    data = render_docx(parse_or_422(content_markdown), _options(body))

    stem = safe_filename(body.filename or default_name)
    if body.profile == "ats_plain":
        stem += "_ATS"
    return Response(
        content=data,
        media_type=DOCX_MIME,
        headers={
            "Content-Disposition": content_disposition(stem),
            "Content-Length": str(len(data)),
        },
    )


@router.post("/preview", response_model=PreviewOut)
async def export_preview(
    body: ExportRequest, user: CurrentUser, session: Session
) -> PreviewOut:
    """The same document as ``/docx``, as styled blocks the web app can draw.

    Accepts unsaved markdown so the editor can preview edits before saving.
    """
    content_markdown, _ = await _source(body, user, session)
    return render_preview(parse_or_422(content_markdown), _options(body))
