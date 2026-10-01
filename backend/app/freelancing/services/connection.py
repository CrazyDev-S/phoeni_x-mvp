"""A user's link to Upwork: credentials, tokens, and a ready client.

Credentials come from Settings first and the environment second. Tokens are
refreshed here, transparently, a few minutes before they expire, and a refresh
that Upwork refuses moves the connection to ``expired`` so the UI can say
"connect again" rather than "something failed".
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.crypto import mask, seal, unseal
from app.core.timezone import utc_now
from app.db.session import SessionLocal
from app.freelancing.upwork import oauth
from app.freelancing.upwork.client import UpworkClient
from app.freelancing.upwork.errors import (
    UpworkError,
    UpworkNotConfiguredError,
    UpworkNotConnectedError,
)
from app.freelancing.upwork.oauth import TokenPair
from app.freelancing.upwork.queries import VIEWER
from app.models.enums import UpworkConnectionStatus
from app.models.freelancing import UpworkConnection
from app.schemas.freelancing import UpworkConnectionOut, UpworkOrganization

PROVIDER = "upwork"
SECRET_LABEL = "client_secret"  # noqa: S105 - an AAD label, not a secret
ACCESS_LABEL = "access_token"
REFRESH_LABEL = "refresh_token"

# Refresh this far ahead of expiry, so a long search never runs into it.
REFRESH_AHEAD = timedelta(minutes=5)


@dataclass(frozen=True, slots=True)
class Credentials:
    client_id: str
    client_secret: str
    source: Literal["user", "environment"]


async def get_connection(session: AsyncSession, user_id: uuid.UUID) -> UpworkConnection:
    row = await session.get(UpworkConnection, user_id)
    if row is None:
        row = UpworkConnection(user_id=user_id)
        session.add(row)
        await session.flush()
    return row


def resolve_credentials(
    row: UpworkConnection, settings: Settings | None = None
) -> Credentials | None:
    settings = settings or get_settings()
    if row.client_id and row.client_secret_ciphertext and row.client_secret_nonce:
        secret = unseal(
            row.client_secret_ciphertext,
            row.client_secret_nonce,
            user_id=str(row.user_id),
            provider=PROVIDER,
            label=SECRET_LABEL,
        )
        return Credentials(row.client_id, secret, "user")
    if settings.upwork_client_id and settings.upwork_client_secret:
        return Credentials(settings.upwork_client_id, settings.upwork_client_secret, "environment")
    return None


async def store_credentials(
    session: AsyncSession, user_id: uuid.UUID, *, client_id: str, client_secret: str
) -> UpworkConnection:
    row = await get_connection(session, user_id)
    sealed = seal(client_secret.strip(), user_id=str(user_id), provider=PROVIDER, label=SECRET_LABEL)
    row.client_id = client_id.strip()
    row.client_secret_ciphertext = sealed.ciphertext
    row.client_secret_nonce = sealed.nonce
    row.client_secret_last4 = sealed.last4
    row.encryption_key_version = sealed.encryption_key_version
    # A new key pair means the old tokens belong to another app.
    _clear_tokens(row)
    row.status = UpworkConnectionStatus.PENDING_AUTHORIZATION
    row.last_error = None
    await session.flush()
    return row


async def clear_credentials(session: AsyncSession, user_id: uuid.UUID) -> UpworkConnection:
    row = await get_connection(session, user_id)
    row.client_id = None
    row.client_secret_ciphertext = None
    row.client_secret_nonce = None
    row.client_secret_last4 = None
    _clear_tokens(row)
    row.status = (
        UpworkConnectionStatus.PENDING_AUTHORIZATION
        if resolve_credentials(row)
        else UpworkConnectionStatus.NOT_CONFIGURED
    )
    row.last_error = None
    await session.flush()
    return row


def _clear_tokens(row: UpworkConnection) -> None:
    row.access_token_ciphertext = None
    row.access_token_nonce = None
    row.access_token_expires_at = None
    row.refresh_token_ciphertext = None
    row.refresh_token_nonce = None
    row.connected_at = None
    row.upwork_user_id = None
    row.upwork_user_name = None


async def store_tokens(session: AsyncSession, row: UpworkConnection, pair: TokenPair) -> None:
    user_id = str(row.user_id)
    access = seal(pair.access_token, user_id=user_id, provider=PROVIDER, label=ACCESS_LABEL)
    row.access_token_ciphertext = access.ciphertext
    row.access_token_nonce = access.nonce
    row.access_token_expires_at = utc_now() + timedelta(seconds=pair.expires_in_seconds)
    if pair.refresh_token:
        refresh = seal(pair.refresh_token, user_id=user_id, provider=PROVIDER, label=REFRESH_LABEL)
        row.refresh_token_ciphertext = refresh.ciphertext
        row.refresh_token_nonce = refresh.nonce
    row.encryption_key_version = access.encryption_key_version
    row.status = UpworkConnectionStatus.CONNECTED
    row.connected_at = row.connected_at or utc_now()
    row.last_error = None
    await session.flush()


async def disconnect(session: AsyncSession, user_id: uuid.UUID) -> UpworkConnection:
    row = await get_connection(session, user_id)
    _clear_tokens(row)
    row.status = (
        UpworkConnectionStatus.PENDING_AUTHORIZATION
        if resolve_credentials(row)
        else UpworkConnectionStatus.NOT_CONFIGURED
    )
    await session.flush()
    return row


def _unseal(row: UpworkConnection, label: str, ciphertext: bytes, nonce: bytes) -> str:
    return unseal(ciphertext, nonce, user_id=str(row.user_id), provider=PROVIDER, label=label)


async def access_token(session: AsyncSession, row: UpworkConnection) -> str:
    """A token good for at least a few minutes, refreshing it when it is not."""
    if not row.access_token_ciphertext or not row.access_token_nonce:
        if resolve_credentials(row) is None:
            raise UpworkNotConfiguredError()
        raise UpworkNotConnectedError()

    expires_at = row.access_token_expires_at
    if expires_at is None or expires_at - REFRESH_AHEAD > utc_now():
        return _unseal(row, ACCESS_LABEL, row.access_token_ciphertext, row.access_token_nonce)

    return await refresh(session, row)


async def refresh(session: AsyncSession, row: UpworkConnection) -> str:
    credentials = resolve_credentials(row)
    if credentials is None:
        raise UpworkNotConfiguredError()
    if not row.refresh_token_ciphertext or not row.refresh_token_nonce:
        row.status = UpworkConnectionStatus.EXPIRED
        raise UpworkNotConnectedError("The Upwork session has no refresh token. Connect again.")
    refresh_token = _unseal(row, REFRESH_LABEL, row.refresh_token_ciphertext, row.refresh_token_nonce)
    try:
        pair = await oauth.refresh_tokens(
            client_id=credentials.client_id,
            client_secret=credentials.client_secret,
            refresh_token=refresh_token,
        )
    except UpworkError as exc:
        # A refused refresh is the "two weeks idle" case; the user has to
        # authorize again. An unreachable Upwork is not, so it stays connected.
        if exc.code == "UPWORK_TOKEN_REJECTED":
            row.status = UpworkConnectionStatus.EXPIRED
            row.last_error = exc.message
            # The request that found this out is about to fail, and its
            # session will roll back with it - so the status is written in a
            # transaction of its own, or the UI would keep saying "connected".
            await _record_expiry(row.user_id, exc.message)
            raise UpworkNotConnectedError(
                "The Upwork session expired (refresh tokens lapse after two weeks idle). "
                "Connect again."
            ) from exc
        raise
    await store_tokens(session, row, pair)
    return pair.access_token


async def _record_expiry(user_id: uuid.UUID, message: str) -> None:
    async with SessionLocal() as own:
        await own.execute(
            update(UpworkConnection)
            .where(UpworkConnection.user_id == user_id)
            .values(status=UpworkConnectionStatus.EXPIRED, last_error=message)
        )
        await own.commit()


async def client_for(session: AsyncSession, user_id: uuid.UUID) -> UpworkClient:
    row = await get_connection(session, user_id)
    token = await access_token(session, row)
    row.last_used_at = utc_now()
    return UpworkClient(token, tenant_id=row.tenant_id)


async def fetch_viewer(client: UpworkClient) -> tuple[dict, list[UpworkOrganization]]:
    """Who the token belongs to, and the organisations it can act for."""
    data = await client.graphql(VIEWER)
    user = data.get("user") or {}
    items = (data.get("companySelector") or {}).get("items") or []
    organizations = [
        UpworkOrganization(
            organization_id=str(item.get("organizationId")),
            title=str(item.get("title") or ""),
            type_title=item.get("typeTitle") or item.get("organizationType"),
        )
        for item in items
        if isinstance(item, dict) and item.get("organizationId")
    ]
    return user, organizations


def describe(row: UpworkConnection, settings: Settings | None = None) -> UpworkConnectionOut:
    settings = settings or get_settings()
    credentials = resolve_credentials(row, settings)
    connected = bool(row.access_token_ciphertext) and row.status is UpworkConnectionStatus.CONNECTED
    if credentials is None:
        client_id, masked = None, None
    elif credentials.source == "user":
        client_id = row.client_id
        masked = mask(row.client_secret_last4 or "", PROVIDER)
    else:
        client_id = credentials.client_id
        masked = mask(credentials.client_secret[-4:], PROVIDER)
    return UpworkConnectionOut(
        status=row.status,
        configured=credentials is not None,
        credentials_source=credentials.source if credentials else "none",
        client_id=client_id,
        masked_client_secret=masked,
        connected=connected,
        upwork_user_name=row.upwork_user_name,
        upwork_user_id=row.upwork_user_id,
        tenant_id=row.tenant_id,
        redirect_uri=settings.upwork_callback_url,
        access_token_expires_at=row.access_token_expires_at,
        connected_at=row.connected_at,
        last_used_at=row.last_used_at,
        last_error=row.last_error,
    )
