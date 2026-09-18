"""DOCX export: OOXML schema order, extractor survival, and profile differences."""

from __future__ import annotations

import io
import re
import zipfile

import docx2txt
import pytest

from app.export.docx_renderer import render_docx
from app.export.profiles import ExportOptions, RenderProfile
from app.resume.parser import parse

# ECMA-376 CT_TblPr child sequence.
TBLPR_SCHEMA_ORDER = [
    "tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize",
    "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd",
    "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption",
    "tblDescription", "tblPrChange",
]
# CT_PPr, from w:pBdr onwards.
PPR_SCHEMA_ORDER = [
    "pBdr", "shd", "tabs", "spacing", "ind", "contextualSpacing", "jc",
    "outlineLvl", "rPr",
]


def _parts(data: bytes) -> tuple[str, str]:
    z = zipfile.ZipFile(io.BytesIO(data))
    return z.read("word/document.xml").decode(), z.read("word/styles.xml").decode()


@pytest.fixture
def resume(aran_markdown: str):
    return parse(aran_markdown)


@pytest.fixture
def designed(resume) -> bytes:
    return render_docx(resume, ExportOptions(profile=RenderProfile.DESIGNED))


@pytest.fixture
def ats(resume) -> bytes:
    return render_docx(resume, ExportOptions(profile=RenderProfile.ATS_PLAIN))


def test_tblpr_children_are_in_schema_order(designed: bytes) -> None:
    """Regression: appending w:tblLayout put w:tblBorders after w:tblLook.

    Word tolerates that; LibreOffice silently DROPS the borders, so the bug is
    invisible until someone looks at a PDF.
    """
    doc, _ = _parts(designed)
    tblpr = re.search(r"<w:tblPr>.*?</w:tblPr>", doc, re.DOTALL).group(0)
    found = re.findall(r"<w:(\w+)", tblpr)[1:]  # skip the tblPr element itself
    idx = [TBLPR_SCHEMA_ORDER.index(t) for t in found if t in TBLPR_SCHEMA_ORDER]
    assert idx == sorted(idx), f"tblPr out of schema order: {found}"


def test_section_heading_border_precedes_spacing(designed: bytes) -> None:
    _, styles = _parts(designed)
    style = re.search(
        r'<w:style [^>]*w:styleId="ResumeSection".*?</w:style>', styles, re.DOTALL
    ).group(0)
    ppr = re.search(r"<w:pPr>.*?</w:pPr>", style, re.DOTALL).group(0)
    found = re.findall(r"<w:(\w+)", ppr)[1:]
    idx = [PPR_SCHEMA_ORDER.index(t) for t in found if t in PPR_SCHEMA_ORDER]
    assert idx == sorted(idx), f"pPr out of schema order: {found}"
    assert "<w:pBdr>" in ppr


def test_skills_table_has_inner_horizontal_borders_only(designed: bytes) -> None:
    doc, _ = _parts(designed)
    tblpr = re.search(r"<w:tblPr>.*?</w:tblPr>", doc, re.DOTALL).group(0)
    assert 'w:insideH w:val="single"' in tblpr
    assert tblpr.count('w:val="none"') == 5  # top/left/bottom/right/insideV
    assert 'w:tblLayout w:type="fixed"' in tblpr


def test_all_four_font_hints_are_set(designed: bytes) -> None:
    """Setting only w:ascii lets LibreOffice swap metrics and change page count."""
    _, styles = _parts(designed)
    normal = re.search(
        r'<w:style [^>]*w:styleId="Normal".*?</w:style>', styles, re.DOTALL
    ).group(0)
    rfonts = re.search(r"<w:rFonts[^/]*/>", normal).group(0)
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        assert attr in rfonts


def test_dates_use_a_real_tab_not_space_padding(designed: bytes) -> None:
    doc, _ = _parts(designed)
    assert "<w:tab/>" in doc
    # Space padding collapses on conversion and parses as one run-on string.
    assert not re.search(r"<w:t[^>]*>\s{4,}", doc)


def test_bullets_are_literal_glyphs_with_hanging_indent(designed: bytes) -> None:
    doc, styles = _parts(designed)
    assert "•\t" in doc or "•" in doc
    style = re.search(
        r'<w:style [^>]*w:styleId="ResumeBullet".*?</w:style>', styles, re.DOTALL
    ).group(0)
    assert re.search(r'<w:ind [^/]*w:hanging="\d+"', style)


def test_no_content_in_headers_or_footers(designed: bytes) -> None:
    """Many parsers drop header/footer content entirely."""
    names = zipfile.ZipFile(io.BytesIO(designed)).namelist()
    assert not [n for n in names if re.match(r"word/(header|footer)\d*\.xml", n)]


@pytest.mark.parametrize("profile", list(RenderProfile))
def test_naive_extractor_sees_every_word(resume, profile, tmp_path) -> None:
    """Simulate a dumb ATS: everything must survive to the text stream."""
    path = tmp_path / f"{profile.value}.docx"
    path.write_bytes(render_docx(resume, ExportOptions(profile=profile)))
    text = docx2txt.process(str(path))

    for e in resume.experience:
        assert e.company in text
        for t in e.titles:
            assert t.title in text
            for b in t.bullets:
                assert b in text
    for c in resume.skills:
        assert c.label in text
        for item in c.items:
            assert item in text
    assert resume.header.name in text
    assert resume.header.email in text


def test_ats_profile_removes_the_only_table(ats: bytes, designed: bytes) -> None:
    ats_doc, _ = _parts(ats)
    designed_doc, _ = _parts(designed)
    assert "<w:tbl>" in designed_doc
    assert "<w:tbl>" not in ats_doc


def test_ats_profile_does_not_justify(ats: bytes, designed: bytes) -> None:
    _, ats_styles = _parts(ats)
    _, designed_styles = _parts(designed)
    assert 'w:val="both"' in designed_styles   # justified
    assert 'w:val="both"' not in ats_styles


def test_ats_headings_carry_an_outline_level(ats: bytes) -> None:
    doc, _ = _parts(ats)
    assert "<w:outlineLvl" in doc


@pytest.mark.parametrize(
    ("case", "mutate"),
    [
        ("single role", lambda md: md.split("### Accenture")[0] + "\n## EDUCATION\n\n### B.Eng.\nX — Y · 2017\n"),
        ("no education", lambda md: md.split("## EDUCATION")[0]),
    ],
)
def test_structural_variants_render(aran_markdown: str, case: str, mutate) -> None:
    data = render_docx(parse(mutate(aran_markdown)))
    assert len(data) > 10_000, case


class TestContentDisposition:
    """Resume names routinely contain em dashes; HTTP headers are latin-1 only."""

    def test_non_ascii_name_does_not_raise(self) -> None:
        from app.api.v1.exports import content_disposition, safe_filename

        for name in (
            "Senior AI Fullstack — Python/FastAPI",
            "Résumé Ω 日本語",
            "plain name",
        ):
            header = content_disposition(safe_filename(name))
            header.encode("latin-1")  # this is what Starlette does
            assert "filename*=UTF-8''" in header

    def test_ascii_fallback_is_always_present(self) -> None:
        from app.api.v1.exports import content_disposition

        header = content_disposition("日本語だけ")
        assert 'filename="Resume.docx"' in header

    def test_path_traversal_is_stripped(self) -> None:
        from app.api.v1.exports import safe_filename

        assert "/" not in safe_filename("../../etc/passwd")
        assert ".." not in safe_filename("../../etc/passwd")
