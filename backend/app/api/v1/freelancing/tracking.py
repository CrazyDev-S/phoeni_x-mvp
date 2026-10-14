"""Phase 3: tracking focused jobs through the bidding pipeline."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import CurrentUser, Session
from app.core.timezone import utc_now
from app.freelancing.services import tracking
from app.freelancing.services.tracking import CLOSED_STAGES
from app.models.enums import FreelanceTrackStage
from app.models.freelancing import FreelanceJob, FreelanceJobTrack, Proposal
from app.models.maintenance import MaintainedJob
from app.schemas.freelancing import TrackDetail, TrackOut, TrackPatch, TrackSummary
from app.schemas.tracking import MaintainedJobOut

router = APIRouter(prefix="/tracks", tags=["freelancing: tracking"])


async def _owned(session: Session, user: CurrentUser, track_id: uuid.UUID) -> FreelanceJobTrack:
    row = await tracking.get_track(session, user.id, track_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
    return row


@router.get("/summary", response_model=TrackSummary)
async def summary(user: CurrentUser, session: Session) -> TrackSummary:
    return await tracking.summary(session, user.id)


@router.get("", response_model=list[TrackOut])
async def list_tracks(
    user: CurrentUser,
    session: Session,
    stage: FreelanceTrackStage | None = Query(default=None),
    include_closed: bool = Query(default=True),
) -> list[TrackOut]:
    """The board. Every row carries its job, proposal and next call."""
    stmt = select(FreelanceJobTrack).where(FreelanceJobTrack.user_id == user.id)
    if stage:
        stmt = stmt.where(FreelanceJobTrack.stage == stage)
    elif not include_closed:
        stmt = stmt.where(FreelanceJobTrack.stage.not_in(CLOSED_STAGES))
    rows = list(await session.scalars(stmt.order_by(FreelanceJobTrack.updated_at.desc())))
    return await tracking.describe(session, rows)


@router.get("/{track_id}", response_model=TrackDetail)
async def get_track(track_id: uuid.UUID, user: CurrentUser, session: Session) -> TrackDetail:
    return await tracking.describe_one(session, await _owned(session, user, track_id))


@router.patch("/{track_id}", response_model=TrackDetail)
async def update_track(
    track_id: uuid.UUID, body: TrackPatch, user: CurrentUser, session: Session
) -> TrackDetail:
    row = await _owned(session, user, track_id)
    data = body.model_dump(exclude_unset=True, exclude={"stage", "reason"})
    if "proposal_id" in data and data["proposal_id"] is not None:
        owns = await session.scalar(
            select(Proposal.id).where(
                Proposal.id == data["proposal_id"],
                Proposal.user_id == user.id,
                Proposal.job_id == row.job_id,
            )
        )
        if owns is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found for this job"
            )
    for field, value in data.items():
        setattr(row, field, value)
    if body.stage is not None:
        await tracking.set_stage(session, row, body.stage, reason=body.reason)
    await session.flush()
    return await tracking.describe_one(session, row)


@router.delete("/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_track(track_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    """Stop tracking. The job snapshot stays, unfocused; proposals stay with it."""
    row = await _owned(session, user, track_id)
    job = await session.get(FreelanceJob, row.job_id)
    if job is not None:
        job.focused_at = None
    await session.delete(row)


@router.post("/{track_id}/promote", response_model=MaintainedJobOut, status_code=status.HTTP_201_CREATED)
async def promote_to_maintenance(
    track_id: uuid.UUID, user: CurrentUser, session: Session
) -> MaintainedJob:
    """A won bid becomes a maintained job in the shared Job Maintenance tool."""
    row = await _owned(session, user, track_id)
    job = await session.get(FreelanceJob, row.job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    existing = await session.scalar(
        select(MaintainedJob).where(MaintainedJob.freelance_track_id == row.id)
    )
    if existing is not None:
        return existing
    await tracking.set_stage(session, row, FreelanceTrackStage.HIRED, reason="promoted to maintenance")
    maintained = MaintainedJob(
        user_id=user.id,
        freelance_track_id=row.id,
        category="freelancing",
        employer_name=(job.client or {}).get("company_name") or "Upwork client",
        role_title=job.title,
        start_date=date.fromisoformat(utc_now().date().isoformat()),
        employment_type="contract",
        onboarding_notes=f"Won on Upwork: {job.url}" if job.url else "Won on Upwork",
    )
    session.add(maintained)
    await session.flush()
    return maintained
