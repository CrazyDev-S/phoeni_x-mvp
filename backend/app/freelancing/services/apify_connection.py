"""A user's Apify token: stored sealed, resolved with the environment as fallback."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.crypto import mask, seal, unseal
from app.core.timezone import utc_now
from app.db.session import SessionLocal
from app.freelancing.apify.client import ApifyClient
from app.freelancing.apify.profiles import profile_for
from app.freelancing.errors import JobSourceError, JobSourceNotConfiguredError
from app.models.enums import CredentialStatus
from app.models.freelancing import ApifyConnection
from app.schemas.freelancing import ApifyConnectionOut, ApifyTestOut

PROVIDER = "apify"
TOKEN_LABEL = "token"  # noqa: S105 - an AAD label, not a secret

NOT_CONFIGURED = "Add your Apify API token under Settings -> Integrations first."


@dataclass(frozen=True, slots=True)
class Token:
    value: str
    source: Literal["user", "environment"]


async def get_connection(session: AsyncSession, user_id: uuid.UUID) -> ApifyConnection:
    row = await session.get(ApifyConnection, user_id)
    if row is None:
        row = ApifyConnection(user_id=user_id)
        session.add(row)
        await session.flush()
    return row


def resolve_token(row: ApifyConnection, settings: Settings | None = None) -> Token | None:
    settings = settings or get_settings()
    if row.token_ciphertext and row.token_nonce:
        value = unseal(
            row.token_ciphertext,
            row.token_nonce,
            user_id=str(row.user_id),
            provider=PROVIDER,
            label=TOKEN_LABEL,
        )
        return Token(value, "user")
    if settings.apify_token:
        return Token(settings.apify_token, "environment")
    return None


async def client_for(session: AsyncSession, user_id: uuid.UUID) -> ApifyClient:
    row = await get_connection(session, user_id)
    token = resolve_token(row)
    if token is None:
        raise JobSourceNotConfiguredError(NOT_CONFIGURED)
    return ApifyClient(token.value)


async def store_token(session: AsyncSession, user_id: uuid.UUID, token: str) -> ApifyConnection:
    row = await get_connection(session, user_id)
    sealed = seal(token.strip(), user_id=str(user_id), provider=PROVIDER, label=TOKEN_LABEL)
    row.token_ciphertext = sealed.ciphertext
    row.token_nonce = sealed.nonce
    row.token_last4 = sealed.last4
    row.encryption_key_version = sealed.encryption_key_version
    row.status = CredentialStatus.UNVERIFIED
    row.apify_username = None
    row.last_error = None
    await session.flush()
    return row


async def clear_token(session: AsyncSession, user_id: uuid.UUID) -> ApifyConnection:
    row = await get_connection(session, user_id)
    row.token_ciphertext = None
    row.token_nonce = None
    row.token_last4 = None
    row.status = CredentialStatus.UNVERIFIED
    row.apify_username = None
    row.last_error = None
    await session.flush()
    return row


async def record_run(user_id: uuid.UUID, run_id: str) -> None:
    """Note the latest run in its own transaction, so it survives a failed request."""
    async with SessionLocal() as own:
        await own.execute(
            update(ApifyConnection)
            .where(ApifyConnection.user_id == user_id)
            .values(last_run_id=run_id, last_run_at=utc_now())
        )
        await own.commit()


async def record_rejection(user_id: uuid.UUID, message: str) -> None:
    """A token Apify refused: say so on the Settings card, even though the search failed."""
    async with SessionLocal() as own:
        await own.execute(
            update(ApifyConnection)
            .where(ApifyConnection.user_id == user_id)
            .values(status=CredentialStatus.INVALID, last_error=message)
        )
        await own.commit()


async def test(session: AsyncSession, user_id: uuid.UUID) -> ApifyTestOut:
    """Two real calls: who the token belongs to, and whether the actor is reachable."""
    settings = get_settings()
    row = await get_connection(session, user_id)
    token = resolve_token(row, settings)
    if token is None:
        return ApifyTestOut(ok=False, detail=NOT_CONFIGURED)
    client = ApifyClient(token.value)
    try:
        me = await client.me()
        actor = await client.actor(settings.apify_upwork_actor_id)
    except JobSourceError as exc:
        row.status = CredentialStatus.INVALID if exc.code == "APIFY_TOKEN_REJECTED" else row.status
        row.last_error = exc.message
        row.last_verified_at = utc_now()
        return ApifyTestOut(ok=False, detail=exc.message)

    row.status = CredentialStatus.VALID
    row.apify_username = me.get("username")
    row.last_error = None
    row.last_verified_at = utc_now()
    plan = (me.get("plan") or {}).get("id") if isinstance(me.get("plan"), dict) else None
    return ApifyTestOut(
        ok=True,
        detail=f"Connected as {row.apify_username or 'your Apify account'}",
        apify_username=row.apify_username,
        plan=plan,
        actor_title=actor.get("title") or actor.get("name"),
        price_per_job_usd=_price_per_job(actor),
    )


def _price_per_job(actor: dict) -> float | None:
    """The actor's current per-job price on the free tier, from its pricing record."""
    infos = actor.get("pricingInfos") or []
    if not infos or not isinstance(infos[-1], dict):
        return None
    events = ((infos[-1].get("pricingPerEvent") or {}).get("actorChargeEvents")) or {}
    for event in events.values():
        tiers = event.get("eventTieredPricingUsd") or {}
        price = (tiers.get("FREE") or {}).get("tieredEventPriceUsd") or event.get("eventPriceUsd")
        if isinstance(price, (int, float)):
            return float(price)
    return None


def describe(row: ApifyConnection, settings: Settings | None = None) -> ApifyConnectionOut:
    settings = settings or get_settings()
    token = resolve_token(row, settings)
    if token is None:
        masked = None
    elif token.source == "user":
        masked = mask(row.token_last4 or "", PROVIDER)
    else:
        masked = mask(token.value[-4:], PROVIDER)
    try:
        profile = profile_for(settings.apify_upwork_actor_id)
        actor_label, cost_note = profile.label, profile.cost_note
    except JobSourceError as exc:
        actor_label, cost_note = settings.apify_upwork_actor_id, exc.message
    return ApifyConnectionOut(
        actor_label=actor_label,
        cost_note=cost_note,
        configured=token is not None,
        token_source=token.source if token else "none",
        masked_token=masked,
        status=row.status.value,
        apify_username=row.apify_username,
        actor_id=settings.apify_upwork_actor_id,
        last_verified_at=row.last_verified_at,
        last_error=row.last_error,
        last_run_id=row.last_run_id,
        last_run_at=row.last_run_at,
    )
