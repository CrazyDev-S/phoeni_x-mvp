"""Upwork's own GraphQL API as a job source: the full filter set, details, ontology."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.freelancing.services import connection
from app.freelancing.sources.base import ALL_SORTS, SourceCapabilities, SourcePage
from app.freelancing.upwork.client import UpworkClient
from app.freelancing.upwork.errors import UpworkError
from app.freelancing.upwork.filters import SUPPORTED_FILTERS, to_search_variables
from app.freelancing.upwork.normalize import merge_detail, snapshot_from_search_node
from app.freelancing.upwork.queries import CATEGORIES, JOB_DETAIL, JOB_SEARCH, SKILL_SEARCH
from app.models.freelancing import FreelanceJob
from app.schemas.freelancing import CategoryOption, FilterOption, JobSearchParams, SkillSuggestion


class UpworkGraphQLSource:
    key = "upwork"
    label = "Upwork API"
    capabilities = SourceCapabilities(
        filters=SUPPORTED_FILTERS,
        sorts=ALL_SORTS,
        detail=True,
        categories=True,
        skills=True,
    )

    def __init__(self, client: UpworkClient) -> None:
        self._client = client

    @classmethod
    async def for_user(cls, session: AsyncSession, user_id: uuid.UUID) -> UpworkGraphQLSource:
        """Needs the user's own OAuth token; raises when Upwork is not connected."""
        return cls(await connection.client_for(session, user_id))

    async def search(self, params: JobSearchParams) -> SourcePage:
        data = await self._client.graphql(JOB_SEARCH, to_search_variables(params))
        result = data.get("marketplaceJobPostingsSearch") or {}
        nodes = [
            edge["node"]
            for edge in (result.get("edges") or [])
            if isinstance(edge, dict) and isinstance(edge.get("node"), dict) and edge["node"].get("id")
        ]
        page_info = result.get("pageInfo") or {}
        return SourcePage(
            snapshots=[snapshot_from_search_node(node) for node in nodes],
            total=result.get("totalCount"),
            has_next_page=bool(page_info.get("hasNextPage")),
            end_cursor=page_info.get("endCursor"),
        )

    async def detail(self, job: FreelanceJob) -> dict[str, Any] | None:
        data = await self._client.graphql(JOB_DETAIL, {"id": job.upwork_id})
        aggregate = data.get("marketplaceJobPosting")
        if not isinstance(aggregate, dict):
            raise UpworkError("UPWORK_JOB_GONE", "Upwork no longer returns this posting", status=404)
        return merge_detail({"skills": job.skills, "client": job.client, "raw": job.raw}, aggregate)

    async def categories(self) -> list[CategoryOption]:
        data = await self._client.graphql(CATEGORIES)
        return [
            CategoryOption(
                id=str(c["id"]),
                label=str(c.get("preferredLabel") or c["id"]),
                subcategories=[
                    FilterOption(value=str(s["id"]), label=str(s.get("preferredLabel") or s["id"]))
                    for s in (c.get("subcategories") or [])
                    if isinstance(s, dict) and s.get("id")
                ],
            )
            for c in (data.get("ontologyCategories") or [])
            if isinstance(c, dict) and c.get("id")
        ]

    async def suggest_skills(self, label: str, limit: int) -> list[SkillSuggestion]:
        data = await self._client.graphql(SKILL_SEARCH, {"label": label[:100], "limit": limit})
        return [
            SkillSuggestion(id=str(s["id"]), label=str(s.get("preferredLabel") or s["id"]))
            for s in (data.get("ontologyElementsSearchByPrefLabel") or [])
            if isinstance(s, dict) and s.get("id")
        ]
