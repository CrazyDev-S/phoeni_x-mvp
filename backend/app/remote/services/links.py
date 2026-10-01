"""Which tailored resume went with which application.

The link is stored on both rows - ``job_applications.tailored_resume_id`` and
``tailored_resumes.job_application_id`` - and used to be written on only one
side, so the two disagreed. Every link and unlink goes through here.
"""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import JobApplication
from app.models.resume import TailoredResume
from app.services.generation import job_description_hash


async def link_resume(
    session: AsyncSession, application: JobApplication, tailored_id: uuid.UUID | None
) -> None:
    """Point an application and a tailored resume at each other, or at nothing."""
    previous = application.tailored_resume_id
    if previous and previous != tailored_id:
        await session.execute(
            update(TailoredResume)
            .where(
                TailoredResume.id == previous,
                TailoredResume.job_application_id == application.id,
            )
            .values(job_application_id=None)
        )
    application.tailored_resume_id = tailored_id
    if tailored_id:
        await session.execute(
            update(TailoredResume)
            .where(TailoredResume.id == tailored_id)
            .values(job_application_id=application.id)
        )


async def suggest_resume(
    session: AsyncSession, application: JobApplication
) -> TailoredResume | None:
    """The tailored resume written for this posting, when none is linked.

    Unlinking is one click, and afterwards nothing pointed back at the resume
    that was tailored for the job - it had to be found again by name.
    """
    if application.tailored_resume_id:
        return None
    matches = [TailoredResume.job_application_id == application.id]
    if application.job_url:
        matches.append(TailoredResume.job_url == application.job_url)
    if application.job_description_text and application.job_description_text.strip():
        matches.append(
            TailoredResume.job_description_hash
            == job_description_hash(application.job_description_text)
        )
    return await session.scalar(
        select(TailoredResume)
        .where(TailoredResume.user_id == application.user_id, or_(*matches))
        .order_by(TailoredResume.updated_at.desc())
        .limit(1)
    )
