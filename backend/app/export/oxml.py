"""Raw OOXML helpers.

The single most important rule in this module: element order inside
``w:pPr`` / ``w:tblPr`` is schema-enforced. A bare ``append`` produces XML that
Word tolerates but LibreOffice silently DROPS - and LibreOffice is the PDF
renderer, so a dropped border becomes an invisible, untraceable style bug.
Everything below inserts at the schema-correct position.
"""

from __future__ import annotations

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import RGBColor

# CT_PPr child order (ECMA-376). w:pBdr sits after w:numPr and before w:shd.
_AFTER_PBDR = (
    "w:shd", "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap",
    "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN",
    "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind",
    "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
    "w:textDirection", "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl",
    "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange",
)

# CT_TblPr child order (ECMA-376), from w:tblBorders onwards. Each helper
# inserts before the first successor that is already present, so the three may
# be called in any order and still produce schema-valid XML.
_AFTER_TBLBORDERS = (
    "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook", "w:tblCaption",
    "w:tblDescription", "w:tblPrChange",
)
_AFTER_TBLLAYOUT = (
    "w:tblCellMar", "w:tblLook", "w:tblCaption", "w:tblDescription", "w:tblPrChange",
)
_AFTER_TBLCELLMAR = (
    "w:tblLook", "w:tblCaption", "w:tblDescription", "w:tblPrChange",
)


def set_bottom_border(
    paragraph_or_style, *, color: str = "BFBFBF", sz: int = 6, space: int = 2
) -> None:
    """Thin rule under a paragraph.

    ``sz`` is in EIGHTHS of a point, so 6 -> 0.75pt. ``space`` is the gap in
    points between the text baseline box and the rule.
    """
    pPr = _get_ppr(paragraph_or_style)
    for old in pPr.findall(qn("w:pBdr")):
        pPr.remove(old)
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(sz))
    bottom.set(qn("w:space"), str(space))
    bottom.set(qn("w:color"), color)
    pBdr.append(bottom)
    pPr.insert_element_before(pBdr, *_AFTER_PBDR)


def set_inner_horizontal_borders(
    table, *, color: str = "D9D9D9", sz: int = 4
) -> None:
    """Skills-table look: no outer frame, no vertical rules, thin row dividers."""
    tblPr = table._tbl.tblPr
    for old in tblPr.findall(qn("w:tblBorders")):
        tblPr.remove(old)
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "none")
        el.set(qn("w:sz"), "0")
        borders.append(el)
    inside_h = OxmlElement("w:insideH")
    inside_h.set(qn("w:val"), "single")
    inside_h.set(qn("w:sz"), str(sz))
    inside_h.set(qn("w:space"), "0")
    inside_h.set(qn("w:color"), color)
    borders.append(inside_h)
    tblPr.insert_element_before(borders, *_AFTER_TBLBORDERS)


def set_fixed_layout(table) -> None:
    """Without this, Word re-flows column widths and ignores w:tcW."""
    tblPr = table._tbl.tblPr
    for old in tblPr.findall(qn("w:tblLayout")):
        tblPr.remove(old)
    el = OxmlElement("w:tblLayout")
    el.set(qn("w:type"), "fixed")
    # NOT append: python-docx's default table already carries w:tblLook, which
    # must follow w:tblLayout. Appending puts them the wrong way round.
    tblPr.insert_element_before(el, *_AFTER_TBLLAYOUT)


def set_cell_margins(table, *, left: int = 0, right: int = 108) -> None:
    """Margins in twentieths of a point (dxa). Left 0 keeps labels flush."""
    tblPr = table._tbl.tblPr
    for old in tblPr.findall(qn("w:tblCellMar")):
        tblPr.remove(old)
    mar = OxmlElement("w:tblCellMar")
    for side, width in (("left", left), ("right", right)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(width))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tblPr.insert_element_before(mar, *_AFTER_TBLCELLMAR)


def force_font(style, name: str) -> None:
    """Set all four w:rFonts hints.

    Setting only ``w:ascii`` lets LibreOffice substitute a theme font for
    eastAsia/cs, which changes metrics and therefore the page count - a
    two-page resume silently becomes three in the PDF.
    """
    rPr = style.element.get_or_add_rPr()
    rFonts = rPr.get_or_add_rFonts()
    for attr in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
        rFonts.set(qn(attr), name)


def set_outline_level(paragraph, level: int) -> None:
    """Expose a heading to outline-aware extractors (used by the ATS profile)."""
    pPr = paragraph._p.get_or_add_pPr()
    for old in pPr.findall(qn("w:outlineLvl")):
        pPr.remove(old)
    el = OxmlElement("w:outlineLvl")
    el.set(qn("w:val"), str(level))
    pPr.insert_element_before(el, "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange")


def _get_ppr(obj):
    if hasattr(obj, "_p"):  # a Paragraph
        return obj._p.get_or_add_pPr()
    return obj.element.get_or_add_pPr()  # a ParagraphStyle


def hex_color(value: str) -> RGBColor:
    return RGBColor.from_string(value)
