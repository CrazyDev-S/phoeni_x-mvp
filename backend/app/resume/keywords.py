"""Whether a resume mentions a keyword, decided one way everywhere.

The ATS report and the coverage rule used to disagree: one matched on word
boundaries, the other on raw substrings, so "Go" counted as covered by
"Google" in one and not the other.
"""

from __future__ import annotations

import re


def contains_keyword(haystack: str, needle: str) -> bool:
    """Word-boundary match, so 'Go' does not match 'Django'."""
    if not needle.strip():
        return False
    return re.search(rf"(?<![A-Za-z0-9+#.]){re.escape(needle)}(?![A-Za-z0-9+#])",
                     haystack, re.IGNORECASE) is not None
