"""Calendar.

Every stored instant is ``timestamptz``. The API takes and returns LOCAL
wall-clock plus an IANA zone, and derives the instant, so a meeting keeps its
wall-clock time across a DST boundary rather than sliding by an hour.
"""

from __future__ import annotations

import uuid
from datetime import date, time, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import CurrentUser, Session
from app.core.timezone import local_day_bounds, local_to_utc, to_display, utc_now
from app.models.application import ApplicationStage, JobApplication
from app.models.calendar import Meeting, MeetingSeries
from app.models.enums import MeetingStatus
from app.models.maintenance import MaintainedJob
from app.models.user import UserSettings
from app.schemas.tracking import CalendarMeetingOut, MeetingCreate, MeetingPatch, UpcomingOut
from app.services.tracking import describe_meetings, sync_stage

router = APIRouter(prefix="/meetings", tags=["calendar"])


async def _display_timezone(session: Session, user: CurrentUser) -> str:
    row = await session.get(UserSettings, user.id)
    return row.display_timezone if row else "America/New_York"


async def _owned(session: Session, user: CurrentUser, meeting_id: uuid.UUID) -> Meeting:
    row = await session.scalar(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user.id)
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return row


def _parse_hhmm(value: str) -> time:
    hh, mm = value.split(":")
    try:
        return time(int(hh), int(mm))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Invalid time {value!r}"
        ) from exc


async def _describe_one(session: Session, meeting: Meeting) -> CalendarMeetingOut:
    await session.flush()
    await session.refresh(meeting)
    return (await describe_meetings(session, [meeting]))[0]


@router.post("", response_model=CalendarMeetingOut, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    body: MeetingCreate, user: CurrentUser, session: Session
) -> CalendarMeetingOut:
    timezone_name = await _display_timezone(session, user)

    if body.stage_id:
        owns = await session.scalar(
            select(ApplicationStage.id)
            .join(JobApplication)
            .where(ApplicationStage.id == body.stage_id, JobApplication.user_id == user.id)
        )
        if owns is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stage not found")
    else:
        owns = await session.scalar(
            select(MaintainedJob.id).where(
                MaintainedJob.id == body.maintained_job_id,
                MaintainedJob.user_id == user.id,
            )
        )
        if owns is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    starts_at = local_to_utc(body.local_date, _parse_hhmm(body.local_time), timezone_name)
    row = Meeting(
        user_id=user.id,
        stage_id=body.stage_id,
        maintained_job_id=body.maintained_job_id,
        title=body.title,
        meeting_type=body.meeting_type,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(minutes=body.duration_min),
        display_timezone=timezone_name,
        location=body.location,
        conferencing_url=body.conferencing_url,
        agenda=body.agenda,
        preparation_notes=body.preparation_notes,
        reminder_minutes=body.reminder_minutes,
    )
    session.add(row)

    # Booking a stage's meeting moves the stage out of "pending", and the
    # denormalised column keeps the tracking table sortable without a join.
    if body.stage_id:
        await sync_stage(session, body.stage_id)

    return await _describe_one(session, row)


@router.get("", response_model=list[CalendarMeetingOut])
async def list_meetings(
    user: CurrentUser,
    session: Session,
    from_: date = Query(alias="from"),
    to: date = Query(),
) -> list[CalendarMeetingOut]:
    """Meetings overlapping a local date range.

    Bounds are computed in Python because ``timestamptz AT TIME ZONE`` is
    STABLE, not IMMUTABLE, so it cannot be used in an index expression - a
    plain btree range scan on ``starts_at`` is both correct and fast.
    """
    timezone_name = await _display_timezone(session, user)
    start, _ = local_day_bounds(from_, timezone_name)
    _, end = local_day_bounds(to, timezone_name)
    rows = list(
        await session.scalars(
            select(Meeting)
            .where(
                Meeting.user_id == user.id,
                Meeting.starts_at >= start,
                Meeting.starts_at < end,
            )
            .order_by(Meeting.starts_at)
        )
    )
    return await describe_meetings(session, rows)


@router.get("/upcoming", response_model=list[UpcomingOut])
async def upcoming(
    user: CurrentUser, session: Session, limit: int = Query(default=10, le=50)
) -> list[UpcomingOut]:
    """The notification feed. Also backs the extension's top banner."""
    now = utc_now()
    rows = list(
        await session.scalars(
            select(Meeting)
            .where(
                Meeting.user_id == user.id,
                Meeting.status == MeetingStatus.SCHEDULED,
                Meeting.starts_at >= now,
            )
            .order_by(Meeting.starts_at)
            .limit(limit)
        )
    )
    return [
        UpcomingOut(
            meeting=m,
            company_name=m.company_name,
            role_title=m.role_title,
            stage_name=m.stage_name,
            kind=m.kind,
            starts_in_minutes=int((m.starts_at - now).total_seconds() // 60),
        )
        for m in await describe_meetings(session, rows)
    ]


@router.get("/next", response_model=UpcomingOut | None)
async def next_meeting(user: CurrentUser, session: Session) -> UpcomingOut | None:
    """The single next call, across applications and maintained jobs."""
    rows = await upcoming(user, session, limit=1)
    return rows[0] if rows else None


@router.patch("/{meeting_id}", response_model=CalendarMeetingOut)
async def update_meeting(
    meeting_id: uuid.UUID, body: MeetingPatch, user: CurrentUser, session: Session
) -> CalendarMeetingOut:
    row = await _owned(session, user, meeting_id)
    data = body.model_dump(exclude_unset=True)
    retimed = False

    if data.get("local_date") or data.get("local_time") or data.get("duration_min"):
        current_local = to_display(row.starts_at, row.display_timezone)
        new_date = data.get("local_date") or current_local.date()
        new_time = (
            _parse_hhmm(data["local_time"])
            if data.get("local_time")
            else current_local.time().replace(second=0, microsecond=0)
        )
        duration = data.get("duration_min") or int(
            (row.ends_at - row.starts_at).total_seconds() // 60
        )
        row.starts_at = local_to_utc(new_date, new_time, row.display_timezone)
        row.ends_at = row.starts_at + timedelta(minutes=duration)
        retimed = True
        if row.series_id:
            # An edited occurrence is protected from series regeneration: the
            # notes and timing on it are real work.
            row.is_exception = True

    for field in (
        "title", "meeting_type", "status", "location", "conferencing_url", "agenda",
        "preparation_notes", "notes", "reminder_minutes",
    ):
        if field in data:
            if field in ("title", "meeting_type", "status", "reminder_minutes") and data[field] is None:
                continue  # NOT NULL columns
            setattr(row, field, data[field])
            # Notes and prep are real user work, not just a reschedule. An
            # occurrence carrying them must survive a later change to the
            # series rule, so it is flagged here too - not only when the
            # time moves.
            if row.series_id and field in ("preparation_notes", "notes", "agenda", "title"):
                row.is_exception = True

    if row.stage_id and (retimed or data.get("status")):
        await sync_stage(session, row.stage_id, trigger=data.get("status"))

    return await _describe_one(session, row)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: uuid.UUID, user: CurrentUser, session: Session
) -> None:
    row = await _owned(session, user, meeting_id)
    if row.series_id and row.occurrence_local_date:
        # Deleting one occurrence of a series is an EXDATE, not a row delete -
        # otherwise the next materialisation pass puts it straight back.
        series = await session.get(MeetingSeries, row.series_id)
        if series is not None:
            series.excluded_dates = [*(series.excluded_dates or []), row.occurrence_local_date]
    stage_id = row.stage_id
    await session.delete(row)
    if stage_id:
        await sync_stage(session, stage_id)
