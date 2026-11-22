"""The shared Upwork job list: registering captures, browsing, marks, saved searches.

Every user reads the same rows. Registering is race-free by construction:
``INSERT ... ON CONFLICT (upwork_id) DO NOTHING`` makes sure a posting exists
exactly once, then the rows are locked and merged, so two people capturing the
same posting at the same moment both land on one row.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, exists, func, literal_column, not_, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ids import uuid7
from app.core.timezone import utc_now
from app.freelancing.capture import COLUMNS, extras, instant, job_url, normalize, stored_view
from app.freelancing.countries import country_code, country_name
from app.models.enums import FreelanceJobType, FreelanceTrackStage
from app.models.freelancing import (
    FreelanceJob,
    FreelanceJobMark,
    FreelanceJobTrack,
    FreelanceSavedSearch,
    Proposal,
)
from app.schemas.freelancing import (
    CapturedJob,
    CapturedRef,
    CaptureOut,
    JobCard,
    JobDetail,
    JobFilter,
    Teammate,
)

# --- registering what the extension saw -----------------------------------------------


async def register(session: AsyncSession, user_id: uuid.UUID, captures: list[CapturedJob]) -> CaptureOut:
    """Create or refresh one shared row per posting from a batch of captures."""
    # The last capture of each view of each posting; a page can show both
    # (a search list with a posting open beside it).
    latest: dict[str, dict[str, CapturedJob]] = {}
    for capture in captures:
        latest.setdefault(capture.upwork_id, {})[capture.view] = capture
    keys = sorted(latest)  # one lock order for every batch, so two never deadlock

    first_title = {
        key: next((c.title for c in views.values() if c.title), None) or "Untitled posting"
        for key, views in latest.items()
    }
    created = set(
        await session.scalars(
            pg_insert(FreelanceJob)
            .values(
                [
                    {"id": uuid7(), "upwork_id": key, "title": first_title[key],
                     "url": job_url(key), "captured_by_id": user_id}
                    for key in keys
                ]
            )
            .on_conflict_do_nothing(index_elements=["upwork_id"])
            .returning(FreelanceJob.upwork_id)
        )
    )
    rows = list(
        await session.scalars(
            select(FreelanceJob)
            .where(FreelanceJob.upwork_id.in_(keys))
            .order_by(FreelanceJob.upwork_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )

    now = utc_now()
    for row in rows:
        views = latest[row.upwork_id]
        raw = dict(row.raw or {})
        for view, capture in views.items():
            raw[view] = stored_view(capture.model_dump(), now)
        columns = normalize(raw)
        raw["extras"] = columns.pop("extras", {})
        for key in COLUMNS:
            # Every column is re-derived from the views; only a title is never blanked.
            if key != "title" or columns.get(key):
                setattr(row, key, columns.get(key))
        row.client = columns.get("client") or {}
        row.published_at = columns.get("published_at") or row.published_at
        row.raw = raw
        row.last_seen_at = now
        if "detail" in views or "store" in views:
            row.detail_captured_at = now
    await session.flush()

    return CaptureOut(
        received=len(captures),
        created=len(created),
        jobs=[
            CapturedRef(upwork_id=row.upwork_id, id=row.id, title=row.title, created=row.upwork_id in created)
            for row in rows
        ],
    )


# --- reading the list ---------------------------------------------------------------


def _countries(values: list[str]) -> list[str]:
    """Lower-cased country names, whichever spelling (name or code) was typed."""
    out = []
    for value in values:
        code = country_code(value)
        out.append((country_name(code) if code else value).strip().lower())
    return out


def _skills_match(skills: list[str]):
    lowered = [s.lower() for s in skills]
    return exists(
        select(literal_column("1"))
        .select_from(func.unnest(FreelanceJob.skills).alias("skill"))
        .where(func.lower(literal_column("skill")).in_(lowered))
    )


def _filtered(stmt, user_id: uuid.UUID, f: JobFilter):
    """The filter's conditions on a statement over ``freelance_jobs``."""
    if f.query:
        for word in f.query.split():
            needle = f"%{word}%"
            stmt = stmt.where(
                or_(
                    FreelanceJob.title.ilike(needle),
                    FreelanceJob.description.ilike(needle),
                    func.array_to_string(FreelanceJob.skills, " ").ilike(needle),
                )
            )
    if f.skills:
        stmt = stmt.where(_skills_match(f.skills))
    for term in f.exclude_terms:
        needle = f"%{term}%"
        stmt = stmt.where(
            not_(FreelanceJob.title.ilike(needle)),
            or_(FreelanceJob.description.is_(None), not_(FreelanceJob.description.ilike(needle))),
        )
    if f.job_type:
        stmt = stmt.where(FreelanceJob.job_type == FreelanceJobType(f.job_type))
    if f.experience_level:
        stmt = stmt.where(func.upper(FreelanceJob.experience_level) == f.experience_level.upper())
    if f.hourly_rate_min is not None:
        stmt = stmt.where(
            or_(
                FreelanceJob.job_type.is_distinct_from(FreelanceJobType.HOURLY),
                func.coalesce(FreelanceJob.hourly_max, FreelanceJob.hourly_min) >= f.hourly_rate_min,
            )
        )
    if f.budget_min is not None or f.budget_max is not None:
        fixed = [FreelanceJob.budget_amount.is_not(None)]
        if f.budget_min is not None:
            fixed.append(FreelanceJob.budget_amount >= f.budget_min)
        if f.budget_max is not None:
            fixed.append(FreelanceJob.budget_amount <= f.budget_max)
        stmt = stmt.where(
            or_(FreelanceJob.job_type.is_distinct_from(FreelanceJobType.FIXED), and_(*fixed))
        )
    if f.posted_within_hours:
        since = utc_now() - timedelta(hours=f.posted_within_hours)
        stmt = stmt.where(func.coalesce(FreelanceJob.published_at, FreelanceJob.created_at) >= since)
    if f.verified_payment_only:
        stmt = stmt.where(FreelanceJob.client["payment_verified"].as_boolean().is_(True))
    if f.client_min_spent is not None:
        stmt = stmt.where(FreelanceJob.client["total_spent"].as_float() >= f.client_min_spent)
    if f.client_min_rating is not None:
        stmt = stmt.where(FreelanceJob.client["feedback"].as_float() >= f.client_min_rating)
    country = func.lower(FreelanceJob.client["country"].as_string())
    if f.client_locations:
        stmt = stmt.where(country.in_(_countries(f.client_locations)))
    if f.exclude_client_locations:
        stmt = stmt.where(or_(country.is_(None), country.not_in(_countries(f.exclude_client_locations))))
    if f.proposals_max is not None:
        stmt = stmt.where(FreelanceJob.total_applicants <= f.proposals_max)
    if f.open_to_country:
        (wanted,) = _countries([f.open_to_country])
        stmt = stmt.where(
            or_(
                func.cardinality(FreelanceJob.preferred_freelancer_location) == 0,
                exists(
                    select(literal_column("1"))
                    .select_from(func.unnest(FreelanceJob.preferred_freelancer_location).alias("place"))
                    .where(func.lower(literal_column("place")) == wanted)
                ),
            )
        )
    if f.hide_hidden:
        stmt = stmt.where(
            ~exists().where(
                FreelanceJobMark.job_id == FreelanceJob.id,
                FreelanceJobMark.user_id == user_id,
                FreelanceJobMark.hidden_at.is_not(None),
            )
        )
    return stmt


async def browse(session: AsyncSession, user_id: uuid.UUID, f: JobFilter) -> tuple[list[FreelanceJob], int]:
    stmt = _filtered(select(FreelanceJob), user_id, f)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = (
        [FreelanceJob.created_at.desc()]
        if f.sort == "captured"
        else [func.coalesce(FreelanceJob.published_at, FreelanceJob.created_at).desc()]
    )
    rows = await session.scalars(stmt.order_by(*order, FreelanceJob.id.desc()).limit(f.limit).offset(f.offset))
    return list(rows), total


async def focused(session: AsyncSession, user_id: uuid.UUID, *, limit: int, offset: int) -> tuple[list[FreelanceJob], int]:
    """This user's starred postings, most recently starred first."""
    stmt = select(FreelanceJob).join(
        FreelanceJobMark,
        and_(
            FreelanceJobMark.job_id == FreelanceJob.id,
            FreelanceJobMark.user_id == user_id,
            FreelanceJobMark.focused_at.is_not(None),
        ),
    )
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await session.scalars(stmt.order_by(FreelanceJobMark.focused_at.desc()).limit(limit).offset(offset))
    return list(rows), total


async def get_job(session: AsyncSession, job_id: uuid.UUID) -> FreelanceJob | None:
    return await session.get(FreelanceJob, job_id)


async def job_by_key(session: AsyncSession, upwork_id: str) -> FreelanceJob | None:
    return await session.scalar(select(FreelanceJob).where(FreelanceJob.upwork_id == upwork_id.lower()))


async def marks(session: AsyncSession, user_id: uuid.UUID, job_ids: list[uuid.UUID]) -> dict[uuid.UUID, FreelanceJobMark]:
    if not job_ids:
        return {}
    return {
        m.job_id: m
        for m in await session.scalars(
            select(FreelanceJobMark).where(
                FreelanceJobMark.user_id == user_id, FreelanceJobMark.job_id.in_(job_ids)
            )
        )
    }


async def cards(session: AsyncSession, user_id: uuid.UUID, rows: list[FreelanceJob]) -> list[JobCard]:
    """Shared rows with this user's marks, stage, proposal count and who is watching."""
    from app.freelancing.services.watch import watchers

    if not rows:
        return []
    ids = [r.id for r in rows]
    mine = await marks(session, user_id, ids)
    watching = await watchers(session, user_id, ids)
    stages = dict(
        (
            await session.execute(
                select(FreelanceJobTrack.job_id, FreelanceJobTrack.stage).where(
                    FreelanceJobTrack.user_id == user_id, FreelanceJobTrack.job_id.in_(ids)
                )
            )
        ).all()
    )
    counts = dict(
        (
            await session.execute(
                select(Proposal.job_id, func.count())
                .where(Proposal.user_id == user_id, Proposal.job_id.in_(ids))
                .group_by(Proposal.job_id)
            )
        ).all()
    )
    out = []
    for row in rows:
        mark = mine.get(row.id)
        found = extras(row.raw)
        activity = found["activity"]
        out.append(
            JobCard.model_validate(row).model_copy(
                update={
                    "focused_at": mark.focused_at if mark else None,
                    "hidden_at": mark.hidden_at if mark else None,
                    "track_stage": stages.get(row.id),
                    "proposal_count": counts.get(row.id, 0),
                    "proposals_label": found["proposals_label"],
                    "connects_required": found["connects_required"],
                    "client_activity_at": instant(activity.get("last_client_activity")),
                    "interviewing": activity.get("total_invited_to_interview"),
                    "watchers": watching.get(row.id, []),
                }
            )
        )
    return out


async def card(session: AsyncSession, user_id: uuid.UUID, row: FreelanceJob) -> JobCard:
    return (await cards(session, user_id, [row]))[0]


async def detail(session: AsyncSession, user_id: uuid.UUID, row: FreelanceJob) -> JobDetail:
    from app.freelancing.services.watch import display_names

    base = await card(session, user_id, row)
    found = extras(row.raw)
    poster = row.captured_by_id
    name = (await display_names(session, {poster})).get(poster) if poster else None
    return JobDetail(
        **base.model_dump(),
        detail_captured_at=row.detail_captured_at,
        screening_questions=found["screening_questions"],
        activity=found["activity"],
        posted_by=Teammate(name=name, you=poster == user_id) if name else None,
    )


# --- this user's marks ----------------------------------------------------------------


async def _mark(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> FreelanceJobMark:
    mark = await session.get(FreelanceJobMark, (user_id, job_id))
    if mark is None:
        mark = FreelanceJobMark(user_id=user_id, job_id=job_id)
        session.add(mark)
    return mark


async def _settle(session: AsyncSession, mark: FreelanceJobMark) -> None:
    """A mark with nothing set says nothing, so it goes."""
    if mark.focused_at is None and mark.hidden_at is None:
        await session.delete(mark)
    await session.flush()


async def focus(session: AsyncSession, user_id: uuid.UUID, row: FreelanceJob) -> None:
    from app.freelancing.services.tracking import ensure_track

    mark = await _mark(session, user_id, row.id)
    mark.focused_at = mark.focused_at or utc_now()
    mark.hidden_at = None
    await ensure_track(session, user_id, row)
    await session.flush()


async def clear_focus(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> None:
    mark = await session.get(FreelanceJobMark, (user_id, job_id))
    if mark is not None:
        mark.focused_at = None
        await _settle(session, mark)


async def unfocus(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> None:
    await clear_focus(session, user_id, job_id)
    track = await session.scalar(
        select(FreelanceJobTrack).where(
            FreelanceJobTrack.user_id == user_id, FreelanceJobTrack.job_id == job_id
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


async def hide(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID, hidden: bool) -> None:
    if hidden:
        mark = await _mark(session, user_id, job_id)
        mark.hidden_at = utc_now()
        mark.focused_at = None
        await session.flush()
        return
    mark = await session.get(FreelanceJobMark, (user_id, job_id))
    if mark is not None:
        mark.hidden_at = None
        await _settle(session, mark)


async def focused_at(
    session: AsyncSession, user_id: uuid.UUID, job_ids: set[uuid.UUID]
) -> dict[uuid.UUID, datetime | None]:
    """When this user starred each of these postings, for the briefs on proposals and tracks."""
    return {job_id: m.focused_at for job_id, m in (await marks(session, user_id, list(job_ids))).items()}


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
    session: AsyncSession, user_id: uuid.UUID, *, name: str, params: JobFilter
) -> FreelanceSavedSearch:
    row = await session.scalar(
        select(FreelanceSavedSearch).where(
            FreelanceSavedSearch.user_id == user_id, FreelanceSavedSearch.name == name
        )
    )
    # Paging is a position in one result list, not part of the search.
    stored = params.model_dump(exclude={"limit", "offset"}, exclude_defaults=True)
    if row is None:
        row = FreelanceSavedSearch(user_id=user_id, name=name, params=stored)
        session.add(row)
    else:
        row.params = stored
    await session.flush()
    return row


async def touch_saved_search(session: AsyncSession, row: FreelanceSavedSearch) -> None:
    row.last_run_at = utc_now()

