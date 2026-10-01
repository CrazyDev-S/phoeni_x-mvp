"""Recurring meeting series.

The RRULE is the rule of record; occurrences are materialised as real
``meetings`` rows over a rolling horizon.

Neither pure approach works here. Expanding the rule on every read cannot be
indexed, sorted, or joined to per-occurrence preparation notes - and
per-occurrence notes are an explicit requirement. Pure materialisation loses
the editable rule. So we keep both, and reconcile.

Expansion runs over LOCAL wall-clock in the series' IANA zone and converts
each occurrence to UTC afterwards. Expanding in UTC would turn a weekly
10:00 ET standup into 09:00 or 11:00 on the far side of a DST boundary.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta

from dateutil.rrule import rrulestr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import app_today, local_to_utc
from app.models.calendar import Meeting, MeetingSeries
from app.models.enums import MeetingStatus

HORIZON_DAYS = 90


def occurrences(series: MeetingSeries, *, through: date) -> list[date]:
    """Local dates the rule fires on, up to and including ``through``."""
    start = datetime.combine(series.start_date, time(0, 0))
    end = datetime.combine(min(through, series.until_date or through), time(23, 59))
    if end < start:
        return []
    rule = rrulestr(series.recurrence_rule, dtstart=start)
    excluded = set(series.excluded_dates or [])
    return [d.date() for d in rule.between(start, end, inc=True) if d.date() not in excluded]


async def materialize(
    session: AsyncSession, series: MeetingSeries, *, horizon_days: int = HORIZON_DAYS
) -> int:
    """Create missing occurrence rows. Idempotent and safely re-runnable.

    The unique index on (series_id, occurrence_local_date) is what makes that
    true, so a double-run or an overlapping worker cannot duplicate a meeting.
    """
    if not series.is_active:
        return 0

    through = app_today(series.timezone_name) + timedelta(days=horizon_days)
    wanted = occurrences(series, through=through)
    if not wanted:
        series.materialized_through = through
        return 0

    existing = set(
        await session.scalars(
            select(Meeting.occurrence_local_date).where(Meeting.series_id == series.id)
        )
    )

    hh, mm = (series.start_time_local.hour, series.start_time_local.minute)
    created = 0
    for day in wanted:
        if day in existing:
            continue
        starts_at = local_to_utc(day, time(hh, mm), series.timezone_name)
        session.add(
            Meeting(
                user_id=series.user_id,
                maintained_job_id=series.maintained_job_id,
                series_id=series.id,
                occurrence_local_date=day,
                title=series.title,
                meeting_type=series.meeting_type,
                starts_at=starts_at,
                ends_at=starts_at + timedelta(minutes=series.duration_min),
                display_timezone=series.timezone_name,
                conferencing_url=series.conferencing_url,
                agenda=series.agenda_template,
                preparation_notes=series.preparation_template,
            )
        )
        created += 1

    series.materialized_through = through
    await session.flush()
    return created


async def rematerialize(session: AsyncSession, series: MeetingSeries) -> int:
    """Rebuild future occurrences after the rule changes.

    Occurrences a user has edited (``is_exception``) are preserved: their notes
    and status are real work, and silently regenerating over them would be data
    loss.
    """
    today = app_today(series.timezone_name)
    candidates = list(
        await session.scalars(
            select(Meeting).where(
                Meeting.series_id == series.id,
                Meeting.occurrence_local_date >= today,
                Meeting.is_exception.is_(False),
                Meeting.status == MeetingStatus.SCHEDULED,
            )
        )
    )
    for row in candidates:
        if _has_user_content(row):
            # Defence in depth: even if the exception flag was missed, an
            # occurrence holding notes is never silently destroyed.
            row.is_exception = True
            continue
        await session.delete(row)
    await session.flush()
    return await materialize(session, series)


def _has_user_content(meeting: Meeting) -> bool:
    return any(
        (getattr(meeting, field) or "").strip()
        for field in ("notes", "preparation_notes", "follow_ups")
    )


async def materialize_all(session: AsyncSession, user_id: uuid.UUID | None = None) -> int:
    stmt = select(MeetingSeries).where(MeetingSeries.is_active.is_(True))
    if user_id:
        stmt = stmt.where(MeetingSeries.user_id == user_id)
    total = 0
    for series in await session.scalars(stmt):
        total += await materialize(session, series)
    return total
