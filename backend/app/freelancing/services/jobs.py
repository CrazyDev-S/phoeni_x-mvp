"""Job search, snapshots, focus, and saved searches.

Searches go to whichever ``JobSource`` is in service (``sources.registry``);
this module never speaks a provider's own vocabulary.

Upwork's terms allow caching a posting for 24 hours. A snapshot the user has
not focused, hidden, tracked or written a proposal for is therefore pruned
once it has not been seen for a day. Focused jobs are the user's own list and
stay; that is what makes the tracker possible at all.
"""

from __future__ import annotations

import time
import uuid
from datetime import timedelta

from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now
from app.freelancing.countries import same_country
from app.freelancing.errors import JobSourceError
from app.freelancing.snapshot import extras as snapshot_extras
from app.freelancing.sources.registry import describe_source, get_source
from app.freelancing.upwork.filters import (
    DURATION_OPTIONS,
    EXPERIENCE_OPTIONS,
    JOB_TYPE_OPTIONS,
    PAGE_SIZES,
    SORT_OPTIONS,
    WORKLOAD_OPTIONS,
)
from app.models.enums import FreelanceTrackStage
from app.models.freelancing import (
    FreelanceJob,
    FreelanceJobTrack,
    FreelanceSavedSearch,
    Proposal,
)
from app.schemas.freelancing import (
    CategoryOption,
    FilterCatalogue,
    JobCard,
    JobDetail,
    JobSearchPage,
    JobSearchParams,
    SkillSuggestion,
)

SNAPSHOT_TTL = timedelta(hours=24)
DETAIL_TTL = timedelta(hours=6)
CATEGORY_CACHE_SECONDS = 12 * 3600

# A category tree is the same for everyone and changes rarely; cached per source.
_categories_cache: tuple[str, float, list[CategoryOption]] | None = None


async def search_jobs(session: AsyncSession, user_id: uuid.UUID, params: JobSearchParams) -> JobSearchPage:
    source = await get_source(session, user_id)
    page = await source.search(params)
    if page.pending:
        return JobSearchPage(
            items=[], pending=True, end_cursor=page.end_cursor, progress_note=page.note
        )
    rows = await _upsert_snapshots(session, user_id, page.snapshots)

    hidden = 0
    kept: list[FreelanceJob] = []
    for row in rows:
        if params.hide_hidden and row.hidden_at is not None:
            hidden += 1
            continue
        if params.hide_applied and (row.raw or {}).get("applied"):
            hidden += 1
            continue
        if params.open_to_country and not open_to(row, params.open_to_country):
            hidden += 1
            continue
        kept.append(row)

    await prune_stale(session, user_id)

    return JobSearchPage(
        items=await cards(session, user_id, kept),
        total=page.total,
        has_next_page=page.has_next_page,
        end_cursor=page.end_cursor,
        hidden_count=hidden,
        notice=page.notice,
    )


def open_to(row: FreelanceJob, country: str) -> bool:
    """False when the posting only accepts applicants from other countries."""
    allowed = [c for c in (row.preferred_freelancer_location or []) if c]
    if not allowed:
        return True
    # Upwork's own API marks a preference that is only a preference.
    if (row.raw or {}).get("preferredFreelancerLocationMandatory") is False:
        return True
    # "Thailand" and "TH" are the same country, whichever a source used.
    return any(same_country(country, place) for place in allowed)


async def _upsert_snapshots(
    session: AsyncSession, user_id: uuid.UUID, snapshots: list[dict]
) -> list[FreelanceJob]:
    """Write the source's snapshots, one row per posting, updating rows seen before."""
    if not snapshots:
        return []
    ids = [str(s["upwork_id"]) for s in snapshots]
    existing = {
        row.upwork_id: row
        for row in await session.scalars(
            select(FreelanceJob).where(
                FreelanceJob.user_id == user_id, FreelanceJob.upwork_id.in_(ids)
            )
        )
    }
    now = utc_now()
    rows: list[FreelanceJob] = []
    seen: set[str] = set()
    for snapshot in snapshots:
        snapshot = {**snapshot, "upwork_id": str(snapshot["upwork_id"])}
        if snapshot["upwork_id"] in seen:
            continue
        seen.add(snapshot["upwork_id"])
        row = existing.get(snapshot["upwork_id"])
        if row is None:
            row = FreelanceJob(user_id=user_id, **snapshot)
            session.add(row)
        else:
            # The search result is authoritative for what it carries; the deeper
            # aggregate fetched earlier is kept alongside it.
            detail = (row.raw or {}).get("detail")
            if detail is not None:
                snapshot["raw"] = {**(snapshot.get("raw") or {}), "detail": detail}
            for key, value in snapshot.items():
                setattr(row, key, value)
        row.last_seen_at = now
        rows.append(row)
    await session.flush()
    return rows


async def prune_stale(session: AsyncSession, user_id: uuid.UUID) -> int:
    """Drop snapshots nothing refers to once they are a day old."""
    cutoff = utc_now() - SNAPSHOT_TTL
    stale = list(
        await session.scalars(
            select(FreelanceJob).where(
                FreelanceJob.user_id == user_id,
                FreelanceJob.focused_at.is_(None),
                FreelanceJob.hidden_at.is_(None),
                FreelanceJob.last_seen_at < cutoff,
                ~exists().where(FreelanceJobTrack.job_id == FreelanceJob.id),
                ~exists().where(Proposal.job_id == FreelanceJob.id),
            )
        )
    )
    for row in stale:
        await session.delete(row)
    if stale:
        await session.flush()
    return len(stale)


async def cards(session: AsyncSession, user_id: uuid.UUID, rows: list[FreelanceJob]) -> list[JobCard]:
    """Cards with what the tracker and proposals know about each job, in two queries."""
    if not rows:
        return []
    ids = [r.id for r in rows]
    stages = {
        job_id: stage
        for job_id, stage in await session.execute(
            select(FreelanceJobTrack.job_id, FreelanceJobTrack.stage).where(
                FreelanceJobTrack.user_id == user_id, FreelanceJobTrack.job_id.in_(ids)
            )
        )
    }
    counts = {
        job_id: count
        for job_id, count in await session.execute(
            select(Proposal.job_id, func.count())
            .where(Proposal.user_id == user_id, Proposal.job_id.in_(ids))
            .group_by(Proposal.job_id)
        )
    }
    return [
        JobCard.model_validate(row).model_copy(
            update={
                "applied": bool((row.raw or {}).get("applied")),
                "track_stage": stages.get(row.id),
                "proposal_count": counts.get(row.id, 0),
                **_card_extras(row.raw),
            }
        )
        for row in rows
    ]


def _card_extras(raw: dict | None) -> dict:
    """Connects cost, featured, job score: from the source's record, when it has them."""
    extras = (raw or {}).get("extras") or {}
    connects = extras.get("connects_required")
    score = extras.get("job_score")
    return {
        "connects_required": int(connects) if isinstance(connects, (int, float)) else None,
        "featured": bool(extras.get("featured")),
        "job_score": float(score) if isinstance(score, (int, float)) else None,
    }


async def card(session: AsyncSession, user_id: uuid.UUID, row: FreelanceJob) -> JobCard:
    return (await cards(session, user_id, [row]))[0]


async def detail(session: AsyncSession, user_id: uuid.UUID, row: FreelanceJob) -> JobDetail:
    base = await card(session, user_id, row)
    return JobDetail(
        **base.model_dump(),
        detail_fetched_at=row.detail_fetched_at,
        **snapshot_extras(row.raw),
    )


async def get_job(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> FreelanceJob | None:
    return await session.scalar(
        select(FreelanceJob).where(FreelanceJob.id == job_id, FreelanceJob.user_id == user_id)
    )


async def refresh_detail(session: AsyncSession, user_id: uuid.UUID, row: FreelanceJob) -> bool:
    """Fetch the posting's deeper aggregate. False when the source has none."""
    if not describe_source().detail:
        return False
    source = await get_source(session, user_id)
    updates = await source.detail(row)
    if updates is None:
        return False
    for key, value in updates.items():
        setattr(row, key, value)
    row.detail_fetched_at = utc_now()
    await session.flush()
    return True


def detail_is_fresh(row: FreelanceJob) -> bool:
    """Fresh, or not something this source can fetch at all."""
    if not describe_source().detail:
        return True
    return row.detail_fetched_at is not None and utc_now() - row.detail_fetched_at < DETAIL_TTL


async def list_jobs(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    focused: bool | None,
    include_hidden: bool,
    query: str | None,
    limit: int,
    offset: int,
) -> tuple[list[FreelanceJob], int]:
    stmt = select(FreelanceJob).where(FreelanceJob.user_id == user_id)
    if focused is True:
        stmt = stmt.where(FreelanceJob.focused_at.is_not(None))
    elif focused is False:
        stmt = stmt.where(FreelanceJob.focused_at.is_(None))
    if not include_hidden:
        stmt = stmt.where(FreelanceJob.hidden_at.is_(None))
    if query:
        needle = f"%{query.strip()}%"
        stmt = stmt.where(
            or_(
                FreelanceJob.title.ilike(needle),
                FreelanceJob.description.ilike(needle),
                func.array_to_string(FreelanceJob.skills, " ").ilike(needle),
            )
        )
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = (
        FreelanceJob.focused_at.desc().nulls_last()
        if focused
        else FreelanceJob.last_seen_at.desc()
    )
    rows = list(await session.scalars(stmt.order_by(order, FreelanceJob.created_at.desc()).limit(limit).offset(offset)))
    return rows, total


async def focus(session: AsyncSession, user_id: uuid.UUID, row: FreelanceJob) -> FreelanceJob:
    from app.freelancing.services.tracking import ensure_track

    if row.focused_at is None:
        row.focused_at = utc_now()
    row.hidden_at = None
    await ensure_track(session, user_id, row)
    await session.flush()
    return row


async def unfocus(session: AsyncSession, user_id: uuid.UUID, row: FreelanceJob) -> FreelanceJob:
    row.focused_at = None
    track = await session.scalar(
        select(FreelanceJobTrack).where(
            FreelanceJobTrack.user_id == user_id, FreelanceJobTrack.job_id == row.id
        )
    )
    # A track that never left "focused" and has no proposal carries nothing
    # worth keeping; anything further along is history and stays.
    if (
        track is not None
        and track.stage is FreelanceTrackStage.FOCUSED
        and track.proposal_id is None
        and not track.notes_markdown
    ):
        await session.delete(track)
    await session.flush()
    return row


async def hide(session: AsyncSession, row: FreelanceJob, hidden: bool) -> FreelanceJob:
    row.hidden_at = utc_now() if hidden else None
    if hidden:
        row.focused_at = None
    await session.flush()
    return row


# --- catalogue -------------------------------------------------------------------


async def filter_catalogue(session: AsyncSession, user_id: uuid.UUID) -> FilterCatalogue:
    source = describe_source()
    catalogue = FilterCatalogue(
        source=source,
        job_types=JOB_TYPE_OPTIONS,
        workloads=WORKLOAD_OPTIONS,
        durations=DURATION_OPTIONS,
        experience_levels=EXPERIENCE_OPTIONS,
        sorts=[option for option in SORT_OPTIONS if option.value in source.sorts],
        page_sizes=PAGE_SIZES,
    )
    if source.categories:
        try:
            catalogue.categories = await categories(session, user_id)
        except JobSourceError as exc:
            catalogue.categories_error = exc.message
    return catalogue


async def categories(session: AsyncSession, user_id: uuid.UUID) -> list[CategoryOption]:
    global _categories_cache
    key = describe_source().key
    if (
        _categories_cache
        and _categories_cache[0] == key
        and time.monotonic() - _categories_cache[1] < CATEGORY_CACHE_SECONDS
    ):
        return _categories_cache[2]
    source = await get_source(session, user_id)
    options = await source.categories()
    _categories_cache = (key, time.monotonic(), options)
    return options


async def suggest_skills(session: AsyncSession, user_id: uuid.UUID, label: str, limit: int = 10) -> list[SkillSuggestion]:
    if not describe_source().skills:
        return []
    source = await get_source(session, user_id)
    return await source.suggest_skills(label, limit)


# --- saved searches ---------------------------------------------------------------


async def list_saved_searches(session: AsyncSession, user_id: uuid.UUID) -> list[FreelanceSavedSearch]:
    return list(
        await session.scalars(
            select(FreelanceSavedSearch)
            .where(FreelanceSavedSearch.user_id == user_id)
            .order_by(FreelanceSavedSearch.name)
        )
    )


async def save_search(
    session: AsyncSession, user_id: uuid.UUID, *, name: str, params: JobSearchParams
) -> FreelanceSavedSearch:
    row = await session.scalar(
        select(FreelanceSavedSearch).where(
            FreelanceSavedSearch.user_id == user_id, FreelanceSavedSearch.name == name
        )
    )
    # The cursor is a position in one result set, not part of the search.
    stored = params.model_dump(exclude={"cursor"}, exclude_defaults=True)
    if row is None:
        row = FreelanceSavedSearch(user_id=user_id, name=name, params=stored)
        session.add(row)
    else:
        row.params = stored
    await session.flush()
    return row


async def touch_saved_search(session: AsyncSession, user_id: uuid.UUID, saved_id: uuid.UUID) -> None:
    row = await session.scalar(
        select(FreelanceSavedSearch).where(
            FreelanceSavedSearch.id == saved_id, FreelanceSavedSearch.user_id == user_id
        )
    )
    if row is not None:
        row.last_run_at = utc_now()
