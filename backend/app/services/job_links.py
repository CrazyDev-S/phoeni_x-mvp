"""Links between job postings and resumes, for the side panel."""

from __future__ import annotations

import re
import uuid
from urllib.parse import parse_qsl, urlencode, urlsplit

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_link import JobLink
from app.models.resume import BaseResume, TailoredResume

# Query parameters that say where a visitor came from, not which job it is.
TRACKING_PARAMETERS = re.compile(
    r"^(utm_\w+|gh_src|lever-(source|origin)|source|src|ref|referrer|trk|trackingid|refid"
    r"|from|fbclid|gclid|mc_[ce]id|_hs\w+)$",
    re.IGNORECASE,
)
# Ashby, Lever and Workday put the application form one segment below the
# posting. Only a final segment is stripped: "/apply/123" names a job.
APPLICATION_SUFFIX = re.compile(
    r"/(application|apply)(/(applymanually|autofillwithresume|usemylastapplication))?/?$",
    re.IGNORECASE,
)
# Tailored resumes are matched by URL in Python, so only the newest are read.
RECENT_TAILORED = 500


def job_key(url: str) -> str:
    """One key per posting, however the URL for it was reached.

    Scheme, "www.", the fragment, tracking parameters and an application-form
    suffix are dropped; anything else in the query is kept, because some boards
    name the job there (``?gh_jid=123``).
    """
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").removeprefix("www.")
    try:
        if parts.port:
            host = f"{host}:{parts.port}"
    except ValueError:
        pass
    path = APPLICATION_SUFFIX.sub("", parts.path).rstrip("/")
    query = urlencode(
        sorted(
            (name, value)
            for name, value in parse_qsl(parts.query)
            if not TRACKING_PARAMETERS.match(name)
        )
    )
    return f"{host}{path}?{query}" if query else f"{host}{path}"


async def find_link(session: AsyncSession, user_id: uuid.UUID, url: str) -> JobLink | None:
    return await session.scalar(
        select(JobLink).where(JobLink.user_id == user_id, JobLink.job_key == job_key(url))
    )


async def upsert_link(
    session: AsyncSession, user_id: uuid.UUID, url: str, **values: object
) -> JobLink:
    """The link for a posting, created on first use. ``None`` values are ignored.

    Open tabs are tailored in parallel and two of them can be the same posting,
    so creation tolerates a concurrent insert instead of failing on it.
    """
    key = job_key(url)
    await session.execute(
        insert(JobLink)
        .values(user_id=user_id, job_key=key, job_url=url)
        .on_conflict_do_nothing(index_elements=["user_id", "job_key"])
    )
    row = await session.scalar(
        select(JobLink).where(JobLink.user_id == user_id, JobLink.job_key == key)
    )
    assert row is not None
    for name, value in values.items():
        if value is not None:
            setattr(row, name, value)
    await session.flush()
    return row


async def linked_resume(
    session: AsyncSession, link: JobLink
) -> BaseResume | TailoredResume | None:
    if link.resume_kind == "tailored" and link.tailored_resume_id:
        return await session.get(TailoredResume, link.tailored_resume_id)
    if link.resume_kind == "base" and link.base_resume_id:
        return await session.get(BaseResume, link.base_resume_id)
    return None


async def tailored_for_keys(
    session: AsyncSession, user_id: uuid.UUID, keys: set[str]
) -> dict[str, TailoredResume]:
    """The newest tailored resume whose posting URL has each key.

    Finds resumes tailored before links existed, or from the portal, so a tab
    for a job tailored last week shows that resume without being linked again.
    """
    if not keys:
        return {}
    rows = await session.execute(
        select(TailoredResume.id, TailoredResume.job_url)
        .where(TailoredResume.user_id == user_id, TailoredResume.job_url.is_not(None))
        .order_by(TailoredResume.updated_at.desc())
        .limit(RECENT_TAILORED)
    )
    matched: dict[str, uuid.UUID] = {}
    for resume_id, url in rows:
        key = job_key(url)
        if key in keys:
            matched.setdefault(key, resume_id)
    found = {key: await session.get(TailoredResume, rid) for key, rid in matched.items()}
    return {key: row for key, row in found.items() if row is not None}
