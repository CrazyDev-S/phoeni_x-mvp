"""Time handling.

Six rules keep the EST/EDT bug impossible:

1. Every stored instant is ``timestamptz`` (UTC on the wire).
2. We never store the strings "EST"/"EDT" - they are renderings, not zones.
   ``AT TIME ZONE 'EST'`` is a fixed -05:00 offset and is the classic bug.
3. The database connection is pinned to UTC.
4. Python datetimes are always timezone-aware.
5. The API speaks RFC3339 with an explicit offset in both directions.
6. Recurrence expands over local wall-clock in an IANA zone, then converts
   to UTC - never the other way around.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

DEFAULT_TZ_NAME = "America/New_York"


def zone(name: str = DEFAULT_TZ_NAME) -> ZoneInfo:
    return ZoneInfo(name)


def utc_now() -> datetime:
    """Always timezone-aware. Never ``datetime.utcnow()``."""
    return datetime.now(UTC)


def app_today(timezone_name: str = DEFAULT_TZ_NAME) -> date:
    """Today's date in the app's display zone, not the server's locale.

    ``date.today()`` reads the host timezone, which on a UTC server rolls over
    five hours early for an Eastern user - enough to make a gap check or a
    "future end date" check disagree with what the user sees.
    """
    return utc_now().astimezone(zone(timezone_name)).date()


def to_display(dt: datetime, timezone_name: str = DEFAULT_TZ_NAME) -> datetime:
    """Render a stored instant in the viewer's zone."""
    if dt.tzinfo is None:
        raise ValueError("refusing to convert a naive datetime")
    return dt.astimezone(zone(timezone_name))


def tz_abbreviation(dt: datetime, timezone_name: str = DEFAULT_TZ_NAME) -> str:
    """'EST' in January, 'EDT' in July - derived from the instant, never stored."""
    return to_display(dt, timezone_name).strftime("%Z")


def local_to_utc(
    local_date: date,
    local_time: time,
    timezone_name: str = DEFAULT_TZ_NAME,
) -> datetime:
    """Combine a local wall-clock date+time into a UTC instant.

    Handles the two DST edge cases explicitly:

    * Ambiguous (fall-back, e.g. 01:30 on 2026-11-01): take the first
      occurrence (``fold=0``).
    * Nonexistent (spring-forward, e.g. 02:30 on 2026-03-08): shift forward
      by the size of the gap.
    """
    timezone_name = zone(timezone_name)
    naive = datetime.combine(local_date, local_time)
    aware = naive.replace(tzinfo=timezone_name, fold=0)

    # A nonexistent local time round-trips to a different wall clock.
    round_tripped = aware.astimezone(UTC).astimezone(timezone_name)
    if round_tripped.replace(tzinfo=None) != naive:
        gap = round_tripped.utcoffset() - aware.utcoffset()  # type: ignore[operator]
        aware = (naive + gap).replace(tzinfo=timezone_name, fold=0)

    return aware.astimezone(UTC)


def local_day_bounds(
    day: date, timezone_name: str = DEFAULT_TZ_NAME
) -> tuple[datetime, datetime]:
    """UTC half-open range covering one local calendar day.

    Computed in Python rather than SQL because ``timestamptz AT TIME ZONE``
    is STABLE, not IMMUTABLE, so it cannot live in an expression index.
    Range predicates on ``starts_at`` use the plain btree index instead.
    """
    start = local_to_utc(day, time(0, 0), timezone_name)
    end = local_to_utc(day + timedelta(days=1), time(0, 0), timezone_name)
    return start, end
