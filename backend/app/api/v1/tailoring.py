"""Resume generation and tailoring requests.

All four flows enqueue a job and return 202. The extension's one-click path
still feels immediate because of the instant path below: an identical
(base resume, job description) pair inside 7 days returns the saved result
rather than re-spending 90 seconds and real money.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, Session
from app.core.timezone import utc_now
from app.models.enums import GenerationKind, GenerationStatus, ResumeStatus
from app.models.profile import CandidateProfile
from app.models.resume import BaseResume, TailoredResume
from app.models.user import UserSettings
from app.schemas.generation import GenerationAccepted
from app.schemas.tailoring import (
    GenerateFromJob,
    GenerateFromStory,
    TailorByInstruction,
    TailorToJob,
)
from app.services.generation import enqueue, idempotency_key, jd_hash

router = APIRouter(tags=["generation"])

INSTANT_PATH_WINDOW = timedelta(days=7)


async def _profile_text(session: Session, user_id: uuid.UUID) -> str | None:
    row = await session.scalar(
        select(CandidateProfile)
        .where(CandidateProfile.user_id == user_id)
        .order_by(CandidateProfile.is_default.desc())
        .limit(1)
    )
    return row.raw_profile_md if row else None


async def _mode(session: Session, user_id: uuid.UUID, requested: str | None) -> str:
    """Default to Grounded when a profile exists, Constructed when it does not."""
    if requested in ("grounded", "constructed"):
        return requested
    return "grounded" if await _profile_text(session, user_id) else "constructed"


async def _owned_base(session: Session, user: CurrentUser, rid: uuid.UUID) -> BaseResume:
    row = await session.scalar(
        select(BaseResume).where(BaseResume.id == rid, BaseResume.user_id == user.id)
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Base resume not found"
        )
    return row


@router.post(
    "/resumes/generate/story",
    response_model=GenerationAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def generate_from_story(
    body: GenerateFromStory, user: CurrentUser, session: Session
) -> GenerationAccepted:
    mode = await _mode(session, user.id, body.mode)
    gen = await enqueue(
        session,
        user_id=user.id,
        kind=GenerationKind.RESUME_STORY,
        payload={
            "target_title": body.target_title,
            "mode": mode,
            "skill_count": body.skill_count,
            "extra_instructions": body.extra_instructions,
            "display_name": body.display_name,
            "stack_label": body.stack_label,
            "candidate_profile": await _profile_text(session, user.id),
        },
        key=idempotency_key(
            "story", user.id, body.target_title, body.extra_instructions, body.skill_count
        ),
    )
    return GenerationAccepted(id=gen.id, status=gen.status, kind=gen.kind)


@router.post(
    "/resumes/generate/job",
    response_model=GenerationAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def generate_from_job(
    body: GenerateFromJob, user: CurrentUser, session: Session
) -> GenerationAccepted:
    mode = await _mode(session, user.id, body.mode)
    gen = await enqueue(
        session,
        user_id=user.id,
        kind=GenerationKind.RESUME_JOB,
        payload={
            "target_title": body.target_title,
            "mode": mode,
            "job_description": body.job_description,
            "extra_instructions": body.extra_instructions,
            "display_name": body.display_name,
            "candidate_profile": body.candidate_info
            or await _profile_text(session, user.id),
        },
        key=idempotency_key("job", user.id, body.target_title, body.job_description),
    )
    return GenerationAccepted(id=gen.id, status=gen.status, kind=gen.kind)


@router.post(
    "/tailoring/job",
    response_model=GenerationAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def tailor_to_job(
    body: TailorToJob, user: CurrentUser, session: Session
) -> GenerationAccepted:
    base = await _owned_base(session, user, body.base_resume_id)

    if not body.force:
        cached = await _instant_path(session, user.id, base.id, body.job_description)
        if cached is not None:
            return GenerationAccepted(
                id=cached.generation_id or cached.id,
                status=GenerationStatus.SUCCEEDED,
                kind=GenerationKind.TAILOR_JOB,
                reused=True,
                result_kind="tailored_resume",
                result_id=cached.id,
            )

    settings = await session.get(UserSettings, user.id)
    gen = await enqueue(
        session,
        user_id=user.id,
        kind=GenerationKind.TAILOR_JOB,
        payload={
            "base_resume_id": str(base.id),
            "base_resume_md": base.content_md,
            "job_description": body.job_description,
            "job_url": body.job_url,
            "company_name": body.company_name,
            "target_title": body.job_title or base.target_title,
            "display_name": body.display_name,
            "job_source": body.source,
            "mode": "grounded",  # tailoring reframes; it never invents a timeline
            "base_country": settings.base_country if settings else "Thailand",
        },
        key=idempotency_key("tailor", user.id, base.id, body.job_description),
    )
    return GenerationAccepted(id=gen.id, status=gen.status, kind=gen.kind)


@router.post(
    "/tailoring/instruction",
    response_model=GenerationAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def tailor_by_instruction(
    body: TailorByInstruction, user: CurrentUser, session: Session
) -> GenerationAccepted:
    """Instruction-based edits save back as a BASE resume, per the requirements."""
    base = await _owned_base(session, user, body.base_resume_id)
    gen = await enqueue(
        session,
        user_id=user.id,
        kind=GenerationKind.TAILOR_INSTRUCTION,
        payload={
            "base_resume_id": str(base.id),
            "base_resume_md": base.content_md,
            "instructions": body.instructions,
            "target_title": base.target_title,
            "display_name": body.display_name or f"{base.display_name} (edited)",
            "stack_label": base.stack_label,
            "mode": "grounded",
        },
        key=idempotency_key("instr", user.id, base.id, body.instructions),
    )
    return GenerationAccepted(id=gen.id, status=gen.status, kind=gen.kind)


async def _instant_path(
    session: Session, user_id: uuid.UUID, base_id: uuid.UUID, jd: str
) -> TailoredResume | None:
    return await session.scalar(
        select(TailoredResume).where(
            TailoredResume.user_id == user_id,
            TailoredResume.base_resume_id == base_id,
            TailoredResume.jd_hash == jd_hash(jd),
            TailoredResume.status != ResumeStatus.DRAFT,
            TailoredResume.created_at > utc_now() - INSTANT_PATH_WINDOW,
        )
    )
