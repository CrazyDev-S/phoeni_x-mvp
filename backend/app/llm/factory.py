"""Resolve a configured provider for a user."""

from __future__ import annotations

import uuid
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import unseal
from app.llm.anthropic_adapter import AnthropicAdapter
from app.llm.catalog import DEFAULT_TIERS
from app.llm.openai_adapter import OpenAIAdapter
from app.llm.provider import LLMProviderPort, MissingCredentialError
from app.models.enums import CredentialStatus, LLMProvider
from app.models.user import LLMCredential, UserSettings

Tier = str  # heavy | mid | fast


async def load_api_key(
    session: AsyncSession, user_id: uuid.UUID, provider: LLMProvider
) -> str:
    row = await session.scalar(
        select(LLMCredential).where(
            LLMCredential.user_id == user_id,
            LLMCredential.provider == provider,
            LLMCredential.status != CredentialStatus.REVOKED,
        )
    )
    if row is None:
        raise MissingCredentialError(provider.value)
    return unseal(
        row.key_ciphertext,
        row.key_nonce,
        user_id=str(user_id),
        provider=provider.value,
        label=row.label,
    )


async def get_provider(
    session: AsyncSession, user_id: uuid.UUID, tier: Tier = "heavy"
) -> LLMProviderPort:
    settings = await session.get(UserSettings, user_id)
    provider = settings.default_provider if settings else LLMProvider.ANTHROPIC

    model = None
    if settings:
        model = {"heavy": settings.heavy_model, "mid": settings.mid_model,
                 "fast": settings.fast_model}.get(tier)
    model = model or DEFAULT_TIERS[provider][tier]

    key = await load_api_key(session, user_id, provider)
    if provider is LLMProvider.ANTHROPIC:
        return AnthropicAdapter(key, model)
    # A stable cache key improves OpenAI's implicit prefix-cache routing.
    return OpenAIAdapter(key, model, cache_key=f"{user_id}:{_prompt_version()}")


@lru_cache(maxsize=1)
def _prompt_version() -> str:
    from app.llm.prompts import PROMPT_VERSION

    return PROMPT_VERSION
