"""The generation pipeline: staged calls around one conversation, and two
Python gates.

Why not a single call asking for all four blocks: the model would write the
resume and "12/12 PASS" in the same breath, so the gate would gate nothing.
Splitting the turns lets real code sit between them.

Why the scenario, the resume and the prep are turns of ONE conversation
rather than independent calls: each call would re-pay the ~17k-token system
prefix. Turns share a growing cached prefix, and Opus 5 accepts
mid-conversation ``system`` messages, so a phase transition is an operator
instruction that does not invalidate the cache.

Around that conversation sit stages with prompts of their own. The posting's
criteria are read first, so the scenario is built from the work it describes
rather than from the page it sat on - platform, proposal and boilerplate left
behind. Research on the candidate's employers and education runs after the
scenario, both at once, and feeds the turn that compiles the resume.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from app.core.timezone import app_today
from app.llm.catalog import cost_micros
from app.llm.prompts import (
    COMPANY_RESEARCH_SYSTEM,
    CRITERIA_SYSTEM,
    DRAFT_TURN,
    EDUCATION_RESEARCH_SYSTEM,
    FLAGS_TURN,
    company_research_turn,
    compile_turn,
    criteria_turn,
    education_research_turn,
    frozen_system_prompt,
    import_turn,
    instruction_turn,
    prep_turn,
    repair_turn,
    scenario_turn,
    tailor_turn,
    upgrade_turn,
)
from app.llm.provider import (
    CacheTTL,
    LLMError,
    LLMEvent,
    LLMProviderPort,
    LLMRequest,
    LLMResponse,
    SystemBlock,
    Usage,
)
from app.llm.schemas import (
    COMPANY_RESEARCH,
    EDUCATION_RECORD,
    FLAGS_REPORT,
    JOB_CRITERIA,
    SCENARIO_LEDGER,
    shape,
)
from app.remote.orchestration import ats_report
from app.remote.orchestration.staging import (
    clean_criteria,
    researchable_employers,
    stated_education,
)
from app.remote.resume.document import Resume
from app.remote.resume.parser import SECTIONS, ResumeMarkdownError, parse
from app.remote.resume.renderer import render_plain_text
from app.remote.validation.import_review import review_import
from app.remote.validation.rules import Context, Finding, employer_keys, validate

log = logging.getLogger(__name__)

# A draft is repaired until no rule error remains. These two only cap spend
# on a model that cannot get there: each round re-emits the whole resume.
MAX_REPAIRS = 6
STALL_DRAFTS = 3
# Coverage is a warning - a resume missing a keyword can still be sent - but it
# is repaired like an error, because a tailored resume exists to match the job.
REPAIRED_WARNINGS = frozenset({"MUST_HAVE_COVERAGE"})

# Thinking tokens count toward the output budget, so these are far larger than
# the answers themselves. A real run truncated the scenario turn at 24k with
# the reasoning alone.
SCENARIO_MAX_TOKENS = 64_000
DRAFT_MAX_TOKENS = 32_000
FLAGS_MAX_TOKENS = 16_000
CRITERIA_MAX_TOKENS = 16_000
RESEARCH_MAX_TOKENS = 24_000
MAX_OUTPUT_CEILING = 128_000

# Searches a research turn may run for each employer, or for the education.
SEARCHES_PER_ITEM = 3

# How often a running turn reports its reasoning, and how much of it to keep.
THINKING_INTERVAL_SECONDS = 3.0
THINKING_TAIL_CHARS = 600

# How much of a model's reason for declining reaches the user.
DECLINE_QUOTE_CHARS = 600


@dataclass
class GenerationResult:
    content_markdown: str
    content_text: str
    resume: Resume
    ledger: dict | None = None
    flags: dict | None = None
    report: dict = field(default_factory=dict)
    findings: list[Finding] = field(default_factory=list)
    usage: dict = field(default_factory=dict)
    calls: list[dict] = field(default_factory=list)
    criteria: dict | None = None
    research: dict = field(default_factory=dict)

    @property
    def needs_review(self) -> bool:
        return any(f.severity == "error" for f in self.findings)

    def ledger_record(self) -> dict | None:
        """The ledger as saved: the scenario, plus the stages that fed it."""
        if self.ledger is None:
            return None
        record = dict(self.ledger)
        if self.criteria is not None:
            record["criteria"] = self.criteria
        if self.research:
            record["research"] = self.research
        return record


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
    # A real resume restructured from a file: generator policy rules advise only.
    imported: bool = False


class ResumePipeline:
    def __init__(
        self,
        provider: LLMProviderPort,
        *,
        # Measured: the scenario turn alone ran 5.1 minutes on the heavy tier,
        # and a whole job ran nine. With the 5-minute default the prefix
        # expired mid-job and was re-written at 1.25x instead of read at 0.1x -
        # paying the write twice and the read never.
        cache_ttl: CacheTTL = "1h",
        research_dossiers: bool = False,
        system_prompt: str | None = None,
    ) -> None:
        self.provider = provider
        self.cache_ttl = cache_ttl
        self._system = [SystemBlock(system_prompt or frozen_system_prompt(), cache=cache_ttl)]
        self.calls: list[dict] = []
        # Set by the worker so a turn can report progress WHILE it runs. A
        # single heavy turn measured at over seven minutes; without this the
        # percentage sits still for all of it and reads as a hang.
        self.on_event: Callable[[LLMEvent], Awaitable[None]] | None = None
        # The two research turns run at once. Each report takes the next
        # sequence number for the run, so two written together collide.
        self._report_lock = asyncio.Lock()

        # Web search is the only way a company dossier can carry a real source.
        # Without it the DOSSIER_PROVENANCE rule is unsatisfiable, so the two
        # are wired to the same switch.
        self.research_enabled = bool(
            research_dossiers and getattr(provider, "caps", {}).get("server_web_search")
        )
        # Sent on every turn of the generator conversation unless a turn says
        # otherwise. Three companies x at least three searches each, plus
        # headroom.
        self.tools: list[dict] = []
        if self.research_enabled:
            tool_type = provider.caps.get("web_search_tool_type", "web_search_20260209")
            self.tools = [{"type": tool_type, "name": "web_search", "max_uses": 24}]

    # -- public entry points ----------------------------------------------

    async def generate(self, spec: PipelineInput) -> AsyncIterator[LLMEvent]:
        """A new resume.

        Built from the candidate's own history, it runs in stages: the
        posting's criteria, the scenario built on them, research on the
        employers and education the history names - both at once - and the
        compile. A constructed scenario keeps to one conversation.
        """
        stream = self._constructed(spec) if spec.mode == "constructed" else self._staged(spec)
        async for event in stream:
            yield event

    async def _staged(self, spec: PipelineInput) -> AsyncIterator[LLMEvent]:
        today = spec.today or app_today()
        history = spec.candidate_profile or ""

        criteria: dict | None = None
        if spec.job_description:
            yield LLMEvent("phase", {"phase": "criteria", "label": "Reading the job's criteria", "percent": 5})
            criteria = await self._criteria(spec.job_description, spec.target_title, today)

        yield LLMEvent("phase", {"phase": "scenario", "label": "Building the career scenario", "percent": 15})
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": scenario_turn(
                    mode=spec.mode,
                    today=today.isoformat(),
                    base_country=spec.base_country,
                    target_title=spec.target_title,
                    # The posting goes no further than the criteria stage,
                    # unless its criteria came back unreadable.
                    job_description=None if criteria else spec.job_description,
                    candidate_profile=spec.candidate_profile,
                    extra_instructions=spec.extra_instructions,
                    allow_real_company_names=spec.allow_real_company_names,
                    skill_count=spec.skill_count,
                    criteria=criteria,
                    research_follows=bool(history.strip()),
                ),
            }
        ]
        # No tool on any turn of this conversation: searching is the research
        # stage's job, and a tool sent on some turns only would break the
        # cached prefix between them.
        ledger_resp = await self._call(
            "scenario", messages,
            output_schema=SCENARIO_LEDGER, max_tokens=SCENARIO_MAX_TOKENS, tools=[],
        )
        ledger = _coerce(SCENARIO_LEDGER, ledger_resp)
        if ledger and ledger["input_problem"].strip():
            raise _declined(ledger["input_problem"])
        messages.append({"role": "assistant", "content": ledger_resp.text})
        if criteria is not None:
            ledger = {
                **(ledger or shape(SCENARIO_LEDGER, {"mode": spec.mode})),
                "keyword_plan": criteria["keyword_plan"],
                "job_required_years": criteria["required_years"],
            }

        employers = researchable_employers(ledger, history) if ledger else []
        education = ledger["education"].strip() if ledger and history.strip() else ""
        research: dict = {}
        if employers or education:
            label = (
                "Researching employers and education" if employers and education
                else "Researching employers" if employers
                else "Checking education"
            )
            yield LLMEvent("phase", {"phase": "research", "label": label, "percent": 35})
            found_employers, found_education = await asyncio.gather(
                self._research_employers(employers, criteria, today),
                self._research_education(history, education, today),
            )
            if found_employers:
                research["employers"] = found_employers
            if found_education:
                research["education"] = found_education

        yield LLMEvent("phase", {"phase": "draft", "label": "Compiling the resume", "percent": 50})
        messages.append(
            {
                "role": "user",
                "content": compile_turn(
                    employers=research.get("employers"), education=research.get("education")
                ),
            }
        )
        resume, content_markdown, findings = await self._draft_and_repair(
            messages, spec, ledger, today, percent=50, tools=[]
        )
        async for event in self._finish(
            messages, spec, today, resume, content_markdown, findings, ledger,
            tools=[], criteria=criteria, research=research,
        ):
            yield event

    async def _constructed(self, spec: PipelineInput) -> AsyncIterator[LLMEvent]:
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
                    research_enabled=self.research_enabled,
                    skill_count=spec.skill_count,
                ),
            }
        )
        ledger_resp = await self._call(
            "scenario", messages,
            output_schema=SCENARIO_LEDGER, max_tokens=SCENARIO_MAX_TOKENS,
        )
        ledger = _coerce(SCENARIO_LEDGER, ledger_resp)
        if ledger and ledger["input_problem"].strip():
            raise _declined(ledger["input_problem"])
        messages.append({"role": "assistant", "content": ledger_resp.text})

        yield LLMEvent("phase", {"phase": "draft", "label": "Drafting the resume", "percent": 45})
        messages.append({"role": "user", "content": DRAFT_TURN})
        resume, content_markdown, findings = await self._draft_and_repair(
            messages, spec, ledger, today, percent=45
        )
        async for event in self._finish(
            messages, spec, today, resume, content_markdown, findings, ledger
        ):
            yield event

    async def _finish(
        self,
        messages: list[dict[str, Any]],
        spec: PipelineInput,
        today: date,
        resume: Resume,
        content_markdown: str,
        findings: list[Finding],
        ledger: dict | None,
        *,
        tools: list[dict] | None = None,
        criteria: dict | None = None,
        research: dict | None = None,
    ) -> AsyncIterator[LLMEvent]:
        """The checked resume, its interview prep and its report."""
        yield LLMEvent("phase", {"phase": "validate", "label": "Checking hard rules", "percent": 80})
        yield LLMEvent(
            "usage",
            {"findings": [f.as_dict() for f in findings]},
        )

        yield LLMEvent("phase", {"phase": "flags", "label": "Writing interview prep", "percent": 90})
        messages.append({"role": "user", "content": FLAGS_TURN})
        flags_resp = await self._call(
            "flags", messages, output_schema=FLAGS_REPORT,
            max_tokens=FLAGS_MAX_TOKENS, effort="low", tools=tools,
        )
        flags = _coerce(FLAGS_REPORT, flags_resp)

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
                    criteria=criteria,
                    research=research or {},
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
        ledger: dict | None = None,
    ) -> AsyncIterator[LLMEvent]:
        """Job-based tailoring: a reframing, not a new scenario.

        The posting's criteria are read first, by the same stage a generation
        starts with - without a keyword plan there was nothing to score
        against, and every tailored resume reported 0/0 must-have coverage.
        That plan replaces the base ledger's, and the repair loop then chases
        every MUST keyword the draft leaves out.
        """
        today = spec.today or app_today()
        yield LLMEvent("phase", {"phase": "criteria", "label": "Reading the job's criteria", "percent": 10})
        criteria = await self._criteria(job_description, spec.target_title, today)
        ledger = {
            **(ledger or shape(SCENARIO_LEDGER, {"mode": spec.mode})),
            "keyword_plan": criteria["keyword_plan"] if criteria else [],
            "job_required_years": criteria["required_years"] if criteria else 0,
        }

        yield LLMEvent("phase", {"phase": "draft", "label": "Tailoring to the job", "percent": 25})
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": tailor_turn(
                    base_resume_md=base_resume_md,
                    criteria=criteria,
                    job_description=job_description,
                    today=today.isoformat(),
                    company=company,
                ),
            }
        ]
        resume, content_markdown, findings = await self._draft_and_repair(
            messages, spec, ledger, today, percent=25
        )

        yield LLMEvent("phase", {"phase": "report", "label": "Scoring coverage", "percent": 90})
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
                    report=report,
                    findings=findings,
                    usage=self._totals(),
                    calls=self.calls,
                    criteria=criteria,
                )
            },
        )

    # -- the stages around the conversation ----------------------------------

    async def _criteria(
        self, job_description: str, target_title: str, today: date
    ) -> dict | None:
        """Stage 1: the posting read once, into the criteria every later stage
        works from. None when the reply is unreadable, and the posting itself
        is passed on instead."""
        resp = await self._call(
            "criteria",
            [
                {
                    "role": "user",
                    "content": criteria_turn(
                        job_description=job_description,
                        target_title=target_title,
                        today=today.isoformat(),
                    ),
                }
            ],
            output_schema=JOB_CRITERIA,
            max_tokens=CRITERIA_MAX_TOKENS,
            effort="medium",
            system=[SystemBlock(CRITERIA_SYSTEM, cache=self.cache_ttl)],
            tools=[],
        )
        criteria = _coerce(JOB_CRITERIA, resp)
        if criteria is None:
            return None
        if criteria["input_problem"].strip():
            raise _declined(criteria["input_problem"])
        return clean_criteria(criteria)

    async def _research_employers(
        self, employers: list[dict], criteria: dict | None, today: date
    ) -> list[dict] | None:
        """Stage 3: what each of the candidate's employers was, in their years
        there. Enrichment, so a failure leaves the compile without it rather
        than failing the run."""
        if not employers:
            return None
        try:
            resp = await self._call(
                "company_research",
                [
                    {
                        "role": "user",
                        "content": company_research_turn(
                            employers=employers,
                            core_stack=criteria["core_stack"] if criteria else [],
                            today=today.isoformat(),
                            can_search=self.research_enabled,
                        ),
                    }
                ],
                output_schema=COMPANY_RESEARCH,
                max_tokens=RESEARCH_MAX_TOKENS,
                effort="medium",
                system=[SystemBlock(COMPANY_RESEARCH_SYSTEM, cache=self.cache_ttl)],
                tools=self._search_tools(len(employers)),
            )
        except LLMError as exc:
            log.warning("employer research skipped: %s", exc)
            return None
        research = _coerce(COMPANY_RESEARCH, resp)
        if research is None:
            return None
        # Only the employers asked about; research never adds one.
        asked = {key for d in employers for key in employer_keys(d["employer"])}
        found = [p for p in research["employers"] if employer_keys(p["employer"]) & asked]
        return found or None

    async def _research_education(
        self, history: str, education: str, today: date
    ) -> dict | None:
        """Stage 3: the education the candidate's history states, checked."""
        if not education:
            return None
        try:
            resp = await self._call(
                "education_research",
                [
                    {
                        "role": "user",
                        "content": education_research_turn(
                            candidate_profile=history,
                            scenario_education=education,
                            today=today.isoformat(),
                            can_search=self.research_enabled,
                        ),
                    }
                ],
                output_schema=EDUCATION_RECORD,
                max_tokens=RESEARCH_MAX_TOKENS,
                effort="medium",
                system=[SystemBlock(EDUCATION_RESEARCH_SYSTEM, cache=self.cache_ttl)],
                tools=self._search_tools(1),
            )
        except LLMError as exc:
            log.warning("education research skipped: %s", exc)
            return None
        return stated_education(_coerce(EDUCATION_RECORD, resp), history)

    def _search_tools(self, items: int) -> list[dict]:
        if not self.research_enabled:
            return []
        tool_type = self.provider.caps.get("web_search_tool_type", "web_search_20260209")
        return [{"type": tool_type, "name": "web_search", "max_uses": SEARCHES_PER_ITEM * items}]

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
            messages, spec, None, today, percent=25
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

    async def import_document(
        self, *, source_text: str, filename: str, spec: PipelineInput
    ) -> AsyncIterator[LLMEvent]:
        """Restructure an existing resume's text into Resume Markdown, then audit it.

        The model only reformats; the audit afterwards is code. It looks every
        employer, year, figure and contact detail of the result up in the
        original, so an invented fact shows as a finding instead of passing
        quietly into a document the user will send to employers.
        """
        today = spec.today or app_today()
        yield LLMEvent("phase", {"phase": "structure", "label": "Restructuring your resume", "percent": 15})
        messages: list[dict[str, Any]] = [
            {
                "role": "user",
                "content": import_turn(
                    source_text=source_text,
                    filename=filename,
                    today=today.isoformat(),
                    target_title=spec.target_title or None,
                ),
            }
        ]
        resume, content_markdown, findings = await self._draft_and_repair(
            messages, spec, None, today, percent=15
        )

        yield LLMEvent("phase", {"phase": "review", "label": "Checking it against your original", "percent": 85})
        order = {"error": 0, "warning": 1, "info": 2}
        findings = sorted(
            [*findings, *review_import(resume, source_text)],
            key=lambda f: (order[f.severity], f.rule_id),
        )
        yield LLMEvent("usage", {"findings": [f.as_dict() for f in findings]})

        report = ats_report.build(
            resume,
            None,
            target_title=spec.target_title or resume.header.title,
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

    async def prepare(
        self,
        *,
        resume_md: str,
        spec: PipelineInput,
        origin: str,
        ledger: dict | None = None,
    ) -> AsyncIterator[LLMEvent]:
        """Analyse a saved resume and write its interview-prep block.

        The resume itself is not touched: the result carries it unchanged, so
        the only thing a run can change is the prep.
        """
        today = spec.today or app_today()
        resume = parse(resume_md)
        yield LLMEvent("phase", {"phase": "prep", "label": "Analysing the resume", "percent": 15})
        resp = await self._call(
            "prep",
            [
                {
                    "role": "user",
                    "content": prep_turn(
                        resume_md=resume_md,
                        target_title=spec.target_title or resume.header.title,
                        today=today.isoformat(),
                        origin=origin,
                        job_description=spec.job_description,
                        ledger=ledger,
                    ),
                }
            ],
            output_schema=FLAGS_REPORT,
            max_tokens=FLAGS_MAX_TOKENS,
            effort="medium",
        )
        flags = _coerce(FLAGS_REPORT, resp)
        if flags is None:
            # Saving nothing over the existing prep would erase it.
            raise LLMError("PREP_UNREADABLE", "The prep came back unreadable. Run it again.")
        yield LLMEvent(
            "done",
            {
                "result": GenerationResult(
                    content_markdown=resume_md,
                    content_text=render_plain_text(resume),
                    resume=resume,
                    flags=flags,
                    usage=self._totals(),
                    calls=self.calls,
                )
            },
        )

    async def upgrade(
        self,
        *,
        base_resume_md: str,
        ledger: dict | None,
        spec: PipelineInput,
    ) -> AsyncIterator[LLMEvent]:
        """Repair a saved resume until the rule errors it carries are gone.

        The same loop a fresh draft goes through, started from the saved
        document. A result with no fewer errors than the original is discarded:
        an upgrade must never leave the resume worse than it found it.
        """
        today = spec.today or app_today()
        original = parse(base_resume_md)
        before = self._validate(original, base_resume_md, spec, ledger, today)
        resume, content_markdown, findings = original, base_resume_md, before

        if _error_count(before):
            yield LLMEvent("phase", {"phase": "draft", "label": "Fixing rule errors", "percent": 20})
            messages: list[dict[str, Any]] = [
                {
                    "role": "user",
                    "content": upgrade_turn(
                        base_resume_md=base_resume_md,
                        findings=[f.as_dict() for f in before if f.severity == "error"],
                        ledger=ledger,
                        today=today.isoformat(),
                    ),
                }
            ]
            try:
                repaired = await self._draft_and_repair(
                    messages, spec, ledger, today, percent=20
                )
            except ResumeMarkdownError:
                repaired = None
            if repaired and _error_count(repaired[2]) < _error_count(before):
                resume, content_markdown, findings = repaired

        yield LLMEvent("phase", {"phase": "report", "label": "Scoring coverage", "percent": 90})
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
                    report=report,
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
        ledger: dict | None,
        today: date,
        *,
        percent: int,
        tools: list[dict] | None = None,
    ) -> tuple[Resume, str, list[Finding]]:
        """Draft, parse, validate, and repair until no error - and no missing
        must-have keyword - remains.

        A parse failure and a rule failure both route into the same repair
        turn, because both are "the document is wrong in a way we can name
        precisely". Each repair also says which errors survived the last one,
        so the model changes approach instead of resubmitting the same fix.

        Only spend ends the loop short of a clean draft: MAX_REPAIRS rounds, or
        the identical errors coming back STALL_DRAFTS drafts running - a model
        repeating itself will not be talked out of it by another round. Either
        way the draft with the fewest errors is returned, not merely the last.

        A reply that is not a resume at all ends it at once. That is the model
        declining, not a formatting fault, and a repair turn about a missing
        '---' cannot change its mind - measured, it refused six passes running
        and the run failed on the parse error instead of on its reason.
        """
        attempt = 0
        previous: set[str] = set()
        repeats = 0
        best: tuple[Resume, str, list[Finding]] | None = None

        while True:
            resp = await self._call("draft", messages, max_tokens=DRAFT_MAX_TOKENS, tools=tools)
            content_markdown = _extract_document(resp.text)
            messages.append({"role": "assistant", "content": resp.text})

            parse_error: ResumeMarkdownError | None = None
            errors: list[Finding] = []
            try:
                resume = parse(content_markdown)
            except ResumeMarkdownError as exc:
                if resp.text.strip() and not _is_resume_attempt(content_markdown):
                    if best is not None:
                        return best
                    raise _declined(resp.text) from exc
                parse_error = exc
                failures = {f"PARSE: {exc}"}
            else:
                findings = self._validate(resume, content_markdown, spec, ledger, today)
                errors = _to_fix(findings)
                if best is None or _rank(findings) <= _rank(best[2]):
                    best = (resume, content_markdown, findings)
                if not errors:
                    return best
                failures = {_failure_key(f) for f in errors}

            repeats = repeats + 1 if failures == previous else 1
            if attempt >= MAX_REPAIRS or repeats >= STALL_DRAFTS:
                if best is None:
                    raise parse_error  # type: ignore[misc]
                return best

            attempt += 1
            if self.on_event is not None:
                n = len(errors) or 1
                await self._report(
                    LLMEvent(
                        "phase",
                        {
                            "phase": "repair",
                            "label": f"Fixing {n} {'issue' if n == 1 else 'issues'} (pass {attempt})",
                            "percent": percent,
                        },
                    )
                )
            messages.append(
                {
                    "role": "user",
                    "content": repair_turn(
                        [
                            f.as_dict() | {"still_failing": _failure_key(f) in previous}
                            for f in errors
                        ],
                        raw_error=str(parse_error) if parse_error else None,
                        attempt=attempt,
                        raw_error_repeated=failures == previous,
                    ),
                }
            )
            previous = failures

    def _validate(
        self,
        resume: Resume,
        content_markdown: str,
        spec: PipelineInput,
        ledger: dict | None,
        today: date,
    ) -> list[Finding]:
        return validate(
                Context(
                    resume=resume,
                    raw_md=content_markdown,
                    claimed_years=_claimed_yoe(resume, ledger),
                    jd_keywords=_jd_keywords(ledger),
                    mode=spec.mode,
                    strict_dossier=(
                        spec.strict_dossier
                        and spec.mode == "constructed"
                        and self.research_enabled
                    ),
                    ledger=ledger or {},
                    today=today,
                    imported=spec.imported,
                )
            )

    # -- provider plumbing -------------------------------------------------

    async def _call(
        self,
        purpose: str,
        messages: list[dict[str, Any]],
        *,
        output_schema: dict | None = None,
        max_tokens: int = 16_000,
        effort: str = "high",
        system: list[SystemBlock] | None = None,
        tools: list[dict] | None = None,
    ) -> LLMResponse:
        """One model call. ``system`` and ``tools`` default to the generator
        conversation's; a stage with a prompt of its own passes both."""
        system = system or self._system
        tools = self.tools if tools is None else tools
        resp = await self._call_once(purpose, messages, output_schema, max_tokens, effort, system, tools)

        # A truncated reply is not a partial answer, it is a broken one: the
        # JSON stops mid-token and the markdown stops mid-section. Repairing it
        # is not possible, so retry once with real headroom.
        if resp.stop_reason == "max_tokens":
            retry_tokens = min(max_tokens * 2, MAX_OUTPUT_CEILING)
            if retry_tokens <= max_tokens:
                raise LLMError(
                    "OUTPUT_TOO_LONG",
                    f"The {purpose} turn exceeded {max_tokens} output tokens even at "
                    "the ceiling. Lower the effort setting or shorten the input.",
                )
            self.calls[-1]["truncated"] = True
            resp = await self._call_once(
                purpose, messages, output_schema, retry_tokens, effort, system, tools
            )
            if resp.stop_reason == "max_tokens":
                raise LLMError(
                    "OUTPUT_TOO_LONG",
                    f"The {purpose} turn truncated twice, at {retry_tokens} output "
                    "tokens. Lower the effort setting or shorten the input.",
                )
        return resp

    async def _call_once(
        self,
        purpose: str,
        messages: list[dict[str, Any]],
        output_schema: dict | None,
        max_tokens: int,
        effort: str,
        system: list[SystemBlock],
        tools: list[dict],
    ) -> LLMResponse:
        request = LLMRequest(
            purpose=purpose,
            system=system,
            messages=list(messages),
            output_schema=output_schema,
            max_output_tokens=max_tokens,
            effort=effort,  # type: ignore[arg-type]
            tools=tools,
            tool_choice={"type": "auto"} if tools else None,
        )
        resp = (
            await self._stream_call(request)
            if self.on_event is not None
            else await self.provider.complete(request)
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

    async def _stream_call(self, request: LLMRequest) -> LLMResponse:
        """Run a turn with streaming, reporting reasoning as it arrives.

        Deltas are coalesced on a timer rather than forwarded individually -
        one database write per token would be absurd, and the reader only needs
        to see that something is still happening.
        """
        summary: list[str] = []
        last_sent = 0.0
        usage = Usage()
        text_parts: list[str] = []
        stop_reason: str | None = None
        final_text: str | None = None
        started = time.perf_counter()

        async for event in self.provider.stream(request):
            if event.type == "thinking":
                summary.append(str(event.data.get("text", "")))
                now = time.perf_counter()
                if now - last_sent >= THINKING_INTERVAL_SECONDS:
                    last_sent = now
                    await self._report(
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

        # The answer is the final message's text. A turn resumed after a
        # search paused it also streamed what it said before the pause.
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
            model=getattr(self.provider, "model", ""),
            latency_ms=int((time.perf_counter() - started) * 1000),
            # The worker streams every turn, so without this every recorded
            # call - and every generation's total - read $0.
            cost_usd_micros=cost_micros(getattr(self.provider, "spec", None), usage.as_dict()),
        )

    async def _report(self, event: LLMEvent) -> None:
        async with self._report_lock:
            await self.on_event(event)  # type: ignore[misc]

    def _totals(self) -> dict:
        keys = (
            "input_tokens", "output_tokens", "cache_read_tokens",
            "cache_write_5m_tokens", "cache_write_1h_tokens", "cost_usd_micros",
        )
        return {k: sum(c.get(k, 0) for c in self.calls) for k in keys} | {
            "calls": len(self.calls)
        }


_FRONTMATTER_KEY = re.compile(r"^\s*[A-Za-z_]+\s*:")


def _frontmatter_at(lines: list[str]) -> int | None:
    """Where the frontmatter opens: a '---' line with a 'key:' line under it."""
    return next(
        (
            i
            for i in range(len(lines) - 1)
            if lines[i].strip() == "---" and _FRONTMATTER_KEY.match(lines[i + 1])
        ),
        None,
    )


def _extract_document(text: str) -> str:
    """The resume out of a reply, without whatever the model wrapped it in.

    A code fence or a line of preamble is not a fault in the document, and
    re-asking for the whole resume over one costs a full draft turn.
    """
    lines = text.strip().splitlines()
    start = _frontmatter_at(lines)
    if start is not None:
        lines = lines[start:]
    elif lines and lines[0].startswith("```"):
        lines = lines[1:]
    # No construct in the grammar is fenced, so a fence ends the document.
    end = next((i for i, line in enumerate(lines) if line.lstrip().startswith("```")), len(lines))
    return "\n".join(lines[:end]).strip() + "\n"


def _is_resume_attempt(text: str) -> bool:
    """Whether a reply is a resume at all, however badly formed."""
    lines = text.splitlines()
    return _frontmatter_at(lines) is not None or any(
        line.startswith("## ") and line[3:].strip() in SECTIONS for line in lines
    )


def _declined(reason: str) -> LLMError:
    """The model's own reason for not writing the resume, for the user to read."""
    said = " ".join(reason.split())
    if len(said) > DECLINE_QUOTE_CHARS:
        said = said[:DECLINE_QUOTE_CHARS].rsplit(" ", 1)[0] + "…"
    return LLMError("MODEL_DECLINED", f"The model did not write this resume. It said: “{said}”")


def _coerce(schema: dict, resp: LLMResponse) -> dict | None:
    """The reply as a dict in the schema's shape, or None when it holds no
    JSON object. An unreadable ledger is not fatal: the resume turn can still
    run, and the missing ledger simply narrows the ATS report."""
    parsed = resp.parsed if isinstance(resp.parsed, dict) else _json_object(resp.text)
    return shape(schema, parsed) if parsed is not None else None


def _json_object(text: str) -> dict | None:
    """The JSON object that ends a reply, past any words before it.

    A turn that searched can say what it is about to look up before it
    answers, and that sentence lands in front of the JSON.
    """
    decoder = json.JSONDecoder()
    start = text.find("{")
    while start != -1:
        try:
            value, end = decoder.raw_decode(text, start)
        except ValueError:
            pass
        else:
            if isinstance(value, dict) and not text[end:].strip():
                return value
        start = text.find("{", start + 1)
    return None


def _error_count(findings: list[Finding]) -> int:
    return sum(f.severity == "error" for f in findings)


def _to_fix(findings: list[Finding]) -> list[Finding]:
    return [f for f in findings if f.severity == "error" or f.rule_id in REPAIRED_WARNINGS]


def _rank(findings: list[Finding]) -> tuple[int, int]:
    """Fewer errors first, then fewer remaining issues of any repaired kind."""
    return _error_count(findings), len(_to_fix(findings))


def _jd_keywords(ledger: dict | None) -> dict[str, list[str]]:
    return {"must": ats_report.must_keywords(ledger)} if ledger else {}


def _failure_key(finding: Finding) -> str:
    return f"{finding.rule_id}: {finding.message}"


def _claimed_yoe(resume: Resume, ledger: dict | None) -> int | None:
    if ledger and ledger["total_years"]:
        return ledger["total_years"]
    import re

    m = re.search(r"(\d{1,2})\+?\s*years?", resume.summary, re.IGNORECASE)
    return int(m.group(1)) if m else None
