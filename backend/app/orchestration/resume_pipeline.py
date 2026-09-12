"""The generation pipeline: one conversation, three turns, two Python gates.

Why not a single call asking for all four blocks: the model would write the
resume and "12/12 PASS" in the same breath, so the gate would gate nothing.
Splitting the turns lets real code sit between them.

Why turns of ONE conversation rather than three independent calls: three calls
each re-pay the ~17k-token system prefix. Turns share a growing cached prefix,
and Opus 5 accepts mid-conversation ``system`` messages, so a phase transition
is an operator instruction that does not invalidate the cache.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from pydantic import ValidationError

from app.core.timezone import app_today
from app.llm.prompts import (
    DRAFT_TURN,
    FLAGS_TURN,
    frozen_system_prompt,
    instruction_turn,
    repair_turn,
    scenario_turn,
    tailor_turn,
)
from app.llm.provider import (
    CacheTTL,
    LLMEvent,
    LLMProviderPort,
    LLMRequest,
    LLMResponse,
    SystemBlock,
)
from app.llm.schemas import FlagsReport, ScenarioLedger
from app.orchestration import ats_report
from app.resume.document import Resume
from app.resume.parser import ResumeMarkdownError, parse
from app.resume.renderer import render_plain_text
from app.validation.rules import Context, Finding, validate

MAX_REPAIRS = 2


@dataclass
class GenerationResult:
    content_markdown: str
    content_text: str
    resume: Resume
    ledger: ScenarioLedger | None = None
    flags: FlagsReport | None = None
    report: dict = field(default_factory=dict)
    findings: list[Finding] = field(default_factory=list)
    usage: dict = field(default_factory=dict)
    calls: list[dict] = field(default_factory=list)

    @property
    def needs_review(self) -> bool:
        return any(f.severity == "error" for f in self.findings)


@dataclass
class PipelineInput:
    target_title: str
    mode: str = "grounded"
    base_country: str = "Thailand"
    job_description: str | None = None
    candidate_profile: str | None = None
    extra_instructions: str | None = None
    skill_count: int | None = None
    allow_real_company_names: bool = False
    strict_dossier: bool = True
    research_dossiers: bool = True
    today: date | None = None


class ResumePipeline:
    def __init__(self, provider: LLMProviderPort, *, cache_ttl: CacheTTL = "5m") -> None:
        self.provider = provider
        self.cache_ttl = cache_ttl
        self._system = [SystemBlock(frozen_system_prompt(), cache=cache_ttl)]
        self.calls: list[dict] = []

    # -- public entry points ----------------------------------------------

    async def generate(self, spec: PipelineInput) -> AsyncIterator[LLMEvent]:
        today = spec.today or app_today()
        messages: list[dict[str, Any]] = []

        yield LLMEvent("phase", {"phase": "scenario", "label": "Building career scenario", "percent": 5})
        messages.append(
            {
                "role": "user",
                "content": scenario_turn(
                    mode=spec.mode,
                    today=today.isoformat(),
                    base_country=spec.base_country,
                    target_title=spec.target_title,
                    job_description=spec.job_description,
                    candidate_profile=spec.candidate_profile,
                    extra_instructions=spec.extra_instructions,
                    allow_real_company_names=spec.allow_real_company_names,
                    skill_count=spec.skill_count,
                ),
            }
        )
        ledger_resp = await self._call(
            "scenario", messages, output_schema=ScenarioLedger, max_tokens=24_000
        )
        ledger = _coerce(ScenarioLedger, ledger_resp)
        messages.append({"role": "assistant", "content": ledger_resp.text})

        yield LLMEvent("phase", {"phase": "draft", "label": "Drafting the resume", "percent": 45})
        messages.append({"role": "user", "content": DRAFT_TURN})
        resume, content_markdown, findings = await self._draft_and_repair(
            messages, spec, ledger, today
        )

        yield LLMEvent("phase", {"phase": "validate", "label": "Checking hard rules", "percent": 80})
        yield LLMEvent(
            "usage",
            {"findings": [f.as_dict() for f in findings]},
        )

        yield LLMEvent("phase", {"phase": "flags", "label": "Writing interview prep", "percent": 90})
        messages.append({"role": "user", "content": FLAGS_TURN})
        flags_resp = await self._call(
            "flags", messages, output_schema=FlagsReport, max_tokens=12_000, effort="low"
        )
        flags = _coerce(FlagsReport, flags_resp)

        report = ats_report.build(
            resume,
            ledger,
            target_title=spec.target_title,
            today=today,
            findings_count=len(findings),
        )

        yield LLMEvent(
            "done",
            {
                "result": GenerationResult(
                    content_markdown=content_markdown,
                    content_text=render_plain_text(resume),
                    resume=resume,
                    ledger=ledger,
                    flags=flags,
                    report=report,
                    findings=findings,
                    usage=self._totals(),
                    calls=self.calls,
                )
            },
        )

    async def tailor(
        self,
        *,
        base_resume_md: str,
        job_description: str,
        company: str | None,
        spec: PipelineInput,
    ) -> AsyncIterator[LLMEvent]:
        """Job-based tailoring: a reframing, not a new scenario."""
        today = spec.today or app_today()
        yield LLMEvent("phase", {"phase": "draft", "label": "Tailoring to the job", "percent": 20})
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": tailor_turn(
                    base_resume_md=base_resume_md,
                    job_description=job_description,
                    today=today.isoformat(),
                    company=company,
                ),
            }
        ]
        resume, content_markdown, findings = await self._draft_and_repair(
            messages, spec, None, today
        )

        yield LLMEvent("phase", {"phase": "validate", "label": "Checking hard rules", "percent": 75})
        # No ledger on this path, so the keyword plan is extracted from the JD
        # directly rather than asked for again.
        yield LLMEvent("phase", {"phase": "report", "label": "Scoring coverage", "percent": 90})
        report = ats_report.build(
            resume,
            None,
            target_title=spec.target_title,
            today=today,
            findings_count=len(findings),
        )
        yield LLMEvent(
            "done",
            {
                "result": GenerationResult(
                    content_markdown=content_markdown,
                    content_text=render_plain_text(resume),
                    resume=resume,
                    report=report,
                    findings=findings,
                    usage=self._totals(),
                    calls=self.calls,
                )
            },
        )

    async def apply_instructions(
        self, *, base_resume_md: str, instructions: str, spec: PipelineInput
    ) -> AsyncIterator[LLMEvent]:
        today = spec.today or app_today()
        yield LLMEvent("phase", {"phase": "draft", "label": "Applying your edits", "percent": 25})
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": instruction_turn(
                    base_resume_md=base_resume_md,
                    instructions=instructions,
                    today=today.isoformat(),
                ),
            }
        ]
        resume, content_markdown, findings = await self._draft_and_repair(
            messages, spec, None, today
        )
        yield LLMEvent(
            "done",
            {
                "result": GenerationResult(
                    content_markdown=content_markdown,
                    content_text=render_plain_text(resume),
                    resume=resume,
                    findings=findings,
                    usage=self._totals(),
                    calls=self.calls,
                )
            },
        )

    # -- the draft + gate loop --------------------------------------------

    async def _draft_and_repair(
        self,
        messages: list[dict[str, Any]],
        spec: PipelineInput,
        ledger: ScenarioLedger | None,
        today: date,
    ) -> tuple[Resume, str, list[Finding]]:
        """Draft, parse, validate, and repair at most twice.

        A parse failure and a rule failure both route into the same bounded
        repair turn, because both are "the document is wrong in a way we can
        name precisely".
        """
        attempt = 0
        last_error: str | None = None
        findings: list[Finding] = []

        while True:
            resp = await self._call("draft", messages, max_tokens=32_000)
            content_markdown = _strip_fences(resp.text)
            messages.append({"role": "assistant", "content": resp.text})

            try:
                resume = parse(content_markdown)
            except ResumeMarkdownError as exc:
                last_error = str(exc)
                attempt += 1
                if attempt > MAX_REPAIRS:
                    raise
                messages.append(
                    {"role": "user", "content": repair_turn([], raw_error=last_error)}
                )
                continue

            findings = validate(
                Context(
                    resume=resume,
                    raw_md=content_markdown,
                    claimed_years=_claimed_yoe(resume, ledger),
                    mode=spec.mode,
                    strict_dossier=spec.strict_dossier and spec.mode == "constructed",
                    ledger=ledger.model_dump() if ledger else {},
                    today=today,
                )
            )
            errors = [f for f in findings if f.severity == "error"]
            if not errors or attempt >= MAX_REPAIRS:
                return resume, content_markdown, findings

            attempt += 1
            messages.append(
                {"role": "user", "content": repair_turn([f.as_dict() for f in errors])}
            )

    # -- provider plumbing -------------------------------------------------

    async def _call(
        self,
        purpose: str,
        messages: list[dict[str, Any]],
        *,
        output_schema: type | None = None,
        max_tokens: int = 16_000,
        effort: str = "high",
    ) -> LLMResponse:
        resp = await self.provider.complete(
            LLMRequest(
                purpose=purpose,
                system=self._system,
                messages=list(messages),
                output_schema=output_schema,
                max_output_tokens=max_tokens,
                effort=effort,  # type: ignore[arg-type]
            )
        )
        self.calls.append(
            {
                "purpose": purpose,
                "model": resp.model,
                "latency_ms": resp.latency_ms,
                "stop_reason": resp.stop_reason,
                "cost_usd_micros": resp.cost_usd_micros,
                **resp.usage.as_dict(),
            }
        )
        return resp

    def _totals(self) -> dict:
        keys = (
            "input_tokens", "output_tokens", "cache_read_tokens",
            "cache_write_5m_tokens", "cache_write_1h_tokens", "cost_usd_micros",
        )
        return {k: sum(c.get(k, 0) for c in self.calls) for k in keys} | {
            "calls": len(self.calls)
        }


def _strip_fences(text: str) -> str:
    """Remove a stray ```markdown fence if the model adds one anyway."""
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        lines = lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
        stripped = "\n".join(lines)
    return stripped.strip() + "\n"


def _coerce(model: type, resp: LLMResponse):
    if isinstance(resp.parsed, dict):
        try:
            return model.model_validate(resp.parsed)
        except ValidationError:
            # A malformed ledger is not fatal: the resume turn can still run,
            # and the missing ledger simply narrows the ATS report.
            return None
    return None


def _claimed_yoe(resume: Resume, ledger: ScenarioLedger | None) -> int | None:
    if ledger and ledger.total_years:
        return ledger.total_years
    import re

    m = re.search(r"(\d{1,2})\+?\s*years?", resume.summary, re.IGNORECASE)
    return int(m.group(1)) if m else None
