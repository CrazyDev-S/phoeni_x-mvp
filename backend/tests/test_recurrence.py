"""Recurring meeting series: DST correctness and not destroying user work."""

from __future__ import annotations

from datetime import date, time
from zoneinfo import ZoneInfo

from app.core.timezone import local_to_utc
from app.models.calendar import MeetingSeries
from app.services.recurrence import _has_user_content, occurrences

ET = ZoneInfo("America/New_York")


def series(**kw) -> MeetingSeries:
    defaults = dict(
        title="Standup",
        recurrence_rule="FREQ=WEEKLY;BYDAY=MO",
        start_date=date(2026, 10, 5),
        start_time_local=time(10, 0),
        timezone_name="America/New_York",
        duration_min=30,
        excluded_dates=[],
        until_date=None,
    )
    return MeetingSeries(**{**defaults, **kw})


def test_weekly_rule_expands_on_the_right_weekday() -> None:
    days = occurrences(series(), through=date(2026, 11, 2))
    assert days[0] == date(2026, 10, 5)
    assert all(d.weekday() == 0 for d in days)


def test_exdates_are_skipped() -> None:
    s = series(excluded_dates=[date(2026, 10, 12)])
    assert date(2026, 10, 12) not in occurrences(s, through=date(2026, 11, 2))


def test_until_date_bounds_the_series() -> None:
    s = series(until_date=date(2026, 10, 19))
    assert max(occurrences(s, through=date(2026, 12, 1))) == date(2026, 10, 19)


def test_occurrences_keep_local_time_across_a_dst_boundary() -> None:
    """The whole reason expansion runs in local time rather than UTC.

    A weekly 10:00 ET standup must stay at 10:00 ET on both sides of the
    November transition - which means the stored UTC instants DIFFER.
    """
    before = local_to_utc(date(2026, 10, 26), time(10, 0))
    after = local_to_utc(date(2026, 11, 2), time(10, 0))

    assert before.hour == 14  # EDT, UTC-4
    assert after.hour == 15   # EST, UTC-5
    assert before.astimezone(ET).hour == after.astimezone(ET).hour == 10
    assert before.astimezone(ET).strftime("%Z") == "EDT"
    assert after.astimezone(ET).strftime("%Z") == "EST"


class _Meeting:
    def __init__(self, **kw):
        self.notes = kw.get("notes")
        self.preparation_notes = kw.get("preparation_notes")
        self.follow_ups = kw.get("follow_ups")


def test_user_content_protects_an_occurrence() -> None:
    """Regression: editing only the NOTES used to leave an occurrence
    unprotected, so changing the series rule deleted the user's work."""
    assert _has_user_content(_Meeting(preparation_notes="Bring the numbers")) is True
    assert _has_user_content(_Meeting(notes="Went well")) is True
    assert _has_user_content(_Meeting(follow_ups="Send the deck")) is True
    assert _has_user_content(_Meeting()) is False
    assert _has_user_content(_Meeting(notes="   ")) is False
