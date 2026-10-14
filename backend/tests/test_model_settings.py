"""Which model runs the work: Sonnet 5.5 on Anthropic, GPT-6.1 Sol on OpenAI.

Each provider has its own models, so switching provider must never leave the
other provider's model ids behind - they fail only at the first real call.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.llm.anthropic_adapter import AnthropicAdapter
from app.llm.catalog import belongs_to_other_provider
from app.llm.provider import LLMRequest, SystemBlock
from app.main import app
from app.models.enums import LLMProvider


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": f"models-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


TIERS = ("heavy_model", "mid_model", "fast_model")


async def test_a_new_account_runs_claude_work_on_sonnet_5_5(client, auth):
    res = await client.get("/api/v1/settings", headers=auth)
    body = res.json()
    assert body["default_provider"] == "anthropic"
    assert {body[t] for t in TIERS} == {"claude-sonnet-5-5"}


async def test_switching_provider_takes_that_providers_models(client, auth):
    res = await client.patch("/api/v1/settings", headers=auth, json={"default_provider": "openai"})
    assert {res.json()[t] for t in TIERS} == {"gpt-6.1-sol"}

    res = await client.patch("/api/v1/settings", headers=auth, json={"default_provider": "anthropic"})
    assert {res.json()[t] for t in TIERS} == {"claude-sonnet-5-5"}


async def test_a_model_named_with_the_switch_is_kept(client, auth):
    res = await client.patch(
        "/api/v1/settings",
        headers=auth,
        json={"default_provider": "openai", "fast_model": "gpt-6.1-custom"},
    )
    body = res.json()
    assert body["fast_model"] == "gpt-6.1-custom"
    assert body["heavy_model"] == "gpt-6.1-sol"


async def test_editing_one_tier_leaves_the_others(client, auth):
    res = await client.patch("/api/v1/settings", headers=auth, json={"fast_model": "claude-haiku-4-5"})
    body = res.json()
    assert body["fast_model"] == "claude-haiku-4-5"
    assert body["heavy_model"] == "claude-sonnet-5-5"


def test_a_claude_model_is_never_sent_to_openai():
    assert belongs_to_other_provider(LLMProvider.OPENAI, "claude-sonnet-5")
    assert belongs_to_other_provider(LLMProvider.ANTHROPIC, "gpt-6.1-sol")
    assert not belongs_to_other_provider(LLMProvider.ANTHROPIC, "claude-sonnet-5-5")
    # An id the catalog does not know is the user's to choose.
    assert not belongs_to_other_provider(LLMProvider.OPENAI, "gpt-6-preview")


def _request(*, thinking: bool, effort: str = "low") -> LLMRequest:
    return LLMRequest(
        purpose="test",
        system=[SystemBlock("system")],
        messages=[{"role": "user", "content": "hi"}],
        max_output_tokens=1_000,
        effort=effort,  # type: ignore[arg-type]
        thinking=thinking,
    )


def test_sonnet_5_5_turns_thinking_off_with_between_tools():
    """It 400s on "disabled", and leaving thinking out means adaptive."""
    adapter = AnthropicAdapter("sk-test", "claude-sonnet-5-5")
    assert adapter._kwargs(_request(thinking=False))["thinking"] == {"type": "between_tools"}
    assert adapter._kwargs(_request(thinking=True))["thinking"]["type"] == "adaptive"
    # between_tools is rejected above high effort; adaptive is all that is left.
    assert "thinking" not in adapter._kwargs(_request(thinking=False, effort="max"))


def test_other_claude_models_keep_their_thinking_off_behaviour():
    adapter = AnthropicAdapter("sk-test", "claude-opus-5")
    assert "thinking" not in adapter._kwargs(_request(thinking=False))


def test_openai_cost_does_not_bill_cached_input_twice():
    """OpenAI counts cached tokens inside input_tokens; Anthropic does not."""
    from types import SimpleNamespace

    from app.llm.openai_adapter import OpenAIAdapter

    adapter = OpenAIAdapter("sk-test", "gpt-6.1-sol")
    resp = SimpleNamespace(
        output_text="{}",
        status="completed",
        usage=SimpleNamespace(
            input_tokens=1_000_000,
            output_tokens=100_000,
            input_tokens_details=SimpleNamespace(cached_tokens=800_000),
        ),
    )
    out = adapter._to_response(resp, latency_ms=1)
    assert out.usage.input_tokens == 200_000
    assert out.usage.cache_read_tokens == 800_000
    # 200K x $2 + 800K x $0.10 + 100K x $10 = $0.40 + $0.08 + $1.00
    assert out.cost_usd_micros == 1_480_000


def test_gpt_6_1_sol_gets_reasoning_effort_and_no_temperature():
    from app.llm.openai_adapter import OpenAIAdapter

    adapter = OpenAIAdapter("sk-test", "gpt-6.1-sol")
    req = _request(thinking=True, effort="high")
    req.temperature = 0.2
    kwargs = adapter._kwargs(req)
    assert kwargs["reasoning"] == {"effort": "high"}
    assert "temperature" not in kwargs


async def test_a_streamed_turn_records_its_cost():
    """The worker streams every turn; a streamed turn used to cost $0."""
    from app.llm.catalog import spec_for
    from app.llm.provider import LLMEvent
    from app.remote.orchestration.resume_pipeline import ResumePipeline

    class Streaming:
        model = "claude-sonnet-5-5"
        spec = spec_for(LLMProvider.ANTHROPIC, "claude-sonnet-5-5")
        caps = spec.caps

        async def stream(self, req):
            yield LLMEvent("text_delta", {"text": "{}"})
            yield LLMEvent(
                "usage",
                {"input_tokens": 100_000, "output_tokens": 50_000, "cache_read_tokens": 1_000_000},
            )
            yield LLMEvent("done", {"stop_reason": "end_turn"})

    async def ignore(event):
        return None

    pipeline = ResumePipeline(Streaming())
    pipeline.on_event = ignore
    resp = await pipeline._call("draft", [{"role": "user", "content": "hi"}])
    # 100K x $2 + 50K x $10 + 1M x $0.20 = $0.20 + $0.50 + $0.20
    assert resp.cost_usd_micros == 900_000
    assert pipeline.calls[-1]["cost_usd_micros"] == 900_000
