"""What every job source's snapshot has in common.

A snapshot is the set of ``FreelanceJob`` column values a source produces for
one posting, with the provider's own record kept under ``raw``. Two things a
page needs are not columns: the screening questions and the posting's
activity. A source puts them in ``raw["extras"]`` in the shape ``extras``
returns; Upwork's own API keeps them in its fetched aggregate under
``raw["detail"]`` instead, and both are read here, once.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from dateutil import parser as date_parser

EXTRA_KEYS = (
    "screening_questions",
    "cover_letter_required",
    "activity",
    "qualification",
    "location_preference",
    "attachments",
    "on_site_type",
    "status",
)


def parse_instant(value: object) -> datetime | None:
    """An ISO-ish timestamp as an aware datetime; naive input is read as UTC."""
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = date_parser.isoparse(value)
    except (ValueError, OverflowError):
        try:
            parsed = date_parser.parse(value)
        except (ValueError, OverflowError):
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def extras(raw: dict | None) -> dict[str, Any]:
    """Screening questions, activity and the rest, from whichever source wrote ``raw``."""
    from app.freelancing.upwork.normalize import upwork_detail_extras

    raw = raw or {}
    out = upwork_detail_extras(raw)
    own = raw.get("extras")
    if isinstance(own, dict):
        for key in EXTRA_KEYS:
            value = own.get(key)
            if value in (None, [], {}):
                continue
            if isinstance(value, dict) and isinstance(out.get(key), dict):
                # Merge, so a source that knows one activity figure does not
                # blank out another the aggregate had.
                out[key] = {**out[key], **{k: v for k, v in value.items() if v is not None}}
            else:
                out[key] = value
    return out
