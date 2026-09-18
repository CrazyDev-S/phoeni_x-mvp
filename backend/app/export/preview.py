"""The web preview of a .docx export.

``PreviewRenderer`` runs the docx renderer's own section code and captures each
paragraph as a block instead of writing it, so content, order and wording
cannot drift from the download. Styles are read back off the built carrier -
the same named styles the .docx carries - rather than restated here.
"""

from __future__ import annotations

from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

from app.export.carrier import REQUIRED_STYLES, build_carrier
from app.export.docx_renderer import SECTION_TITLES, DocxRenderer
from app.export.profiles import TABLE_RULE_GREY, ExportOptions
from app.resume.document import Resume
from app.schemas.resume import (
    PreviewBlock,
    PreviewBorder,
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
        self._emit(resume)

        section = carrier.sections[0]
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
                date_color=self.spec.context_color,
                skills_label_pt=self.spec.skills_label_in * 72,
                # set_cell_margins(right=108) is in twentieths of a point;
                # set_inner_horizontal_borders(sz=4) in eighths.
                cell_right_margin_pt=108 / 20,
                table_rule_color=TABLE_RULE_GREY,
                table_rule_pt=4 / 8,
            ),
            styles={name: _style(carrier.styles[name]) for name in sorted(REQUIRED_STYLES)},
            blocks=self.blocks,
        )

    # -- primitives, captured instead of written ---------------------------

    def _p(self, text: str, style: str):
        self.blocks.append(PreviewBlock(kind="paragraph", style=style, text=text))

    def _heading(self, key: str) -> None:
        self._p(SECTION_TITLES[key], "ResumeSection")

    def _role_line(self, left: str, right: str, *, indent: bool = False):
        self.blocks.append(
            PreviewBlock(kind="role", style="ResumeRole", text=left, right=right or None)
        )

    def _bullet(self, text: str, *, first: bool) -> None:
        self.blocks.append(PreviewBlock(kind="bullet", style="ResumeBullet", text=text))

    def _skills_table(self, r: Resume) -> None:
        self.blocks.append(
            PreviewBlock(
                kind="skills_table",
                style="ResumeBody",
                rows=[PreviewSkillRow(label=c.label, value=c.value) for c in r.skills],
            )
        )

    def _skills_paragraphs(self, r: Resume) -> None:
        for cat in r.skills:
            self.blocks.append(
                PreviewBlock(
                    kind="skill_line", style="ResumeSkillLine", label=cat.label, text=cat.value
                )
            )


def _pt(length) -> float:
    return length.pt if length is not None else 0.0


def _style(style) -> PreviewStyle:
    font, pf = style.font, style.paragraph_format
    border = None
    ppr = style.element.pPr
    bottom = ppr.find(qn("w:pBdr") + "/" + qn("w:bottom")) if ppr is not None else None
    if bottom is not None and bottom.get(qn("w:val")) not in (None, "none", "nil"):
        border = PreviewBorder(
            color=bottom.get(qn("w:color")) or "000000",
            width_pt=int(bottom.get(qn("w:sz"), "4")) / 8,
            space_pt=float(bottom.get(qn("w:space"), "0")),
        )
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
        left_indent_pt=_pt(pf.left_indent),
        first_line_indent_pt=_pt(pf.first_line_indent),
        keep_with_next=bool(pf.keep_with_next),
        border_bottom=border,
    )


def render_preview(resume: Resume, options: ExportOptions | None = None) -> PreviewOut:
    return PreviewRenderer(options).render_preview(resume)
