"""One model turn, streamed, with its reasoning reported while it runs.

A heavy turn can think for minutes before it writes a word; streaming it is
how the worker shows that it is still going. Reasoning deltas are coalesced
on a timer rather than forwarded one by one - a database write per token
would be absurd, and the reader only needs to see that something is happening.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable

from app.llm.catalog import cost_micros
from app.llm.provider import LLMEvent, LLMProviderPort, LLMRequest, LLMResponse, Usage

# How often a running turn reports its reasoning, and how much of it to keep.
THINKING_INTERVAL_SECONDS = 3.0
THINKING_TAIL_CHARS = 600


async def streamed_turn(
    provider: LLMProviderPort,
    request: LLMRequest,
    report: Callable[[LLMEvent], Awaitable[None]],
) -> LLMResponse:
    """Run ``request`` streaming, ``report`` a ``thinking`` event every few seconds."""
    summary: list[str] = []
    last_sent = 0.0
    usage = Usage()
    text_parts: list[str] = []
    stop_reason: str | None = None
    final_text: str | None = None
    started = time.perf_counter()

    async for event in provider.stream(request):
        if event.type == "thinking":
            summary.append(str(event.data.get("text", "")))
            now = time.perf_counter()
            if now - last_sent >= THINKING_INTERVAL_SECONDS:
                last_sent = now
                await report(
                    LLMEvent(
                        "thinking",
                        {
                            "purpose": request.purpose,
                            "text": "".join(summary)[-THINKING_TAIL_CHARS:],
                            "elapsed_seconds": int(now - started),
                        },
                    )
                )
        elif event.type == "text_delta":
            text_parts.append(str(event.data.get("text", "")))
        elif event.type == "usage":
            usage = Usage(
                input_tokens=event.data.get("input_tokens", 0),
                output_tokens=event.data.get("output_tokens", 0),
                cache_read_tokens=event.data.get("cache_read_tokens", 0),
                cache_write_5m_tokens=event.data.get("cache_write_5m_tokens", 0),
                cache_write_1h_tokens=event.data.get("cache_write_1h_tokens", 0),
            )
        elif event.type == "done":
            stop_reason = event.data.get("stop_reason")
            final_text = event.data.get("text")

    # The answer is the final message's text. A turn resumed after a search
    # paused it also streamed what it said before the pause.
    text = final_text if final_text is not None else "".join(text_parts)
    parsed = None
    if text:
        try:
            parsed = json.loads(text)
        except (ValueError, TypeError):
            parsed = None

    return LLMResponse(
        text=text,
        parsed=parsed,
        stop_reason=stop_reason,
        usage=usage,
        model=getattr(provider, "model", ""),
        latency_ms=int((time.perf_counter() - started) * 1000),
        # Without this every streamed call - and every generation's total - read $0.
        cost_usd_micros=cost_micros(getattr(provider, "spec", None), usage.as_dict()),
    )
