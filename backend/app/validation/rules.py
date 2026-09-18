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

from app.resume.document import Resume
from app.resume.keywords import contains_keyword
from app.resume.renderer import render_plain_text

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
    claimed_years: int | None = None
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
def placeholder_token(context: Context) -> list[Finding]:
    findings: list[Finding] = []
    for path, text in _text_fields(context.resume):
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
def skill_category_count(context: Context) -> list[Finding]:
    n = len(context.resume.skills)
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
def company_count(context: Context) -> list[Finding]:
    names = {e.company for e in context.resume.experience}
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
def promotion_present(context: Context) -> list[Finding]:
    if any(len(e.titles) == 2 for e in context.resume.experience):
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
def tenure_arithmetic(context: Context) -> list[Finding]:
    if context.claimed_years is None:
        return []
    months = _merged_months(context)
    shown = months / 12
    if abs(shown - context.claimed_years) <= 0.25:
        return []
    return [
        Finding(
            "TENURE_ARITHMETIC", "error",
            f"summary claims {context.claimed_years} years but the roles sum to {shown:.1f}",
            "experience", "",
            "Adjust the claimed years or the role dates so they agree.",
        )
    ]


def _merged_months(context: Context) -> int:
    """Total months employed, with overlapping roles counted once."""
    spans = [
        (
            e.total_tenure.start.ordinal,
            context.today_ordinal
            if e.total_tenure.is_current
            else e.total_tenure.end.ordinal,  # type: ignore[union-attr]
        )
        for e in context.resume.experience
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
def employment_gap(context: Context) -> list[Finding]:
    spans = sorted(
        (
            e.total_tenure.start.ordinal,
            context.today_ordinal
            if e.total_tenure.is_current
            else e.total_tenure.end.ordinal,  # type: ignore[union-attr]
            e.company,
        )
        for e in context.resume.experience
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
def date_format(context: Context) -> list[Finding]:
    findings = []
    today = context.today_ordinal
    for i, e in enumerate(context.resume.experience):
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
    starts = [e.total_tenure.start.ordinal for e in context.resume.experience]
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
def must_have_coverage(context: Context) -> list[Finding]:
    must = context.jd_keywords.get("must", [])
    if not must:
        return []
    text = render_plain_text(context.resume)
    missing = [k for k in must if not contains_keyword(text, k)]
    if not missing:
        return []
    return [
        Finding(
            "MUST_HAVE_COVERAGE", "warning",
            # Every missing keyword, not a sample: this is the repair turn's
            # to-do list, and a truncated list can never reach full coverage.
            f"{len(missing)} of {len(must)} must-have keywords absent: "
            + ", ".join(missing),
            "document", "",
            "Work each into a bullet that shows real use, and into Skills, "
            "wherever the experience supports it. Spell it as the posting does.",
        )
    ]


@rule
def dossier_provenance(context: Context) -> list[Finding]:
    """Mode B may not name a company without a searched, sourced dossier.

    Only enforced when the model actually had a research tool. Without one it
    cannot produce a source for anything, so the rule would fail every single
    generation - a gate nobody can pass is noise, not safety.
    """
    if context.mode != "constructed":
        return []
    if not context.strict_dossier:
        if context.resume.experience:
            return [
                Finding(
                    "DOSSIER_PROVENANCE", "warning",
                    "Company research is off, so no employer here has a verified "
                    "source. Check every company name before sending this.",
                    "experience", "",
                    "Turn on company research in Settings, or replace the names "
                    "with your own history.",
                )
            ]
        return []
    dossiers = [d for d in context.ledger.get("dossiers", []) if d.get("employer")]
    by_key = {key: d for d in dossiers for key in _employer_keys(d["employer"])}
    used = {k for e in context.resume.experience for k in _employer_keys(e.company)}
    findings = []
    for e in context.resume.experience:
        d = next((by_key[k] for k in _employer_keys(e.company) if k in by_key), None)
        if d is None:
            # Name the researched companies outright. "Use an archetype" sent
            # a real run round in circles: the model swapped "Agoda" for
            # "Online Travel Marketplace", which has no dossier either.
            unused = [
                _display_employer(x["employer"])
                for x in dossiers
                if x.get("sources") and not (_employer_keys(x["employer"]) & used)
            ]
            fix = (
                "Name this employer exactly as one of the researched companies in "
                "the ledger: " + ", ".join(unused) + ". An archetype description "
                "does not satisfy this rule."
                if unused
                else "Replace this employer with one that has a sourced dossier in the ledger."
            )
            findings.append(
                Finding(
                    "DOSSIER_PROVENANCE", "error",
                    f"'{e.company}' is named with no dossier in the ledger",
                    "experience", e.company, fix,
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


LEGAL_SUFFIX_RE = re.compile(
    r"(\s+(public\s+company\s+limited|company\s+limited|co|ltd|limited|inc|"
    r"incorporated|llc|plc|corp|corporation|gmbh|pte|pvt))+$"
)


def _employer_keys(name: str) -> set[str]:
    """Every spelling that should count as the same employer.

    The ledger records the legal entity ("Agoda (Agoda Services Co., Ltd. -
    part of Booking Holdings Inc.)", "MFEC Public Company Limited") while the
    resume names the brand ("Agoda", "MFEC"). Both are the same company.
    """
    parts = [name.split("(")[0], *re.findall(r"\(([^)]*)\)", name)]
    keys = set()
    for part in parts:
        part = re.split(r"\s+[—–-]\s+", part)[0]
        key = " ".join(re.sub(r"[.,]", " ", part).lower().split())
        key = LEGAL_SUFFIX_RE.sub("", key).strip()
        if key:
            keys.add(key)
    return keys


def _display_employer(name: str) -> str:
    return name.split("(")[0].strip() or name


# --------------------------------------------------------------------------

# Rules that must never reach a real job application via the extension's
# one-click auto-download. These force the user into the editor instead.
HARD_BLOCK_RULES = frozenset({"PLACEHOLDER_TOKEN", "DOSSIER_PROVENANCE"})


def validate(context: Context) -> list[Finding]:
    findings: list[Finding] = []
    for fn in REGISTRY.values():
        findings.extend(fn(context))
    order = {"error": 0, "warning": 1, "info": 2}
    return sorted(findings, key=lambda f: (order[f.severity], f.rule_id))


def blocks_autodownload(findings: list[Finding]) -> bool:
    return any(
        f.severity == "error" and f.rule_id in HARD_BLOCK_RULES for f in findings
    )
