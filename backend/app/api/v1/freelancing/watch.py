"""Watching a posting's client from the extension, and the team's alert feed."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status

from app.core.deps import CurrentUser, Session
from app.freelancing.services import watch
from app.schemas.freelancing import AlertFeed, WatchOut, WatchPatch, WatchReport

router = APIRouter(tags=["freelancing: watch"])

_NOT_WATCHING = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not watching this job")


@router.post("/watches", response_model=WatchOut)
async def report(body: WatchReport, user: CurrentUser, session: Session) -> WatchOut:
    """A heartbeat for a posting open in this user's browser, with a fresh reading when there is one.

    The reading updates the shared row. The answer says whether this user's
    alerts are on, who else is watching and who relays, and what this user's
    own watch just saw, for the extension to announce.
    """
    try:
        return await watch.report(session, user.id, body)
    except watch.WatchNotFound:
        raise _NOT_WATCHING from None


@router.patch("/watches/{job_id}", response_model=WatchOut)
async def set_notify(job_id: uuid.UUID, body: WatchPatch, user: CurrentUser, session: Session) -> WatchOut:
    try:
        return await watch.set_notify(session, user.id, job_id, body.notify)
    except watch.WatchNotFound:
        raise _NOT_WATCHING from None


@router.delete("/watches/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def leave(job_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    await watch.leave(session, user.id, job_id)


@router.get("/alerts", response_model=AlertFeed)
async def alerts(
    user: CurrentUser,
    session: Session,
    after: int | None = Query(default=None, ge=0, description="Only alerts newer than this cursor"),
    limit: int = Query(default=20, ge=1, le=100),
) -> AlertFeed:
    """What the team's relays reported, newest first. ``local`` marks the ones this user's own watch saw."""
    return await watch.feed(session, user.id, after=after, limit=limit)
