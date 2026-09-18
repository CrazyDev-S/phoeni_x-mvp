"""Render the resume AST to .docx.

Two profiles share one renderer. DESIGNED reproduces the reference PDF;
ATS_PLAIN overrides exactly the three things job-board parsers choke on
(the skills table, justified text, and bordered headings).
"""

from __future__ import annotations

import io

from docx.shared import Inches, Pt

from app.export.carrier import build_carrier, content_width
from app.export.oxml import (
    hex_color,
    set_cell_margins,
    set_fixed_layout,
    set_inner_horizontal_borders,
    set_outline_level,
)
from app.export.profiles import (
    TABLE_RULE_GREY,
    ExportOptions,
    RenderProfile,
    StyleSpec,
)
from app.resume.document import Resume

SECTION_TITLES = {
    "summary": "PROFESSIONAL SUMMARY",
    "skills": "TECHNICAL SKILLS",
    "experience": "PROFESSIONAL EXPERIENCE",
    "projects": "SELECTED PROJECTS",
    "education": "EDUCATION",
    "certifications": "CERTIFICATIONS",
    "languages": "LANGUAGES",
}


class DocxRenderer:
    def __init__(self, options: ExportOptions | None = None) -> None:
        self.options = options or ExportOptions()
        self.spec: StyleSpec = self.options.spec()

    # -- public ------------------------------------------------------------

    def render(self, resume: Resume) -> bytes:
        doc = build_carrier(self.spec)
        self.doc = doc
        self.section = doc.sections[0]
        self._emit(resume)

        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    def _emit(self, resume: Resume) -> None:
        """Section order and content. Shared with the web preview, which
        overrides only the primitives below so it cannot drift from this."""
        self._header(resume)
        self._summary(resume)
        self._skills(resume)
        self._experience(resume)
        self._projects(resume)
        self._education(resume)
        self._certifications(resume)
        self._languages(resume)

    # -- sections ----------------------------------------------------------

    def _header(self, r: Resume) -> None:
        h = r.header
        self._p(h.name, "ResumeName")
        self._p(h.title, "ResumeTagline")

        # One field per line: parsers split a separator-packed row
        # inconsistently and scorers read it as an unstructured blob.
        contact: list[str] = [h.location]
        if h.work_preference or h.timezone_note:
            contact.append(" · ".join(x for x in (h.work_preference, h.timezone_note) if x))
        contact += [x for x in (h.phone, h.email) if x]
        contact += [link.label for link in h.links]
        for line in contact:
            self._p(line, "ResumeContact")

        # The header rule lives on this paragraph's style, so an availability
        # line is always emitted - it carries the rule even when empty.
        self._p(h.availability or "", "ResumeAvailability")

    def _summary(self, r: Resume) -> None:
        if not r.summary:
            return
        self._heading("summary")
        self._p(r.summary, "ResumeSummary")

    def _skills(self, r: Resume) -> None:
        if not r.skills:
            return
        self._heading("skills")
        if self.spec.skills_as_table:
            self._skills_table(r)
        else:
            self._skills_paragraphs(r)

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

    def _skills_paragraphs(self, r: Resume) -> None:
        """ATS variant: no table, label and values in one hanging-indent line."""
        for cat in r.skills:
            p = self.doc.add_paragraph(style="ResumeSkillLine")
            p.add_run(f"{cat.label}: ").bold = True
            p.add_run(cat.value)

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

            # Single-title roles put the title and company on one line, exactly
            # like the reference document; promotion roles carry the company
            # tenure on the company line and dates on each title beneath.
            if single:
                t = exp.titles[0]
                self._role_line(f"{t.title} — {head}", str(t.dates))
            else:
                self._role_line(head, str(exp.total_tenure))

            if exp.context:
                self._p(exp.context, "ResumeContext")

            for i, t in enumerate(exp.titles):
                if not single:
                    self._role_line(t.title, str(t.dates), indent=True)
                if t.promotion_note:
                    self._p(t.promotion_note, "ResumePromotion")
                self._bullets(t.bullets)
                if not single and i == 0:
                    pass

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
            self._p(e.degree, "ResumeEduDegree")
            loc = ", ".join(x for x in (e.city, e.country) if x)
            detail = e.institution
            if loc:
                detail += f" — {loc}"
            if e.year:
                detail += f" · {e.year}"
            self._p(detail, "ResumeEduDetail")

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

    # -- primitives --------------------------------------------------------

    def _heading(self, key: str) -> None:
        p = self.doc.add_paragraph(SECTION_TITLES[key], style="ResumeSection")
        if self.spec.profile is RenderProfile.ATS_PLAIN:
            # Give outline-aware extractors something to key on, since the ATS
            # profile drops the visual rule.
            set_outline_level(p, 0)

    def _p(self, text: str, style: str):
        return self.doc.add_paragraph(text, style=style)

    def _role_line(self, left: str, right: str, *, indent: bool = False):
        """Bold left text with the date right-aligned on the SAME line.

        A single tab against the style's right-aligned stop - never space or
        tab padding, which collapses on conversion and parses as one run-on
        string.
        """
        p = self.doc.add_paragraph(style="ResumeRole")
        p.add_run(left).bold = True
        if right:
            p.add_run("\t")
            run = p.add_run(right)
            run.italic = True
            run.font.color.rgb = hex_color(self.spec.context_color)
        if indent:
            p.paragraph_format.left_indent = Pt(0)
        return p

    def _bullets(self, bullets: list[str]) -> None:
        limit = self.options.tighten.max_bullets_per_title
        items = bullets[:limit] if limit else bullets
        for i, text in enumerate(items):
            self._bullet(text, first=i == 0)

    def _bullet(self, text: str, *, first: bool) -> None:
        p = self.doc.add_paragraph(style="ResumeBullet")
        # A literal bullet lives in <w:t> and survives every extractor; an
        # auto-numbered glyph is absent from the text stream entirely.
        # The TAB (not a space) makes continuation lines align to the stop
        # independent of the glyph's advance width.
        p.add_run(f"•\t{text}")
        if first:
            # Break the keep_with_next chain here so a long role block is
            # not shoved wholesale onto the next page.
            p.paragraph_format.keep_with_next = False


def render_docx(resume: Resume, options: ExportOptions | None = None) -> bytes:
    return DocxRenderer(options).render(resume)
