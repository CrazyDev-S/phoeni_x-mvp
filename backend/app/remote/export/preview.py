"""The web preview of a .docx export.

``PreviewRenderer`` runs the docx renderer's own section code and captures each
paragraph as a block instead of writing it, so content, order and wording
cannot drift from the download. Styles are read back off the built carrier -
the same named styles the .docx carries - rather than restated here.
"""

from __future__ import annotations

from contextlib import contextmanager

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

from app.remote.export.carrier import REQUIRED_STYLES, build_carrier
from app.remote.export.docx_renderer import (
    BAND_PAD_BOTTOM_PT,
    BAND_PAD_TOP_PT,
    CONTACT_HANG_IN,
    SECTION_TITLES,
    DocxRenderer,
)
from app.remote.export.profiles import TABLE_RULE_GREY, ExportOptions
from app.remote.export.templates import contact_icon_look, heading_icon_look
from app.remote.resume.document import Resume
from app.schemas.resume import (
    PreviewBlock,
    PreviewBorder,
    PreviewContactItem,
    PreviewIconLook,
    PreviewLayout,
    PreviewOut,
    PreviewSkillRow,
    PreviewStyle,
)

EMU_PER_PT = 12700


class PreviewRenderer(DocxRenderer):
    def render_preview(self, resume: Resume) -> PreviewOut:
        carrier = build_carrier(self.spec)
        self.blocks: list[PreviewBlock] = []
        self._region = "body"
        self._emit(resume)

        section = carrier.sections[0]
        spec, t = self.spec, self.spec.template
        contact = contact_icon_look(t, spec.colors) if t else None
        heading = heading_icon_look(t, spec.colors) if t else None
        return PreviewOut(
            profile=self.spec.profile.value,
            layout=PreviewLayout(
                font=self.spec.font,
                page_width_pt=section.page_width / EMU_PER_PT,
                page_height_pt=section.page_height / EMU_PER_PT,
                margin_top_pt=section.top_margin / EMU_PER_PT,
                margin_right_pt=section.right_margin / EMU_PER_PT,
                margin_bottom_pt=section.bottom_margin / EMU_PER_PT,
                margin_left_pt=section.left_margin / EMU_PER_PT,
                date_color=self.spec.date_color,
                skills_label_pt=self.spec.skills_label_in * 72,
                # set_cell_margins(right=108) is in twentieths of a point;
                # set_inner_horizontal_borders(sz=4) in eighths.
                cell_right_margin_pt=108 / 20,
                table_rule_color=TABLE_RULE_GREY,
                table_rule_pt=4 / 8,
                bullet=spec.bullet,
                date_italic=spec.date_italic,
                rest_italic=spec.rest_italic,
                skills_cols=t.skills_cols if t else 0,
                contact_cols=t.contact_cols if t else 0,
                contact_hang_pt=CONTACT_HANG_IN * 72,
                contact_icon=PreviewIconLook(**vars(contact)) if contact else None,
                heading_icon=PreviewIconLook(**vars(heading)) if heading else None,
                band_fill=spec.colors.band if t else None,
                band_pad_top_pt=BAND_PAD_TOP_PT,
                band_pad_bottom_pt=BAND_PAD_BOTTOM_PT,
            ),
            styles={name: _style(carrier.styles[name]) for name in sorted(REQUIRED_STYLES)},
            blocks=self.blocks,
        )

    # -- primitives, captured instead of written ---------------------------

    def _add(self, **fields) -> None:
        self.blocks.append(PreviewBlock(region=self._region, **fields))

    @contextmanager
    def _band(self):
        t = self.spec.template
        if t is None or t.band is None:
            yield
            return
        self._region = "band"
        try:
            yield
        finally:
            self._region = "body"

    def _p(self, text: str, style: str):
        self._add(kind="paragraph", style=style, text=text)

    def _heading(self, key: str) -> None:
        t = self.spec.template
        title = SECTION_TITLES[key]
        if t is None:
            self._add(kind="paragraph", style="ResumeSection", text=title)
            return
        self._add(
            kind="heading",
            style="ResumeSection",
            text=title if t.heading_upper else title.title(),
            icon=key if t.heading_icon else None,
        )
        if t.heading_rule == "bar":
            self._p("", "ResumeBar")

    def _contact(self, items: list[tuple[str, str]]) -> None:
        # A grid is one block; a flowing row is one block per packed line.
        groups = [items] if self.spec.template.contact_cols else self._contact_rows(items)
        for group in groups:
            self._add(
                kind="contact",
                style="ResumeContact",
                items=[PreviewContactItem(icon=i, text=t) for i, t in group],
            )

    def _role_line(self, left: str, right: str, *, rest: str | None = None, indent: bool = False):
        self._add(kind="role", style="ResumeRole", text=left, rest=rest, right=right or None)

    def _bullet(self, text: str, *, first: bool) -> None:
        self._add(kind="bullet", style="ResumeBullet", text=text)

    def _skills_table(self, r: Resume) -> None:
        self._add(
            kind="skills_table",
            style="ResumeBody",
            rows=[PreviewSkillRow(label=c.label, value=c.value) for c in r.skills],
        )

    def _skills_grid(self, r: Resume) -> None:
        self._add(
            kind="skills_grid",
            style="ResumeBody",
            rows=[PreviewSkillRow(label=c.label, value=c.value) for c in r.skills],
        )

    def _skills_paragraphs(self, r: Resume) -> None:
        for cat in r.skills:
            self._add(kind="skill_line", style="ResumeSkillLine", label=cat.label, text=cat.value)


def _pt(length) -> float:
    return length.pt if length is not None else 0.0


def _border(ppr, edge: str) -> PreviewBorder | None:
    el = ppr.find(qn("w:pBdr") + "/" + qn(f"w:{edge}")) if ppr is not None else None
    if el is None or el.get(qn("w:val")) in (None, "none", "nil"):
        return None
    return PreviewBorder(
        color=el.get(qn("w:color")) or "000000",
        width_pt=int(el.get(qn("w:sz"), "4")) / 8,
        space_pt=float(el.get(qn("w:space"), "0")),
    )


def _shading(ppr) -> str | None:
    el = ppr.find(qn("w:shd")) if ppr is not None else None
    fill = el.get(qn("w:fill")) if el is not None else None
    return fill if fill not in (None, "auto") else None


def _style(style) -> PreviewStyle:
    font, pf = style.font, style.paragraph_format
    ppr = style.element.pPr
    return PreviewStyle(
        size_pt=font.size.pt,
        bold=bool(font.bold),
        italic=bool(font.italic),
        all_caps=bool(font.all_caps),
        color=str(font.color.rgb) if font.color.type is not None else None,
        space_before_pt=_pt(pf.space_before),
        space_after_pt=_pt(pf.space_after),
        line_spacing=pf.line_spacing if isinstance(pf.line_spacing, float) else 1.0,
        justify=pf.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY,
        center=pf.alignment == WD_ALIGN_PARAGRAPH.CENTER,
        left_indent_pt=_pt(pf.left_indent),
        right_indent_pt=_pt(pf.right_indent),
        first_line_indent_pt=_pt(pf.first_line_indent),
        keep_with_next=bool(pf.keep_with_next),
        shading=_shading(ppr),
        border_top=_border(ppr, "top"),
        border_bottom=_border(ppr, "bottom"),
    )


def render_preview(resume: Resume, options: ExportOptions | None = None) -> PreviewOut:
    return PreviewRenderer(options).render_preview(resume)
