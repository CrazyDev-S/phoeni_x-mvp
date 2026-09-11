"""BLOCK 3, computed rather than asked for.

The model supplies the keyword plan and the priorities; every count and
percentage here is derived from that plan plus the finished resume. Deriving
them is what makes the report always agree with the document, and it removes
the single largest source of hallucinated arithmetic in the original prompt.
"""

from __future__ import annotations

import re
from datetime import date

from app.core.timezone import app_today
from app.llm.schemas import ScenarioLedger
from app.resume.ast import Resume

SECTION_SUMMARY = "Summary"
SECTION_SKILLS = "Skills"
SECTION_EXPERIENCE = "Experience"


def _contains(haystack: str, needle: str) -> bool:
    """Word-boundary match, so 'Go' does not match 'Django'."""
    if not needle.strip():
        return False
    return re.search(rf"(?<![A-Za-z0-9+#.]){re.escape(needle)}(?![A-Za-z0-9+#])",
                     haystack, re.IGNORECASE) is not None


def _where(resume: Resume, keyword: str) -> list[str]:
    found: list[str] = []
    if _contains(resume.summary, keyword):
        found.append(SECTION_SUMMARY)
    if any(_contains(c.value, keyword) or _contains(c.label, keyword) for c in resume.skills):
        found.append(SECTION_SKILLS)
    roles = [
        e.company
        for e in resume.experience
        if any(
            _contains(b, keyword)
            for t in e.titles
            for b in t.bullets
        )
        or (e.context and _contains(e.context, keyword))
    ]
    if roles:
        found.append(SECTION_EXPERIENCE)
    return found


def total_months(resume: Resume, today: date) -> int:
    today_ord = today.year * 12 + today.month
    spans = sorted(
        (
            e.total_tenure.start.ordinal,
            today_ord if e.total_tenure.is_current else e.total_tenure.end.ordinal,  # type: ignore[union-attr]
        )
        for e in resume.experience
    )
    if not spans:
        return 0
    merged = [list(spans[0])]
    for start, end in spans[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return sum(e - s for s, e in merged)


def build(
    resume: Resume,
    ledger: ScenarioLedger | None,
    *,
    target_title: str,
    today: date | None = None,
    findings_count: int = 0,
) -> dict:
    today = today or app_today()
    plan = ledger.keyword_plan if ledger else []

    rows = []
    must_total = must_covered = nice_total = nice_covered = 0
    for entry in plan:
        sections = _where(resume, entry.keyword)
        covered = bool(sections)
        is_must = entry.priority.upper().startswith("MUST")
        if is_must:
            must_total += 1
            must_covered += covered
        else:
            nice_total += 1
            nice_covered += covered
        rows.append(
            {
                "keyword": entry.keyword,
                "priority": "MUST" if is_must else "NICE",
                "skills": SECTION_SKILLS in sections,
                "experience": SECTION_EXPERIENCE in sections,
                "summary": SECTION_SUMMARY in sections,
                "covered": covered,
            }
        )

    yoe_shown = round(total_months(resume, today) / 12, 1)
    gate = ledger.gate if ledger else []
    gate_passed = sum(1 for g in gate if g.result.upper() == "PASS")

    return {
        "target_title": target_title,
        "resume_title": resume.header.title,
        "title_aligned": _titles_align(target_title, resume.header.title),
        # Parse integrity is a fact here, not a claim: the document was parsed
        # from markdown into the AST this report was computed from.
        "parse_integrity": "PASS",
        "must_have_covered": must_covered,
        "must_have_total": must_total,
        "must_have_coverage_pct": _pct(must_covered, must_total),
        "nice_to_have_covered": nice_covered,
        "nice_to_have_total": nice_total,
        "nice_to_have_coverage_pct": _pct(nice_covered, nice_total),
        "yoe_required": ledger.jd_required_yoe if ledger else 0,
        "yoe_shown": yoe_shown,
        "scenario_gate_passed": gate_passed,
        "scenario_gate_total": len(gate),
        "validation_findings": findings_count,
        "skill_categories": len(resume.skills),
        "companies": len(resume.experience),
        "keywords": rows,
        "computed_at": today.isoformat(),
    }


def _pct(covered: int, total: int) -> float:
    return round(100.0 * covered / total, 1) if total else 0.0


def _titles_align(target: str, actual: str) -> bool:
    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()

    a, b = norm(target), norm(actual)
    return bool(a) and bool(b) and (a == b or a in b or b in a)
