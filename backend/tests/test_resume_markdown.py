"""Resume Markdown dialect: parsing, the round-trip property, and parse-failure behaviour."""

from __future__ import annotations

import pytest

from app.resume.parser import ResumeMarkdownError, parse
from app.resume.renderer import render_plain_text, render_resume_markdown


def test_parses_reference_resume(aran_markdown: str) -> None:
    r = parse(aran_markdown)
    assert r.header.name == "Aran Thammasiri"
    assert len(r.skills) == 4
    assert len(r.experience) == 3
    assert [e.layout for e in r.experience] == ["single", "promotion", "single"]


def test_company_name_containing_parentheses(aran_markdown: str) -> None:
    """KBTG's own name has brackets; the work mode is still the LAST group."""
    kbtg = parse(aran_markdown).experience[2]
    assert kbtg.company == "KASIKORN Business-Technology Group (KBTG)"
    assert kbtg.work_mode == "On-site"
    assert (kbtg.city, kbtg.country) == ("Bangkok", "Thailand")


def test_promotion_block_nests_two_titles(aran_markdown: str) -> None:
    acc = parse(aran_markdown).experience[1]
    assert [t.title for t in acc.titles] == [
        "Senior Software Engineer",
        "Software Engineer",
    ]
    assert acc.titles[0].promotion_note.startswith("Promoted from")
    assert acc.titles[1].promotion_note is None
    assert str(acc.total_tenure) == "Aug 2020 – Oct 2023"


def test_roundtrip_is_identity(aran_markdown: str) -> None:
    """parse -> render -> parse must be a fixed point.

    This property is what makes markdown-canonical storage safe: the exporter
    reads back exactly what the editor wrote.
    """
    a1 = parse(aran_markdown)
    a2 = parse(render_resume_markdown(a1))
    a3 = parse(render_resume_markdown(a2))
    assert a1 == a2 == a3


def test_plain_text_contains_every_bullet(aran_markdown: str) -> None:
    r = parse(aran_markdown)
    text = render_plain_text(r)
    for e in r.experience:
        assert e.company in text
        for t in e.titles:
            for b in t.bullets:
                assert b in text
    for c in r.skills:
        for item in c.items:
            assert item in text


@pytest.mark.parametrize(
    ("mutation", "expect"),
    [
        ("## UNKNOWN SECTION\n\nhi", "unknown section"),
        ("## TECHNICAL SKILLS\n\n- Python, Go", "expected '- **Label**"),
        ("## LANGUAGES\n\n- Thai", "expected '- Language"),
    ],
)
def test_malformed_sections_raise(aran_markdown: str, mutation: str, expect: str) -> None:
    head = aran_markdown.split("## PROFESSIONAL SUMMARY")[0]
    with pytest.raises(ResumeMarkdownError) as exc:
        parse(head + mutation)
    assert expect in str(exc.value)


def test_parse_error_reports_line_and_state(aran_markdown: str) -> None:
    broken = aran_markdown.replace(
        "#### Senior Software Engineer · Dec 2023 – Present",
        "#### Senior Software Engineer (Dec 2023 - Present)",
    )
    with pytest.raises(ResumeMarkdownError) as exc:
        parse(broken)
    assert exc.value.line_no > 0
    assert exc.value.state == "PROFESSIONAL EXPERIENCE"


def test_missing_frontmatter_is_rejected() -> None:
    with pytest.raises(ResumeMarkdownError, match="missing '---' opener"):
        parse("## PROFESSIONAL SUMMARY\n\nhello")


def test_two_titles_require_a_company_tenure_line(aran_markdown: str) -> None:
    broken = aran_markdown.replace("**Aug 2020 – Oct 2023**\n", "")
    with pytest.raises(ResumeMarkdownError, match="needs a '\\*\\*tenure\\*\\*' line"):
        parse(broken)
