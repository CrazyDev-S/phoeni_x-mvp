"""Which job source answers searches, and whether this user can use it yet."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser, Session
from app.freelancing.sources.registry import source_status
from app.schemas.freelancing import JobSourceStatus

router = APIRouter(prefix="/source", tags=["freelancing: jobs"])


@router.get("", response_model=JobSourceStatus)
async def read_source(user: CurrentUser, session: Session) -> JobSourceStatus:
    """The source in service, the controls it honours, and what to set up if it is not ready."""
    return await source_status(session, user.id)
