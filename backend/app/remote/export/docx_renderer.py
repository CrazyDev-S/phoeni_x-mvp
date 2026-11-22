"""Render the resume AST to .docx.

Two profiles share one renderer. DESIGNED draws one of the templates in
``templates.py``; ATS_PLAIN overrides exactly the things job-board parsers
choke on (the skills table, justified text, bordered headings, headers and
pictures) and ignores templates.
"""

from __future__ import annotations

import io
from contextlib import contextmanager

from docx.shared import Emu, Inches, Pt

from app.remote.export.carrier import build_carrier, content_width
from app.remote.export.icons import icon_png
from app.remote.export.oxml import (
    hex_color,
    set_cell_margins,
    set_cell_padding,
    set_fixed_layout,
    set_inner_horizontal_borders,
    set_outline_level,
    set_table_extent,
    shade_cell,
)
from app.remote.export.profiles import (
    TABLE_RULE_GREY,
    ExportOptions,
    StyleSpec,
)
from app.remote.export.templates import contact_icon_look, heading_icon_look
from app.remote.resume.document import Header, Resume

SECTION_TITLES = {
    "summary": "PROFESSIONAL SUMMARY",
    "skills": "TECHNICAL SKILLS",
    "experience": "PROFESSIONAL EXPERIENCE",
    "projects": "SELECTED PROJECTS",
    "education": "EDUCATION",
    "certifications": "CERTIFICATIONS",
    "languages": "LANGUAGES",
}

# A band of colour across the top of page one. Padding is in points; the web
# preview draws the same numbers.
BAND_PAD_TOP_PT = 26
BAND_PAD_BOTTOM_PT = 18
# Word and LibreOffice disagree about whether a table's indent is measured to
# its edge or to its text, so the band overshoots both sides of the page and
# the page clips it.
BAND_OVERSHOOT_IN = 0.15

# Between an icon and its text, and between one contact item and the next.
ICON_GAP = "\u2002"
ITEM_GAP = "\u2003\u2003"
# Average glyph width as a share of the font size, for deciding how many
# contact items fit on a line. Slightly generous, so a line never overflows.
AVG_CHAR_EM = 0.54
# Hanging indent for a wrapped contact line in a grid cell.
CONTACT_HANG_IN = 0.26


def contact_items(h: Header) -> list[tuple[str, str]]:
    """(icon, text) for the contact panel: email, phone, location, one link.

    The header can carry more (work preference, timezone, availability, further
    links); those stay in the resume data but are not printed here.
    """
    link = h.links[0].label if h.links else None
    items = [("mail", h.email), ("phone", h.phone), ("pin", h.location), ("link", link)]
    return [(icon, text) for icon, text in items if text]


def contact_lines(
    items: list[tuple[str, str]], width_pt: float, font_pt: float, *, icons: bool
) -> list[list[tuple[str, str]]]:
    """Pack whole contact items into lines that fit, in order.

    Left to flow, a row breaks wherever the text runs out - through a link, or
    between an icon and its words. Packing keeps each item in one piece and
    puts a long one alone on its line.
    """
    gap = 2 * font_pt  # ITEM_GAP
    icon = 1.35 * font_pt + 0.5 * font_pt if icons else 0

    def cost(item: tuple[str, str]) -> float:
        return icon + len(item[1]) * AVG_CHAR_EM * font_pt

    lines: list[list[tuple[str, str]]] = []
    used = 0.0
    for item in items:
        if lines and used + gap + cost(item) <= width_pt:
            lines[-1].append(item)
            used += gap + cost(item)
        else:
            lines.append([item])
            used = cost(item)
    return lines


class DocxRenderer:
    def __init__(self, options: ExportOptions | None = None) -> None:
        self.options = options or ExportOptions()
        self.spec: StyleSpec = self.options.spec()

    # -- public ------------------------------------------------------------

    def render(self, resume: Resume) -> bytes:
        doc = build_carrier(self.spec)
        self.doc = doc
        self.section = doc.sections[0]
        self._out = doc  # where paragraphs go; the band swaps in its own cell
        self._fresh_cell = False
        self._emit(resume)

        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    def _emit(self, resume: Resume) -> None:
        """Section order and content. Shared with the web preview, which
        overrides only the primitives below so it cannot drift from this."""
        self._header(resume)
        # A template lays its sections out in its own order; ATS keeps the
        # order the generator writes them in.
        t = self.spec.template
        order = t.sections if t else (
            "summary", "skills", "experience", "projects", "education", "certifications", "languages",
        )
        for name in order:
            getattr(self, f"_{name}")(resume)

    # -- sections ----------------------------------------------------------

    def _header(self, r: Resume) -> None:
        h = r.header
        t = self.spec.template
        if t is None:
            self._ats_header(h)
            return

        with self._band():
            self._p(h.name, "ResumeName")
            self._p(h.title, "ResumeTagline")
            self._contact(contact_items(h))

    def _ats_header(self, h: Header) -> None:
        self._p(h.name, "ResumeName")
        self._p(h.title, "ResumeTagline")

        # One field per line: parsers split a separator-packed row
        # inconsistently and scorers read it as an unstructured blob.
        for _, line in contact_items(h):
            self._p(line, "ResumeContact")

        # Always emitted, empty: it carries the rule under the header.
        self._p("", "ResumeAvailability")

    def _summary(self, r: Resume) -> None:
        if not r.summary:
            return
        self._heading("summary")
        self._p(r.summary, "ResumeSummary")

    def _skills(self, r: Resume) -> None:
        if not r.skills:
            return
        self._heading("skills")
        t = self.spec.template
        if not self.spec.skills_as_table:
            self._skills_paragraphs(r)
        elif t is not None and t.skills_cols:
            self._skills_grid(r)
        else:
            self._skills_table(r)

    def _experience(self, r: Resume) -> None:
        if not r.experience:
            return
        self._heading("experience")
        for exp in r.experience:
            single = exp.layout == "single"
            head = exp.company
            if loc := exp.location_label:
                head += f" — {loc}"
            if exp.work_mode:
                head += f" ({exp.work_mode})"

            # Single-title roles put the title and company together, exactly
            # like the reference document; promotion roles carry the company
            # tenure on the company line and dates on each title beneath.
            if single:
                t = exp.titles[0]
                self._titled_entry(t.title, head, str(t.dates))
            else:
                self._role_line(head, str(exp.total_tenure))

            if exp.context:
                self._p(exp.context, "ResumeContext")

            for t in exp.titles:
                if not single:
                    self._role_line(t.title, str(t.dates), indent=True)
                if t.promotion_note:
                    self._p(t.promotion_note, "ResumePromotion")
                self._bullets(t.bullets)

    def _projects(self, r: Resume) -> None:
        if not r.projects:
            return
        self._heading("projects")
        for p in r.projects:
            self._role_line(p.name, "")
            if p.context:
                self._p(p.context, "ResumeContext")
            self._bullets(p.bullets)

    def _education(self, r: Resume) -> None:
        if not r.education:
            return
        self._heading("education")
        for e in r.education:
            loc = ", ".join(x for x in (e.city, e.country) if x)
            if self.spec.template is None:
                self._p(e.degree, "ResumeEduDegree")
                detail = e.institution
                if loc:
                    detail += f" — {loc}"
                if e.year:
                    detail += f" · {e.year}"
                self._p(detail, "ResumeEduDetail")
            else:
                school = f"{e.institution} — {loc}" if loc else e.institution
                self._titled_entry(e.degree, school, str(e.year) if e.year else "")

    def _certifications(self, r: Resume) -> None:
        if not r.certifications:
            return
        self._heading("certifications")
        for c in r.certifications:
            parts = [c.name]
            if c.issuer:
                parts.append(c.issuer)
            if c.year:
                parts.append(str(c.year))
            self._p(" — ".join(parts), "ResumeBody")

    def _languages(self, r: Resume) -> None:
        if not r.languages:
            return
        self._heading("languages")
        self._p(
            "   ".join(f"{lang.name} — {lang.proficiency}" for lang in r.languages),
            "ResumeBody",
        )

    # -- entries -----------------------------------------------------------

    def _titled_entry(self, title: str, org: str, right: str) -> None:
        """A title and the organisation it was held at, with a date on the right.

        ATS keeps the single bold line. A template picks how the two sit:
        title first, organisation first, or the organisation on its own line.
        """
        t = self.spec.template
        if t is None:
            self._role_line(f"{title} — {org}", right)
        elif t.entry == "stacked":
            self._role_line(title, right)
            self._p(org, "ResumeCompany")
        elif t.entry == "company_first":
            self._role_line(org, right, rest=f", {title}")
        else:
            self._role_line(title, right, rest=f", {org}")

    # -- primitives --------------------------------------------------------

    def _new(self, style: str):
        """The next paragraph, in the band's cell while one is open."""
        if self._out is self.doc:
            return self.doc.add_paragraph(style=style)
        if self._fresh_cell:  # a table cell starts with one empty paragraph
            self._fresh_cell = False
            paragraph = self._out.paragraphs[0]
            paragraph.style = self.doc.styles[style]
            return paragraph
        return self._out.add_paragraph(style=style)

    def _p(self, text: str, style: str):
        p = self._new(style)
        p.add_run(text)
        return p

    def _heading(self, key: str) -> None:
        t = self.spec.template
        title = SECTION_TITLES[key]
        if t is None:
            p = self._new("ResumeSection")
            p.add_run(title)
            # Give outline-aware extractors something to key on, since the ATS
            # profile drops the visual rule.
            set_outline_level(p, 0)
            return

        p = self._new("ResumeSection")
        if look := heading_icon_look(t, self.spec.colors):
            self._icon(p, key, look, height_pt=t.heading_pt * 1.25)
            p.add_run(ICON_GAP)
        p.add_run(title if t.heading_upper else title.title())
        if t.heading_rule == "bar":
            self._p("", "ResumeBar")

    def _icon(self, paragraph, name: str, look, *, height_pt: float) -> None:
        picture = icon_png(name, look.style, look.fg, look.bg)
        shape = paragraph.add_run().add_picture(io.BytesIO(picture), height=Pt(height_pt))
        # python-docx omits the wrap distances, and LibreOffice then pads an
        # inline picture by 0.125in on every side.
        for edge in ("distT", "distB", "distL", "distR"):
            shape._inline.set(edge, "0")

    def _contact_rows(self, items: list[tuple[str, str]]) -> list[list[tuple[str, str]]]:
        width_pt = (self.spec.page_dims[0] - Inches(self.spec.margin_in) * 2) / 12700
        icons = self.spec.template.contact_icon is not None
        return contact_lines(items, width_pt, self.spec.contact_pt, icons=icons)

    def _contact(self, items: list[tuple[str, str]]) -> None:
        t = self.spec.template
        look = contact_icon_look(t, self.spec.colors)
        height = self.spec.contact_pt * 1.35

        def fill(paragraph, icon: str, text: str, *, hang: bool = False) -> None:
            if look:
                self._icon(paragraph, icon, look, height_pt=height)
                paragraph.add_run("\t" if hang else ICON_GAP)
            paragraph.add_run(text)

        if not t.contact_cols:
            for line in self._contact_rows(items):
                p = self._new("ResumeContact")
                for i, (icon, text) in enumerate(line):
                    if i:
                        p.add_run(ITEM_GAP)
                    fill(p, icon, text)
            return

        rows = -(-len(items) // t.contact_cols)
        table = self.doc.add_table(rows=rows, cols=t.contact_cols)
        table.autofit = False
        set_fixed_layout(table)
        set_cell_margins(table, left=0, right=108)
        width = Emu(content_width(self.section) // t.contact_cols)
        for i, (icon, text) in enumerate(items):
            cell = table.rows[i // t.contact_cols].cells[i % t.contact_cols]
            cell.width = width
            p = cell.paragraphs[0]
            p.style = self.doc.styles["ResumeContact"]
            if look:
                # Wrapped text lines up with the first word, not under the icon.
                p.paragraph_format.left_indent = Inches(CONTACT_HANG_IN)
                p.paragraph_format.first_line_indent = -Inches(CONTACT_HANG_IN)
            fill(p, icon, text, hang=True)

    @contextmanager
    def _band(self):
        """Everything emitted inside lands in a coloured band across page one.

        The band lives in the first-page header: that is the only construct
        both Word and LibreOffice will anchor to the very top edge and let
        the body flow beneath. (Per-section margins would also work in Word,
        but LibreOffice applies the first section's margins to the whole
        document.)
        """
        t = self.spec.template
        if t is None or t.band is None:
            yield
            return

        section = self.section
        section.different_first_page_header_footer = True
        section.header_distance = 0
        header = section.first_page_header
        header.is_linked_to_previous = False
        for p in list(header.paragraphs):
            p._p.getparent().remove(p._p)

        overshoot = Inches(BAND_OVERSHOOT_IN)
        page_w = section.page_width
        table = header.add_table(rows=1, cols=1, width=page_w + overshoot * 2)
        table.autofit = False
        set_fixed_layout(table)
        set_table_extent(
            table,
            width=round((page_w + overshoot * 2) / 635),
            indent=-round((section.left_margin + overshoot) / 635),
        )
        cell = table.rows[0].cells[0]
        cell.width = page_w + overshoot * 2
        shade_cell(cell, self.spec.colors.band)
        pad = round((section.left_margin + overshoot) / 635)
        set_cell_padding(
            cell, top=BAND_PAD_TOP_PT * 20, left=pad, bottom=BAND_PAD_BOTTOM_PT * 20, right=pad
        )

        # A header must end in a paragraph, not a table; keep it from adding height.
        tail = header.add_paragraph()
        tail.paragraph_format.space_after = Pt(0)
        tail.paragraph_format.line_spacing = Pt(1)

        self._out, self._fresh_cell = cell, True
        try:
            yield
        finally:
            self._out, self._fresh_cell = self.doc, False

    def _role_line(self, left: str, right: str, *, rest: str | None = None, indent: bool = False):
        """Bold left text with the date right-aligned on the SAME line.

        A single tab against the style's right-aligned stop - never space or
        tab padding, which collapses on conversion and parses as one run-on
        string.
        """
        p = self._new("ResumeRole")
        p.add_run(left).bold = True
        if rest:
            p.add_run(rest).italic = self.spec.rest_italic
        if right:
            p.add_run("\t")
            run = p.add_run(right)
            run.italic = self.spec.date_italic
            run.font.color.rgb = hex_color(self.spec.date_color)
        if indent:
            p.paragraph_format.left_indent = Pt(0)
        return p

    def _bullets(self, bullets: list[str]) -> None:
        limit = self.options.tighten.max_bullets_per_title
        items = bullets[:limit] if limit else bullets
        for i, text in enumerate(items):
            self._bullet(text, first=i == 0)

    def _bullet(self, text: str, *, first: bool) -> None:
        p = self._new("ResumeBullet")
        # A literal bullet lives in <w:t> and survives every extractor; an
        # auto-numbered glyph is absent from the text stream entirely.
        # The TAB (not a space) makes continuation lines align to the stop
        # independent of the glyph's advance width.
        p.add_run(f"{self.spec.bullet}\t{text}")
        if first:
            # Break the keep_with_next chain here so a long role block is
            # not shoved wholesale onto the next page.
            p.paragraph_format.keep_with_next = False

    # -- skills ------------------------------------------------------------

    def _skills_table(self, r: Resume) -> None:
        table = self.doc.add_table(rows=0, cols=2)
        table.autofit = False
        set_fixed_layout(table)
        set_inner_horizontal_borders(table, color=TABLE_RULE_GREY, sz=4)
        set_cell_margins(table, left=0, right=108)

        label_w = Inches(self.spec.skills_label_in)
        value_w = content_width(self.section) - label_w
        for cat in r.skills:
            row = table.add_row()
            for cell, width, text, bold in (
                (row.cells[0], label_w, cat.label, True),
                (row.cells[1], value_w, cat.value, False),
            ):
                # Width must be set per CELL; python-docx writes w:tcW there and
                # Word honours it only under fixed layout.
                cell.width = width
                p = cell.paragraphs[0]
                p.style = self.doc.styles["ResumeBody"]
                run = p.add_run(text)
                run.bold = bold

    def _skills_grid(self, r: Resume) -> None:
        """Each category as a labelled cell in a borderless grid."""
        cols = self.spec.template.skills_cols
        rows = -(-len(r.skills) // cols)
        table = self.doc.add_table(rows=rows, cols=cols)
        table.autofit = False
        set_fixed_layout(table)
        set_cell_margins(table, left=0, right=216)
        width = Emu(content_width(self.section) // cols)
        for i, cat in enumerate(r.skills):
            cell = table.rows[i // cols].cells[i % cols]
            cell.width = width
            label = cell.paragraphs[0]
            label.style = self.doc.styles["ResumeBody"]
            label.paragraph_format.space_after = Pt(0)
            label.add_run(cat.label).bold = True
            cell.add_paragraph(cat.value, style="ResumeBody").paragraph_format.space_after = Pt(5)

    def _skills_paragraphs(self, r: Resume) -> None:
        """ATS variant: no table, label and values in one hanging-indent line."""
        for cat in r.skills:
            p = self.doc.add_paragraph(style="ResumeSkillLine")
            p.add_run(f"{cat.label}: ").bold = True
            p.add_run(cat.value)


def render_docx(resume: Resume, options: ExportOptions | None = None) -> bytes:
    return DocxRenderer(options).render(resume)
