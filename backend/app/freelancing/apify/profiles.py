"""The Apify actors the job source can drive, one input mapping each.

Two actors that both scrape Upwork disagree on nearly everything: input field
names, how a page is addressed, the shape of a job. A profile hides that. The
source (``sources/apify_upwork.py``) runs actors, polls runs and pages through
datasets; the profile says what to ask the actor for and how to read its
answer. ``APIFY_UPWORK_ACTOR_ID`` picks the profile.

To support another actor, add a module beside these with a class meeting
``ActorProfile`` and list it in ``PROFILES``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from app.core.config import Settings, get_settings
from app.freelancing.apify.client import actor_path
from app.freelancing.apify.neatrat_scraper import NeatratProfile
from app.freelancing.apify.vibe_scraper import VibeProfile
from app.freelancing.errors import JobSourceError
from app.freelancing.sources.base import SourceCapabilities
from app.schemas.freelancing import CategoryOption, JobSearchParams


class ActorProfile(Protocol):
    actor_id: str
    label: str
    capabilities: SourceCapabilities
    # How the actor bills, in a sentence, for the Settings card.
    cost_note: str

    def run_size(self, params: JobSearchParams, settings: Settings) -> int:
        """How many jobs one run is asked for."""
        ...

    def first_continuation(self, params: JobSearchParams, settings: Settings, now: datetime) -> dict:
        """Where the first run of a search starts: a page number, a date window..."""
        ...

    def build_input(
        self, params: JobSearchParams, *, size: int, cont: dict, settings: Settings
    ) -> dict[str, Any]: ...

    def next_continuation(self, cont: dict, final_slice: list[dict], settings: Settings) -> dict | None:
        """Where the next run starts, after a run that filled its size. None: no more."""
        ...

    def describe_continuation(self, cont: dict) -> str:
        """What a run is fetching, for the progress line: "Upwork page 2"."""
        ...

    def snapshot(self, item: dict) -> dict[str, Any]: ...

    def categories(self, input_schema: dict | None) -> list[CategoryOption]:
        """The category tree, from the actor's live input schema when it has one."""
        ...


PROFILES: dict[str, ActorProfile] = {
    profile.actor_id: profile for profile in (VibeProfile(), NeatratProfile())
}


def profile_for(actor_id: str) -> ActorProfile:
    found = PROFILES.get(actor_path(actor_id))
    if found is None:
        raise JobSourceError(
            "APIFY_ACTOR_UNSUPPORTED",
            f"APIFY_UPWORK_ACTOR_ID={actor_id!r} has no input mapping here "
            f"(supported: {', '.join(sorted(PROFILES))}).",
            status=500,
        )
    return found


def active_profile() -> ActorProfile:
    return profile_for(get_settings().apify_upwork_actor_id)
