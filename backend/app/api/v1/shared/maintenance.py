"""Post-hire job maintenance: the job, its recurring meetings, and prep notes."""

from __future__ import annotations

import uuid
from datetime import time

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import CurrentUser, Session
from app.models.application import JobApplication
from app.models.calendar import MeetingSeries
from app.models.enums import ApplicationStatus, FreelanceTrackStage
from app.models.freelancing import FreelanceJobTrack
from app.models.maintenance import MaintainedJob
from app.models.user import UserSettings
from app.schemas.tracking import (
    Category,
    MaintainedJobCreate,
    MaintainedJobOut,
    SeriesCreate,
    SeriesOut,
)
from app.shared.calendar.recurrence import materialize, rematerialize

router = APIRouter(prefix="/maintained-jobs", tags=["maintenance"])


async def _owned(session: Session, user: CurrentUser, job_id: uuid.UUID) -> MaintainedJob:
    row = await session.scalar(
        select(MaintainedJob).where(
            MaintainedJob.id == job_id, MaintainedJob.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return row


@router.post("", response_model=MaintainedJobOut, status_code=status.HTTP_201_CREATED)
async def create_maintained_job(
    body: MaintainedJobCreate, user: CurrentUser, session: Session
) -> MaintainedJob:
    """Promote a won application, or a won freelancing bid, into an ongoing job."""
    if body.job_application_id and body.freelance_track_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A maintained job comes from an application or a track, not both",
        )
    if body.freelance_track_id:
        track = await session.scalar(
            select(FreelanceJobTrack).where(
                FreelanceJobTrack.id == body.freelance_track_id,
                FreelanceJobTrack.user_id == user.id,
            )
        )
        if track is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
        from app.freelancing.services.tracking import set_stage

        await set_stage(session, track, FreelanceTrackStage.HIRED, reason="promoted to maintenance")
    if body.job_application_id:
        application = await session.scalar(
            select(JobApplication).where(
                JobApplication.id == body.job_application_id,
                JobApplication.user_id == user.id,
            )
        )
        if application is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Application not found"
            )
        application.status = ApplicationStatus.HIRED

    # A link decides the portal; a job added by hand takes the one it was added in.
    category = (
        "freelancing"
        if body.freelance_track_id
        else "remote"
        if body.job_application_id
        else body.category or "remote"
    )
    row = MaintainedJob(user_id=user.id, **{**body.model_dump(), "category": category})
    session.add(row)
    await session.flush()
    return row


@router.get("", response_model=list[MaintainedJobOut])
async def list_maintained_jobs(
    user: CurrentUser, session: Session, category: Category | None = Query(default=None)
) -> list[MaintainedJob]:
    query = select(MaintainedJob).where(MaintainedJob.user_id == user.id)
    if category:
        query = query.where(MaintainedJob.category == category)
    return list(await session.scalars(query.order_by(MaintainedJob.start_date.desc())))


@router.patch("/{job_id}", response_model=MaintainedJobOut)
async def update_maintained_job(
    job_id: uuid.UUID, body: dict, user: CurrentUser, session: Session
) -> MaintainedJob:
    row = await _owned(session, user, job_id)
    for field in ("employer_name", "role_title", "manager_name", "team",
                  "notes_markdown", "onboarding_notes", "status", "end_date"):
        if field in body:
            setattr(row, field, body[field])
    return row


@router.get("/{job_id}/series", response_model=list[SeriesOut])
async def list_series(
    job_id: uuid.UUID, user: CurrentUser, session: Session
) -> list[MeetingSeries]:
    await _owned(session, user, job_id)
    return list(
        await session.scalars(
            select(MeetingSeries).where(MeetingSeries.maintained_job_id == job_id)
        )
    )


@router.post(
    "/{job_id}/series", response_model=SeriesOut, status_code=status.HTTP_201_CREATED
)
async def create_series(
    job_id: uuid.UUID, body: SeriesCreate, user: CurrentUser, session: Session
) -> MeetingSeries:
    """Create a recurring meeting and materialise its first 90 days."""
    await _owned(session, user, job_id)
    settings = await session.get(UserSettings, user.id)
    hh, mm = body.start_time_local.split(":")

    row = MeetingSeries(
        user_id=user.id,
        maintained_job_id=job_id,
        title=body.title,
        meeting_type=body.meeting_type,
        recurrence_rule=body.recurrence_rule,
        start_date=body.start_date,
        start_time_local=time(int(hh), int(mm)),
        timezone_name=settings.display_timezone if settings else "America/New_York",
        duration_min=body.duration_min,
        conferencing_url=body.conferencing_url,
        agenda_template=body.agenda_template,
        preparation_template=body.preparation_template,
        until_date=body.until_date,
        excluded_dates=[],
    )
    session.add(row)
    await session.flush()
    await materialize(session, row)
    return row


@router.patch("/series/{series_id}", response_model=SeriesOut)
async def update_series(
    series_id: uuid.UUID, body: dict, user: CurrentUser, session: Session
) -> MeetingSeries:
    row = await session.scalar(
        select(MeetingSeries).where(
            MeetingSeries.id == series_id, MeetingSeries.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    rule_changed = False
    for field in ("title", "recurrence_rule", "duration_min", "is_active", "conferencing_url",
                  "agenda_template", "preparation_template", "until_date"):
        if field in body:
            rule_changed |= field in ("recurrence_rule", "duration_min", "until_date")
            setattr(row, field, body[field])
    if "start_time_local" in body:
        hh, mm = str(body["start_time_local"]).split(":")
        row.start_time_local = time(int(hh), int(mm))
        rule_changed = True

    await session.flush()
    if rule_changed:
        # Future generated occurrences are rebuilt; edited ones survive.
        await rematerialize(session, row)
    return row


@router.delete("/series/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_series(
    series_id: uuid.UUID, user: CurrentUser, session: Session
) -> None:
    row = await session.scalar(
        select(MeetingSeries).where(
            MeetingSeries.id == series_id, MeetingSeries.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    row.is_active = False  # keep history; stop generating
