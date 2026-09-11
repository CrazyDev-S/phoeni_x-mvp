"""Pipeline behaviour, exercised against a stub provider.

The point of these tests is the machinery BETWEEN the model calls: the parse
gate, the validation gate, and the bounded repair loop. They must not need an
API key, and they must not spend money.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.llm.ports import LLMRequest, LLMResponse, Usage
from app.orchestration.resume_pipeline import (
    MAX_REPAIRS,
    PipelineInput,
    ResumePipeline,
)
from app.resume.parser import CrmParseError


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


LEDGER_JSON = """{"mode":"grounded","total_yoe":9,"jd_required_yoe":7,
"keyword_plan":[{"keyword":"FastAPI","priority":"MUST","planned_sections":["Skills"]},
{"keyword":"Rust","priority":"MUST","planned_sections":["Skills"]}],
"gate":[{"id":1,"name":"Arithmetic","result":"PASS","evidence":"sums"}],
"dossiers":[]}"""

FLAGS_JSON = """{"estimated_figures":[],"uncovered_requirements":[],
"must_verify":["Confirm the Veeva backlog figure"],"interview_probes":[],"notes":""}"""


async def drain(gen):
    events = []
    async for e in gen:
        events.append(e)
    return events


@pytest.mark.asyncio
async def test_happy_path_produces_a_result(aran_md: str) -> None:
    provider = StubProvider([LEDGER_JSON, aran_md, FLAGS_JSON])
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
    assert result.ledger.total_yoe == 9
    assert result.flags.must_verify == ["Confirm the Veeva backlog figure"]
    assert result.report["must_have_total"] == 2
    assert result.report["must_have_covered"] == 1  # Rust genuinely absent
    assert result.needs_review is False
    # Exactly three model calls: scenario, draft, flags.
    assert [c["purpose"] for c in result.calls] == ["scenario", "draft", "flags"]


@pytest.mark.asyncio
async def test_system_prefix_is_byte_identical_across_turns(aran_md: str) -> None:
    """The cached prefix must not drift between turns, or caching pays nothing."""
    provider = StubProvider([LEDGER_JSON, aran_md, FLAGS_JSON])
    await drain(ResumePipeline(provider).generate(PipelineInput(target_title="X")))

    prefixes = {r.system[0].text for r in provider.requests}
    assert len(prefixes) == 1, "system prompt changed between turns"
    assert all(r.system[0].cache == "5m" for r in provider.requests)


@pytest.mark.asyncio
async def test_volatile_values_stay_out_of_the_system_prompt(aran_md: str) -> None:
    """Today's date and the mode belong in the user turn, never the prefix."""
    provider = StubProvider([LEDGER_JSON, aran_md, FLAGS_JSON])
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
async def test_validation_failure_triggers_one_repair_turn(aran_md: str) -> None:
    broken = aran_md.replace("Mentored 4 engineers", "Mentored several engineers")
    provider = StubProvider([LEDGER_JSON, broken, aran_md, FLAGS_JSON])
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
async def test_parse_failure_reports_the_line_in_the_repair_turn(aran_md: str) -> None:
    garbage = "---\nname: A\ntitle: B\nlocation: C\n---\n\n## TECHNICAL SKILLS\n\n- nope\n"
    provider = StubProvider([LEDGER_JSON, garbage, aran_md, FLAGS_JSON])
    await drain(
        ResumePipeline(provider).generate(
            PipelineInput(target_title="X", today=date(2026, 9, 11))
        )
    )
    repair = provider.requests[2].messages[-1]["content"]
    assert "PARSE ERROR" in repair
    assert "line 9" in repair


@pytest.mark.asyncio
async def test_repairs_are_bounded_and_the_result_is_flagged(aran_md: str) -> None:
    """A model that never fixes the problem must not loop forever."""
    broken = aran_md.replace("Mentored 4 engineers", "Mentored several engineers")
    provider = StubProvider([LEDGER_JSON, broken, broken, broken, FLAGS_JSON])
    result = (
        await drain(
            ResumePipeline(provider).generate(
                PipelineInput(target_title="X", today=date(2026, 9, 11))
            )
        )
    )[-1].data["result"]

    drafts = [c for c in result.calls if c["purpose"] == "draft"]
    assert len(drafts) == MAX_REPAIRS + 1
    # Surfaced honestly rather than silently shipped.
    assert result.needs_review is True
    assert any(f.rule_id == "PLACEHOLDER_TOKEN" for f in result.findings)


@pytest.mark.asyncio
async def test_unparseable_after_all_repairs_raises(aran_md: str) -> None:
    garbage = "---\nname: A\ntitle: B\nlocation: C\n---\n\n## TECHNICAL SKILLS\n\n- nope\n"
    provider = StubProvider([LEDGER_JSON, garbage, garbage, garbage, FLAGS_JSON])
    with pytest.raises(CrmParseError):
        await drain(
            ResumePipeline(provider).generate(PipelineInput(target_title="X"))
        )


@pytest.mark.asyncio
async def test_code_fences_are_stripped(aran_md: str) -> None:
    fenced = f"```markdown\n{aran_md}```"
    provider = StubProvider([LEDGER_JSON, fenced, FLAGS_JSON])
    result = (
        await drain(
            ResumePipeline(provider).generate(
                PipelineInput(target_title="X", today=date(2026, 9, 11))
            )
        )
    )[-1].data["result"]
    assert result.content_md.startswith("---")
    assert result.resume.header.name == "Aran Thammasiri"


@pytest.mark.asyncio
async def test_tailoring_keeps_dates_and_scores_coverage(aran_md: str) -> None:
    provider = StubProvider([aran_md])
    result = (
        await drain(
            ResumePipeline(provider).tailor(
                base_resume_md=aran_md,
                job_description="Senior AI engineer. Must have Python, FastAPI, RAG.",
                company="Acme",
                spec=PipelineInput(target_title="Senior AI Engineer", today=date(2026, 9, 11)),
            )
        )
    )[-1].data["result"]
    assert result.report["companies"] == 3
    assert [c["purpose"] for c in result.calls] == ["draft"]
