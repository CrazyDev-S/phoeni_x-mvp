"""Text for Upwork's boxes, which take plain text only.

Markdown pasted there shows its asterisks to the client. The model writes
emphasis the way it reliably can - ``**bold**``, ``*italic*``, ``- `` bullets -
and ``from_markdown`` turns that into what a plain-text box can still show:
Unicode mathematical sans-serif letters, which render bold or italic anywhere,
and a real bullet. The web editor's style bar (apps/web/src/lib/text-styles.ts)
writes the same characters, so a draft and a hand edit look alike.
"""

from __future__ import annotations

import re


def _shift(upper: int, lower: int, digit: int | None) -> dict[int, int]:
    table = {ord("A") + i: upper + i for i in range(26)}
    table |= {ord("a") + i: lower + i for i in range(26)}
    if digit is not None:
        table |= {ord("0") + i: digit + i for i in range(10)}
    return table


_BOLD = _shift(0x1D5D4, 0x1D5EE, 0x1D7EC)
_ITALIC = _shift(0x1D608, 0x1D622, None)

_HEADING = re.compile(r"^[ \t]*#{1,6}[ \t]+(.+?)[ \t#]*$", re.M)
_BULLET = re.compile(r"^([ \t]*)[-*+][ \t]+", re.M)
_BOLD_RUN = re.compile(r"\*\*(?=\S)([^\n]+?)(?<=\S)\*\*")
_ITALIC_RUN = re.compile(r"(?<![*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![*\w])")


def bold(text: str) -> str:
    return text.translate(_BOLD)


def italic(text: str) -> str:
    return text.translate(_ITALIC)


def from_markdown(text: str) -> str:
    """``**x**`` → 𝘅, ``*x*`` → 𝘹, ``# x`` → a bold line, ``- x`` → ``• x``."""
    text = _HEADING.sub(lambda m: bold(m.group(1)), text)
    # Bullets before italics, so "* item" is read as a list, not emphasis.
    text = _BULLET.sub(r"\1• ", text)
    text = _BOLD_RUN.sub(lambda m: bold(m.group(1)), text)
    return _ITALIC_RUN.sub(lambda m: italic(m.group(1)), text)
