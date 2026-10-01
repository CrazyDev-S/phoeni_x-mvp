"""The proposal engine seam.

Phase 2 of the Freelancing category is a profile and proposal generator whose
prompt and engine logic are still to be supplied. What exists now is the
contract every engine has to meet, and one engine that meets it without a
model: ``TemplateProposalEngine`` assembles an honest, editable skeleton from
the posting and the freelancer profile, and labels itself as such.

When the real prompt arrives:

1. Put it in ``backend/prompts/proposal_generator_v1.md``. Like the resume
   generator prompt, it is loaded verbatim and byte-frozen so it can be a
   cached prefix; nothing is interpolated into it.
2. Implement ``PromptedProposalEngine.draft`` below with the LLM turn
   structure the prompt specifies, using ``app.llm.factory.get_provider``.
3. Point ``get_engine`` at it. Nothing else in the product changes: the
   worker, the API and the UI only know the ``ProposalEngine`` protocol.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from app.models.enums import FreelanceJobType
from app.models.freelancing import FreelanceJob, FreelancerProfile

PROMPT_PATH = Path(__file__).resolve().parents[3] / "prompts" / "proposal_generator_v1.md"
PLACEHOLDER_MARKER = "<!-- PLACEHOLDER: proposal prompt not supplied yet -->"


class ProposalEngineUnavailable(Exception):
    def __init__(self, message: str) -> None:
        self.code = "PROPOSAL_ENGINE_UNAVAILABLE"
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class ProposalContext:
    job: FreelanceJob
    profile: FreelancerProfile | None
    screening_questions: list[str]
    instructions: str | None = None
    tone: str = "direct"


@dataclass(slots=True)
class ProposalDraft:
    cover_letter_markdown: str
    answers: list[dict[str, str]] = field(default_factory=list)
    bid_type: FreelanceJobType | None = None
    bid_amount: float | None = None
    bid_currency: str | None = None
    connects_estimate: int | None = None
    engine_version: str = ""
    meta: dict[str, Any] = field(default_factory=dict)


class ProposalEngine(Protocol):
    version: str

    async def draft(self, context: ProposalContext) -> ProposalDraft: ...


# --- the engine that ships today ------------------------------------------------


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9+#.]{2,}", text.lower()) if len(t) > 2}


def _first_sentence(text: str | None, limit: int = 160) -> str:
    if not text:
        return ""
    cleaned = " ".join(text.split())
    end = cleaned.find(". ")
    sentence = cleaned if end < 0 else cleaned[: end + 1]
    return sentence if len(sentence) <= limit else sentence[: limit - 1].rstrip() + "…"


class TemplateProposalEngine:
    """A deterministic first draft: structure, matched skills, a rate, the questions.

    It never claims experience the profile does not state. Every paragraph is
    meant to be rewritten; the value is a scaffold that already points at what
    the posting asks for and what the profile has to say about it.
    """

    version = "template-v0"

    async def draft(self, context: ProposalContext) -> ProposalDraft:
        job, profile = context.job, context.profile
        job_words = _tokens(f"{job.title} {job.description or ''} {' '.join(job.skills)}")
        profile_skills = list(profile.skills) if profile else []
        matched = [s for s in profile_skills if _tokens(s) & job_words]
        unmatched_required = [s for s in job.skills if not (_tokens(s) & _tokens(" ".join(profile_skills)))]

        # A first name the source inferred with confidence; never a guess.
        name = str((job.client or {}).get("contact_name") or "").strip()
        if name:
            greeting = f"Dear {name}," if context.tone == "formal" else f"Hi {name},"
        else:
            greeting = {
                "warm": "Hi there,",
                "formal": "Dear Hiring Manager,",
            }.get(context.tone, "Hello,")

        lines = [greeting, ""]
        hook = _first_sentence(job.description)
        if hook:
            lines.append(f"You are looking for {job.title.strip()} — {hook[0].lower() + hook[1:]}")
        else:
            lines.append(f"You are looking for {job.title.strip()}.")
        lines.append("")

        if profile and profile.title:
            lines.append(f"I am a {profile.title.strip()}.")
        if profile and profile.overview:
            lines.append(_first_sentence(profile.overview, 240))
        lines.append("")

        if matched:
            lines.append("What I bring to this specific brief:")
            lines.extend(f"- **{skill}** — <!-- one concrete result with this -->" for skill in matched[:4])
            lines.append("")
        if unmatched_required:
            lines.append(
                "<!-- The posting also names: "
                + ", ".join(unmatched_required[:6])
                + ". Address these or say plainly how you would cover them. -->"
            )
            lines.append("")

        portfolio = [p for p in (profile.portfolio if profile else []) if isinstance(p, dict)]
        if portfolio:
            lines.append("Relevant work:")
            for item in portfolio[:3]:
                title = str(item.get("title") or "").strip()
                url = str(item.get("url") or "").strip()
                summary = str(item.get("summary") or "").strip()
                entry = f"- {title}" + (f" ({url})" if url else "") + (f" — {summary}" if summary else "")
                lines.append(entry)
            lines.append("")

        lines.append("Next step: <!-- propose a first milestone or a short call, with a time. -->")
        if context.instructions:
            lines.append("")
            lines.append(f"<!-- Instructions given for this draft: {context.instructions.strip()} -->")
        lines.append("")
        lines.append(profile.name if profile else "<!-- your name -->")

        bid_type, amount, currency = self._bid(job, profile)
        return ProposalDraft(
            cover_letter_markdown="\n".join(lines).strip() + "\n",
            answers=[{"question": q, "answer": ""} for q in context.screening_questions],
            bid_type=bid_type,
            bid_amount=amount,
            bid_currency=currency,
            connects_estimate=self._connects(job),
            engine_version=self.version,
            meta={
                "matched_skills": matched,
                "unmatched_required_skills": unmatched_required,
                "tone": context.tone,
                "placeholder": True,
            },
        )

    @staticmethod
    def _bid(job: FreelanceJob, profile: FreelancerProfile | None) -> tuple[FreelanceJobType | None, float | None, str | None]:
        rate = float(profile.hourly_rate) if profile and profile.hourly_rate is not None else None
        currency = job.budget_currency or "USD"
        if job.job_type is FreelanceJobType.HOURLY:
            low = float(job.hourly_min) if job.hourly_min is not None else None
            high = float(job.hourly_max) if job.hourly_max is not None else None
            if rate is not None:
                if high is not None and rate > high:
                    return FreelanceJobType.HOURLY, high, currency
                if low is not None and rate < low:
                    return FreelanceJobType.HOURLY, low, currency
                return FreelanceJobType.HOURLY, rate, currency
            return FreelanceJobType.HOURLY, high or low, currency
        if job.job_type is FreelanceJobType.FIXED:
            budget = float(job.budget_amount) if job.budget_amount is not None else None
            return FreelanceJobType.FIXED, budget, currency
        return None, rate, currency

    @staticmethod
    def _connects(job: FreelanceJob) -> int | None:
        """What the posting costs to apply to, or else Upwork's usual price for its budget band."""
        known = ((job.raw or {}).get("extras") or {}).get("connects_required")
        if isinstance(known, (int, float)) and known >= 0:
            return int(known)
        if job.job_type is FreelanceJobType.FIXED and job.budget_amount is not None:
            budget = float(job.budget_amount)
            return 4 if budget < 50 else 8 if budget < 200 else 12 if budget < 600 else 16
        if job.job_type is FreelanceJobType.HOURLY:
            return 12
        return None


class PromptedProposalEngine:
    """The engine the supplied prompt will drive. Not yet available.

    Intended shape, mirroring the resume pipeline: a byte-frozen system prefix
    from ``PROMPT_PATH`` with a cache breakpoint, then one user turn carrying
    the posting, the profile, the screening questions and the instructions,
    and a JSON reply validated into ``ProposalDraft``.
    """

    version = "prompt-v1"

    async def draft(self, context: ProposalContext) -> ProposalDraft:
        raise ProposalEngineUnavailable(
            "The proposal generation prompt has not been supplied yet. "
            "Until it is, drafts come from the template engine."
        )


def prompt_is_supplied() -> bool:
    if not PROMPT_PATH.exists():
        return False
    text = PROMPT_PATH.read_text(encoding="utf-8")
    return PLACEHOLDER_MARKER not in text and bool(text.strip())


def get_engine() -> ProposalEngine:
    """The engine in service. Switch this to ``PromptedProposalEngine`` when it is implemented."""
    return TemplateProposalEngine()
