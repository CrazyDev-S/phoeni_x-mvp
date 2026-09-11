"""Programmatic enforcement of the generator prompt's hard rules.

The prompt instructs the model to self-certify a 12-check gate. A model that
writes both the resume and "12/12 PASS" in the same breath is not a gate, so
every mechanisable rule is re-verified here, in Python, against the parsed AST.

Checks that are genuinely judgment calls (narrative coherence, geography
realism, whether a number is defensible in an interview) cannot be mechanised;
those stay model-reported and are stored alongside, clearly labelled, in the
ledger's ``gate`` array. Do not assume the whole 12-check gate is enforced -
only the rules in REGISTRY below are.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from itertools import pairwise
from typing import Any

from app.resume.ast import Resume
from app.resume.renderer import to_plain_text

Severity = str  # "error" | "warning" | "info"


@dataclass(frozen=True)
class Finding:
    rule_id: str
    severity: Severity
    message: str
    path: str = ""
    excerpt: str = ""
    suggested_fix: str = ""

    def as_dict(self) -> dict[str, str]:
        return {
            "rule_id": self.rule_id,
            "severity": self.severity,
            "message": self.message,
            "path": self.path,
            "excerpt": self.excerpt,
            "suggested_fix": self.suggested_fix,
        }


@dataclass
class Context:
    """Everything a rule may need beyond the resume itself."""

    resume: Resume
    raw_md: str = ""
    jd_keywords: dict[str, list[str]] = field(default_factory=dict)  # must/nice
    claimed_yoe: int | None = None
    mode: str = "grounded"
    strict_dossier: bool = False
    ledger: dict[str, Any] = field(default_factory=dict)
    today: date = field(default_factory=date.today)

    @property
    def today_ordinal(self) -> int:
        return self.today.year * 12 + self.today.month


Rule = Callable[[Context], list[Finding]]
REGISTRY: dict[str, Rule] = {}


def rule(fn: Rule) -> Rule:
    REGISTRY[fn.__name__.upper()] = fn
    return fn


# --------------------------------------------------------------------------
# Placeholders - the prompt's absolute rule
# --------------------------------------------------------------------------

PLACEHOLDER_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("templated percentage", re.compile(r"\b[Xx]{1,3}\s*%")),
    ("bracketed placeholder", re.compile(r"\[[^\]]{0,40}\]")),
    ("angle placeholder", re.compile(r"<[a-z_]{2,30}>")),
    ("placeholder token", re.compile(r"(?<![A-Za-z])(TBD|TODO|N/A|XX+|\?\?+)(?![A-Za-z])")),
    ("templated count", re.compile(r"\b[Nn]\s+(users|engineers|services|customers)\b")),
    ("dollar placeholder", re.compile(r"\$[XxNn]\b")),
    ("underscore blank", re.compile(r"_{2,}")),
]

VAGUE_WORDS = [
    "several", "various", "numerous", "significant", "substantial",
    "multiple", "many", "a number of", "some of the", "a variety of",
]
VAGUE_RE = re.compile(r"(?<![A-Za-z])(" + "|".join(VAGUE_WORDS) + r")(?![A-Za-z])", re.IGNORECASE)


def _text_fields(r: Resume) -> list[tuple[str, str]]:
    out = [("summary", r.summary)]
    for c in r.skills:
        out.append((f"skills.{c.label}", c.value))
    for ei, e in enumerate(r.experience):
        if e.context:
            out.append((f"experience[{ei}].context", e.context))
        for ti, t in enumerate(e.titles):
            if t.promotion_note:
                out.append((f"experience[{ei}].titles[{ti}].promotion_note", t.promotion_note))
            for bi, b in enumerate(t.bullets):
                out.append((f"experience[{ei}].titles[{ti}].bullets[{bi}]", b))
    for pi, p in enumerate(r.projects):
        for bi, b in enumerate(p.bullets):
            out.append((f"projects[{pi}].bullets[{bi}]", b))
    return out


@rule
def placeholder_token(ctx: Context) -> list[Finding]:
    findings: list[Finding] = []
    for path, text in _text_fields(ctx.resume):
        for label, pattern in PLACEHOLDER_PATTERNS:
            for m in pattern.finditer(text):
                findings.append(
                    Finding(
                        "PLACEHOLDER_TOKEN", "error",
                        f"{label} left in the document: {m.group(0)!r}",
                        path, _excerpt(text, m.start()),
                        "Replace with a specific, derivable number.",
                    )
                )
        for m in VAGUE_RE.finditer(text):
            findings.append(
                Finding(
                    "PLACEHOLDER_TOKEN", "error",
                    f"vague quantifier {m.group(0)!r}; the prompt bans it",
                    path, _excerpt(text, m.start()),
                    "State the actual count.",
                )
            )
    return findings


def _excerpt(text: str, at: int, width: int = 60) -> str:
    lo = max(0, at - width // 2)
    return ("..." if lo else "") + text[lo : lo + width] + ("..." if lo + width < len(text) else "")


# --------------------------------------------------------------------------
# Structural rules
# --------------------------------------------------------------------------

@rule
def skill_category_count(ctx: Context) -> list[Finding]:
    n = len(ctx.resume.skills)
    if n == 4:
        return []
    return [
        Finding(
            "SKILL_CATEGORY_COUNT", "error",
            f"expected exactly 4 skill categories, found {n}",
            "skills", "", "Merge or split categories to land on exactly 4.",
        )
    ]


@rule
def company_count(ctx: Context) -> list[Finding]:
    names = {e.company for e in ctx.resume.experience}
    if len(names) <= 3:
        return []
    return [
        Finding(
            "COMPANY_COUNT", "error",
            f"{len(names)} employers listed; the prompt caps it at 3",
            "experience", ", ".join(sorted(names)),
            "Drop the oldest role or fold it into an earlier-career line.",
        )
    ]


@rule
def promotion_present(ctx: Context) -> list[Finding]:
    if any(len(e.titles) == 2 for e in ctx.resume.experience):
        return []
    return [
        Finding(
            "PROMOTION_PRESENT", "error",
            "no internal promotion shown; the prompt requires at least one",
            "experience", "",
            "Split one company's tenure into two title blocks with a promotion note.",
        )
    ]


@rule
def tenure_arithmetic(ctx: Context) -> list[Finding]:
    if ctx.claimed_yoe is None:
        return []
    months = _merged_months(ctx)
    shown = months / 12
    if abs(shown - ctx.claimed_yoe) <= 0.25:
        return []
    return [
        Finding(
            "TENURE_ARITHMETIC", "error",
            f"summary claims {ctx.claimed_yoe} years but the roles sum to {shown:.1f}",
            "experience", "",
            "Adjust the claimed years or the role dates so they agree.",
        )
    ]


def _merged_months(ctx: Context) -> int:
    """Total months employed, with overlapping roles counted once."""
    spans = [
        (
            e.total_tenure.start.ordinal,
            ctx.today_ordinal
            if e.total_tenure.is_current
            else e.total_tenure.end.ordinal,  # type: ignore[union-attr]
        )
        for e in ctx.resume.experience
    ]
    if not spans:
        return 0
    spans.sort()
    merged: list[list[int]] = [list(spans[0])]
    for start, end in spans[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return sum(e - s for s, e in merged)


@rule
def employment_gap(ctx: Context) -> list[Finding]:
    spans = sorted(
        (
            e.total_tenure.start.ordinal,
            ctx.today_ordinal
            if e.total_tenure.is_current
            else e.total_tenure.end.ordinal,  # type: ignore[union-attr]
            e.company,
        )
        for e in ctx.resume.experience
    )
    findings = []
    for (_, prev_end, prev_co), (next_start, _, next_co) in pairwise(spans):
        gap = next_start - prev_end
        if gap > 3:
            findings.append(
                Finding(
                    "EMPLOYMENT_GAP", "warning",
                    f"{gap}-month gap between {prev_co} and {next_co}",
                    "experience", "",
                    "Explain the gap in the ledger or close it.",
                )
            )
    return findings


@rule
def date_format(ctx: Context) -> list[Finding]:
    findings = []
    today = ctx.today_ordinal
    for i, e in enumerate(ctx.resume.experience):
        ranges = [("total_tenure", e.total_tenure)] + [
            (f"titles[{j}]", t.dates) for j, t in enumerate(e.titles)
        ]
        for label, rng in ranges:
            if not rng.is_current and rng.end and rng.end.ordinal > today:
                findings.append(
                    Finding(
                        "DATE_FORMAT", "error",
                        f"{e.company} {label} ends in the future ({rng.end})",
                        f"experience[{i}].{label}", str(rng),
                        "Use 'Present' for a current role.",
                    )
                )
        for j, t in enumerate(e.titles):
            if t.dates.start.ordinal < e.total_tenure.start.ordinal or (
                e.total_tenure.end
                and t.dates.end
                and t.dates.end.ordinal > e.total_tenure.end.ordinal
            ):
                findings.append(
                    Finding(
                        "DATE_FORMAT", "error",
                        f"{e.company}: title '{t.title}' falls outside the company tenure",
                        f"experience[{i}].titles[{j}]", f"{t.dates} vs {e.total_tenure}",
                        "Widen the company tenure line or correct the title dates.",
                    )
                )
    # Chronological order, newest first.
    starts = [e.total_tenure.start.ordinal for e in ctx.resume.experience]
    if starts != sorted(starts, reverse=True):
        findings.append(
            Finding(
                "DATE_FORMAT", "error",
                "companies are not in reverse-chronological order",
                "experience", "", "Sort newest first.",
            )
        )
    return findings


@rule
def must_have_coverage(ctx: Context) -> list[Finding]:
    must = ctx.jd_keywords.get("must", [])
    if not must:
        return []
    text = to_plain_text(ctx.resume).lower()
    missing = [k for k in must if k.lower() not in text]
    if not missing:
        return []
    return [
        Finding(
            "MUST_HAVE_COVERAGE", "warning",
            f"{len(missing)} of {len(must)} must-have keywords absent: "
            + ", ".join(missing[:8]),
            "document", "", "Work them into a bullet that shows real use.",
        )
    ]


@rule
def dossier_provenance(ctx: Context) -> list[Finding]:
    """Mode B may not name a company without a searched, sourced dossier."""
    if ctx.mode != "constructed" or not ctx.strict_dossier:
        return []
    dossiers = {d.get("employer"): d for d in ctx.ledger.get("dossiers", [])}
    findings = []
    for e in ctx.resume.experience:
        d = dossiers.get(e.company)
        if d is None:
            findings.append(
                Finding(
                    "DOSSIER_PROVENANCE", "error",
                    f"'{e.company}' is named with no dossier in the ledger",
                    "experience", e.company,
                    "Research the company or use an archetype description instead.",
                )
            )
        elif not d.get("sources"):
            findings.append(
                Finding(
                    "DOSSIER_PROVENANCE", "error",
                    f"dossier for '{e.company}' carries no source URL",
                    "ledger.dossiers", e.company,
                    "Add at least one retrieved source, or mark it unverified.",
                )
            )
    return findings


# --------------------------------------------------------------------------

# Rules that must never reach a real job application via the extension's
# one-click auto-download. These force the user into the editor instead.
HARD_BLOCK_RULES = frozenset({"PLACEHOLDER_TOKEN", "DOSSIER_PROVENANCE"})


def validate(ctx: Context) -> list[Finding]:
    findings: list[Finding] = []
    for fn in REGISTRY.values():
        findings.extend(fn(ctx))
    order = {"error": 0, "warning": 1, "info": 2}
    return sorted(findings, key=lambda f: (order[f.severity], f.rule_id))


def blocks_autodownload(findings: list[Finding]) -> bool:
    return any(
        f.severity == "error" and f.rule_id in HARD_BLOCK_RULES for f in findings
    )
