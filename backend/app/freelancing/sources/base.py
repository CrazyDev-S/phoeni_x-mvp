"""Where job postings come from.

The Freelancing category does not care whether a posting arrived from
Upwork's own GraphQL API or from a third-party API that republishes the
listings. It asks a ``JobSource`` for a page of snapshots in this product's
own shape, and everything downstream - snapshots, focus, proposals, tracking,
the calendar - is the same.

To add a provider:

1. Write a class with the four methods below. ``search`` returns snapshot
   dicts, that is column values for ``FreelanceJob`` - see
   ``app.freelancing.upwork.normalize.snapshot_from_search_node`` for the keys
   and ``upwork_id`` as the provider's own id for the posting.
2. Say which ``JobSearchParams`` fields it honours in its capabilities. The
   search form hides the rest, so a filter the provider cannot apply is never
   offered as if it were.
3. Register it in ``registry`` with a factory and a readiness check, and
   select it with ``FREELANCING_JOB_SOURCE``.

A search that takes longer than one request should block returns
``SourcePage(pending=True, end_cursor=...)``; the portal asks again with that
cursor until the page arrives. The Apify source does this.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from app.models.freelancing import FreelanceJob
from app.schemas.freelancing import CategoryOption, JobSearchParams, SkillSuggestion

# Paging, sorting and this-side toggles are not filters a source has to honour.
NOT_FILTERS = frozenset(
    {"sort", "page_size", "cursor", "hide_hidden", "hide_applied", "open_to_country"}
)
ALL_FILTERS = frozenset(JobSearchParams.model_fields) - NOT_FILTERS
ALL_SORTS = ("recency", "relevance", "client_total_charge", "client_rating")


@dataclass(frozen=True)
class SourceCapabilities:
    """What a source can do, so the UI never offers what it cannot."""

    filters: frozenset[str]
    sorts: tuple[str, ...] = ("recency",)
    # Can fetch a posting's deeper aggregate (screening questions, activity).
    detail: bool = False
    # Provides a category tree for ``category_ids`` / ``subcategory_ids``.
    categories: bool = False
    # Provides skill autocomplete.
    skills: bool = False


@dataclass
class SourcePage:
    snapshots: list[dict[str, Any]] = field(default_factory=list)
    total: int | None = None
    has_next_page: bool = False
    end_cursor: str | None = None
    # Still working: no snapshots yet; ask again with ``end_cursor``.
    pending: bool = False
    note: str | None = None
    # Something the provider said about the search, shown with the results.
    notice: str | None = None


class JobSource(Protocol):
    key: str
    label: str
    capabilities: SourceCapabilities

    async def search(self, params: JobSearchParams) -> SourcePage: ...

    async def detail(self, job: FreelanceJob) -> dict[str, Any] | None:
        """Column updates for the posting's deeper aggregate, or None when the
        source has none. Raise ``JobSourceError`` when the posting is gone."""
        ...

    async def categories(self) -> list[CategoryOption]: ...

    async def suggest_skills(self, label: str, limit: int) -> list[SkillSuggestion]: ...
