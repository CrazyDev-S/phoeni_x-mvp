"""The shared Upwork job list: the extension registers postings, everyone browses them."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status

from app.core.deps import CurrentUser, Session
from app.freelancing.services import jobs
from app.models.freelancing import FreelanceJob, FreelanceSavedSearch
from app.schemas.common import Page
from app.schemas.freelancing import (
    CaptureIn,
    CaptureOut,
    JobCard,
    JobDetail,
    JobFilter,
    SavedSearchIn,
    SavedSearchOut,
)

router = APIRouter(prefix="/jobs", tags=["freelancing: jobs"])


async def _job(session: Session, job_id: uuid.UUID) -> FreelanceJob:
    row = await jobs.get_job(session, job_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return row


async def _saved(session: Session, user: CurrentUser, saved_id: uuid.UUID) -> FreelanceSavedSearch:
    row = next((r for r in await jobs.list_saved_searches(session, user.id) if r.id == saved_id), None)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved search not found")
    return row


# Static paths first: "/search" would otherwise be read as a job id and 422.


@router.post("/capture", response_model=CaptureOut)
async def capture(body: CaptureIn, user: CurrentUser, session: Session) -> CaptureOut:
    """Register postings the extension saw on Upwork, one shared row per Upwork job id."""
    return await jobs.register(session, user.id, body.jobs)


@router.post("/search", response_model=Page[JobCard])
async def search(body: JobFilter, user: CurrentUser, session: Session) -> Page[JobCard]:
    """The shared list, filtered. Answered from the database: instant, and free."""
    rows, total = await jobs.browse(session, user.id, body)
    return Page(items=await jobs.cards(session, user.id, rows), total=total, limit=body.limit, offset=body.offset)


@router.get("", response_model=Page[JobCard])
async def list_jobs(
    user: CurrentUser,
    session: Session,
    focused: bool = Query(default=False, description="Only this user's starred postings"),
    q: str | None = Query(default=None, max_length=300),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[JobCard]:
    if focused:
        rows, total = await jobs.focused(session, user.id, limit=limit, offset=offset)
    else:
        rows, total = await jobs.browse(session, user.id, JobFilter(query=q, limit=limit, offset=offset))
    return Page(items=await jobs.cards(session, user.id, rows), total=total, limit=limit, offset=offset)


@router.get("/saved-searches", response_model=list[SavedSearchOut])
async def list_saved_searches(user: CurrentUser, session: Session) -> list[SavedSearchOut]:
    return [SavedSearchOut.model_validate(r) for r in await jobs.list_saved_searches(session, user.id)]


@router.put("/saved-searches", response_model=SavedSearchOut, status_code=status.HTTP_201_CREATED)
async def save_search(body: SavedSearchIn, user: CurrentUser, session: Session) -> SavedSearchOut:
    """Create or replace by name, so re-saving a preset never makes a duplicate."""
    row = await jobs.save_search(session, user.id, name=body.name.strip(), params=body.params)
    return SavedSearchOut.model_validate(row)


@router.delete("/saved-searches/{saved_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_search(saved_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    await session.delete(await _saved(session, user, saved_id))


@router.post("/saved-searches/{saved_id}/run", response_model=Page[JobCard])
async def run_saved_search(
    saved_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    offset: int = Query(default=0, ge=0),
) -> Page[JobCard]:
    saved = await _saved(session, user, saved_id)
    params = JobFilter.model_validate({**saved.params, "offset": offset})
    rows, total = await jobs.browse(session, user.id, params)
    await jobs.touch_saved_search(session, saved)
    return Page(items=await jobs.cards(session, user.id, rows), total=total, limit=params.limit, offset=offset)


@router.get("/upwork/{upwork_id}", response_model=JobDetail)
async def get_job_by_key(upwork_id: str, user: CurrentUser, session: Session) -> JobDetail:
    """The posting a browser has open, by the key in its Upwork address; 404 until it is in the list."""
    row = await jobs.job_by_key(session, upwork_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not in the shared list yet")
    return await jobs.detail(session, user.id, row)


@router.get("/{job_id}", response_model=JobDetail)
async def get_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobDetail:
    return await jobs.detail(session, user.id, await _job(session, job_id))


@router.post("/{job_id}/focus", response_model=JobCard)
async def focus_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobCard:
    """Focus: the posting joins this user's tracker at its first stage."""
    row = await _job(session, job_id)
    await jobs.focus(session, user.id, row)
    return await jobs.card(session, user.id, row)


@router.delete("/{job_id}/focus", response_model=JobCard)
async def unfocus_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobCard:
    row = await _job(session, job_id)
    await jobs.unfocus(session, user.id, row.id)
    return await jobs.card(session, user.id, row)


@router.post("/{job_id}/hide", response_model=JobCard)
async def hide_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobCard:
    """Hidden for this user only; everyone else still sees it."""
    row = await _job(session, job_id)
    await jobs.hide(session, user.id, row.id, True)
    return await jobs.card(session, user.id, row)


@router.delete("/{job_id}/hide", response_model=JobCard)
async def unhide_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobCard:
    row = await _job(session, job_id)
    await jobs.hide(session, user.id, row.id, False)
    return await jobs.card(session, user.id, row)
