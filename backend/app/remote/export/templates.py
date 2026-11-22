"""The resume templates: a design is a small spec plus one accent colour.

Everything that varies between the looks lives here as data. The carrier turns
a spec into named styles, the renderer branches on the few structural switches
(band, icons, heading rule, entry layout, skills layout), and the web preview
reads the result back - so a template cannot look different in the preview,
the .docx and the PDF.

The ATS profile ignores templates entirely.
"""

from __future__ import annotations

import colorsys
from dataclasses import dataclass
from typing import Literal

INK = "1A1A1A"
MUTED = "595959"
WHITE = "FFFFFF"
DARK_BAND = "333333"

# The order the sample designs lay their sections out in. Projects, when
# there are any, follow experience.
SECTIONS = ("summary", "experience", "projects", "education", "skills", "languages", "certifications")

# Colour roles a template points at; resolved against the chosen accent.
Role = Literal["ink", "accent", "white"]


@dataclass(frozen=True)
class Template:
    key: str
    label: str
    font: str  # a face Word and LibreOffice both have (or a metric twin of)
    accent: str  # the default accent; the user can pick another

    # -- header
    band: Literal["accent", "dark"] | None = None
    center: bool = False
    name_pt: float = 24.0
    title_pt: float = 14.0
    name_color: Role = "ink"
    title_color: Role = "ink"
    contact_icon: Literal["chip", "disc", "ring", "glyph"] | None = None
    contact_icon_color: Role = "accent"
    contact_cols: int = 0  # 0 = one flowing row

    # -- section headings
    heading_upper: bool = True
    heading_center: bool = False
    heading_icon: bool = False
    heading_rule: Literal["full", "bar", "tint"] = "full"
    heading_color: Role = "ink"
    heading_pt: float = 11.0

    sections: tuple[str, ...] = SECTIONS

    # -- entries
    entry: Literal["inline", "stacked", "company_first"] = "inline"
    date_color: Role = "ink"
    bullet: str = "•"
    skills_cols: int = 0  # 0 = label | values table


@dataclass(frozen=True)
class Colors:
    """A template's roles resolved against one accent."""

    ink: str
    muted: str
    fill: str  # the accent as chosen: rules, chips, bands
    text: str  # the accent made dark enough to read on white
    tint: str  # a whisper of the accent, for tinted bars
    band: str | None
    on_band: str  # text colour on the band

    def role(self, role: Role, *, on_band: bool = False) -> str:
        if role == "white":
            return WHITE
        if role == "accent":
            return self.fill if on_band else self.text
        return self.ink


def _rgb(hex_: str) -> tuple[float, float, float]:
    return tuple(int(hex_[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def _hex(rgb: tuple[float, float, float]) -> str:
    return "".join(f"{round(max(0.0, min(1.0, c)) * 255):02X}" for c in rgb)


def _luminance(hex_: str) -> float:
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(c) for c in _rgb(hex_))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_on_white(hex_: str) -> float:
    return 1.05 / (_luminance(hex_) + 0.05)


def readable(hex_: str, minimum: float = 4.5) -> str:
    """Darken until the colour reads on white, keeping its hue."""
    h, light, s = colorsys.rgb_to_hls(*_rgb(hex_))
    while contrast_on_white(_hex(colorsys.hls_to_rgb(h, light, s))) < minimum and light > 0.05:
        light -= 0.02
    return _hex(colorsys.hls_to_rgb(h, light, s))


def mix_white(hex_: str, amount: float) -> str:
    return _hex(tuple(c + (1 - c) * amount for c in _rgb(hex_)))  # type: ignore[arg-type]


def resolve(template: Template, accent: str | None) -> Colors:
    fill = (accent or template.accent).upper()
    band = {"accent": fill, "dark": DARK_BAND, None: None}[template.band]
    return Colors(
        ink=INK,
        muted=MUTED,
        fill=fill,
        text=readable(fill),
        tint=mix_white(fill, 0.92),
        band=band,
        on_band=WHITE,
    )


# The look of each thumbnail, in the order they are offered. The first is the
# default.
TEMPLATES: dict[str, Template] = {
    t.key: t
    for t in (
        Template(
            key="modern",
            label="Modern",
            font="Calibri",
            accent="3DD68C",
            name_pt=26,
            title_pt=15,
            contact_icon="chip",
            contact_icon_color="white",
            contact_cols=2,
            heading_pt=12,
        ),
        Template(
            key="executive",
            label="Executive",
            font="Arial",
            accent="05607F",
            band="accent",
            name_pt=26,
            title_pt=14,
            name_color="white",
            title_color="white",
            contact_icon="disc",
            contact_icon_color="accent",
            heading_center=True,
            heading_icon=True,
            heading_rule="tint",
            heading_color="accent",
            entry="stacked",
            date_color="accent",
            bullet="–",
            skills_cols=3,
        ),
        Template(
            key="bold",
            label="Bold",
            font="Calibri",
            accent="FACC15",
            band="dark",
            name_pt=28,
            title_pt=16,
            name_color="accent",
            title_color="accent",
            contact_icon="glyph",
            contact_icon_color="accent",
            heading_icon=True,
            heading_rule="bar",
            heading_pt=12,
            date_color="accent",
            skills_cols=3,
        ),
        Template(
            key="editorial",
            label="Editorial",
            font="Cambria",
            accent="4F46E5",
            band="accent",
            center=True,
            name_pt=24,
            title_pt=14,
            name_color="white",
            title_color="white",
            contact_icon="ring",
            contact_icon_color="white",
            heading_upper=False,
            heading_icon=True,
            heading_rule="bar",
            heading_color="accent",
            heading_pt=13,
            entry="company_first",
            skills_cols=3,
        ),
        Template(
            key="centered",
            label="Centered",
            font="Calibri",
            accent="A84B2F",
            center=True,
            name_pt=28,
            title_pt=15,
            name_color="accent",
            contact_icon="glyph",
            contact_icon_color="accent",
            heading_rule="bar",
            heading_color="accent",
            heading_pt=12,
        ),
        Template(
            key="clean",
            label="Clean",
            sections=("summary", "experience", "projects", "education", "certifications", "skills", "languages"),
            font="Arial",
            accent="1F7A70",
            name_pt=26,
            title_pt=15,
            name_color="accent",
            contact_icon="ring",
            contact_icon_color="accent",
            heading_upper=False,
            heading_icon=True,
            heading_color="accent",
            heading_pt=13,
            skills_cols=3,
        ),
        Template(
            key="corporate",
            label="Corporate",
            font="Calibri",
            accent="0F9B6B",
            center=True,
            name_pt=26,
            title_pt=15,
            name_color="accent",
            title_color="accent",
            contact_icon="glyph",
            contact_icon_color="ink",
            heading_icon=True,
            heading_color="accent",
            heading_pt=12,
            skills_cols=2,
        ),
    )
}

DEFAULT_TEMPLATE = "modern"

# Offered beside every template. Each template's own accent is in here.
PALETTE: list[tuple[str, str]] = [
    ("Mint", "3DD68C"),
    ("Emerald", "0F9B6B"),
    ("Teal", "1F7A70"),
    ("Ocean", "05607F"),
    ("Blue", "2563EB"),
    ("Indigo", "4F46E5"),
    ("Violet", "7C3AED"),
    ("Rose", "BE185D"),
    ("Terracotta", "A84B2F"),
    ("Amber", "D97706"),
    ("Sun", "FACC15"),
    ("Slate", "374151"),
]


def get_template(key: str | None) -> Template:
    return TEMPLATES.get(key or DEFAULT_TEMPLATE, TEMPLATES[DEFAULT_TEMPLATE])


@dataclass(frozen=True)
class IconLook:
    style: Literal["chip", "disc", "ring", "glyph"]
    fg: str
    bg: str | None = None


def contact_icon_look(template: Template, colors: Colors) -> IconLook | None:
    if template.contact_icon is None:
        return None
    banded = template.band is not None
    fg = colors.role(template.contact_icon_color, on_band=banded)
    bg = {"chip": colors.fill, "disc": WHITE}.get(template.contact_icon)
    return IconLook(template.contact_icon, fg, bg)


def heading_icon_look(template: Template, colors: Colors) -> IconLook | None:
    if not template.heading_icon:
        return None
    return IconLook("glyph", colors.role(template.heading_color))
