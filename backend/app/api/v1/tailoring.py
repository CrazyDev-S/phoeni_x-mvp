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
from app.models.application import JobApplication
from app.models.enums import GenerationKind, GenerationStatus, ResumeStatus
from app.models.generation import Generation
from app.models.profile import CandidateProfile
from app.models.resume import BaseResume, TailoredResume
from app.models.user import UserSettings
from app.schemas.generation import GenerationAccepted
from app.schemas.tailoring import (
    GenerateFromJob,
    GenerateFromStory,
    TailorApplication,
    TailorByInstruction,
    TailorToJob,
    UpgradeTailored,
)
from app.services.generation import enqueue, idempotency_key, job_description_hash
from app.services.links import link_resume

router = APIRouter(tags=["generation"])

INSTANT_PATH_WINDOW = timedelta(days=7)


async def _profile_text(session: Session, user_id: uuid.UUID) -> str | None:
    row = await session.scalar(
        select(CandidateProfile)
        .where(CandidateProfile.user_id == user_id)
        .order_by(CandidateProfile.is_default.desc())
        .limit(1)
    )
    return row.raw_profile_markdown if row else None


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


async def _owned_application(
    session: Session, user: CurrentUser, application_id: uuid.UUID
) -> JobApplication:
    row = await session.scalar(
        select(JobApplication).where(
            JobApplication.id == application_id, JobApplication.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
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
    application = (
        await _owned_application(session, user, body.application_id)
        if body.application_id
        else None
    )

    if not body.force and body.strategy == "existing":
        cached = await _instant_path(session, user.id, base.id, body.job_description)
        if cached is not None:
            if application is not None:
                await link_resume(session, application, cached.id)
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
            "base_resume_md": base.content_markdown,
            "job_description": body.job_description,
            "job_url": body.job_url,
            "company_name": body.company_name,
            "target_title": body.job_title or base.target_title,
            "display_name": body.display_name,
            "job_source": body.source,
            "mode": "grounded",  # tailoring reframes; it never invents a timeline
            "base_country": settings.base_country if settings else "Thailand",
            "strategy": body.strategy,
            "application_id": str(application.id) if application else None,
        },
        # The application is part of the key: the same posting tailored for a
        # tracked application must run (and link) rather than return an older
        # job that linked nothing.
        key=idempotency_key(
            "tailor", user.id, base.id, body.job_description, body.strategy,
            body.application_id,
        ),
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
            "base_resume_md": base.content_markdown,
            "instructions": body.instructions,
            "target_title": base.target_title,
            "display_name": body.display_name or f"{base.display_name} (edited)",
            "stack_label": base.stack_label,
            "mode": "grounded",
        },
        key=idempotency_key("instr", user.id, base.id, body.instructions),
    )
    return GenerationAccepted(id=gen.id, status=gen.status, kind=gen.kind)


@router.post(
    "/resumes/{resume_id}/repair",
    response_model=GenerationAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def repair_resume(
    resume_id: uuid.UUID, user: CurrentUser, session: Session
) -> GenerationAccepted:
    """Fix the rule errors a saved resume still carries, in place.

    Not idempotency-keyed: a run that could not clear everything must be
    re-runnable on the same content. Only a run already in flight is reused.
    """
    base = await _owned_base(session, user, resume_id)
    findings = (base.validation or {}).get("findings", [])
    if not any(f.get("severity") == "error" for f in findings):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This resume has no rule errors to fix.",
        )

    running = await session.scalar(
        select(Generation).where(
            Generation.user_id == user.id,
            Generation.kind == GenerationKind.RESUME_REPAIR,
            Generation.status.in_([GenerationStatus.QUEUED, GenerationStatus.RUNNING]),
            Generation.input["base_resume_id"].astext == str(base.id),
        )
    )
    gen = running or await enqueue(
        session,
        user_id=user.id,
        kind=GenerationKind.RESUME_REPAIR,
        payload={"base_resume_id": str(base.id), "target_title": base.target_title},
    )
    return GenerationAccepted(id=gen.id, status=gen.status, kind=gen.kind)


@router.post(
    "/tailored-resumes/{resume_id}/upgrade",
    response_model=GenerationAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upgrade_tailored_resume(
    resume_id: uuid.UUID, body: UpgradeTailored, user: CurrentUser, session: Session
) -> GenerationAccepted:
    """Re-tailor a saved tailored resume against its own posting, in place.

    In place, so the application it was sent with stays linked to it.
    """
    row = await session.scalar(
        select(TailoredResume).where(
            TailoredResume.id == resume_id, TailoredResume.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tailored resume not found"
        )
    if len(row.job_description_text.strip()) < 40:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No job description is saved with this resume, so there is nothing to match.",
        )

    running = await session.scalar(
        select(Generation).where(
            Generation.user_id == user.id,
            Generation.kind == GenerationKind.TAILOR_JOB,
            Generation.status.in_([GenerationStatus.QUEUED, GenerationStatus.RUNNING]),
            Generation.input["tailored_resume_id"].astext == str(row.id),
        )
    )
    gen = running or await enqueue(
        session,
        user_id=user.id,
        kind=GenerationKind.TAILOR_JOB,
        payload={
            "tailored_resume_id": str(row.id),
            "base_resume_id": str(row.base_resume_id),
            "base_resume_md": row.content_markdown,
            "job_description": row.job_description_text,
            "job_url": row.job_url,
            "company_name": row.company_name,
            "target_title": row.job_title or row.display_name,
            "job_source": row.job_source,
            "mode": "grounded",
            "strategy": body.strategy,
        },
    )
    return GenerationAccepted(id=gen.id, status=gen.status, kind=gen.kind)


@router.post(
    "/applications/{application_id}/tailor",
    response_model=GenerationAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def tailor_for_application(
    application_id: uuid.UUID, body: TailorApplication, user: CurrentUser, session: Session
) -> GenerationAccepted:
    """Tailor against an application's saved posting, and link the result to it.

    The same flow as the Tailor page, so strategies and the instant path behave
    identically from either place.
    """
    application = await _owned_application(session, user, application_id)
    description = (application.job_description_text or "").strip()
    if len(description) < 40:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Save the job description with this application first - there is nothing to tailor against.",
        )
    return await tailor_to_job(
        TailorToJob(
            base_resume_id=body.base_resume_id,
            job_description=description[:60_000],
            job_url=application.job_url,
            company_name=application.company_name,
            job_title=application.role_title,
            source="web",
            strategy=body.strategy,
            application_id=application.id,
        ),
        user,
        session,
    )


async def _instant_path(
    session: Session, user_id: uuid.UUID, base_id: uuid.UUID, jd: str
) -> TailoredResume | None:
    return await session.scalar(
        select(TailoredResume).where(
            TailoredResume.user_id == user_id,
            TailoredResume.base_resume_id == base_id,
            TailoredResume.job_description_hash == job_description_hash(jd),
            TailoredResume.status != ResumeStatus.DRAFT,
            TailoredResume.created_at > utc_now() - INSTANT_PATH_WINDOW,
            # A result scored before tailoring read the posting's keywords shows
            # 0/0 coverage. Serving it again would hide the fix.
            TailoredResume.must_have_total > 0,
        )
    )
