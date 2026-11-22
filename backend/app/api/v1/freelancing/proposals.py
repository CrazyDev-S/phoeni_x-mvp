"""Phase 2, the proposal half: proposals for focused postings, and the writer's versions of them.

``POST /generate`` queues one draft per instruction; the generation's events
say when it lands, as a version and in the proposal. Saving the proposal
(``PATCH``) records the whole version.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import CurrentUser, Session
from app.core.timezone import utc_now
from app.freelancing.proposals.engine import VERSION
from app.freelancing.proposals.versions import (
    delete_version,
    record_save,
    running_generation,
    versions,
)
from app.freelancing.services import jobs
from app.freelancing.services.tracking import ensure_track, set_stage, untrack
from app.llm.factory import get_provider
from app.llm.provider import MissingCredentialError
from app.models.enums import FreelanceTrackStage, GenerationKind, ProposalStatus
from app.models.freelancing import (
    FreelanceJob,
    FreelanceJobTrack,
    FreelancerProfile,
    Proposal,
    ProposalVersion,
)
from app.schemas.common import Page
from app.schemas.freelancing import (
    JobBrief,
    ProposalCreate,
    ProposalGenerated,
    ProposalGenerateIn,
    ProposalOut,
    ProposalPatch,
    ProposalVersionOut,
    ProposalVersions,
)
from app.services.generation import enqueue, idempotency_key

router = APIRouter(prefix="/proposals", tags=["freelancing: proposals"])


async def _owned(session: Session, user: CurrentUser, proposal_id: uuid.UUID) -> Proposal:
    row = await session.scalar(
        select(Proposal).where(Proposal.id == proposal_id, Proposal.user_id == user.id)
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proposal not found")
    return row


async def _job(session: Session, user: CurrentUser, job_id: uuid.UUID) -> FreelanceJob:
    row = await jobs.get_job(session, job_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return row


async def _profile(session: Session, user: CurrentUser, profile_id: uuid.UUID | None) -> FreelancerProfile | None:
    if profile_id is None:
        return None
    row = await session.scalar(
        select(FreelancerProfile).where(
            FreelancerProfile.id == profile_id, FreelancerProfile.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    return row


def _brief(job: FreelanceJob, focused_at: datetime | None = None) -> JobBrief:
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
        focused_at=focused_at,
        description=job.description,
        skills=list(job.skills or []),
    )


async def _out(session: Session, rows: list[Proposal]) -> list[ProposalOut]:
    """Proposals - always one user's - with a brief of the shared posting each is for."""
    if not rows:
        return []
    job_ids = {r.job_id for r in rows}
    by_id = {
        job.id: job
        for job in await session.scalars(select(FreelanceJob).where(FreelanceJob.id.in_(job_ids)))
    }
    focused = await jobs.focused_at(session, rows[0].user_id, job_ids)
    return [
        ProposalOut.model_validate(row).model_copy(
            update={
                "job": _brief(by_id[row.job_id], focused.get(row.job_id))
                if row.job_id in by_id
                else None
            }
        )
        for row in rows
    ]


@router.get("", response_model=Page[ProposalOut])
async def list_proposals(
    user: CurrentUser,
    session: Session,
    job_id: uuid.UUID | None = Query(default=None),
    status_filter: ProposalStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
) -> Page[ProposalOut]:
    stmt = select(Proposal).where(Proposal.user_id == user.id)
    if job_id:
        stmt = stmt.where(Proposal.job_id == job_id)
    if status_filter:
        stmt = stmt.where(Proposal.status == status_filter)
    rows = list(await session.scalars(stmt.order_by(Proposal.created_at.desc()).limit(limit).offset(offset)))
    total_rows = list(await session.scalars(stmt.with_only_columns(Proposal.id)))
    return Page(items=await _out(session, rows), total=len(total_rows), limit=limit, offset=offset)


@router.post("", response_model=ProposalOut, status_code=status.HTTP_201_CREATED)
async def create_proposal(body: ProposalCreate, user: CurrentUser, session: Session) -> ProposalOut:
    """A proposal written by hand. Focuses the job, so it is tracked."""
    job = await _job(session, user, body.job_id)
    profile = await _profile(session, user, body.profile_id)
    row = Proposal(
        user_id=user.id,
        job_id=job.id,
        profile_id=profile.id if profile else None,
        bid_type=body.bid_type,
        bid_amount=body.bid_amount,
        bid_currency=body.bid_currency,
        connects_estimate=body.connects_estimate,
        cover_letter_markdown=body.cover_letter_markdown,
        answers=[a.model_dump() for a in body.answers],
        engine_version="manual",
    )
    session.add(row)
    await session.flush()
    await jobs.focus(session, user.id, job)
    track = await ensure_track(session, user.id, job)
    if track.proposal_id is None:
        track.proposal_id = row.id
    if track.stage is FreelanceTrackStage.FOCUSED and row.cover_letter_markdown.strip():
        await set_stage(session, track, FreelanceTrackStage.PROPOSAL_DRAFTED, reason="written by hand")
    return (await _out(session, [row]))[0]


@router.post("/generate", response_model=ProposalGenerated, status_code=status.HTTP_202_ACCEPTED)
async def generate_proposal(body: ProposalGenerateIn, user: CurrentUser, session: Session) -> ProposalGenerated:
    """Queue the next draft: the first from the posting and profile, or a revision of ``based_on_id``."""
    job = await _job(session, user, body.job_id)
    profile = await _profile(session, user, body.profile_id)
    try:
        # Said now rather than a minute into the run.
        await get_provider(session, user.id, "heavy")
    except MissingCredentialError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": "Add an AI provider key in Settings to write a proposal."},
        ) from exc
    if body.proposal_id:
        proposal = await _owned(session, user, body.proposal_id)
        if proposal.job_id != job.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="That proposal is for another posting"
            )
        if await running_generation(session, proposal.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A version of this proposal is already being written.",
            )
        if body.based_on_id is not None:
            base = await session.get(ProposalVersion, body.based_on_id)
            if base is None or base.proposal_id != proposal.id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    else:
        proposal = Proposal(
            user_id=user.id,
            job_id=job.id,
            profile_id=profile.id if profile else None,
            engine_version="pending",
        )
        session.add(proposal)
        await session.flush()
    await jobs.focus(session, user.id, job)

    generation = await enqueue(
        session,
        user_id=user.id,
        kind=GenerationKind.PROPOSAL,
        payload={
            "job_id": str(job.id),
            "profile_id": str(profile.id) if profile else None,
            "proposal_id": str(proposal.id),
            "based_on_id": str(body.based_on_id) if body.based_on_id else None,
            "instruction": (body.instruction or "").strip(),
            "current": body.current.model_dump(mode="json") if body.current else None,
        },
        key=idempotency_key("proposal", proposal.id, body.instruction, utc_now().replace(microsecond=0)),
    )
    proposal.generation_id = generation.id
    return ProposalGenerated(
        id=generation.id,
        generation_id=generation.id,
        proposal_id=proposal.id,
        status=generation.status.value,
        engine_version=VERSION,
    )


@router.get("/{proposal_id}/versions", response_model=ProposalVersions)
async def list_versions(proposal_id: uuid.UUID, user: CurrentUser, session: Session) -> ProposalVersions:
    row = await _owned(session, user, proposal_id)
    return ProposalVersions(
        items=[ProposalVersionOut.model_validate(v) for v in await versions(session, row.id)],
        running_generation_id=await running_generation(session, row.id),
    )


@router.delete("/{proposal_id}/versions/{version_id}", response_model=ProposalOut)
async def remove_version(
    proposal_id: uuid.UUID, version_id: uuid.UUID, user: CurrentUser, session: Session
) -> ProposalOut:
    """Delete one version. When the proposal holds it, the proposal goes back to the newest one left."""
    row = await _owned(session, user, proposal_id)
    version = await session.get(ProposalVersion, version_id)
    if version is None or version.proposal_id != row.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    await delete_version(session, row, version)
    await session.flush()
    await session.refresh(row)
    return (await _out(session, [row]))[0]


@router.get("/{proposal_id}", response_model=ProposalOut)
async def get_proposal(proposal_id: uuid.UUID, user: CurrentUser, session: Session) -> ProposalOut:
    return (await _out(session, [await _owned(session, user, proposal_id)]))[0]


@router.patch("/{proposal_id}", response_model=ProposalOut)
async def update_proposal(
    proposal_id: uuid.UUID, body: ProposalPatch, user: CurrentUser, session: Session
) -> ProposalOut:
    row = await _owned(session, user, proposal_id)
    data = body.model_dump(mode="json", exclude_unset=True)
    version_id = body.version_id
    data.pop("version_id", None)
    if "profile_id" in data and data["profile_id"] is not None:
        await _profile(session, user, uuid.UUID(data["profile_id"]))
    if data.get("status") == ProposalStatus.SUBMITTED.value and row.submitted_at is None:
        row.submitted_at = utc_now()
    letter_before = row.cover_letter_markdown
    for field, value in data.items():
        if field == "status" and value is None:
            continue
        setattr(row, field, value)
    if (
        row.engine_version
        and row.engine_version not in ("manual", "pending")
        and not row.engine_version.endswith("+edited")
        and row.cover_letter_markdown != letter_before
    ):
        # Edited by hand after the writer wrote it: the label says so.
        row.engine_version = f"{row.engine_version}+edited"
    if "cover_letter_markdown" in data or "answers" in data:
        # A save is the next whole version, when the writing changed.
        await record_save(session, row, version_id)
    await session.flush()
    if data.get("status") == ProposalStatus.SUBMITTED.value:
        await _mark_submitted(session, user, row)
    return (await _out(session, [row]))[0]


@router.post("/{proposal_id}/submit", response_model=ProposalOut)
async def submit_proposal(proposal_id: uuid.UUID, user: CurrentUser, session: Session) -> ProposalOut:
    """Record that this proposal went out on Upwork; the track follows."""
    row = await _owned(session, user, proposal_id)
    row.status = ProposalStatus.SUBMITTED
    row.submitted_at = row.submitted_at or utc_now()
    await session.flush()
    await _mark_submitted(session, user, row)
    return (await _out(session, [row]))[0]


async def _mark_submitted(session: Session, user: CurrentUser, row: Proposal) -> None:
    job = await _job(session, user, row.job_id)
    track = await ensure_track(session, user.id, job)
    track.proposal_id = row.id
    track.bid_type = row.bid_type
    track.bid_amount = row.bid_amount
    if track.connects_spent is None:
        track.connects_spent = row.connects_estimate
    if track.stage in (FreelanceTrackStage.FOCUSED, FreelanceTrackStage.PROPOSAL_DRAFTED):
        await set_stage(session, track, FreelanceTrackStage.SUBMITTED, reason="proposal submitted")


@router.delete("/{proposal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_proposal(proposal_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    """Delete a proposal and its versions, and take it out of the pipeline.

    The job's track only stays when another proposal for the same job is still
    there to carry it; otherwise the job leaves the pipeline with its proposal.
    """
    row = await _owned(session, user, proposal_id)
    await session.delete(row)
    await session.flush()
    track = await session.scalar(
        select(FreelanceJobTrack).where(FreelanceJobTrack.user_id == user.id, FreelanceJobTrack.job_id == row.job_id)
    )
    if track is None:
        return
    others = await session.scalar(
        select(Proposal.id)
        .where(Proposal.user_id == user.id, Proposal.job_id == row.job_id)
        .order_by(Proposal.created_at.desc())
        .limit(1)
    )
    if others is None:
        await untrack(session, track)
    else:
        track.proposal_id = others
