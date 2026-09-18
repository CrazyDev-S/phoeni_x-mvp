"""Render profiles and the style specification the carrier is built from."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from docx.shared import Inches


class RenderProfile(StrEnum):
    # Reproduces the reference PDF. For humans, email and portfolios.
    DESIGNED = "designed"
    # Single-column, no tables. For job-board upload forms, where Workday and
    # Taleo mangle tables and skills is exactly what keyword matching scores.
    ATS_PLAIN = "ats_plain"


class PageSize(StrEnum):
    LETTER = "letter"
    A4 = "a4"


PAGE_DIMS = {
    PageSize.LETTER: (Inches(8.5), Inches(11.0)),
    PageSize.A4: (Inches(8.268), Inches(11.693)),
}

NAVY = "1F3864"
GREY = "595959"
RULE_GREY = "BFBFBF"
TABLE_RULE_GREY = "D9D9D9"
BLACK = "000000"


@dataclass(frozen=True)
class StyleSpec:
    profile: RenderProfile = RenderProfile.DESIGNED
    page: PageSize = PageSize.LETTER
    font: str = "Calibri"

    body_pt: float = 10.0
    name_pt: float = 21.0
    tagline_pt: float = 11.0
    contact_pt: float = 9.5
    section_pt: float = 10.5
    context_pt: float = 9.0

    margin_in: float = 0.65
    bullet_indent_in: float = 0.20
    skills_label_in: float = 1.9

    name_color: str = NAVY
    tagline_color: str = GREY
    context_color: str = GREY
    section_color: str = BLACK

    justify_summary: bool = True
    section_rule: bool = True
    header_rule: bool = True
    skills_as_table: bool = True
    hyperlinks: bool = False

    @property
    def page_dims(self):
        return PAGE_DIMS[self.page]


def ats_spec(page: PageSize = PageSize.LETTER) -> StyleSpec:
    """The ATS variant differs in exactly the things parsers choke on."""
    return StyleSpec(
        profile=RenderProfile.ATS_PLAIN,
        page=page,
        body_pt=11.0,
        name_pt=18.0,
        tagline_pt=11.0,
        contact_pt=11.0,
        section_pt=11.0,
        context_pt=10.5,
        margin_in=0.7,
        name_color=BLACK,
        tagline_color=BLACK,
        context_color=BLACK,
        justify_summary=False,   # justification inserts wide gaps some
                                 # extractors read as column boundaries
        section_rule=False,      # a paragraph border can surface as a stray line
        header_rule=False,
        skills_as_table=False,   # the only table in the document, removed
    )


@dataclass(frozen=True)
class Tighten:
    """One rung of the fit-to-N-pages ladder."""

    space_after_delta: float = 0.0
    body_pt: float | None = None
    margin_in: float | None = None
    max_bullets_per_title: int | None = None


TIGHTEN_LADDER: list[Tighten] = [
    Tighten(),
    Tighten(space_after_delta=-1.0),
    Tighten(space_after_delta=-1.0, body_pt=9.5),
    Tighten(space_after_delta=-1.5, body_pt=9.5, margin_in=0.55),
    Tighten(space_after_delta=-1.5, body_pt=9.5, margin_in=0.55, max_bullets_per_title=4),
]


@dataclass
class ExportOptions:
    profile: RenderProfile = RenderProfile.DESIGNED
    page: PageSize = PageSize.LETTER
    tighten: Tighten = field(default_factory=Tighten)
    max_pages: int = 2

    def spec(self) -> StyleSpec:
        base = ats_spec(self.page) if self.profile is RenderProfile.ATS_PLAIN else StyleSpec(page=self.page)
        t = self.tighten
        if t.body_pt is None and t.margin_in is None:
            return base
        from dataclasses import replace

        return replace(
            base,
            body_pt=t.body_pt if t.body_pt is not None else base.body_pt,
            margin_in=t.margin_in if t.margin_in is not None else base.margin_in,
        )
