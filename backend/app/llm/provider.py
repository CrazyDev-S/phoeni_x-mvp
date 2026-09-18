"""The provider port.

One narrow interface, two adapters. Every place the providers disagree is a
capability flag read from the model catalog - never a try/except around a 400.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import BaseModel

Effort = Literal["low", "medium", "high", "xhigh", "max"]
CacheTTL = Literal["5m", "1h"]


class LLMError(Exception):
    def __init__(
        self, code: str, message: str, *, status: int | None = None, retryable: bool = False
    ) -> None:
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable
        super().__init__(f"{code}: {message}")


class MissingCredentialError(LLMError):
    def __init__(self, provider: str) -> None:
        super().__init__(
            "NO_PROVIDER_KEY", f"No API key configured for {provider}", status=409
        )


class RefusedError(LLMError):
    def __init__(self, category: str | None, explanation: str | None) -> None:
        self.category = category
        super().__init__(
            "REFUSED", explanation or f"The model declined this request ({category})"
        )


@dataclass(frozen=True)
class SystemBlock:
    """A system-prompt segment.

    ``cache`` marks a cache breakpoint. The block's text must be byte-frozen:
    interpolating a date or a user name here invalidates the whole prefix on
    every request, which is the most common silent caching regression.
    """

    text: str
    cache: CacheTTL | None = None


@dataclass
class LLMRequest:
    purpose: str
    system: list[SystemBlock]
    messages: list[dict[str, Any]]
    max_output_tokens: int = 16_000
    effort: Effort = "high"
    output_schema: type[BaseModel] | None = None
    tools: list[dict[str, Any]] = field(default_factory=list)
    tool_choice: dict[str, Any] | None = None
    thinking: bool = True
    show_thinking: bool = True
    timeout_s: float = 300.0
    # Only honoured by providers whose caps allow it; dropped otherwise.
    temperature: float | None = None


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_5m_tokens: int = 0
    cache_write_1h_tokens: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_5m_tokens": self.cache_write_5m_tokens,
            "cache_write_1h_tokens": self.cache_write_1h_tokens,
        }


@dataclass
class LLMResponse:
    text: str
    parsed: BaseModel | dict | None = None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    raw_content: list[Any] = field(default_factory=list)
    stop_reason: str | None = None
    usage: Usage = field(default_factory=Usage)
    model: str = ""
    latency_ms: int = 0
    cost_usd_micros: int = 0


@dataclass
class LLMEvent:
    """Normalized stream event.

    The SSE endpoint forwards these verbatim, so neither the portal nor the
    extension ever sees a provider-shaped payload.
    """

    type: Literal[
        "phase", "text_delta", "thinking", "tool_started", "usage", "done", "error"
    ]
    data: dict[str, Any] = field(default_factory=dict)


class LLMProviderPort(Protocol):
    name: str

    async def complete(self, req: LLMRequest) -> LLMResponse: ...

    def stream(self, req: LLMRequest) -> AsyncIterator[LLMEvent]: ...

    async def count_tokens(self, req: LLMRequest) -> int: ...

    async def healthcheck(self) -> tuple[bool, str]: ...
