"""Run one proposal generation job from the worker.

A proposal draft goes through the same queue and event stream as a resume,
so the UI's progress handling is identical, and so swapping the template
engine for the prompted one changes nothing outside the engine.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.core.timezone import utc_now
from app.freelancing.proposals.engine import ProposalContext, ProposalEngineUnavailable, get_engine
from app.freelancing.services.tracking import ensure_track, set_stage
from app.freelancing.snapshot import extras as snapshot_extras
from app.llm.provider import LLMError
from app.models.enums import FreelanceTrackStage, GenerationStatus, ProposalStatus
from app.models.freelancing import FreelanceJob, FreelancerProfile, Proposal
from app.models.generation import Generation
from app.services.generation import emit, emit_now


async def run_proposal_generation(session, generation: Generation) -> None:
    payload = generation.input or {}
    user_id = generation.user_id

    job = await session.get(FreelanceJob, uuid.UUID(payload["job_id"]))
    if job is None or job.user_id != user_id:
        raise LLMError("JOB_NOT_FOUND", "The posting this proposal is for no longer exists.")

    profile: FreelancerProfile | None = None
    if payload.get("profile_id"):
        profile = await session.get(FreelancerProfile, uuid.UUID(payload["profile_id"]))
        if profile is not None and profile.user_id != user_id:
            profile = None
    if profile is None:
        profile = await session.scalar(
            select(FreelancerProfile)
            .where(FreelancerProfile.user_id == user_id)
            .order_by(FreelancerProfile.is_default.desc(), FreelancerProfile.created_at)
            .limit(1)
        )

    proposal = await session.get(Proposal, uuid.UUID(payload["proposal_id"]))
    if proposal is None or proposal.user_id != user_id:
        raise LLMError("PROPOSAL_NOT_FOUND", "The proposal being drafted no longer exists.")

    await emit_now(generation.id, "phase", {"phase": "drafting", "label": "Drafting the proposal", "percent": 20})

    engine = get_engine()
    context = ProposalContext(
        job=job,
        profile=profile,
        screening_questions=snapshot_extras(job.raw)["screening_questions"],
        instructions=payload.get("instructions"),
        tone=payload.get("tone", "direct"),
    )
    try:
        draft = await engine.draft(context)
    except ProposalEngineUnavailable as exc:
        raise LLMError(exc.code, str(exc)) from exc

    proposal.cover_letter_markdown = draft.cover_letter_markdown
    proposal.answers = draft.answers
    if draft.bid_type is not None:
        proposal.bid_type = draft.bid_type
    if draft.bid_amount is not None:
        proposal.bid_amount = draft.bid_amount
    if draft.bid_currency:
        proposal.bid_currency = draft.bid_currency
    if draft.connects_estimate is not None:
        proposal.connects_estimate = draft.connects_estimate
    proposal.engine_version = draft.engine_version
    proposal.generation_id = generation.id
    proposal.generation_meta = draft.meta
    proposal.status = ProposalStatus.DRAFT
    if profile is not None:
        proposal.profile_id = profile.id

    track = await ensure_track(session, user_id, job)
    if track.proposal_id is None:
        track.proposal_id = proposal.id
    if track.stage is FreelanceTrackStage.FOCUSED:
        await set_stage(session, track, FreelanceTrackStage.PROPOSAL_DRAFTED, reason="draft written", actor="engine")

    generation.result_kind = "proposal"
    generation.result_id = proposal.id
    generation.status = GenerationStatus.SUCCEEDED
    generation.progress_percent = 100
    generation.finished_at = utc_now()
    await session.flush()
    await emit(
        session, generation.id, "complete",
        {
            "result_kind": "proposal",
            "result_id": str(proposal.id),
            "engine_version": draft.engine_version,
            "needs_review": True,
            "findings": [],
            "report": None,
            "usage": {},
        },
    )
