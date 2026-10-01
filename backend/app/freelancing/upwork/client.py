"""A thin GraphQL client for api.upwork.com.

One method, ``graphql``. Errors are turned into typed exceptions here, once,
so no caller has to know that a missing scope arrives as HTTP 200 with an
``errors`` array while an expired token arrives as HTTP 401.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.freelancing.transport import current_transport
from app.freelancing.upwork.errors import (
    UpworkAuthError,
    UpworkError,
    UpworkRateLimitedError,
    UpworkScopeError,
)

GRAPHQL_URL = "https://api.upwork.com/graphql"
TENANT_HEADER = "X-Upwork-API-TenantId"


class UpworkClient:
    def __init__(
        self,
        access_token: str,
        *,
        tenant_id: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._token = access_token
        self._tenant_id = tenant_id
        self._transport = transport or current_transport()
        self._timeout = timeout_seconds

    @property
    def headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self._tenant_id:
            headers[TENANT_HEADER] = self._tenant_id
        return headers

    async def graphql(self, query: str, variables: dict[str, Any] | None = None) -> dict:
        """Run one operation and return its ``data``."""
        async with httpx.AsyncClient(transport=self._transport, timeout=self._timeout) as http:
            try:
                response = await http.post(
                    GRAPHQL_URL,
                    headers=self.headers,
                    json={"query": query, "variables": variables or {}},
                )
            except httpx.HTTPError as exc:
                raise UpworkError(
                    "UPWORK_UNREACHABLE", f"Could not reach Upwork: {exc}", retryable=True
                ) from exc

        if response.status_code == 401:
            raise UpworkAuthError()
        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            raise UpworkRateLimitedError(int(retry_after) if retry_after and retry_after.isdigit() else None)
        if response.status_code >= 500:
            raise UpworkError(
                "UPWORK_UNAVAILABLE",
                f"Upwork answered {response.status_code}",
                retryable=True,
            )

        try:
            body = response.json()
        except ValueError as exc:
            raise UpworkError(
                "UPWORK_BAD_RESPONSE", "Upwork returned something that is not JSON"
            ) from exc

        errors = body.get("errors") if isinstance(body, dict) else None
        if errors:
            raise _from_graphql_errors(errors)
        if response.status_code != 200:
            raise UpworkError(
                "UPWORK_REQUEST_FAILED", f"Upwork answered {response.status_code}", status=502
            )
        data = body.get("data") if isinstance(body, dict) else None
        if data is None:
            raise UpworkError("UPWORK_BAD_RESPONSE", "Upwork returned no data")
        return data


def _from_graphql_errors(errors: list[dict]) -> UpworkError:
    messages = [str(e.get("message", "")) for e in errors if isinstance(e, dict)]
    joined = "; ".join(m for m in messages if m) or "Upwork rejected the query"
    lowered = joined.lower()
    if "oauth2 permissions" in lowered or "scopes" in lowered:
        return UpworkScopeError(joined)
    if "unauthorized" in lowered or "unauthenticated" in lowered or "invalid token" in lowered:
        return UpworkAuthError(joined)
    return UpworkError("UPWORK_QUERY_REJECTED", joined, status=502)
