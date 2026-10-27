"""Tailoring a job's resume to it, in place.

Once a job has a resume, tailoring it rewrites that resume instead of adding
another: the application and the side panel's posting still point at the same
row afterwards, so nothing has to be linked again.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import GenerationKind, GenerationStatus, ResumeStatus
from app.models.generation import Generation
from app.models.resume import BaseResume, TailoredResume
from app.remote.validation.posting import require_posting
from app.services.generation import enqueue, job_description_hash

AnyResume = BaseResume | TailoredResume

# The shortest description worth tailoring against.
MIN_DESCRIPTION = 40


async def enqueue_upgrade(
    session: AsyncSession,
    resume: AnyResume,
    *,
    strategy: Literal["existing", "full"],
    job_description: str | None = None,
    job_url: str | None = None,
    company_name: str | None = None,
    job_title: str | None = None,
) -> Generation:
    """Queue a rewrite of ``resume`` for a job, or return the one already running.

    Against the job's description when one is given, else the description the
    resume was last tailored against. A tailored resume moved to a different
    job takes on that job's description, company and title when it lands.
    """
    description = (job_description or "").strip()
    if len(description) < MIN_DESCRIPTION:
        description = (resume.job_description_text or "").strip()
    if len(description) < MIN_DESCRIPTION:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No job description is saved with this job or its resume, "
            "so there is nothing to tailor against.",
        )
    description = description[:60_000]
    require_posting(description)

    if isinstance(resume, TailoredResume):
        target = Generation.input["tailored_resume_id"].astext == str(resume.id)
    else:
        target = (Generation.input["base_resume_id"].astext == str(resume.id)) & (
            Generation.input["base_in_place"].astext == "true"
        )
    running = await session.scalar(
        select(Generation).where(
            Generation.user_id == resume.user_id,
            Generation.kind == GenerationKind.TAILOR_JOB,
            Generation.status.in_([GenerationStatus.QUEUED, GenerationStatus.RUNNING]),
            target,
        )
    )
    if running is not None:
        return running

    common = {
        "job_description": description,
        "mode": "grounded",  # tailoring reframes; it never invents a timeline
        "strategy": strategy,
    }
    if isinstance(resume, TailoredResume):
        await _refuse_duplicate(session, resume, description)
        payload = {
            **common,
            "tailored_resume_id": str(resume.id),
            "base_resume_id": str(resume.base_resume_id),
            "base_resume_md": resume.content_markdown,
            "job_url": job_url or resume.job_url,
            "company_name": company_name or resume.company_name,
            "target_title": job_title or resume.job_title or resume.display_name,
            "job_source": resume.job_source,
        }
    else:
        payload = {
            **common,
            "base_resume_id": str(resume.id),
            "base_in_place": True,
            "base_resume_md": resume.content_markdown,
            "job_url": job_url,
            "company_name": company_name,
            "target_title": job_title or resume.target_title,
        }
    return await enqueue(
        session, user_id=resume.user_id, kind=GenerationKind.TAILOR_JOB, payload=payload
    )


async def _refuse_duplicate(
    session: AsyncSession, resume: TailoredResume, description: str
) -> None:
    """One saved tailoring per (base resume, posting) - see the unique index.

    Checked before the run is paid for, not when its result fails to save.
    """
    digest = job_description_hash(description)
    if digest == resume.job_description_hash:
        return
    clash = await session.scalar(
        select(TailoredResume).where(
            TailoredResume.base_resume_id == resume.base_resume_id,
            TailoredResume.job_description_hash == digest,
            TailoredResume.status != ResumeStatus.DRAFT,
            TailoredResume.id != resume.id,
        )
    )
    if clash is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"“{clash.display_name}” is already tailored from the same base resume "
            "for this job. Link that one instead.",
        )

