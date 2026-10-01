"""The bidding pipeline: one track per focused job, with an append-only history.

Stage changes made anywhere - the tracker, a proposal being submitted, a job
being promoted into maintenance - go through ``set_stage`` so the history and
the side effects (timestamps, the proposal's own status) cannot drift apart.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now
from app.models.calendar import Meeting
from app.models.enums import FreelanceTrackStage, MeetingStatus, ProposalStatus
from app.models.freelancing import (
    FreelanceJob,
    FreelanceJobTrack,
    FreelanceJobTrackEvent,
    Proposal,
)
from app.schemas.freelancing import (
    JobBrief,
    ProposalBrief,
    TrackDetail,
    TrackEventOut,
    TrackMeetingBrief,
    TrackOut,
    TrackSummary,
)

CLOSED_STAGES = {
    FreelanceTrackStage.HIRED,
    FreelanceTrackStage.DECLINED,
    FreelanceTrackStage.WITHDRAWN,
    FreelanceTrackStage.CLOSED,
}


async def ensure_track(session: AsyncSession, user_id: uuid.UUID, job: FreelanceJob) -> FreelanceJobTrack:
    track = await session.scalar(
        select(FreelanceJobTrack).where(
            FreelanceJobTrack.user_id == user_id, FreelanceJobTrack.job_id == job.id
        )
    )
    if track is None:
        track = FreelanceJobTrack(user_id=user_id, job_id=job.id, stage=FreelanceTrackStage.FOCUSED)
        session.add(track)
        await session.flush()
        session.add(
            FreelanceJobTrackEvent(
                track_id=track.id, from_stage=None, to_stage=FreelanceTrackStage.FOCUSED,
                reason="focused", actor="user",
            )
        )
    return track


async def get_track(session: AsyncSession, user_id: uuid.UUID, track_id: uuid.UUID) -> FreelanceJobTrack | None:
    return await session.scalar(
        select(FreelanceJobTrack).where(
            FreelanceJobTrack.id == track_id, FreelanceJobTrack.user_id == user_id
        )
    )


async def set_stage(
    session: AsyncSession,
    track: FreelanceJobTrack,
    stage: FreelanceTrackStage,
    *,
    reason: str | None = None,
    actor: str = "user",
) -> None:
    if stage is track.stage:
        return
    previous = track.stage
    session.add(
        FreelanceJobTrackEvent(
            track_id=track.id, from_stage=previous, to_stage=stage, reason=reason, actor=actor
        )
    )
    track.stage = stage
    now = utc_now()

    if stage is FreelanceTrackStage.SUBMITTED and track.submitted_at is None:
        track.submitted_at = now
    if stage in (FreelanceTrackStage.VIEWED, FreelanceTrackStage.INTERVIEWING) and track.client_replied_at is None:
        track.client_replied_at = now
    track.closed_at = now if stage in CLOSED_STAGES else None

    # The proposal says the same thing from its side.
    if track.proposal_id and stage in (
        FreelanceTrackStage.SUBMITTED,
        FreelanceTrackStage.VIEWED,
        FreelanceTrackStage.INTERVIEWING,
        FreelanceTrackStage.HIRED,
    ):
        proposal = await session.get(Proposal, track.proposal_id)
        if proposal is not None and proposal.status is not ProposalStatus.SUBMITTED:
            proposal.status = ProposalStatus.SUBMITTED
            proposal.submitted_at = proposal.submitted_at or track.submitted_at or now
    await session.flush()


async def summary(session: AsyncSession, user_id: uuid.UUID) -> TrackSummary:
    rows = await session.execute(
        select(FreelanceJobTrack.stage, func.count())
        .where(FreelanceJobTrack.user_id == user_id)
        .group_by(FreelanceJobTrack.stage)
    )
    counts = {stage.value: count for stage, count in rows}
    return TrackSummary(**counts, total=sum(counts.values()))


# Read column by column: validating the ORM row directly would also read its
# ``job`` relationship, which is a model object rather than the brief below.
TRACK_COLUMNS = (
    "id", "job_id", "proposal_id", "stage", "submitted_at", "bid_type", "bid_amount",
    "connects_spent", "client_replied_at", "next_action_at", "notes_markdown",
    "outcome_notes", "closed_at", "created_at", "updated_at",
)


def _job_brief(job: FreelanceJob) -> JobBrief:
    return JobBrief(
        id=job.id,
        title=job.title,
        url=job.url,
        job_type=job.job_type,
        budget_amount=float(job.budget_amount) if job.budget_amount is not None else None,
        hourly_min=float(job.hourly_min) if job.hourly_min is not None else None,
        hourly_max=float(job.hourly_max) if job.hourly_max is not None else None,
        client_country=(job.client or {}).get("country"),
        total_applicants=job.total_applicants,
        published_at=job.published_at,
        focused_at=job.focused_at,
        description=job.description,
        skills=list(job.skills or []),
    )


def _meeting_brief(meeting: Meeting) -> TrackMeetingBrief:
    return TrackMeetingBrief(
        id=meeting.id,
        title=meeting.title,
        starts_at=meeting.starts_at,
        ends_at=meeting.ends_at,
        status=meeting.status.value,
        conferencing_url=meeting.conferencing_url,
    )


async def describe(session: AsyncSession, tracks: Iterable[FreelanceJobTrack]) -> list[TrackOut]:
    """Rows with their job, proposal and next call, in three queries however many there are."""
    tracks = list(tracks)
    if not tracks:
        return []
    jobs = {
        job.id: job
        for job in await session.scalars(
            select(FreelanceJob).where(FreelanceJob.id.in_({t.job_id for t in tracks}))
        )
    }
    proposal_ids = {t.proposal_id for t in tracks if t.proposal_id}
    proposals = {}
    if proposal_ids:
        proposals = {
            p.id: p for p in await session.scalars(select(Proposal).where(Proposal.id.in_(proposal_ids)))
        }
    now = utc_now()
    next_meetings: dict[uuid.UUID, Meeting] = {}
    for meeting in await session.scalars(
        select(Meeting)
        .where(
            Meeting.freelance_track_id.in_({t.id for t in tracks}),
            Meeting.status == MeetingStatus.SCHEDULED,
            Meeting.starts_at >= now,
        )
        .order_by(Meeting.starts_at)
    ):
        next_meetings.setdefault(meeting.freelance_track_id, meeting)

    out: list[TrackOut] = []
    for track in tracks:
        job = jobs.get(track.job_id)
        if job is None:
            continue
        proposal = proposals.get(track.proposal_id) if track.proposal_id else None
        out.append(
            TrackOut(
                **{name: getattr(track, name) for name in TRACK_COLUMNS},
                job=_job_brief(job),
                proposal=ProposalBrief(
                    id=proposal.id,
                    status=proposal.status,
                    bid_type=proposal.bid_type,
                    bid_amount=float(proposal.bid_amount) if proposal.bid_amount is not None else None,
                    submitted_at=proposal.submitted_at,
                )
                if proposal
                else None,
                next_meeting=_meeting_brief(next_meetings[track.id])
                if track.id in next_meetings
                else None,
            )
        )
    return out


async def describe_one(session: AsyncSession, track: FreelanceJobTrack) -> TrackDetail:
    base = (await describe(session, [track]))[0]
    events = list(
        await session.scalars(
            select(FreelanceJobTrackEvent)
            .where(FreelanceJobTrackEvent.track_id == track.id)
            .order_by(FreelanceJobTrackEvent.occurred_at, FreelanceJobTrackEvent.id)
        )
    )
    meetings = list(
        await session.scalars(
            select(Meeting).where(Meeting.freelance_track_id == track.id).order_by(Meeting.starts_at)
        )
    )
    return TrackDetail(
        **base.model_dump(),
        events=[TrackEventOut.model_validate(e) for e in events],
        meetings=[_meeting_brief(m) for m in meetings],
    )
