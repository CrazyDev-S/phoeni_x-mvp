"""Which job source is in service.

Selected by ``FREELANCING_JOB_SOURCE`` for the whole deployment. Each entry
has a factory that builds the source for one user, and a readiness check that
says - without calling the provider - whether that user can search now and,
if not, what to set up. A source that needs the user's own credential
(Upwork's OAuth token, an Apify token) and one that needs only a deployment
key look the same from here.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.freelancing.apify.profiles import active_profile
from app.freelancing.errors import JobSourceError
from app.freelancing.services import apify_connection, connection
from app.freelancing.sources.apify_upwork import ApifyUpworkSource
from app.freelancing.sources.base import JobSource
from app.freelancing.sources.upwork_graphql import UpworkGraphQLSource
from app.schemas.freelancing import JobSourceInfo, JobSourceStatus

SourceFactory = Callable[[AsyncSession, uuid.UUID], Awaitable[JobSource]]
# (ready, what to do when not)
Readiness = Callable[[AsyncSession, uuid.UUID], Awaitable[tuple[bool, str | None]]]


@dataclass(frozen=True)
class Registration:
    # A callable, not a value: the Apify source's filters depend on which
    # actor is configured, and that is read when asked, not at import.
    info: Callable[[], JobSourceInfo]
    factory: SourceFactory
    readiness: Readiness


async def _always_ready(session: AsyncSession, user_id: uuid.UUID) -> tuple[bool, str | None]:
    return True, None


async def _upwork_ready(session: AsyncSession, user_id: uuid.UUID) -> tuple[bool, str | None]:
    row = await connection.get_connection(session, user_id)
    described = connection.describe(row)
    if described.connected:
        return True, None
    if described.status.value == "expired":
        return False, "Your Upwork session expired. Authorize it again to search."
    if described.configured:
        return False, "Your Upwork key pair is saved but not authorized yet."
    return False, "Connect your Upwork account to search jobs."


async def _apify_ready(session: AsyncSession, user_id: uuid.UUID) -> tuple[bool, str | None]:
    row = await apify_connection.get_connection(session, user_id)
    if apify_connection.resolve_token(row) is None:
        return False, "Add your Apify API token to search Upwork jobs."
    if row.status.value == "invalid":
        return False, "Apify rejected the saved token. Replace it to search again."
    return True, None


def _info(source: type[JobSource] | JobSource) -> JobSourceInfo:
    capabilities = source.capabilities
    return JobSourceInfo(
        key=source.key,
        label=source.label,
        filters=sorted(capabilities.filters),
        sorts=list(capabilities.sorts),
        detail=capabilities.detail,
        categories=capabilities.categories,
        skills=capabilities.skills,
    )


def _apify_info() -> JobSourceInfo:
    profile = active_profile()
    capabilities = profile.capabilities
    return JobSourceInfo(
        key=ApifyUpworkSource.key,
        label=profile.label,
        filters=sorted(capabilities.filters),
        sorts=list(capabilities.sorts),
        detail=capabilities.detail,
        categories=capabilities.categories,
        skills=capabilities.skills,
    )


REGISTRY: dict[str, Registration] = {
    ApifyUpworkSource.key: Registration(_apify_info, ApifyUpworkSource.for_user, _apify_ready),
    UpworkGraphQLSource.key: Registration(
        lambda: _info(UpworkGraphQLSource), UpworkGraphQLSource.for_user, _upwork_ready
    ),
}


def register(
    source: type[JobSource], factory: SourceFactory, readiness: Readiness | None = None
) -> None:
    """Add a source class. ``factory`` builds an instance for a user."""
    info = _info(source)
    REGISTRY[source.key] = Registration(lambda: info, factory, readiness or _always_ready)


def unregister(key: str) -> None:
    REGISTRY.pop(key, None)


def source_key() -> str:
    return get_settings().freelancing_job_source


def _registration() -> Registration:
    key = source_key()
    found = REGISTRY.get(key)
    if found is None:
        raise JobSourceError(
            "JOB_SOURCE_UNKNOWN",
            f"FREELANCING_JOB_SOURCE={key!r} names no registered job source "
            f"(known: {', '.join(sorted(REGISTRY))}).",
            status=500,
        )
    return found


def describe_source() -> JobSourceInfo:
    return _registration().info()


async def source_status(session: AsyncSession, user_id: uuid.UUID) -> JobSourceStatus:
    registration = _registration()
    ready, hint = await registration.readiness(session, user_id)
    return JobSourceStatus(**registration.info().model_dump(), ready=ready, setup_hint=hint)


async def get_source(session: AsyncSession, user_id: uuid.UUID) -> JobSource:
    return await _registration().factory(session, user_id)
