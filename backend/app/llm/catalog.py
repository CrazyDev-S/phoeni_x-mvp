"""Model capabilities and pricing.

Seeded into the ``model_catalog`` table so adding a model or correcting a
price is data, not a deploy. Figures are from the Anthropic API reference;
prices are integer micro-dollars per million tokens, never floats.

The capability flags exist because the providers genuinely disagree, and the
disagreements are 400-level errors rather than soft failures:

* Current Anthropic models REJECT ``temperature``/``top_p``.
* ``output_config.effort`` errors on Haiku 4.5 - it is not a no-op.
* Haiku 4.5 still uses ``thinking={"type": "enabled", "budget_tokens": N}``;
  Opus 5 and Sonnet 5 use adaptive thinking and reject ``budget_tokens``.
* Minimum cacheable prefixes are NOT monotonic across generations: 512 tokens
  on Opus 5 but 4096 on Haiku 4.5. Below the minimum, caching silently does
  nothing - no error, just ``cache_creation_input_tokens: 0``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from app.models.enums import LLMProvider

M = 1_000_000  # micro-dollars in a dollar


@dataclass(frozen=True)
class ModelSpec:
    provider: LLMProvider
    model_id: str
    display_name: str
    tier: str  # heavy | mid | fast
    context_window: int
    max_output_tokens: int
    min_cacheable_prefix_tokens: int
    price_in_usd_micros: int
    price_out_usd_micros: int
    price_cache_read_usd_micros: int = 0
    price_cache_write_5m_usd_micros: int = 0
    price_cache_write_1h_usd_micros: int = 0
    caps: dict = field(default_factory=dict)

    def as_row(self) -> dict:
        return asdict(self) | {"caps": self.caps}


def _anthropic_caps(
    *,
    effort: bool,
    adaptive_thinking: bool,
    mid_conversation_system: bool = False,
    server_fallbacks: bool = False,
) -> dict:
    return {
        "explicit_cache_breakpoints": True,
        "native_json_schema": True,
        "strict_tools": True,
        # Current Anthropic models 400 on temperature/top_p/top_k.
        "temperature": False,
        "effort": effort,
        "adaptive_thinking": adaptive_thinking,
        # Haiku 4.5 and older still take a fixed thinking budget.
        "thinking_budget_tokens": not adaptive_thinking,
        "server_web_search": effort,
        "web_search_tool_type": "web_search_20260209",
        "mid_conversation_system": mid_conversation_system,
        "server_fallbacks": server_fallbacks,
        "streaming": True,
    }


ANTHROPIC_MODELS = [
    ModelSpec(
        provider=LLMProvider.ANTHROPIC,
        model_id="claude-opus-5",
        display_name="Claude Opus 5",
        tier="heavy",
        context_window=1_000_000,
        max_output_tokens=128_000,
        min_cacheable_prefix_tokens=512,
        price_in_usd_micros=5 * M,
        price_out_usd_micros=25 * M,
        price_cache_read_usd_micros=int(0.5 * M),      # 0.1x input
        price_cache_write_5m_usd_micros=int(6.25 * M),  # 1.25x input
        price_cache_write_1h_usd_micros=10 * M,         # 2x input
        caps=_anthropic_caps(
            effort=True,
            adaptive_thinking=True,
            mid_conversation_system=True,
            server_fallbacks=True,
        ),
    ),
    ModelSpec(
        provider=LLMProvider.ANTHROPIC,
        model_id="claude-sonnet-5",
        display_name="Claude Sonnet 5",
        tier="mid",
        context_window=1_000_000,
        max_output_tokens=128_000,
        min_cacheable_prefix_tokens=1024,
        price_in_usd_micros=2 * M,
        price_out_usd_micros=10 * M,
        price_cache_read_usd_micros=int(0.2 * M),
        price_cache_write_5m_usd_micros=int(2.5 * M),
        price_cache_write_1h_usd_micros=4 * M,
        # Sonnet 5 does not take mid-conversation system messages.
        caps=_anthropic_caps(effort=True, adaptive_thinking=True),
    ),
    ModelSpec(
        provider=LLMProvider.ANTHROPIC,
        model_id="claude-haiku-4-5",
        display_name="Claude Haiku 4.5",
        tier="fast",
        context_window=200_000,
        max_output_tokens=64_000,
        min_cacheable_prefix_tokens=4096,
        price_in_usd_micros=1 * M,
        price_out_usd_micros=5 * M,
        price_cache_read_usd_micros=int(0.1 * M),
        price_cache_write_5m_usd_micros=int(1.25 * M),
        price_cache_write_1h_usd_micros=2 * M,
        # effort errors here, and thinking still takes budget_tokens.
        caps=_anthropic_caps(effort=False, adaptive_thinking=False),
    ),
]

OPENAI_MODELS = [
    ModelSpec(
        provider=LLMProvider.OPENAI,
        model_id="gpt-5.2",
        display_name="GPT-5.2",
        tier="heavy",
        context_window=400_000,
        max_output_tokens=128_000,
        # OpenAI caching is implicit above roughly 1024 tokens; there are no
        # markers to place and no TTL to choose.
        min_cacheable_prefix_tokens=1024,
        price_in_usd_micros=0,
        price_out_usd_micros=0,
        caps={
            "explicit_cache_breakpoints": False,
            "native_json_schema": True,
            "strict_tools": True,
            "temperature": True,
            "effort": True,
            "adaptive_thinking": False,
            "thinking_budget_tokens": False,
            "server_web_search": False,
            "mid_conversation_system": False,
            "server_fallbacks": False,
            "streaming": True,
            # Pricing is left at zero deliberately: it is not in this skill's
            # authoritative reference, so cost reporting is marked unknown for
            # OpenAI rather than guessed. Fill it from OpenAI's own docs.
            "pricing_unknown": True,
        },
    ),
]

ALL_MODELS = ANTHROPIC_MODELS + OPENAI_MODELS
BY_ID = {(m.provider, m.model_id): m for m in ALL_MODELS}

DEFAULT_TIERS = {
    LLMProvider.ANTHROPIC: {
        "heavy": "claude-opus-5",
        "mid": "claude-sonnet-5",
        "fast": "claude-haiku-4-5",
    },
    LLMProvider.OPENAI: {"heavy": "gpt-5.2", "mid": "gpt-5.2", "fast": "gpt-5.2"},
}


def spec_for(provider: LLMProvider, model_id: str) -> ModelSpec | None:
    return BY_ID.get((provider, model_id))


def cost_micros(spec: ModelSpec | None, usage: dict) -> int:
    """Cost in micro-dollars. Integer arithmetic end to end."""
    if spec is None or spec.caps.get("pricing_unknown"):
        return 0
    return (
        usage.get("input_tokens", 0) * spec.price_in_usd_micros
        + usage.get("output_tokens", 0) * spec.price_out_usd_micros
        + usage.get("cache_read_tokens", 0) * spec.price_cache_read_usd_micros
        + usage.get("cache_write_5m_tokens", 0) * spec.price_cache_write_5m_usd_micros
        + usage.get("cache_write_1h_tokens", 0) * spec.price_cache_write_1h_usd_micros
    ) // M
