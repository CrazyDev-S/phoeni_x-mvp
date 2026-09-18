"""OpenAI adapter (secondary provider).

Deliberately thinner than the Anthropic adapter. The portable discipline is
the ordering of the prompt - static prefix first, volatile content last -
which benefits both providers. What differs:

* Caching is implicit: no breakpoints to place, no TTL to choose. We pass a
  ``prompt_cache_key`` to improve routing instead.
* Strict JSON schema requires ``additionalProperties: false`` AND every
  property listed in ``required``; optional fields must be ``anyOf: [T, null]``.
* Pricing is not carried in this project's authoritative reference, so cost is
  reported as unknown rather than guessed. See ``catalog.py``.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

import openai

from app.llm.catalog import cost_micros, spec_for
from app.llm.provider import LLMError, LLMEvent, LLMRequest, LLMResponse, Usage
from app.models.enums import LLMProvider

EFFORT_MAP = {
    "low": "low",
    "medium": "medium",
    "high": "high",
    "xhigh": "high",
    "max": "high",
}


class OpenAIAdapter:
    name = "openai"

    def __init__(self, api_key: str, model: str, *, cache_key: str = "") -> None:
        self._client = openai.AsyncOpenAI(api_key=api_key, max_retries=3)
        self.model = model
        self.spec = spec_for(LLMProvider.OPENAI, model)
        self.caps = self.spec.caps if self.spec else {}
        self._cache_key = cache_key

    def _kwargs(self, req: LLMRequest) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "instructions": "\n\n".join(b.text for b in req.system),
            "input": _to_input(req.messages),
            "max_output_tokens": req.max_output_tokens,
        }
        if self._cache_key:
            kwargs["prompt_cache_key"] = self._cache_key
        if self.caps.get("effort"):
            kwargs["reasoning"] = {"effort": EFFORT_MAP[req.effort]}
        if req.output_schema is not None:
            kwargs["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": req.output_schema.__name__,
                    "strict": True,
                    "schema": _openai_schema(req.output_schema),
                }
            }
        if req.temperature is not None and self.caps.get("temperature"):
            kwargs["temperature"] = req.temperature
        return kwargs

    async def complete(self, req: LLMRequest) -> LLMResponse:
        started = time.perf_counter()
        try:
            resp = await self._client.with_options(
                timeout=req.timeout_s
            ).responses.create(**self._kwargs(req))
        except openai.OpenAIError as exc:
            raise _translate(exc) from exc
        return self._to_response(resp, int((time.perf_counter() - started) * 1000))

    async def stream(self, req: LLMRequest) -> AsyncIterator[LLMEvent]:
        started = time.perf_counter()
        kwargs = self._kwargs(req) | {"stream": True}
        chunks: list[str] = []
        final: Any = None
        try:
            stream = await self._client.with_options(
                timeout=req.timeout_s
            ).responses.create(**kwargs)
            async for event in stream:
                etype = getattr(event, "type", "")
                if etype == "response.output_text.delta":
                    chunks.append(event.delta)
                    yield LLMEvent("text_delta", {"text": event.delta})
                elif etype == "response.completed":
                    final = event.response
        except openai.OpenAIError as exc:
            raise _translate(exc) from exc

        latency = int((time.perf_counter() - started) * 1000)
        response = (
            self._to_response(final, latency)
            if final is not None
            else LLMResponse(text="".join(chunks), model=self.model, latency_ms=latency)
        )
        yield LLMEvent("usage", response.usage.as_dict() | {"cost_usd_micros": response.cost_usd_micros})
        yield LLMEvent("done", {"text": response.text, "stop_reason": response.stop_reason})

    def _to_response(self, resp: Any, latency_ms: int) -> LLMResponse:
        text = getattr(resp, "output_text", "") or ""
        u = getattr(resp, "usage", None)
        details = getattr(u, "input_tokens_details", None)
        usage = Usage(
            input_tokens=getattr(u, "input_tokens", 0) or 0,
            output_tokens=getattr(u, "output_tokens", 0) or 0,
            cache_read_tokens=getattr(details, "cached_tokens", 0) or 0,
        )
        try:
            parsed = json.loads(text) if text else None
        except (ValueError, TypeError):
            parsed = None
        return LLMResponse(
            text=text,
            parsed=parsed,
            stop_reason=getattr(resp, "status", None),
            usage=usage,
            model=self.model,
            latency_ms=latency_ms,
            cost_usd_micros=cost_micros(self.spec, usage.as_dict()),
        )

    async def count_tokens(self, req: LLMRequest) -> int:
        # No token-counting endpoint; a 4-chars-per-token estimate is honest
        # enough for a budget warning and is labelled as an estimate upstream.
        chars = sum(len(b.text) for b in req.system) + sum(
            len(str(m.get("content", ""))) for m in req.messages
        )
        return chars // 4

    async def healthcheck(self) -> tuple[bool, str]:
        try:
            await self._client.with_options(timeout=20.0, max_retries=0).models.retrieve(
                self.model
            )
        except openai.AuthenticationError:
            return False, "The API key was rejected"
        except openai.NotFoundError:
            return False, f"Model {self.model!r} is not available to this key"
        except openai.OpenAIError as exc:
            return False, str(exc)
        return True, "ok"


def _to_input(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map our message list onto the Responses API input shape.

    Mid-conversation ``system`` messages are an Anthropic feature; OpenAI has
    no equivalent, so they are folded into developer-role turns.
    """
    out = []
    for m in messages:
        role = m.get("role")
        content = m.get("content")
        if role == "system":
            role = "developer"
        if isinstance(content, list):
            content = "\n".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            )
        out.append({"role": role, "content": content})
    return out


def _openai_schema(model: type[Any]) -> dict[str, Any]:
    return _strictify(model.model_json_schema())


def _strictify(node: Any) -> Any:
    if isinstance(node, dict):
        out = {k: _strictify(v) for k, v in node.items()}
        if out.get("type") == "object" and "properties" in out:
            out["additionalProperties"] = False
            # Strict mode demands every property appear in `required`.
            out["required"] = list(out["properties"].keys())
        return out
    if isinstance(node, list):
        return [_strictify(v) for v in node]
    return node


def _translate(exc: Exception) -> LLMError:
    if isinstance(exc, openai.AuthenticationError):
        return LLMError("BAD_CREDENTIAL", str(exc), status=401)
    if isinstance(exc, openai.RateLimitError):
        return LLMError("RATE_LIMITED", str(exc), status=429, retryable=True)
    if isinstance(exc, openai.BadRequestError):
        return LLMError("BAD_REQUEST", str(exc), status=400)
    if isinstance(exc, openai.APIConnectionError):
        return LLMError("CONNECTION", str(exc), retryable=True)
    return LLMError("PROVIDER_ERROR", str(exc))
