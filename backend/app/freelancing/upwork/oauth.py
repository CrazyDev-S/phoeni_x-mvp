"""The Upwork OAuth2 authorization-code flow.

Upwork issues a 24-hour access token and a refresh token that dies after two
weeks idle. Both are exchanged at one token endpoint; every refresh hands back
a NEW refresh token, so the pair is always stored together.

The ``state`` parameter is a short-lived signed token naming the user, because
the callback arrives as a bare browser redirect with no session on it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from app.core.config import get_settings
from app.core.timezone import utc_now
from app.freelancing.transport import current_transport
from app.freelancing.upwork.errors import UpworkError

AUTHORIZE_URL = "https://www.upwork.com/ab/account-security/oauth2/authorize"
TOKEN_URL = "https://www.upwork.com/api/v3/oauth2/token"  # noqa: S105 - an endpoint, not a secret

STATE_TOKEN_TYPE = "upwork_oauth"  # noqa: S105 - a token kind, not a secret
STATE_TTL = timedelta(minutes=15)


@dataclass(frozen=True, slots=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in_seconds: int


def authorization_url(*, client_id: str, redirect_uri: str, state: str) -> str:
    query = urlencode(
        {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "state": state,
        }
    )
    return f"{AUTHORIZE_URL}?{query}"


def make_state(user_id: uuid.UUID) -> str:
    settings = get_settings()
    now = utc_now()
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "typ": STATE_TOKEN_TYPE,
        "iat": int(now.timestamp()),
        "exp": int((now + STATE_TTL).timestamp()),
    }
    return jwt.encode(payload, settings.app_secret_key, algorithm=settings.jwt_algorithm)


def read_state(state: str) -> uuid.UUID:
    """The user the round trip belongs to, or an UpworkError if the state is bad."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            state, settings.app_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError as exc:
        raise UpworkError(
            "UPWORK_BAD_STATE",
            "The sign-in link has expired or was tampered with. Start again from Settings.",
            status=400,
        ) from exc
    if payload.get("typ") != STATE_TOKEN_TYPE:
        raise UpworkError("UPWORK_BAD_STATE", "Not an Upwork sign-in state", status=400)
    return uuid.UUID(payload["sub"])


async def exchange_code(
    *,
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> TokenPair:
    return await _token_request(
        {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        },
        transport=transport,
    )


async def refresh_tokens(
    *,
    client_id: str,
    client_secret: str,
    refresh_token: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> TokenPair:
    return await _token_request(
        {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
        },
        transport=transport,
    )


async def _token_request(
    form: dict[str, str], *, transport: httpx.AsyncBaseTransport | None
) -> TokenPair:
    async with httpx.AsyncClient(
        transport=transport or current_transport(), timeout=30.0
    ) as http:
        try:
            response = await http.post(
                TOKEN_URL, data=form, headers={"Accept": "application/json"}
            )
        except httpx.HTTPError as exc:
            raise UpworkError(
                "UPWORK_UNREACHABLE", f"Could not reach Upwork: {exc}", retryable=True
            ) from exc

    try:
        body = response.json()
    except ValueError:
        body = {}

    if response.status_code != 200 or "access_token" not in body:
        detail = (
            body.get("error_description") or body.get("error") or response.text[:200]
            if isinstance(body, dict)
            else response.text[:200]
        )
        raise UpworkError(
            "UPWORK_TOKEN_REJECTED",
            f"Upwork refused the token request ({response.status_code}): {detail}",
            status=502 if response.status_code >= 500 else 400,
        )

    return TokenPair(
        access_token=str(body["access_token"]),
        refresh_token=str(body.get("refresh_token") or form.get("refresh_token") or ""),
        expires_in_seconds=int(body.get("expires_in") or 86_400),
    )
