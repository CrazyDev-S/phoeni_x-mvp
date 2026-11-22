"""The style carrier.

All presentation lives in named styles on a base document; the renderer emits
structure only and assigns styles by name. The plan called for authoring the
carrier in Word, which is not available on this host, so it is built here from
a StyleSpec instead - reproducibly, and still openable and restyleable in Word
afterwards.

``validate_carrier`` runs at startup, not render time: a missing style should
fail the process, not silently produce a wrong document.
"""

from __future__ import annotations

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.shared import Inches, Pt

from app.remote.export.oxml import (
    force_font,
    hex_color,
    set_bottom_border,
    set_box_padding,
)
from app.remote.export.profiles import RULE_GREY, StyleSpec

# Every style the renderer is allowed to reference.
REQUIRED_STYLES = frozenset(
    {
        "ResumeName", "ResumeTagline", "ResumeContact", "ResumeAvailability",
        "ResumeSection", "ResumeBar", "ResumeBody", "ResumeSummary", "ResumeRole",
        "ResumeCompany", "ResumeContext", "ResumePromotion", "ResumeBullet",
        "ResumeSkillLine", "ResumeEduDegree", "ResumeEduDetail",
    }
)

# Length of the short accent bar under some headings.
BAR_LENGTH_IN = 0.55


class CarrierStyleError(RuntimeError):
    pass


def validate_carrier(doc) -> None:
    have = {s.name for s in doc.styles}
    if missing := REQUIRED_STYLES - have:
        raise CarrierStyleError(f"carrier is missing styles: {sorted(missing)}")


def build_carrier(spec: StyleSpec):
    """Create a base document carrying every named style and the page setup."""
    doc = Document()
    _page_setup(doc, spec)
    _document_defaults(doc, spec)

    add = _style_adder(doc)
    t, c = spec.template, spec.colors
    centre = WD_ALIGN_PARAGRAPH.CENTER if t and t.center else None
    banded = bool(t and t.band)

    add("ResumeName", size=spec.name_pt, bold=True, color=spec.name_color,
        space_after=1, align=centre)
    add("ResumeTagline", size=spec.tagline_pt, color=spec.tagline_color,
        space_after=3, align=centre)
    add("ResumeContact", size=spec.contact_pt, color=spec.contact_color,
        space_before=5 if banded else 0, space_after=3 if t and t.contact_cols else 2 if t else 0,
        line=1.0, align=centre)
    availability = add(
        "ResumeAvailability", size=spec.contact_pt, italic=True,
        color=spec.contact_color, space_before=2 if banded else 0,
        space_after=0 if banded else 8, line=1.0, align=centre,
    )
    if spec.header_rule:
        # The rule rides on the last header line rather than adding an empty
        # paragraph, so no extractor emits a stray blank line for it.
        set_bottom_border(availability, color=RULE_GREY, sz=6, space=6)

    rule = t.heading_rule if t else "full"
    section = add(
        "ResumeSection", size=spec.section_pt, bold=True, color=spec.section_color,
        space_before=12 if t else 10, space_after=1 if rule == "bar" else 4,
        keep_with_next=True, all_caps=t.heading_upper if t else True,
        align=WD_ALIGN_PARAGRAPH.CENTER if t and t.heading_center else None,
    )
    if t is None:
        if spec.section_rule:
            set_bottom_border(section, color=RULE_GREY, sz=6, space=2)
    elif rule == "full":
        set_bottom_border(section, color=c.fill, sz=12, space=3)
    elif rule == "tint":
        set_box_padding(section, fill=c.tint, pad_pt=3)

    bar = add("ResumeBar", size=2, space_after=6, line=1.0, keep_with_next=True)
    set_bottom_border(bar, color=c.fill if c else RULE_GREY, sz=24, space=0)
    bar.paragraph_format.right_indent = _content_width(spec) - Inches(BAR_LENGTH_IN)

    add("ResumeBody", size=spec.body_pt, space_after=3)
    summary = add("ResumeSummary", size=spec.body_pt, space_after=4)
    if spec.justify_summary:
        summary.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    role = add("ResumeRole", size=spec.body_pt, space_before=6, space_after=1,
               keep_with_next=True, keep_together=True)
    _right_tab(role, spec)

    add("ResumeCompany", size=spec.body_pt, space_after=1, keep_with_next=True)
    add("ResumeContext", size=spec.context_pt, italic=True, color=spec.context_color,
        space_after=3, keep_with_next=True, keep_together=True)
    add("ResumePromotion", size=spec.context_pt, italic=True,
        color=spec.context_color, space_after=3, keep_with_next=True)

    bullet = add("ResumeBullet", size=spec.body_pt, space_after=2, widow_control=True)
    _hanging_indent(bullet, Inches(spec.bullet_indent_in))

    skill = add("ResumeSkillLine", size=spec.body_pt, space_after=2)
    _hanging_indent(skill, Inches(spec.skills_label_in))

    add("ResumeEduDegree", size=spec.body_pt, bold=True, space_before=4, space_after=0,
        keep_with_next=True)
    add("ResumeEduDetail", size=spec.body_pt, space_after=2)

    validate_carrier(doc)
    return doc


def _style_adder(doc):
    from docx.enum.style import WD_STYLE_TYPE

    def add(
        name: str, *, size: float, bold: bool = False, italic: bool = False,
        color: str | None = None, space_before: float = 0, space_after: float = 0,
        line: float = 1.08, keep_with_next: bool = False, keep_together: bool = False,
        widow_control: bool = False, all_caps: bool = False,
        align: WD_ALIGN_PARAGRAPH | None = None,
    ):
        st = doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
        st.base_style = doc.styles["Normal"]
        st.quick_style = True
        f = st.font
        f.size = Pt(size)
        f.bold = bold
        f.italic = italic
        f.all_caps = all_caps
        if color:
            f.color.rgb = hex_color(color)
        pf = st.paragraph_format
        pf.space_before = Pt(space_before)
        pf.space_after = Pt(space_after)
        pf.line_spacing = line
        pf.keep_with_next = keep_with_next
        pf.keep_together = keep_together
        pf.widow_control = widow_control
        if align is not None:
            pf.alignment = align
        return st

    return add


def _page_setup(doc, spec: StyleSpec) -> None:
    width, height = spec.page_dims
    for s in doc.sections:
        s.page_width, s.page_height = width, height
        s.top_margin = s.bottom_margin = Inches(spec.margin_in)
        s.left_margin = s.right_margin = Inches(spec.margin_in)
        s.header_distance = s.footer_distance = Inches(0.3)


def _document_defaults(doc, spec: StyleSpec) -> None:
    normal = doc.styles["Normal"]
    normal.font.name = spec.font
    normal.font.size = Pt(spec.body_pt)
    force_font(normal, spec.font)
    pf = normal.paragraph_format
    pf.space_after = Pt(0)
    pf.line_spacing = 1.08


def _content_width(spec: StyleSpec) -> int:
    width, _ = spec.page_dims
    return width - Inches(spec.margin_in) * 2


def content_width(section) -> int:
    return section.page_width - section.left_margin - section.right_margin


def _right_tab(style, spec: StyleSpec) -> None:
    """Right-aligned tab stop at the right margin.

    A single tab against a declared stop is a formatting property, not the
    whitespace padding the generator prompt bans - and it degrades gracefully:
    an extractor that strips tabs still yields one coherent line. A two-cell
    table would degrade destructively.
    """
    style.paragraph_format.tab_stops.add_tab_stop(_content_width(spec), WD_TAB_ALIGNMENT.RIGHT)


def _hanging_indent(style, indent) -> None:
    pf = style.paragraph_format
    pf.left_indent = indent
    pf.first_line_indent = -indent
    pf.tab_stops.add_tab_stop(indent, WD_TAB_ALIGNMENT.LEFT)
