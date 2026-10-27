"""Whether a job description is a job posting at all.

The side panel reads the frame of a tab with the most text, and a frame the
page keeps hidden reads back as the source of its scripts: a reCAPTCHA widget
arrived as 36KB of base64 with the title "reCAPTCHA", and a feedback widget as
its login wall and JavaScript. The model rightly refuses to build a resume from
either - but only after the whole pipeline has been paid for, every repair pass
included. This check is free, and stops it at the door.

Deliberately coarse, so it never turns away a real posting. Measured over every
posting saved so far, real ones score 0.81 or more on prose share once HTML tags
are dropped (JSON-LD descriptions arrive as HTML); the two script pages scored
0.28 and 0.001.
"""

from __future__ import annotations

import html
import re
import unicodedata

from fastapi import HTTPException, status

# Below this share of characters in plain words, the text is code or data.
MIN_PROSE_SHARE = 0.5

_TAG = re.compile(r"<[^>]{0,400}>")
_EDGES = re.compile(r"^\W+|\W+$")
# An English word, or an acronym. camelCase and digits read as code.
_ASCII_WORD = re.compile(r"^(?:[A-Za-z][a-z]+(?:['’-][A-Za-z]+)*|[A-Z]{2,6}s?)$")


def posting_problem(text: str) -> str | None:
    """Why ``text`` cannot be a job posting, or None when it can."""
    tokens = html.unescape(_TAG.sub(" ", text)).split()
    chars = sum(map(len, tokens))
    if not chars:
        return "The job description is empty."
    if all(t.startswith(("http://", "https://", "www.")) for t in tokens):
        return "This is a link to the posting, not its text. Paste the job description itself."
    if sum(len(t) for t in tokens if _is_word(t)) / chars < MIN_PROSE_SHARE:
        return (
            "This is page code or encoded data, not a job posting - it was most likely "
            "read from a hidden widget on the page, such as a captcha. Open the posting "
            "itself, or paste its description."
        )
    return None


def require_posting(text: str) -> None:
    if problem := posting_problem(text):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "NOT_A_JOB_POSTING", "message": problem},
        )


def _is_word(token: str) -> bool:
    core = _EDGES.sub("", token)
    if not core:
        return False
    if core.isascii():
        return bool(_ASCII_WORD.match(core))
    # Any other script - Thai, Chinese, accented Latin. Thai and Chinese put no
    # spaces between words, so a token can be a whole phrase; it is still prose
    # when it is made of letters.
    letters = sum(unicodedata.category(c)[0] in "LM" for c in core)
    return letters >= 0.8 * len(core)
