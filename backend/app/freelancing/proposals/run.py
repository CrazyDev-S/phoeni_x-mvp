"""Write one version of a proposal, from the worker.

The first instruction writes draft 1.1 from the posting and the profile; each
one after it revises the version the editor holds. The draft lands as a
``ProposalVersion`` and in the proposal row, so the editor, the list and the
tracker all show it at once.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.core.timezone import utc_now
from app.freelancing.capture import extras as job_extras
from app.freelancing.profile_import import _json_object as json_object
from app.freelancing.proposals import engine
from app.freelancing.proposals.research import links, read_pages
from app.freelancing.proposals.versions import lineage, next_draft, version_label, versions
from app.freelancing.services.tracking import ensure_track, set_stage
from app.llm.factory import get_provider
from app.llm.provider import LLMError, LLMRequest
from app.llm.schemas import shape
from app.llm.streaming import streamed_turn
from app.models.enums import FreelanceTrackStage, GenerationStatus, LLMProvider, ProposalStatus
from app.models.freelancing import (
    FreelanceJob,
    FreelancerProfile,
    FreelancerProfileVersion,
    Proposal,
    ProposalVersion,
)
from app.models.generation import Generation
from app.models.user import UserSettings
from app.services.generation import emit, emit_now, record_calls


async def run_proposal_generation(session, generation: Generation) -> None:
    payload = generation.input or {}
    user_id = generation.user_id

    # Postings are shared; the proposal, the profile and the track are the user's.
    job = await session.get(FreelanceJob, uuid.UUID(payload["job_id"]))
    if job is None:
        raise LLMError("JOB_NOT_FOUND", "The posting this proposal is for no longer exists.")
    proposal = await session.get(Proposal, uuid.UUID(payload["proposal_id"]))
    if proposal is None or proposal.user_id != user_id:
        raise LLMError("PROPOSAL_NOT_FOUND", "The proposal being drafted no longer exists.")
    profile = await _profile(session, user_id, payload.get("profile_id"))

    thread = await versions(session, proposal.id)
    based_on = next((v for v in thread if str(v.id) == payload.get("based_on_id")), None)
    instruction = str(payload.get("instruction") or "").strip()
    questions = job_extras(job.raw)["screening_questions"]

    provider = await get_provider(session, user_id, "heavy")
    settings = await session.get(UserSettings, user_id)
    generation.provider = settings.default_provider if settings else LLMProvider.ANTHROPIC
    generation.model = getattr(provider, "model", None)

    urls = links(instruction)
    pages = []
    if urls:
        await emit_now(generation.id, "phase", {"phase": "research", "label": "Reading the linked pages", "percent": 8})
        pages = await read_pages(urls)

    label = f"Revising {version_label(based_on)}" if based_on else "Writing the proposal"
    await emit_now(generation.id, "phase", {"phase": "writing", "label": label, "percent": 15})

    response = await streamed_turn(
        provider,
        LLMRequest(
            purpose="proposal_write",
            system=engine.SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": engine.write_turn(
                        job=job,
                        profile=profile,
                        work_history=await _work_history(session, profile),
                        screening_questions=questions,
                        pages=pages,
                        history=lineage(thread, based_on),
                        current=_current(payload.get("current")),
                        instruction=instruction or "Write the proposal.",
                    ),
                }
            ],
            output_schema=engine.DOCUMENT,
            max_output_tokens=16_000,
            effort="high",
            timeout_s=420.0,
        ),
        lambda event: emit_now(generation.id, event.type, event.data),
    )
    await record_calls(
        session,
        generation,
        [
            {
                "purpose": "proposal_write",
                "model": response.model,
                "latency_ms": response.latency_ms,
                "stop_reason": response.stop_reason,
                "cost_usd_micros": response.cost_usd_micros,
                **response.usage.as_dict(),
            }
        ],
    )
    if response.stop_reason == "max_tokens":
        raise LLMError("OUTPUT_TOO_LONG", "The proposal ran past the length limit. Try a narrower instruction.")
    raw = response.parsed if isinstance(response.parsed, dict) else json_object(response.text)
    if raw is None:
        raise LLMError("UNREADABLE_REPLY", "The proposal came back unreadable. Try again.")
    # The turn takes a while; the proposal may have been deleted meanwhile.
    if await session.scalar(select(Proposal.id).where(Proposal.id == proposal.id)) is None:
        raise LLMError("PROPOSAL_NOT_FOUND", "The proposal was deleted while it was being written.")

    major, minor = next_draft(thread)
    version = ProposalVersion(
        user_id=user_id,
        proposal_id=proposal.id,
        major=major,
        minor=minor,
        instruction=instruction or None,
        document={
            **engine.document(shape(engine.DOCUMENT, raw), questions),
            "researched": [{"url": p.url, "title": p.title, "problem": p.problem} for p in pages],
        },
        based_on_id=based_on.id if based_on else None,
        generation_id=generation.id,
    )
    session.add(version)
    await session.flush()

    proposal.cover_letter_markdown = version.document["cover_letter_markdown"]
    proposal.answers = version.document["answers"]
    proposal.version_id = version.id
    proposal.engine_version = engine.VERSION
    proposal.generation_id = generation.id
    if profile is not None:
        proposal.profile_id = profile.id
    # The bid is the freelancer's once set; the writer only fills what is empty.
    bid_type, bid_amount, currency = engine.bid(job, profile)
    if proposal.bid_amount is None:
        proposal.bid_type = proposal.bid_type or bid_type
        proposal.bid_amount = bid_amount
        proposal.bid_currency = proposal.bid_currency or currency
    if proposal.connects_estimate is None:
        proposal.connects_estimate = engine.connects(job)
    if proposal.status is ProposalStatus.ARCHIVED:
        proposal.status = ProposalStatus.DRAFT

    track = await ensure_track(session, user_id, job)
    if track.proposal_id is None:
        track.proposal_id = proposal.id
    if track.stage is FreelanceTrackStage.FOCUSED:
        await set_stage(session, track, FreelanceTrackStage.PROPOSAL_DRAFTED, reason="draft written", actor="engine")

    generation.result_kind = "proposal_version"
    generation.result_id = version.id
    generation.status = GenerationStatus.SUCCEEDED
    generation.progress_percent = 100
    generation.finished_at = utc_now()
    await session.flush()
    await emit(
        session,
        generation.id,
        "complete",
        {
            "result_kind": "proposal_version",
            "result_id": str(version.id),
            "proposal_id": str(proposal.id),
            "label": version_label(version),
            "needs_review": True,
            "findings": [],
            "report": None,
        },
    )


def _current(current: dict | None) -> dict | None:
    """The editor's letter and answers, when it holds any: what an instruction revises."""
    if not current or not str(current.get("cover_letter_markdown") or "").strip():
        return None
    return current


async def _profile(session, user_id: uuid.UUID, profile_id: str | None) -> FreelancerProfile | None:
    """The profile asked for, else the user's default, else their first."""
    if profile_id:
        profile = await session.get(FreelancerProfile, uuid.UUID(profile_id))
        if profile is not None and profile.user_id == user_id:
            return profile
    return await session.scalar(
        select(FreelancerProfile)
        .where(FreelancerProfile.user_id == user_id)
        .order_by(FreelancerProfile.is_default.desc(), FreelancerProfile.created_at)
        .limit(1)
    )


async def _work_history(session, profile: FreelancerProfile | None) -> list[dict]:
    """The work history the profile writer wrote for this profile, as last saved."""
    if profile is None:
        return []
    document = await session.scalar(
        select(FreelancerProfileVersion.document)
        .where(FreelancerProfileVersion.profile_id == profile.id, FreelancerProfileVersion.minor == 0)
        .order_by(FreelancerProfileVersion.major.desc())
        .limit(1)
    )
    entries = (document or {}).get("work_history") or []
    return [e for e in entries if isinstance(e, dict)]
