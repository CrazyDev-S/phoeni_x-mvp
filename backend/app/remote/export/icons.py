"""Icons for the designed templates, as small PNGs.

A .docx can only carry pictures, so each icon is the shared glyph mask
(``assets/icons``, rasterized from the same lucide shapes the web preview
draws - see scripts/resume-icons.mjs) recoloured and, for some templates,
set in a chip, disc or ring.
"""

from __future__ import annotations

import io
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).parent / "assets" / "icons"
SIZE = 96  # px; shown at roughly a sixth of an inch
SUPERSAMPLE = 4

# How much of the frame the glyph fills when it sits inside a shape.
GLYPH_IN_SHAPE = 0.58


def _rgb(hex_: str) -> tuple[int, int, int]:
    return tuple(int(hex_[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


@lru_cache(maxsize=None)
def _mask(name: str) -> Image.Image:
    return Image.open(ASSETS / f"{name}.png").convert("RGBA").getchannel("A")


def _glyph(name: str, color: str, fraction: float, canvas: int) -> Image.Image:
    """The glyph in ``color``, centred on a transparent canvas."""
    side = round(canvas * fraction)
    mask = _mask(name).resize((side, side), Image.LANCZOS)
    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    solid = Image.new("RGBA", (side, side), (*_rgb(color), 255))
    solid.putalpha(mask)
    offset = (canvas - side) // 2
    layer.paste(solid, (offset, offset), solid)
    return layer


@lru_cache(maxsize=512)
def icon_png(name: str, style: str, fg: str, bg: str | None = None) -> bytes:
    """``style``: glyph (bare), chip (rounded square in ``bg``), disc (circle
    in ``bg``) or ring (outlined circle in ``fg``)."""
    canvas = SIZE * SUPERSAMPLE
    if style == "glyph":
        image = _glyph(name, fg, 0.92, canvas)
    else:
        image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        box = (0, 0, canvas - 1, canvas - 1)
        if style == "chip":
            draw.rounded_rectangle(box, radius=canvas * 0.24, fill=(*_rgb(bg or fg), 255))
        elif style == "disc":
            draw.ellipse(box, fill=(*_rgb(bg or fg), 255))
        else:  # ring
            width = round(canvas * 0.07)
            draw.ellipse(box, outline=(*_rgb(fg), 255), width=width)
        glyph = _glyph(name, fg, GLYPH_IN_SHAPE, canvas)
        image = Image.alpha_composite(image, glyph)

    image = image.resize((SIZE, SIZE), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()
