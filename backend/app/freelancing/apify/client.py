"""A thin client for the Apify API, just the calls a job source needs.

Runs are started asynchronously and long-polled with ``waitForFinish``
(Apify caps one wait at 60 seconds), and results are read from the run's
default dataset by offset, so "load more" pages through what one run already
paid for instead of starting another.

Errors become ``JobSourceError`` here, once. None of them is a 401: to the
portal a 401 means "your PhoeniX session expired", and a rejected Apify token
is a setting to fix, not a reason to sign out.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from app.freelancing.errors import JobSourceError, JobSourceRateLimitedError
from app.freelancing.transport import current_transport

API_BASE = "https://api.apify.com/v2"
# Apify rejects a longer single wait.
MAX_WAIT_SECONDS = 60

RUNNING_STATUSES = frozenset({"READY", "RUNNING", "TIMING-OUT", "ABORTING"})
FINISHED_STATUSES = frozenset({"SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"})


def actor_path(actor_id: str) -> str:
    """``user/name`` and ``user~name`` are the same actor; the URL wants the tilde."""
    return actor_id.strip().replace("/", "~")


class ApifyClient:
    def __init__(
        self,
        token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._token = token
        self._transport = transport or current_transport()
        self._timeout = timeout_seconds

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        wait_seconds: int = 0,
    ) -> httpx.Response:
        clean = {k: v for k, v in (params or {}).items() if v is not None}
        async with httpx.AsyncClient(
            transport=self._transport, timeout=self._timeout + wait_seconds
        ) as http:
            try:
                response = await http.request(
                    method,
                    f"{API_BASE}{path}",
                    params=clean,
                    json=json,
                    headers={"Authorization": f"Bearer {self._token}", "Accept": "application/json"},
                )
            except httpx.HTTPError as exc:
                raise JobSourceError(
                    "APIFY_UNREACHABLE", f"Could not reach Apify: {exc}", retryable=True
                ) from exc
        if response.status_code >= 400:
            raise _error_from(response)
        return response

    async def _data(self, method: str, path: str, **kwargs: Any) -> dict:
        response = await self._request(method, path, **kwargs)
        try:
            body = response.json()
        except ValueError as exc:
            raise JobSourceError("APIFY_BAD_RESPONSE", "Apify returned something that is not JSON") from exc
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            raise JobSourceError("APIFY_BAD_RESPONSE", "Apify returned no data")
        return data

    async def start_run(
        self,
        actor_id: str,
        run_input: dict[str, Any],
        *,
        wait_seconds: int,
        max_items: int | None = None,
        max_charge_usd: float | None = None,
        timeout_seconds: int | None = None,
    ) -> dict:
        """Start the actor and wait up to ``wait_seconds`` for it to finish. Returns the run."""
        wait = max(0, min(wait_seconds, MAX_WAIT_SECONDS))
        return await self._data(
            "POST",
            f"/acts/{actor_path(actor_id)}/runs",
            params={
                "waitForFinish": wait,
                "maxItems": max_items,
                "maxTotalChargeUsd": max_charge_usd,
                "timeout": timeout_seconds,
            },
            json=run_input,
            wait_seconds=wait,
        )

    async def get_run(self, run_id: str, *, wait_seconds: int = 0) -> dict:
        wait = max(0, min(wait_seconds, MAX_WAIT_SECONDS))
        return await self._data(
            "GET", f"/actor-runs/{run_id}", params={"waitForFinish": wait}, wait_seconds=wait
        )

    async def dataset_items(
        self, dataset_id: str, *, offset: int, limit: int
    ) -> tuple[list[dict], int | None]:
        """One slice of a dataset, and how many items it holds in total."""
        response = await self._request(
            "GET",
            f"/datasets/{dataset_id}/items",
            params={"format": "json", "clean": "true", "offset": offset, "limit": limit},
        )
        try:
            items = response.json()
        except ValueError as exc:
            raise JobSourceError("APIFY_BAD_RESPONSE", "Apify returned a dataset that is not JSON") from exc
        total_header = response.headers.get("X-Apify-Pagination-Total")
        total = int(total_header) if total_header and total_header.isdigit() else None
        return [i for i in (items if isinstance(items, list) else []) if isinstance(i, dict)], total

    async def me(self) -> dict:
        return await self._data("GET", "/users/me")

    async def actor(self, actor_id: str) -> dict:
        return await self._data("GET", f"/acts/{actor_path(actor_id)}")

    async def actor_input_schema(self, actor_id: str) -> dict | None:
        """The input schema of the actor's default build, or None when it has none."""
        build = await self._data("GET", f"/acts/{actor_path(actor_id)}/builds/default")
        schema = build.get("inputSchema") or (build.get("actorDefinition") or {}).get("input")
        if isinstance(schema, str):
            try:
                schema = json.loads(schema)
            except ValueError:
                return None
        return schema if isinstance(schema, dict) else None


def _error_from(response: httpx.Response) -> JobSourceError:
    try:
        error = (response.json() or {}).get("error") or {}
    except ValueError:
        error = {}
    kind = str(error.get("type") or "")
    message = str(error.get("message") or f"Apify answered {response.status_code}")
    status = response.status_code

    if status == 401 or kind in ("token-not-provided", "user-or-token-not-found"):
        return JobSourceError(
            "APIFY_TOKEN_REJECTED",
            "Apify rejected the API token. Check it under Settings -> Integrations.",
            status=409,
        )
    if status == 402 or "usage" in kind or "credit" in kind or "payment" in kind:
        return JobSourceError("APIFY_OUT_OF_CREDIT", f"Apify: {message}", status=402)
    if status == 403:
        return JobSourceError("APIFY_FORBIDDEN", f"Apify: {message}", status=403)
    if status == 404:
        return JobSourceError("APIFY_NOT_FOUND", f"Apify: {message}", status=404)
    if status == 429:
        retry_after = response.headers.get("Retry-After")
        return JobSourceRateLimitedError(
            "Apify", int(retry_after) if retry_after and retry_after.isdigit() else None
        )
    if status >= 500:
        return JobSourceError("APIFY_UNAVAILABLE", f"Apify answered {status}", retryable=True)
    return JobSourceError("APIFY_REQUEST_REJECTED", f"Apify: {message}", status=502)
