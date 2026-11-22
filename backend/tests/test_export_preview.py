"""The web preview must show exactly the document the .docx export writes."""

from __future__ import annotations

import io
import re
import uuid

import docx
import pytest
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.remote.export.docx_renderer import render_docx
from app.remote.export.preview import render_preview
from app.remote.export.profiles import ExportOptions, RenderProfile
from app.remote.export.templates import TEMPLATES, contrast_on_white
from app.remote.resume.parser import parse


def _norm(text: str) -> str:
    """Icon and title gaps are spacing, not content; the tab and the date are."""
    return re.sub(r"\s+", "", text)


def _preview_texts(preview) -> list[str]:
    """What each block says, in document order, one entry per docx paragraph."""
    out: list[str] = []
    for b in preview.blocks:
        if b.kind == "role":
            out.append(f"{b.text}{b.rest or ''}{b.right or ''}")
        elif b.kind == "bullet":
            out.append(f"{preview.layout.bullet}{b.text}")
        elif b.kind == "skill_line":
            out.append(f"{b.label}:{b.text}")
        elif b.kind in ("skills_table", "skills_grid"):
            out += [part for row in b.rows for part in (row.label, row.value)]
        elif b.kind == "contact":
            # A flowing row is one paragraph; a grid is one cell per item.
            texts = [item.text for item in b.items]
            out += texts if preview.layout.contact_cols else ["".join(texts)]
        else:
            out.append(b.text)
    return [n for n in map(_norm, out) if n]


def _docx_texts(document) -> list[str]:
    """Paragraphs in document order: the first-page header band, then the body."""
    out: list[str] = []

    def walk(container) -> None:
        for child in container._element.iterchildren():
            if child.tag == qn("w:p"):
                out.append(Paragraph(child, container).text)
            elif child.tag == qn("w:tbl"):
                for cell in Table(child, container)._cells:
                    for p in cell.paragraphs:
                        out.append(p.text)

    section = document.sections[0]
    if section.different_first_page_header_footer:
        walk(section.first_page_header)
    walk(document._body)
    return [n for n in map(_norm, out) if n]


@pytest.mark.parametrize(
    "options",
    [ExportOptions(profile=RenderProfile.ATS_PLAIN)]
    + [ExportOptions(template=key) for key in TEMPLATES],
    ids=["ats_plain", *TEMPLATES],
)
def test_blocks_match_docx_paragraphs(aran_markdown: str, options) -> None:
    resume = parse(aran_markdown)
    document = docx.Document(io.BytesIO(render_docx(resume, options)))
    preview = render_preview(resume, options)

    assert _preview_texts(preview) == _docx_texts(document)


def test_styles_come_from_the_carrier(aran_markdown: str) -> None:
    resume = parse(aran_markdown)
    modern = render_preview(resume, ExportOptions(template="modern", accent="3DD68C"))
    executive = render_preview(resume, ExportOptions(template="executive"))
    ats = render_preview(resume, ExportOptions(profile=RenderProfile.ATS_PLAIN))

    section = modern.styles["ResumeSection"]
    assert section.bold and section.all_caps
    assert section.border_bottom.color == "3DD68C" and section.border_bottom.width_pt == 1.5
    assert not modern.styles["ResumeSummary"].justify
    assert modern.layout.band_fill is None
    assert modern.layout.contact_icon.style == "chip"
    assert modern.layout.page_width_pt == pytest.approx(612, abs=0.1)
    assert modern.layout.margin_left_pt == pytest.approx(0.65 * 72, abs=0.1)

    # A tinted heading is centred on a shaded bar, over a coloured band.
    assert executive.styles["ResumeSection"].center
    assert executive.styles["ResumeSection"].shading is not None
    assert executive.layout.band_fill == "05607F"
    assert {b.region for b in executive.blocks} == {"band", "body"}

    assert ats.styles["ResumeSection"].border_bottom is None
    assert not ats.styles["ResumeSummary"].justify
    assert ats.styles["ResumeBody"].size_pt == 11
    assert ats.layout.band_fill is None and ats.layout.contact_icon is None


def test_the_accent_changes_the_colour_and_keeps_text_readable(aran_markdown: str) -> None:
    resume = parse(aran_markdown)
    sun = render_preview(resume, ExportOptions(template="clean", accent="FACC15"))
    heading = sun.styles["ResumeSection"]

    # The rule is the colour asked for; the words are darkened to read on white.
    assert heading.border_bottom.color == "FACC15"
    assert heading.color != "FACC15"
    assert contrast_on_white(heading.color) >= 4.5


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_preview_endpoint_accepts_unsaved_markdown(client, aran_markdown: str) -> None:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": f"preview-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}

    res = await client.post(
        "/api/v1/remote/export/preview", headers=headers, json={"content_markdown": aran_markdown}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["blocks"][0]["kind"] == "paragraph"
    assert body["blocks"][0]["style"] == "ResumeName"
    assert body["blocks"][0]["text"] == parse(aran_markdown).header.name

    res = await client.post(
        "/api/v1/remote/export/preview", headers=headers, json={"content_markdown": "not a resume"}
    )
    assert res.status_code == 422
