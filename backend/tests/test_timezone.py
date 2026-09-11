"""US Eastern handling, pinned to real DST transition dates."""

from __future__ import annotations

from datetime import UTC, date, datetime, time

from app.core.timezone import (
    local_day_bounds,
    local_to_utc,
    to_display,
    tz_abbreviation,
    utc_now,
)


def test_abbreviation_is_derived_not_stored() -> None:
    assert tz_abbreviation(local_to_utc(date(2026, 1, 5), time(10, 0))) == "EST"
    assert tz_abbreviation(local_to_utc(date(2026, 7, 5), time(10, 0))) == "EDT"


def test_standard_and_daylight_offsets() -> None:
    assert local_to_utc(date(2026, 1, 5), time(10, 0)).hour == 15  # EST = UTC-5
    assert local_to_utc(date(2026, 7, 5), time(10, 0)).hour == 14  # EDT = UTC-4


def test_ambiguous_local_time_takes_first_occurrence() -> None:
    """2026-11-01 01:30 happens twice; policy is fold=0, i.e. still EDT."""
    got = local_to_utc(date(2026, 11, 1), time(1, 30))
    assert got == datetime(2026, 11, 1, 5, 30, tzinfo=UTC)


def test_nonexistent_local_time_shifts_forward() -> None:
    """2026-03-08 02:30 never occurs; it must land at 03:30 EDT, not 01:30 EST."""
    got = local_to_utc(date(2026, 3, 8), time(2, 30))
    assert to_display(got).hour == 3
    assert got == datetime(2026, 3, 8, 7, 30, tzinfo=UTC)


def test_fall_back_day_is_25_hours_long() -> None:
    start, end = local_day_bounds(date(2026, 11, 1))
    assert (end - start).total_seconds() / 3600 == 25


def test_spring_forward_day_is_23_hours_long() -> None:
    start, end = local_day_bounds(date(2026, 3, 8))
    assert (end - start).total_seconds() / 3600 == 23


def test_utc_now_is_always_aware() -> None:
    assert utc_now().tzinfo is not None
