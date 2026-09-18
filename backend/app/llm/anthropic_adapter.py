"""Anthropic adapter.

Encodes the current API surface rather than a remembered one. The things that
are 400-level errors if you get them wrong:

* ``temperature`` / ``top_p`` are rejected on current models.
* ``output_config.effort`` errors on Haiku 4.5 - it is not ignored.
* Opus 5 / Sonnet 5 use ``thinking={"type": "adaptive"}``; ``budget_tokens``
  is removed. Haiku 4.5 still requires ``{"type": "enabled", budget_tokens}``.
* Assistant prefill is removed on all current models.
* Thinking ``display`` defaults to ``omitted``, so a progress stream looks
  dead for ninety seconds unless ``summarized`` is set explicitly.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

import anthropic

from app.llm.catalog import ModelSpec, cost_micros, spec_for
from app.llm.provider import (
    LLMError,
    LLMEvent,
    LLMRequest,
    LLMResponse,
    RefusedError,
    Usage,
)
from app.models.enums import LLMProvider

# Streaming is mandatory above this output size: the SDK refuses non-streaming
# requests it estimates will exceed ~10 minutes, and idle connections drop.
STREAM_THRESHOLD_TOKENS = 20_000

# How many times a turn may be resumed after a server tool pauses it.
MAX_PAUSE_RESUMES = 6


class AnthropicAdapter:
    name = "anthropic"

    def __init__(self, api_key: str, model: str) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=3)
        self.model = model
        self.spec: ModelSpec | None = spec_for(LLMProvider.ANTHROPIC, model)
        self.caps = self.spec.caps if self.spec else {}

    # -- request construction ---------------------------------------------

    def _system(self, req: LLMRequest) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for block in req.system:
            entry: dict[str, Any] = {"type": "text", "text": block.text}
            if block.cache and self.caps.get("explicit_cache_breakpoints", True):
                entry["cache_control"] = (
                    {"type": "ephemeral"}
                    if block.cache == "5m"
                    else {"type": "ephemeral", "ttl": "1h"}
                )
            out.append(entry)
        return out

    def _thinking(self, req: LLMRequest) -> dict[str, Any] | None:
        if not req.thinking:
            return None
        if self.caps.get("adaptive_thinking"):
            return {
                "type": "adaptive",
                "display": "summarized" if req.show_thinking else "omitted",
            }
        if self.caps.get("thinking_budget_tokens"):
            # Must be strictly less than max_tokens, minimum 1024.
            budget = max(1024, min(8192, req.max_output_tokens - 1024))
            if budget >= req.max_output_tokens:
                return None
            return {"type": "enabled", "budget_tokens": budget}
        return None

    def _kwargs(self, req: LLMRequest) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": req.max_output_tokens,
            "system": self._system(req),
            "messages": req.messages,
        }

        if thinking := self._thinking(req):
            kwargs["thinking"] = thinking

        output_config: dict[str, Any] = {}
        # effort is rejected on Haiku 4.5; gate it on the capability flag.
        if self.caps.get("effort"):
            output_config["effort"] = req.effort
        if req.output_schema is not None:
            output_config["format"] = {
                "type": "json_schema",
                "schema": _anthropic_schema(req.output_schema),
            }
        if output_config:
            kwargs["output_config"] = output_config

        if req.tools:
            kwargs["tools"] = req.tools
            if req.tool_choice:
                kwargs["tool_choice"] = req.tool_choice

        # Dropped rather than discovered at runtime: current models 400 on it.
        if req.temperature is not None and self.caps.get("temperature"):
            kwargs["temperature"] = req.temperature

        return kwargs

    # -- calls -------------------------------------------------------------

    async def complete(self, req: LLMRequest) -> LLMResponse:
        kwargs = self._kwargs(req)
        started = time.perf_counter()
        client = self._client.with_options(timeout=req.timeout_s)
        totals = Usage()

        # A server tool that hits its own iteration limit returns
        # stop_reason="pause_turn" with the work so far. Resuming means sending
        # the assistant turn straight back with nothing appended. Treating a
        # pause as an answer would silently truncate the research half way.
        for _ in range(MAX_PAUSE_RESUMES + 1):
            try:
                if req.max_output_tokens >= STREAM_THRESHOLD_TOKENS:
                    async with client.messages.stream(**kwargs) as stream:
                        message = await stream.get_final_message()
                else:
                    message = await client.messages.create(**kwargs)
            except anthropic.APIError as exc:
                raise _translate(exc) from exc

            _accumulate(totals, message)
            if message.stop_reason != "pause_turn":
                break
            kwargs["messages"] = [
                *kwargs["messages"],
                {"role": "assistant", "content": message.content},
            ]

        response = self._to_response(message, int((time.perf_counter() - started) * 1000))
        # Report what the whole turn cost, not just its final leg.
        response.usage = totals
        response.cost_usd_micros = cost_micros(self.spec, totals.as_dict())
        return response

    async def stream(self, req: LLMRequest) -> AsyncIterator[LLMEvent]:
        kwargs = self._kwargs(req)
        started = time.perf_counter()
        client = self._client.with_options(timeout=req.timeout_s)
        try:
            async with client.messages.stream(**kwargs) as stream:
                async for event in stream:
                    if event.type == "content_block_delta":
                        if event.delta.type == "text_delta":
                            yield LLMEvent("text_delta", {"text": event.delta.text})
                        elif event.delta.type == "thinking_delta":
                            yield LLMEvent("thinking", {"text": event.delta.thinking})
                    elif event.type == "content_block_start":
                        block = event.content_block
                        if block.type == "tool_use":
                            yield LLMEvent("tool_started", {"name": block.name})
                message = await stream.get_final_message()
        except anthropic.APIError as exc:
            raise _translate(exc) from exc

        response = self._to_response(message, int((time.perf_counter() - started) * 1000))
        yield LLMEvent("usage", response.usage.as_dict() | {"cost_usd_micros": response.cost_usd_micros})
        yield LLMEvent("done", {"text": response.text, "stop_reason": response.stop_reason})

    def _to_response(self, message: Any, latency_ms: int) -> LLMResponse:
        if message.stop_reason == "refusal":
            details = getattr(message, "stop_details", None)
            raise RefusedError(
                getattr(details, "category", None), getattr(details, "explanation", None)
            )

        text = "".join(b.text for b in message.content if b.type == "text")
        tool_calls = [
            {"id": b.id, "name": b.name, "input": b.input}
            for b in message.content
            if b.type == "tool_use"
        ]

        u = message.usage
        creation = getattr(u, "cache_creation", None)
        usage = Usage(
            input_tokens=getattr(u, "input_tokens", 0) or 0,
            output_tokens=getattr(u, "output_tokens", 0) or 0,
            cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
            cache_write_5m_tokens=getattr(creation, "ephemeral_5m_input_tokens", 0) or 0,
            cache_write_1h_tokens=getattr(creation, "ephemeral_1h_input_tokens", 0) or 0,
        )
        if not (usage.cache_write_5m_tokens or usage.cache_write_1h_tokens):
            usage.cache_write_5m_tokens = getattr(u, "cache_creation_input_tokens", 0) or 0

        parsed = None
        if text:
            try:
                parsed = json.loads(text)
            except (ValueError, TypeError):
                parsed = None

        return LLMResponse(
            text=text,
            parsed=parsed,
            tool_calls=tool_calls,
            raw_content=list(message.content),
            stop_reason=message.stop_reason,
            usage=usage,
            model=self.model,
            latency_ms=latency_ms,
            cost_usd_micros=cost_micros(self.spec, usage.as_dict()),
        )

    async def count_tokens(self, req: LLMRequest) -> int:
        result = await self._client.messages.count_tokens(
            model=self.model, system=self._system(req), messages=req.messages
        )
        return result.input_tokens

    async def healthcheck(self) -> tuple[bool, str]:
        try:
            await self._client.with_options(timeout=20.0, max_retries=0).messages.create(
                model=self.model,
                max_tokens=1,
                messages=[{"role": "user", "content": "ping"}],
            )
        except anthropic.AuthenticationError:
            return False, "The API key was rejected"
        except anthropic.PermissionDeniedError:
            return False, "The API key lacks permission for this model"
        except anthropic.NotFoundError:
            return False, f"Model {self.model!r} is not available to this key"
        except anthropic.APIError as exc:
            return False, str(getattr(exc, "message", exc))
        return True, "ok"


def _accumulate(totals: Usage, message: Any) -> None:
    usage = message.usage
    creation = getattr(usage, "cache_creation", None)
    totals.input_tokens += getattr(usage, "input_tokens", 0) or 0
    totals.output_tokens += getattr(usage, "output_tokens", 0) or 0
    totals.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0) or 0
    written_5m = getattr(creation, "ephemeral_5m_input_tokens", 0) or 0
    written_1h = getattr(creation, "ephemeral_1h_input_tokens", 0) or 0
    if not (written_5m or written_1h):
        written_5m = getattr(usage, "cache_creation_input_tokens", 0) or 0
    totals.cache_write_5m_tokens += written_5m
    totals.cache_write_1h_tokens += written_1h


def _anthropic_schema(model: type[Any]) -> dict[str, Any]:
    """JSON Schema accepted by ``output_config.format``.

    Constraints that are silently stripped rather than honoured - ``minItems``,
    ``minLength``, ``maximum`` - are removed here so nothing downstream mistakes
    a schema for enforcement. The real enforcement is the validation registry.
    """
    return _strip_unsupported(model.model_json_schema())


_UNSUPPORTED_KEYS = {
    "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum",
    "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "pattern", "format",
    "default", "examples",
}


def _strip_unsupported(node: Any) -> Any:
    if isinstance(node, dict):
        out = {k: _strip_unsupported(v) for k, v in node.items() if k not in _UNSUPPORTED_KEYS}
        if out.get("type") == "object":
            out.setdefault("additionalProperties", False)
            # Strict mode requires every property to be listed in `required`.
            if "properties" in out:
                out["required"] = list(out["properties"].keys())
        return out
    if isinstance(node, list):
        return [_strip_unsupported(v) for v in node]
    return node


def _translate(exc: anthropic.APIError) -> LLMError:
    status = getattr(exc, "status_code", None)
    message = str(getattr(exc, "message", exc))
    if isinstance(exc, anthropic.AuthenticationError):
        return LLMError("BAD_CREDENTIAL", message, status=401)
    if isinstance(exc, anthropic.RateLimitError):
        return LLMError("RATE_LIMITED", message, status=429, retryable=True)
    if isinstance(exc, anthropic.BadRequestError):
        return LLMError("BAD_REQUEST", message, status=400)
    if isinstance(exc, anthropic.APIConnectionError):
        return LLMError("CONNECTION", message, retryable=True)
    return LLMError("PROVIDER_ERROR", message, status=status, retryable=bool(status and status >= 500))
