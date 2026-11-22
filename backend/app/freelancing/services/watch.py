"""Watching a posting's client while it is open on Upwork, and telling the team.

The extension reports every posting open in a user's browser (``report``): a
fresh reading of Upwork's own page state when the page loads and on each
background refresh, and a bare heartbeat in between. Every reading goes
through ``jobs.register``, so the shared list shows what the client is doing
as it happens.

**Whose alert.** Each user's watch keeps its own baseline - the last client
visit and interview count *that user* saw - so their extension announces only
what their own watch found. Of everyone watching a posting with alerts on, the
earliest is the **relay**: only the relay's findings become alerts for the rest
of the team (``FreelanceJobAlert``), and whoever was already told by their own
watch is left out of them. When the relay leaves or goes quiet, the next
earliest takes over.

**Alerts start off** for a posting someone is already relaying: the relay tells
that user anyway, so their browser need not check Upwork as well. Turning
alerts on (``set_notify``) makes theirs a watch like any other.

Every report for a posting runs under its row lock (``register`` takes it, a
heartbeat takes it here), so two watchers never both think they relay.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now
from app.freelancing.capture import extras, instant
from app.freelancing.services import jobs
from app.models.enums import FreelanceAlertKind
from app.models.freelancing import (
    FreelanceJob,
    FreelanceJobAlert,
    FreelanceJobMark,
    FreelanceJobWatch,
)
from app.models.user import User
from app.schemas.freelancing import (
    AlertFeed,
    AlertOut,
    CapturedJob,
    Watcher,
    WatchEvent,
    WatchOut,
    WatchReport,
)

# The extension beats about every two minutes; three missed beats end a watch.
WATCH_TTL = timedelta(minutes=6)
# A client visit already this old when first seen is history, not news.
FRESH = timedelta(minutes=5)
# Client activity this long after the last seen is a new visit; sooner is the same one.
NEW_VISIT = timedelta(minutes=5)


class WatchNotFound(LookupError):
    """No such posting, or this user is not watching it."""


# --- the extension's calls --------------------------------------------------------------


async def report(session: AsyncSession, user_id: uuid.UUID, body: WatchReport) -> WatchOut:
    """Record a heartbeat (and a reading, when there is one) from this user's watch."""
    now = utc_now()
    if body.state is not None:
        captured = await jobs.register(
            session,
            user_id,
            [CapturedJob(upwork_id=body.upwork_id, view="store", url=body.url, state=body.state)],
        )
        job = await session.get(FreelanceJob, captured.jobs[0].id)
    else:
        job = await _locked(session, FreelanceJob.upwork_id == body.upwork_id)
    if job is None:
        raise WatchNotFound

    watches = await _watches(session, job.id)
    mine = _join(session, watches, user_id, job.id, now)
    mine.last_seen_at = now
    events = _observe(mine, extras(job.raw)["activity"], now) if body.state is not None else []
    if events and _relay(watches, now) is mine:
        await _broadcast(session, job.id, watches, events, now)
    await session.flush()
    return await _out(session, user_id, job, watches, now, events if mine.notify else [])


async def set_notify(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID, notify: bool) -> WatchOut:
    now = utc_now()
    job = await _locked(session, FreelanceJob.id == job_id)
    watches = await _watches(session, job_id) if job else []
    mine = next((w for w in watches if w.user_id == user_id), None)
    if job is None or mine is None:
        raise WatchNotFound
    if not _live(mine, now):
        mine.started_at, mine.ended_at = now, None
    mine.notify = notify
    mine.last_seen_at = now
    await session.flush()
    return await _out(session, user_id, job, watches, now, [])


async def leave(session: AsyncSession, user_id: uuid.UUID, job_id: uuid.UUID) -> None:
    """The posting is no longer open anywhere in this user's browser."""
    mine = await session.get(FreelanceJobWatch, (user_id, job_id))
    if mine is not None and mine.ended_at is None:
        mine.ended_at = utc_now()
        await session.flush()


# --- the team feed ---------------------------------------------------------------------


async def feed(session: AsyncSession, user_id: uuid.UUID, *, after: int | None, limit: int) -> AlertFeed:
    """Alerts for this user, newest first: everything relayed, minus postings they hid."""
    cursor = await session.scalar(select(func.max(FreelanceJobAlert.id))) or 0
    hidden = exists().where(
        FreelanceJobMark.job_id == FreelanceJobAlert.job_id,
        FreelanceJobMark.user_id == user_id,
        FreelanceJobMark.hidden_at.is_not(None),
    )
    stmt = (
        select(FreelanceJobAlert, FreelanceJob.title, FreelanceJob.url, User.display_name, User.email)
        .join(FreelanceJob, FreelanceJob.id == FreelanceJobAlert.job_id)
        .outerjoin(User, User.id == FreelanceJobAlert.relay_user_id)
        .where(~hidden)
    )
    if after is not None:
        stmt = stmt.where(FreelanceJobAlert.id > after)
    rows = await session.execute(stmt.order_by(FreelanceJobAlert.id.desc()).limit(limit))
    items = [
        AlertOut(
            id=alert.id,
            kind=alert.kind,
            job_id=alert.job_id,
            title=title,
            url=url,
            relay_name=_display(name, email) if email else None,
            local=user_id in alert.local_user_ids,
            client_activity_at=alert.client_activity_at,
            interviewing=alert.interviewing,
            previous_interviewing=alert.previous_interviewing,
            occurred_at=alert.occurred_at,
        )
        for alert, title, url, name, email in rows
    ]
    return AlertFeed(items=items, cursor=max(cursor, after or 0))


async def watchers(
    session: AsyncSession, user_id: uuid.UUID, job_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[Watcher]]:
    """Who is watching each of these postings right now, for the shared list."""
    if not job_ids:
        return {}
    now = utc_now()
    rows = list(
        await session.scalars(
            select(FreelanceJobWatch).where(
                FreelanceJobWatch.job_id.in_(job_ids),
                FreelanceJobWatch.ended_at.is_(None),
                FreelanceJobWatch.last_seen_at >= now - WATCH_TTL,
            )
        )
    )
    names = await display_names(session, {w.user_id for w in rows})
    grouped: dict[uuid.UUID, list[FreelanceJobWatch]] = {}
    for row in rows:
        grouped.setdefault(row.job_id, []).append(row)
    return {job_id: _describe(group, user_id, names, now) for job_id, group in grouped.items()}


# --- how a watch decides ----------------------------------------------------------------


def _live(watch: FreelanceJobWatch, now: datetime) -> bool:
    return watch.ended_at is None and watch.last_seen_at is not None and now - watch.last_seen_at <= WATCH_TTL


def _join(
    session: AsyncSession, watches: list[FreelanceJobWatch], user_id: uuid.UUID, job_id: uuid.UUID, now: datetime
) -> FreelanceJobWatch:
    """This user's watch; a new one (or one back after a gap) starts behind anyone relaying."""
    mine = next((w for w in watches if w.user_id == user_id), None)
    if mine is not None and _live(mine, now):
        return mine
    relayed = any(w.notify and _live(w, now) for w in watches if w.user_id != user_id)
    if mine is None:
        mine = FreelanceJobWatch(user_id=user_id, job_id=job_id)
        session.add(mine)
        watches.append(mine)
    mine.notify = not relayed
    mine.started_at, mine.ended_at = now, None
    return mine


def _observe(watch: FreelanceJobWatch, activity: dict, now: datetime) -> list[WatchEvent]:
    """What this reading shows that this watch had not seen, moving its baseline on."""
    events: list[WatchEvent] = []
    visit = instant(activity.get("last_client_activity"))
    if visit is not None:
        last = watch.seen_client_activity_at
        if now - visit <= FRESH and (last is None or visit - last >= NEW_VISIT):
            events.append(WatchEvent(kind=FreelanceAlertKind.CLIENT_VIEWED, client_activity_at=visit))
        if last is None or visit > last:
            watch.seen_client_activity_at = visit
    count = activity.get("total_invited_to_interview")
    if isinstance(count, int):
        if watch.seen_interviewing is not None and count > watch.seen_interviewing:
            events.append(
                WatchEvent(
                    kind=FreelanceAlertKind.INTERVIEW_STARTED,
                    interviewing=count,
                    previous_interviewing=watch.seen_interviewing,
                )
            )
        watch.seen_interviewing = count
    return events


def _relay(watches: list[FreelanceJobWatch], now: datetime) -> FreelanceJobWatch | None:
    live = [w for w in watches if w.notify and _live(w, now)]
    return min(live, key=lambda w: (w.started_at, str(w.user_id)), default=None)


async def _broadcast(
    session: AsyncSession,
    job_id: uuid.UUID,
    watches: list[FreelanceJobWatch],
    events: list[WatchEvent],
    now: datetime,
) -> None:
    """The relay's findings, as alerts for everyone its fellow watchers have not told themselves."""
    relay = _relay(watches, now)
    told = [w.user_id for w in watches if w.notify and _live(w, now)]
    for event in events:
        if await _already_alerted(session, job_id, event):
            continue
        session.add(
            FreelanceJobAlert(
                job_id=job_id,
                kind=event.kind,
                client_activity_at=event.client_activity_at,
                interviewing=event.interviewing,
                previous_interviewing=event.previous_interviewing,
                relay_user_id=relay.user_id if relay else None,
                local_user_ids=told,
                occurred_at=now,
            )
        )


async def _already_alerted(session: AsyncSession, job_id: uuid.UUID, event: WatchEvent) -> bool:
    """One alert per client visit and per interview count, whoever relayed it.

    A relay taking over may have seen less than the one before it, so its
    first findings can be ones the team was already told.
    """
    last = await session.scalar(
        select(FreelanceJobAlert)
        .where(FreelanceJobAlert.job_id == job_id, FreelanceJobAlert.kind == event.kind)
        .order_by(FreelanceJobAlert.id.desc())
        .limit(1)
    )
    if last is None:
        return False
    if event.kind is FreelanceAlertKind.CLIENT_VIEWED:
        return (
            last.client_activity_at is not None
            and event.client_activity_at is not None
            and event.client_activity_at - last.client_activity_at < NEW_VISIT
        )
    return last.interviewing is not None and (event.interviewing or 0) <= last.interviewing


# --- reading and describing -------------------------------------------------------------


async def _locked(session: AsyncSession, where) -> FreelanceJob | None:
    return await session.scalar(
        select(FreelanceJob).where(where).with_for_update().execution_options(populate_existing=True)
    )


async def _watches(session: AsyncSession, job_id: uuid.UUID) -> list[FreelanceJobWatch]:
    return list(await session.scalars(select(FreelanceJobWatch).where(FreelanceJobWatch.job_id == job_id)))


async def display_names(session: AsyncSession, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not user_ids:
        return {}
    rows = await session.execute(select(User.id, User.display_name, User.email).where(User.id.in_(user_ids)))
    return {uid: _display(name, email) for uid, name, email in rows}


def _display(name: str | None, email: str) -> str:
    return (name or "").strip() or email.split("@", 1)[0]


def _describe(
    watches: list[FreelanceJobWatch], user_id: uuid.UUID, names: dict[uuid.UUID, str], now: datetime
) -> list[Watcher]:
    relay = _relay(watches, now)
    live = sorted((w for w in watches if _live(w, now)), key=lambda w: w.started_at)
    return [
        Watcher(
            name=names.get(w.user_id, "Someone"),
            you=w.user_id == user_id,
            notify=w.notify,
            relay=w is relay,
        )
        for w in live
    ]


async def _out(
    session: AsyncSession,
    user_id: uuid.UUID,
    job: FreelanceJob,
    watches: list[FreelanceJobWatch],
    now: datetime,
    events: list[WatchEvent],
) -> WatchOut:
    mine = next(w for w in watches if w.user_id == user_id)
    names = await display_names(session, {w.user_id for w in watches if _live(w, now)})
    return WatchOut(
        job_id=job.id,
        upwork_id=job.upwork_id,
        title=job.title,
        url=job.url,
        notify=mine.notify,
        relay=_relay(watches, now) is mine,
        watchers=_describe(watches, user_id, names, now),
        total_applicants=job.total_applicants,
        activity=extras(job.raw)["activity"],
        events=events,
    )
