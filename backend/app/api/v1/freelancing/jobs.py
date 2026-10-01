"""Phase 1: searching Upwork, and focusing the postings worth a bid."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status

from app.core.deps import CurrentUser, Session
from app.freelancing.errors import JobSourceError
from app.freelancing.services import jobs
from app.models.freelancing import FreelanceJob
from app.schemas.common import Page
from app.schemas.freelancing import (
    FilterCatalogue,
    JobCard,
    JobDetail,
    JobSearchPage,
    JobSearchParams,
    SavedSearchIn,
    SavedSearchOut,
    SkillSuggestion,
)

router = APIRouter(prefix="/jobs", tags=["freelancing: jobs"])


async def _owned(session: Session, user: CurrentUser, job_id: uuid.UUID) -> FreelanceJob:
    row = await jobs.get_job(session, user.id, job_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return row


# Static paths first: "/filters" would otherwise be read as a job id and 422.


@router.get("/filters", response_model=FilterCatalogue)
async def filters(user: CurrentUser, session: Session) -> FilterCatalogue:
    """Every control the search form renders, and which of them the source honours."""
    return await jobs.filter_catalogue(session, user.id)


@router.get("/skills", response_model=list[SkillSuggestion])
async def skills(
    user: CurrentUser,
    session: Session,
    q: str = Query(min_length=1, max_length=100),
    limit: int = Query(default=10, ge=1, le=25),
) -> list[SkillSuggestion]:
    return await jobs.suggest_skills(session, user.id, q, limit)


@router.post("/search", response_model=JobSearchPage)
async def search(body: JobSearchParams, user: CurrentUser, session: Session) -> JobSearchPage:
    """Run a search on Upwork and snapshot what comes back."""
    return await jobs.search_jobs(session, user.id, body)


@router.get("", response_model=Page[JobCard])
async def list_snapshots(
    user: CurrentUser,
    session: Session,
    focused: bool | None = Query(default=None),
    include_hidden: bool = Query(default=False),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[JobCard]:
    """Jobs already seen: the focused list, or everything still in the 24-hour window."""
    rows, total = await jobs.list_jobs(
        session, user.id, focused=focused, include_hidden=include_hidden,
        query=q, limit=limit, offset=offset,
    )
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
    for row in await jobs.list_saved_searches(session, user.id):
        if row.id == saved_id:
            await session.delete(row)
            return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved search not found")


@router.post("/saved-searches/{saved_id}/run", response_model=JobSearchPage)
async def run_saved_search(
    saved_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    cursor: str | None = Query(default=None),
) -> JobSearchPage:
    saved = next((r for r in await jobs.list_saved_searches(session, user.id) if r.id == saved_id), None)
    if saved is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved search not found")
    params = JobSearchParams.model_validate({**saved.params, "cursor": cursor})
    page = await jobs.search_jobs(session, user.id, params)
    await jobs.touch_saved_search(session, user.id, saved_id)
    return page


@router.get("/{job_id}", response_model=JobDetail)
async def get_job(
    job_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    refresh: bool = Query(default=False),
) -> JobDetail:
    """The posting, with its deeper aggregate fetched when stale.

    A failed fetch is not an error here: the snapshot is still the posting as
    last seen, and the card says how old it is.
    """
    row = await _owned(session, user, job_id)
    if refresh or not jobs.detail_is_fresh(row):
        try:
            await jobs.refresh_detail(session, user.id, row)
        except JobSourceError:
            if refresh:
                raise
    return await jobs.detail(session, user.id, row)


@router.post("/{job_id}/focus", response_model=JobCard)
async def focus_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobCard:
    """Focus: the posting joins the tracker at its first stage."""
    row = await _owned(session, user, job_id)
    return await jobs.card(session, user.id, await jobs.focus(session, user.id, row))


@router.delete("/{job_id}/focus", response_model=JobCard)
async def unfocus_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobCard:
    row = await _owned(session, user, job_id)
    return await jobs.card(session, user.id, await jobs.unfocus(session, user.id, row))


@router.post("/{job_id}/hide", response_model=JobCard)
async def hide_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobCard:
    row = await _owned(session, user, job_id)
    return await jobs.card(session, user.id, await jobs.hide(session, row, True))


@router.delete("/{job_id}/hide", response_model=JobCard)
async def unhide_job(job_id: uuid.UUID, user: CurrentUser, session: Session) -> JobCard:
    row = await _owned(session, user, job_id)
    return await jobs.card(session, user.id, await jobs.hide(session, row, False))
