"""Which resume went with which application.

An application goes with one resume: one tailored for it, or a base resume
used as it is. A tailored link is stored on both rows -
``job_applications.tailored_resume_id`` and ``tailored_resumes.job_application_id``
- and used to be written on only one side, so the two disagreed. A base resume
can go with any number of applications, so it is linked from the application
only. Every link and unlink goes through here.

The side panel keeps its own link per posting (``JobLink``). Once a posting is
tracked as an application the two are one job seen from two places, so a
change made on either side is written to the other.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import JobApplication
from app.models.job_link import JobLink
from app.models.resume import BaseResume, TailoredResume
from app.remote.services.job_links import find_link, job_key, linked_resume, upsert_link
from app.services.generation import job_description_hash

# Applications are matched to a posting by URL in Python, so only the newest are read.
RECENT_APPLICATIONS = 500

# "panel": chosen for the posting in the side panel. "tailored": tailored for it.
SuggestionReason = Literal["panel", "tailored"]


@dataclass(frozen=True)
class LinkedJob:
    """A job a resume is linked to. Only an application has an id to open."""

    application_id: uuid.UUID | None
    company_name: str | None
    job_title: str | None
    job_url: str | None


async def link_resume(
    session: AsyncSession,
    application: JobApplication,
    *,
    tailored_id: uuid.UUID | None = None,
    base_id: uuid.UUID | None = None,
) -> None:
    """Point an application at one resume, tailored or base - or, given neither, at nothing."""
    if tailored_id and base_id:
        raise ValueError("an application goes with one resume")
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
    application.base_resume_id = base_id
    if tailored_id:
        await session.execute(
            update(TailoredResume)
            .where(TailoredResume.id == tailored_id)
            .values(job_application_id=application.id)
        )


async def tracked_postings(
    session: AsyncSession, user_id: uuid.UUID, keys: Collection[str]
) -> dict[str, list[uuid.UUID]]:
    """The applications tracking each posting, newest first, by the posting's job key."""
    found: dict[str, list[uuid.UUID]] = defaultdict(list)
    if not keys:
        return found
    rows = await session.execute(
        select(JobApplication.id, JobApplication.job_url)
        .where(JobApplication.user_id == user_id, JobApplication.job_url.is_not(None))
        .order_by(JobApplication.created_at.desc())
        .limit(RECENT_APPLICATIONS)
    )
    for application_id, url in rows:
        key = job_key(url)
        if key in keys:
            found[key].append(application_id)
    return found


async def link_posting_applications(session: AsyncSession, link: JobLink) -> None:
    """Give the applications tracking a posting the resume the side panel has for it."""
    ids: dict[str, uuid.UUID | None] = {}
    if link.resume_kind == "tailored":
        ids = {"tailored_id": link.tailored_resume_id}
    elif link.resume_kind == "base":
        ids = {"base_id": link.base_resume_id}
    tracked = await tracked_postings(session, link.user_id, {link.job_key})
    for application_id in tracked.get(link.job_key, []):
        application = await session.get(JobApplication, application_id)
        if application is not None:
            await link_resume(session, application, **ids)


async def link_application_posting(session: AsyncSession, application: JobApplication) -> None:
    """Give the application's posting, as the side panel sees it, the application's resume."""
    if not application.job_url:
        return
    link = await upsert_link(session, application.user_id, application.job_url)
    known = {
        "company_name": application.company_name,
        "job_title": application.role_title,
        "job_description_text": application.job_description_text,
    }
    for name, value in known.items():
        if value and not getattr(link, name):
            setattr(link, name, value)
    tailored = (
        await session.get(TailoredResume, application.tailored_resume_id)
        if application.tailored_resume_id
        else None
    )
    if tailored is not None:
        link.resume_kind = "tailored"
        link.tailored_resume_id = tailored.id
        link.base_resume_id = tailored.base_resume_id
    elif application.base_resume_id:
        link.resume_kind = "base"
        link.base_resume_id = application.base_resume_id
    else:
        link.resume_kind = None


async def suggest_resume(
    session: AsyncSession, application: JobApplication
) -> tuple[BaseResume | TailoredResume, SuggestionReason] | None:
    """The resume meant for this posting, when none is linked.

    First the one the side panel chose for it - saved before applications took
    base resumes, a posting used its base resume and the application did not.
    Then one tailored for it: unlinking is one click, and afterwards nothing
    pointed back at the resume that was tailored for the job.
    """
    if application.tailored_resume_id or application.base_resume_id:
        return None
    if application.job_url:
        link = await find_link(session, application.user_id, application.job_url)
        chosen = await linked_resume(session, link) if link else None
        if chosen is not None:
            return chosen, "panel"
    matches = [TailoredResume.job_application_id == application.id]
    if application.job_url:
        matches.append(TailoredResume.job_url == application.job_url)
    if application.job_description_text and application.job_description_text.strip():
        matches.append(
            TailoredResume.job_description_hash
            == job_description_hash(application.job_description_text)
        )
    tailored = await session.scalar(
        select(TailoredResume)
        .where(TailoredResume.user_id == application.user_id, or_(*matches))
        .order_by(TailoredResume.updated_at.desc())
        .limit(1)
    )
    return (tailored, "tailored") if tailored is not None else None


async def linked_jobs(
    session: AsyncSession,
    user_id: uuid.UUID,
    kind: Literal["base", "tailored"],
    resume_ids: Collection[uuid.UUID],
) -> dict[uuid.UUID, list[LinkedJob]]:
    """The jobs each resume is linked to, newest first.

    Either kind is linked by the applications sent with it, and by a posting
    the side panel chose it for. Saving a posting as an application keeps its
    link, so a posting that is already an application is listed once.
    """
    found: dict[uuid.UUID, list[LinkedJob]] = defaultdict(list)
    if not resume_ids:
        return found
    applied: dict[uuid.UUID, set[str]] = defaultdict(set)
    sent_with = (
        JobApplication.tailored_resume_id if kind == "tailored" else JobApplication.base_resume_id
    )
    applications = await session.execute(
        select(
            sent_with,
            JobApplication.id,
            JobApplication.company_name,
            JobApplication.role_title,
            JobApplication.job_url,
        )
        .where(JobApplication.user_id == user_id, sent_with.in_(resume_ids))
        .order_by(JobApplication.created_at.desc())
    )
    for resume_id, application_id, company, title, url in applications:
        found[resume_id].append(LinkedJob(application_id, company, title, url))
        if url:
            applied[resume_id].add(job_key(url))

    column = JobLink.tailored_resume_id if kind == "tailored" else JobLink.base_resume_id
    links = await session.execute(
        select(column, JobLink.job_key, JobLink.company_name, JobLink.job_title, JobLink.job_url)
        .where(JobLink.user_id == user_id, JobLink.resume_kind == kind, column.in_(resume_ids))
        .order_by(JobLink.updated_at.desc())
    )
    for resume_id, key, company, title, url in links:
        if key not in applied[resume_id]:
            found[resume_id].append(LinkedJob(None, company, title, url))
    return found
