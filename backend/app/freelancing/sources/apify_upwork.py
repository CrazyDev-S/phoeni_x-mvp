"""Upwork jobs through an Apify actor.

Which actor is ``APIFY_UPWORK_ACTOR_ID``; its input mapping is an
``ActorProfile`` (``app/freelancing/apify/profiles.py``). This module does
what every actor needs: run it, poll the run, page through its dataset.

A scrape takes tens of seconds, longer than one request should block, so a
search is a small state machine carried in an opaque cursor:

* no cursor: start a run for the profile's first step and wait on it a little;
* a run still going: answer ``pending`` with a cursor naming the run, and the
  portal asks again (each ask long-polls Apify for up to APIFY_WAIT_SECONDS);
* a run finished: read our page out of its dataset by offset, so "load more"
  pages through what that run already paid for;
* the dataset exhausted but full: the profile says where the next run starts
  (the next Upwork page, or jobs posted before the oldest one seen), and
  asking for it starts one more run.

An identical search inside APIFY_REUSE_MINUTES reuses its run, because every
run is billed per job returned.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.timezone import utc_now
from app.freelancing.apify.client import FINISHED_STATUSES, ApifyClient
from app.freelancing.apify.profiles import ActorProfile, active_profile
from app.freelancing.errors import JobSourceError
from app.freelancing.services import apify_connection
from app.freelancing.snapshot import parse_instant
from app.freelancing.sources.base import SourceCapabilities, SourcePage
from app.models.freelancing import FreelanceJob
from app.schemas.freelancing import CategoryOption, JobSearchParams, SkillSuggestion

CURSOR_PREFIX = "apify."
SOURCE_KEY = "apify"


@dataclass
class Cursor:
    """Where a search is: which run, how far into its dataset, where the next run starts."""

    size: int
    cont: dict = field(default_factory=dict)
    run: str | None = None
    dataset: str | None = None
    offset: int = 0

    def encode(self) -> str:
        body = json.dumps(
            {"s": self.size, "c": self.cont, "r": self.run, "d": self.dataset, "o": self.offset},
            separators=(",", ":"),
        )
        return CURSOR_PREFIX + base64.urlsafe_b64encode(body.encode()).decode().rstrip("=")

    @classmethod
    def decode(cls, raw: str) -> Cursor:
        if not raw.startswith(CURSOR_PREFIX):
            raise JobSourceError("BAD_CURSOR", "That page cursor is not from this job source", status=400)
        body = raw[len(CURSOR_PREFIX):]
        try:
            data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
            return cls(
                size=int(data["s"]),
                cont=dict(data.get("c") or {}),
                run=data.get("r"),
                dataset=data.get("d"),
                offset=int(data.get("o") or 0),
            )
        except (ValueError, KeyError, TypeError) as exc:
            raise JobSourceError("BAD_CURSOR", "That page cursor could not be read", status=400) from exc


# (user, actor, search, step) -> (run id, dataset id, when). Per process; a
# miss only costs one more run.
_recent_runs: dict[str, tuple[str, str | None, float]] = {}


def _reuse_key(user_id: uuid.UUID, actor_id: str, params: JobSearchParams, step: dict | None) -> str:
    """The search itself, not the run input: a first step carrying "now" still matches."""
    search = params.model_dump(mode="json", exclude={"cursor", "hide_hidden", "hide_applied"})
    body = json.dumps({"u": str(user_id), "a": actor_id, "p": search, "s": step}, sort_keys=True)
    return hashlib.sha256(body.encode()).hexdigest()


class ApifyUpworkSource:
    key = SOURCE_KEY

    def __init__(self, client: ApifyClient, user_id: uuid.UUID, profile: ActorProfile | None = None) -> None:
        self._client = client
        self._user_id = user_id
        self._settings = get_settings()
        self._profile = profile or active_profile()

    @property
    def label(self) -> str:
        return self._profile.label

    @property
    def capabilities(self) -> SourceCapabilities:
        return self._profile.capabilities

    @classmethod
    async def for_user(cls, session: AsyncSession, user_id: uuid.UUID) -> ApifyUpworkSource:
        profile = active_profile()  # fails fast on an actor with no mapping
        return cls(await apify_connection.client_for(session, user_id), user_id, profile)

    async def search(self, params: JobSearchParams) -> SourcePage:
        try:
            return await self._search(params)
        except JobSourceError as exc:
            if exc.code == "APIFY_TOKEN_REJECTED":
                await apify_connection.record_rejection(self._user_id, exc.message)
            raise

    async def _search(self, params: JobSearchParams) -> SourcePage:
        settings, profile = self._settings, self._profile
        if params.cursor:
            cursor = Cursor.decode(params.cursor)
            first_step = False
        else:
            cursor = Cursor(
                size=profile.run_size(params, settings),
                cont=profile.first_continuation(params, settings, utc_now()),
            )
            first_step = True

        if cursor.run is None:
            run = await self._start(params, cursor, first_step=first_step)
            cursor.run, cursor.dataset, cursor.offset = run["id"], run.get("defaultDatasetId"), 0
        else:
            run = await self._client.get_run(cursor.run, wait_seconds=settings.apify_wait_seconds)
            cursor.dataset = cursor.dataset or run.get("defaultDatasetId")

        status = str(run.get("status") or "")
        if status not in FINISHED_STATUSES:
            return SourcePage(pending=True, end_cursor=cursor.encode(), note=self._progress(run, cursor))

        if not cursor.dataset:
            raise JobSourceError("APIFY_BAD_RESPONSE", "The Apify run has no dataset")
        items, total = await self._client.dataset_items(
            cursor.dataset, offset=cursor.offset, limit=params.page_size
        )
        if not items and cursor.offset == 0 and status != "SUCCEEDED":
            raise JobSourceError(
                "APIFY_RUN_FAILED",
                f"The Apify run ended {status.lower()}: {run.get('statusMessage') or 'no jobs were returned'}",
                status=502,
            )

        consumed = cursor.offset + len(items)
        next_cursor: Cursor | None = None
        if total is not None and consumed < total:
            next_cursor = Cursor(cursor.size, cursor.cont, cursor.run, cursor.dataset, consumed)
        elif total is not None and total >= cursor.size and status == "SUCCEEDED" and items:
            # The run returned all it was asked for: there is probably more.
            following = profile.next_continuation(cursor.cont, items, settings)
            if following is not None:
                next_cursor = Cursor(cursor.size, following)

        notice = None
        if not items and cursor.offset == 0 and run.get("statusMessage"):
            # An actor can exit cleanly with a message - an exhausted free
            # quota, say. "Nothing matched" would hide it.
            notice = f"Apify: {run['statusMessage']}"

        return SourcePage(
            snapshots=[profile.snapshot(item) for item in items],
            total=total,
            has_next_page=next_cursor is not None,
            end_cursor=next_cursor.encode() if next_cursor else None,
            notice=notice,
        )

    async def _start(self, params: JobSearchParams, cursor: Cursor, *, first_step: bool) -> dict[str, Any]:
        settings, profile = self._settings, self._profile
        key = _reuse_key(
            self._user_id, profile.actor_id, params, None if first_step else cursor.cont
        )
        reused = _recent_runs.get(key)
        if reused and time.monotonic() - reused[2] < settings.apify_reuse_minutes * 60:
            return await self._client.get_run(reused[0], wait_seconds=settings.apify_wait_seconds)

        run_input = profile.build_input(params, size=cursor.size, cont=cursor.cont, settings=settings)
        run = await self._client.start_run(
            profile.actor_id,
            run_input,
            wait_seconds=settings.apify_wait_seconds,
            max_items=cursor.size,
            max_charge_usd=settings.apify_max_charge_usd,
            timeout_seconds=settings.apify_run_timeout_seconds,
        )
        if not run.get("id"):
            raise JobSourceError("APIFY_BAD_RESPONSE", "Apify did not return a run id")
        _recent_runs[key] = (run["id"], run.get("defaultDatasetId"), time.monotonic())
        await apify_connection.record_run(self._user_id, run["id"])
        return run

    def _progress(self, run: dict, cursor: Cursor) -> str:
        started = parse_instant(run.get("startedAt"))
        elapsed = int((utc_now() - started).total_seconds()) if started else None
        where = self._profile.describe_continuation(cursor.cont)
        status = str(run.get("status") or "RUNNING").lower().replace("-", " ")
        return f"Apify is fetching {where} ({status}{f', {elapsed}s' if elapsed is not None else ''})"

    async def detail(self, job: FreelanceJob) -> dict[str, Any] | None:
        # A dataset item is already the whole posting.
        return None

    async def categories(self) -> list[CategoryOption]:
        if not self._profile.capabilities.categories:
            return []
        try:
            schema = await self._client.actor_input_schema(self._profile.actor_id)
        except JobSourceError:
            schema = None  # the profile's bundled list
        return self._profile.categories(schema)

    async def suggest_skills(self, label: str, limit: int) -> list[SkillSuggestion]:
        return []
