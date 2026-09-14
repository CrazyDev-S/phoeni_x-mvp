"""Pipeline behaviour, exercised against a stub provider.

The point of these tests is the machinery BETWEEN the model calls: the parse
gate, the validation gate, and the bounded repair loop. They must not need an
API key, and they must not spend money.
"""

from __future__ import annotations

from datetime import date
from typing import ClassVar

import pytest

from app.llm.provider import LLMError, LLMRequest, LLMResponse, SystemBlock, Usage
from app.orchestration.resume_pipeline import (
    MAX_REPAIRS,
    STALL_DRAFTS,
    PipelineInput,
    ResumePipeline,
)
from app.resume.parser import ResumeMarkdownError


class StubProvider:
    """Returns a scripted reply per call, and records what it was sent."""

    name = "stub"

    def __init__(self, replies: list[str]) -> None:
        self.replies = list(replies)
        self.requests: list[LLMRequest] = []

    async def complete(self, req: LLMRequest) -> LLMResponse:
        self.requests.append(req)
        text = self.replies.pop(0) if self.replies else "{}"
        return LLMResponse(
            text=text,
            parsed=_maybe_json(text),
            usage=Usage(input_tokens=10, output_tokens=20, cache_read_tokens=5),
            model="stub-model",
        )

    def stream(self, req):  # pragma: no cover - unused here
        raise NotImplementedError

    async def count_tokens(self, req) -> int:  # pragma: no cover
        return 0

    async def healthcheck(self):  # pragma: no cover
        return True, "ok"


def _maybe_json(text: str):
    import json

    try:
        return json.loads(text)
    except ValueError:
        return None


LEDGER_JSON = """{"mode":"grounded","total_years":9,"job_required_years":7,
"keyword_plan":[{"keyword":"FastAPI","priority":"MUST","planned_sections":["Skills"]},
{"keyword":"React","priority":"MUST","planned_sections":["Skills"]},
{"keyword":"Rust","priority":"NICE","planned_sections":["Skills"]}],
"gate":[{"id":1,"name":"Arithmetic","result":"PASS","evidence":"sums"}],
"dossiers":[]}"""

ANALYSIS_JSON = """{"required_years":7,"keyword_plan":[
{"keyword":"FastAPI","priority":"MUST","planned_sections":["Skills"]},
{"keyword":"React","priority":"MUST","planned_sections":["Skills"]},
{"keyword":"Kafka","priority":"NICE","planned_sections":["Skills"]}]}"""

FLAGS_JSON = """{"estimated_figures":[],"uncovered_requirements":[],
"must_verify":["Confirm the Veeva backlog figure"],"interview_probes":[],"notes":""}"""


async def drain(gen):
    events = []
    async for e in gen:
        events.append(e)
    return events


@pytest.mark.asyncio
async def test_happy_path_produces_a_result(aran_markdown: str) -> None:
    provider = StubProvider([LEDGER_JSON, aran_markdown, FLAGS_JSON])
    pipeline = ResumePipeline(provider)
    events = await drain(
        pipeline.generate(
            PipelineInput(target_title="Senior Software Engineer – AI Fullstack",
                          today=date(2026, 9, 11))
        )
    )
    result = events[-1].data["result"]

    assert events[-1].type == "done"
    assert result.resume.header.name == "Aran Thammasiri"
    assert result.ledger.total_years == 9
    assert result.flags.must_verify == ["Confirm the Veeva backlog figure"]
    assert result.report["must_have_total"] == 2
    assert result.report["must_have_covered"] == 2
    assert result.report["nice_to_have_covered"] == 0  # Rust genuinely absent
    assert result.needs_review is False
    # Exactly three model calls: scenario, draft, flags.
    assert [c["purpose"] for c in result.calls] == ["scenario", "draft", "flags"]


@pytest.mark.asyncio
async def test_system_prefix_is_byte_identical_across_turns(aran_markdown: str) -> None:
    """The cached prefix must not drift between turns, or caching pays nothing."""
    provider = StubProvider([LEDGER_JSON, aran_markdown, FLAGS_JSON])
    await drain(ResumePipeline(provider).generate(PipelineInput(target_title="X")))

    prefixes = {r.system[0].text for r in provider.requests}
    assert len(prefixes) == 1, "system prompt changed between turns"
    # 1h, not the 5m default: a measured job ran nine minutes, so a 5-minute
    # entry expired mid-job and was re-written instead of read.
    assert all(r.system[0].cache == "1h" for r in provider.requests)


@pytest.mark.asyncio
async def test_volatile_values_stay_out_of_the_system_prompt(aran_markdown: str) -> None:
    """Today's date and the mode belong in the user turn, never the prefix."""
    provider = StubProvider([LEDGER_JSON, aran_markdown, FLAGS_JSON])
    await drain(
        ResumePipeline(provider).generate(
            PipelineInput(target_title="X", today=date(2026, 9, 11), base_country="Thailand")
        )
    )
    system = provider.requests[0].system[0].text
    assert "2026-09-11" not in system
    assert "Thailand" not in system
    assert "2026-09-11" in provider.requests[0].messages[0]["content"]


@pytest.mark.asyncio
async def test_validation_failure_triggers_one_repair_turn(aran_markdown: str) -> None:
    broken = aran_markdown.replace("Mentored 4 engineers", "Mentored several engineers")
    provider = StubProvider([LEDGER_JSON, broken, aran_markdown, FLAGS_JSON])
    result = (
        await drain(
            ResumePipeline(provider).generate(
                PipelineInput(target_title="X", today=date(2026, 9, 11))
            )
        )
    )[-1].data["result"]

    assert [c["purpose"] for c in result.calls] == ["scenario", "draft", "draft", "flags"]
    repair = provider.requests[2].messages[-1]["content"]
    assert "PLACEHOLDER_TOKEN" in repair
    assert "several" in repair
    assert result.needs_review is False  # the retry was clean


@pytest.mark.asyncio
async def test_parse_failure_reports_the_line_in_the_repair_turn(aran_markdown: str) -> None:
    garbage = "---\nname: A\ntitle: B\nlocation: C\n---\n\n## TECHNICAL SKILLS\n\n- nope\n"
    provider = StubProvider([LEDGER_JSON, garbage, aran_markdown, FLAGS_JSON])
    await drain(
        ResumePipeline(provider).generate(
            PipelineInput(target_title="X", today=date(2026, 9, 11))
        )
    )
    repair = provider.requests[2].messages[-1]["content"]
    assert "PARSE ERROR" in repair
    assert "line 9" in repair


def vague(markdown: str, word: str) -> str:
    return markdown.replace("Mentored 4 engineers", f"Mentored {word} engineers")


async def generate(provider: StubProvider):
    events = await drain(
        ResumePipeline(provider).generate(
            PipelineInput(target_title="X", today=date(2026, 9, 11))
        )
    )
    return events[-1].data["result"]


@pytest.mark.asyncio
async def test_repairs_continue_until_the_draft_is_clean(aran_markdown: str) -> None:
    """Regression: repairs stopped after two rounds and shipped the errors."""
    drafts = [vague(aran_markdown, w) for w in ("several", "various", "numerous")]
    provider = StubProvider([LEDGER_JSON, *drafts, aran_markdown, FLAGS_JSON])
    result = await generate(provider)

    assert [c["purpose"] for c in result.calls] == [
        "scenario", "draft", "draft", "draft", "draft", "flags",
    ]
    assert result.needs_review is False


@pytest.mark.asyncio
async def test_an_error_that_survives_a_repair_is_called_out(aran_markdown: str) -> None:
    broken = vague(aran_markdown, "several")
    provider = StubProvider([LEDGER_JSON, broken, broken, aran_markdown, FLAGS_JSON])
    await generate(provider)

    first, second = (provider.requests[i].messages[-1]["content"] for i in (2, 3))
    assert "STILL FAILING" not in first
    assert "STILL FAILING" in second


@pytest.mark.asyncio
async def test_a_stuck_model_stops_early_and_the_result_is_flagged(aran_markdown: str) -> None:
    """The same errors back draft after draft will not change with more spend."""
    broken = vague(aran_markdown, "several")
    provider = StubProvider([LEDGER_JSON, *[broken] * STALL_DRAFTS, FLAGS_JSON])
    result = await generate(provider)

    drafts = [c for c in result.calls if c["purpose"] == "draft"]
    assert len(drafts) == STALL_DRAFTS
    # Surfaced honestly rather than silently shipped.
    assert result.needs_review is True
    assert any(f.rule_id == "PLACEHOLDER_TOKEN" for f in result.findings)


@pytest.mark.asyncio
async def test_repairs_are_capped_even_when_every_round_differs(aran_markdown: str) -> None:
    """A model that never fixes the problem must not loop forever."""
    words = ["several", "various", "numerous", "significant", "substantial", "multiple", "many"]
    assert len(words) > MAX_REPAIRS
    drafts = [vague(aran_markdown, w) for w in words[: MAX_REPAIRS + 1]]
    provider = StubProvider([LEDGER_JSON, *drafts, FLAGS_JSON])
    result = await generate(provider)

    assert len([c for c in result.calls if c["purpose"] == "draft"]) == MAX_REPAIRS + 1
    assert result.needs_review is True


@pytest.mark.asyncio
async def test_the_draft_with_the_fewest_errors_is_kept(aran_markdown: str) -> None:
    one = vague(aran_markdown, "several")
    two = one.replace("214 customer vaults", "[N] customer vaults")
    provider = StubProvider([LEDGER_JSON, one, *[two] * STALL_DRAFTS, FLAGS_JSON])
    result = await generate(provider)

    assert len([f for f in result.findings if f.severity == "error"]) == 1
    assert "[N]" not in result.content_markdown


@pytest.mark.asyncio
async def test_upgrade_repairs_a_saved_resume(aran_markdown: str) -> None:
    provider = StubProvider([aran_markdown])
    result = (
        await drain(
            ResumePipeline(provider).upgrade(
                base_resume_md=vague(aran_markdown, "several"),
                ledger=None,
                spec=PipelineInput(target_title="X", today=date(2026, 9, 11)),
            )
        )
    )[-1].data["result"]

    assert [c["purpose"] for c in result.calls] == ["draft"]
    assert "several" in provider.requests[0].messages[0]["content"]
    assert result.needs_review is False
    assert "several" not in result.content_markdown


@pytest.mark.asyncio
async def test_upgrading_a_clean_resume_spends_nothing(aran_markdown: str) -> None:
    provider = StubProvider([])
    result = (
        await drain(
            ResumePipeline(provider).upgrade(
                base_resume_md=aran_markdown,
                ledger=None,
                spec=PipelineInput(target_title="X", today=date(2026, 9, 11)),
            )
        )
    )[-1].data["result"]

    assert provider.requests == []
    assert result.content_markdown == aran_markdown


@pytest.mark.asyncio
async def test_an_upgrade_never_leaves_a_resume_worse(aran_markdown: str) -> None:
    broken = vague(aran_markdown, "several")
    worse = broken.replace("214 customer vaults", "[N] customer vaults")
    provider = StubProvider([worse] * STALL_DRAFTS)
    result = (
        await drain(
            ResumePipeline(provider).upgrade(
                base_resume_md=broken,
                ledger=None,
                spec=PipelineInput(target_title="X", today=date(2026, 9, 11)),
            )
        )
    )[-1].data["result"]

    assert result.content_markdown == broken


@pytest.mark.asyncio
async def test_unparseable_after_all_repairs_raises(aran_markdown: str) -> None:
    garbage = "---\nname: A\ntitle: B\nlocation: C\n---\n\n## TECHNICAL SKILLS\n\n- nope\n"
    provider = StubProvider([LEDGER_JSON, garbage, garbage, garbage, FLAGS_JSON])
    with pytest.raises(ResumeMarkdownError):
        await drain(
            ResumePipeline(provider).generate(PipelineInput(target_title="X"))
        )


@pytest.mark.asyncio
async def test_code_fences_are_stripped(aran_markdown: str) -> None:
    fenced = f"```markdown\n{aran_markdown}```"
    provider = StubProvider([LEDGER_JSON, fenced, FLAGS_JSON])
    result = (
        await drain(
            ResumePipeline(provider).generate(
                PipelineInput(target_title="X", today=date(2026, 9, 11))
            )
        )
    )[-1].data["result"]
    assert result.content_markdown.startswith("---")
    assert result.resume.header.name == "Aran Thammasiri"


async def tailor(provider: StubProvider, markdown: str):
    events = await drain(
        ResumePipeline(provider).tailor(
            base_resume_md=markdown,
            job_description="Senior AI engineer. Must have FastAPI, React. Kafka a plus.",
            company="Acme",
            spec=PipelineInput(target_title="Senior AI Engineer", today=date(2026, 9, 11)),
        )
    )
    return events[-1].data["result"]


@pytest.mark.asyncio
async def test_tailoring_scores_against_the_posting(aran_markdown: str) -> None:
    """Regression: tailoring had no keyword plan, so every result scored 0/0."""
    provider = StubProvider([ANALYSIS_JSON, aran_markdown])
    result = await tailor(provider, aran_markdown)

    assert [c["purpose"] for c in result.calls] == ["analysis", "draft"]
    assert result.report["must_have_total"] == 2
    assert result.report["must_have_covered"] == 2
    assert result.report["years_required"] == 7
    assert result.report["companies"] == 3
    # Stored with the tailored resume, so an upgrade can score it again.
    assert [k.keyword for k in result.ledger.keyword_plan] == ["FastAPI", "React", "Kafka"]


@pytest.mark.asyncio
async def test_a_missing_must_have_keyword_is_repaired(aran_markdown: str) -> None:
    rust_required = ANALYSIS_JSON.replace('"Kafka","priority":"NICE"', '"Rust","priority":"MUST"')
    with_rust = aran_markdown.replace("FastAPI", "FastAPI, Rust", 1)
    provider = StubProvider([rust_required, aran_markdown, with_rust])
    result = await tailor(provider, aran_markdown)

    assert [c["purpose"] for c in result.calls] == ["analysis", "draft", "draft"]
    repair = provider.requests[2].messages[-1]["content"]
    assert "MUST_HAVE_COVERAGE" in repair
    assert "Rust" in repair
    assert result.report["must_have_covered"] == result.report["must_have_total"] == 3


@pytest.mark.asyncio
async def test_a_keyword_the_resume_cannot_support_stops_without_blocking(
    aran_markdown: str,
) -> None:
    """Coverage is chased, but an honest gap is not a rule error."""
    rust_required = ANALYSIS_JSON.replace('"Kafka","priority":"NICE"', '"Rust","priority":"MUST"')
    provider = StubProvider([rust_required, *[aran_markdown] * STALL_DRAFTS])
    result = await tailor(provider, aran_markdown)

    assert len([c for c in result.calls if c["purpose"] == "draft"]) == STALL_DRAFTS
    assert result.report["must_have_covered"] == 2
    assert result.needs_review is False


@pytest.mark.asyncio
async def test_a_truncated_turn_is_retried_with_more_headroom(aran_markdown: str) -> None:
    """Regression: a real run truncated the scenario turn at its 24k cap and
    the pipeline accepted the cut-off JSON without noticing."""

    class TruncatingProvider(StubProvider):
        async def complete(self, req: LLMRequest) -> LLMResponse:
            response = await super().complete(req)
            # Truncate only the first scenario attempt.
            attempts = [r for r in self.requests if r.purpose == "scenario"]
            if req.purpose == "scenario" and len(attempts) == 1:
                response.stop_reason = "max_tokens"
            return response

    provider = TruncatingProvider([LEDGER_JSON, LEDGER_JSON, aran_markdown, FLAGS_JSON])
    result = (
        await drain(
            ResumePipeline(provider).generate(
                PipelineInput(target_title="X", today=date(2026, 9, 11))
            )
        )
    )[-1].data["result"]

    scenario_calls = [r for r in provider.requests if r.purpose == "scenario"]
    assert len(scenario_calls) == 2, "a truncated turn was accepted instead of retried"
    assert scenario_calls[1].max_output_tokens > scenario_calls[0].max_output_tokens
    assert result.ledger is not None


@pytest.mark.asyncio
async def test_truncating_twice_fails_loudly(aran_markdown: str) -> None:
    class AlwaysTruncates(StubProvider):
        async def complete(self, req: LLMRequest) -> LLMResponse:
            response = await super().complete(req)
            response.stop_reason = "max_tokens"
            return response

    provider = AlwaysTruncates([LEDGER_JSON] * 4)
    with pytest.raises(LLMError, match="truncated twice"):
        await drain(
            ResumePipeline(provider).generate(PipelineInput(target_title="X"))
        )


@pytest.mark.asyncio
async def test_research_off_means_no_search_tool_and_no_unsatisfiable_gate(
    aran_markdown: str,
) -> None:
    """Without a research tool the model cannot source a dossier, so enforcing
    DOSSIER_PROVENANCE would fail every Mode B run."""
    provider = StubProvider([LEDGER_JSON, aran_markdown, FLAGS_JSON])
    pipeline = ResumePipeline(provider, research_dossiers=False)
    result = (
        await drain(
            pipeline.generate(
                PipelineInput(
                    target_title="X", mode="constructed",
                    strict_dossier=True, today=date(2026, 9, 11),
                )
            )
        )
    )[-1].data["result"]

    assert all(not r.tools for r in provider.requests), "sent a tool it cannot use"
    dossier = [f for f in result.findings if f.rule_id == "DOSSIER_PROVENANCE"]
    assert dossier and all(f.severity == "warning" for f in dossier)
    # A warning must not block the extension's one-click download.
    assert result.needs_review is False


@pytest.mark.asyncio
async def test_research_on_sends_the_search_tool_and_enforces_dossiers(
    aran_markdown: str,
) -> None:
    """The generator prompt makes a verified dossier the licence to name a
    company. That only works if the model is actually given a search tool."""

    class ResearchProvider(StubProvider):
        caps: ClassVar[dict] = {
            "server_web_search": True,
            "web_search_tool_type": "web_search_20260209",
        }

    # The unsourced companies fail validation the same way every draft, so the
    # loop stops as stuck after STALL_DRAFTS and hands the run back for review.
    provider = ResearchProvider(
        [LEDGER_JSON, aran_markdown, aran_markdown, aran_markdown, FLAGS_JSON]
    )
    pipeline = ResumePipeline(provider, research_dossiers=True)
    result = (
        await drain(
            pipeline.generate(
                PipelineInput(
                    target_title="X", mode="constructed",
                    strict_dossier=True, today=date(2026, 9, 11),
                )
            )
        )
    )[-1].data["result"]

    scenario = provider.requests[0]
    assert scenario.tools, "research was on but no search tool was sent"
    assert scenario.tools[0]["type"] == "web_search_20260209"
    assert scenario.tools[0]["max_uses"] >= 9, "three companies need three searches each"

    instruction = scenario.messages[0]["content"]
    assert "web_search" in instruction
    assert "three searches per company" in instruction
    # Nothing should tell the model to avoid real employers when it can research.
    assert "do NOT name real employers" not in instruction

    # With research available, an unsourced company is a hard error again.
    dossier = [f for f in result.findings if f.rule_id == "DOSSIER_PROVENANCE"]
    assert dossier and all(f.severity == "error" for f in dossier)
    assert result.needs_review is True


@pytest.mark.asyncio
async def test_a_paused_turn_is_resumed_not_treated_as_an_answer() -> None:
    """A server tool that hits its iteration limit returns pause_turn with the
    work so far. Accepting that as the final answer truncates the research."""
    from app.llm.anthropic_adapter import AnthropicAdapter

    adapter = AnthropicAdapter("sk-test", "claude-opus-5")
    calls: list[dict] = []

    class Block:
        type = "text"
        text = '{"mode":"grounded"}'

    class Message:
        usage = type("U", (), {"input_tokens": 10, "output_tokens": 5,
                               "cache_read_input_tokens": 0})()

        def __init__(self, stop_reason: str) -> None:
            self.stop_reason = stop_reason
            self.content = [Block()]

    async def fake_create(**kwargs):
        calls.append(kwargs)
        # Pause once, then finish.
        return Message("pause_turn" if len(calls) == 1 else "end_turn")

    adapter._client = type(
        "C", (), {
            "messages": type("M", (), {"create": staticmethod(fake_create)})(),
            "with_options": lambda self, **kw: self,
        },
    )()

    response = await adapter.complete(
        LLMRequest(
            purpose="scenario",
            system=[SystemBlock("x")],
            messages=[{"role": "user", "content": "go"}],
            max_output_tokens=4000,
        )
    )

    assert len(calls) == 2, "a paused turn was accepted instead of resumed"
    # The resume carries the assistant turn back with nothing appended.
    assert calls[1]["messages"][-1]["role"] == "assistant"
    assert response.stop_reason == "end_turn"
    # Usage is summed across both legs, not just the last.
    assert response.usage.input_tokens == 20
