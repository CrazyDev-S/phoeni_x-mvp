"""What passes between the stages of a staged generation.

Each stage sees only what the one before it handed on. These are the checks
on that hand-off that are code rather than instructions: the posting's
criteria carry no hiring platform, and research covers only what the
candidate's own history names.
"""

from __future__ import annotations

import re

from app.remote.validation.rules import employer_keys

# Marketplaces whose names reach a posting as page furniture, not as skills.
PLATFORMS = re.compile(
    r"\b(?:(?:on|via|through|from|at)\s+(?:the\s+)?)?"
    r"(?:upwork|fiverr|toptal|peopleperhour|freelancer\.com|guru\.com)\b",
    re.IGNORECASE,
)
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.;:])")
_EMPTY_BRACKETS = re.compile(r"\(\s*\)|\[\s*\]")
_NOT_WORD = re.compile(r"[\W_]+")


def clean_criteria(criteria: dict) -> dict:
    """The criteria with any platform name the model let through removed.

    The criteria prompt already leaves them out; this is the backstop. A
    platform name that reaches the keyword plan is a MUST keyword the repair
    loop then chases into the resume.
    """
    updates: dict = {
        "keyword_plan": [
            k for k in criteria["keyword_plan"]
            if k["keyword"].strip() and not PLATFORMS.search(k["keyword"])
        ]
    }
    for name, value in criteria.items():
        if name == "input_problem":
            continue
        if isinstance(value, str) and PLATFORMS.search(value):
            updates[name] = _scrub(value)
        elif isinstance(value, list) and any(
            isinstance(v, str) and PLATFORMS.search(v) for v in value
        ):
            updates[name] = [s for s in (_scrub(v) for v in value) if s]
    return {**criteria, **updates}


def _scrub(text: str) -> str:
    text = _EMPTY_BRACKETS.sub(" ", PLATFORMS.sub(" ", text))
    return _SPACE_BEFORE_PUNCT.sub(r"\1", " ".join(text.split())).strip(" ,;:")


def stated_in(history: str, name: str) -> bool:
    """Whether the candidate's own history names this employer or school."""
    haystack = _words(history)
    return any(
        (key := _words(k)).strip() and key in haystack for k in employer_keys(name)
    )


def _words(text: str) -> str:
    return " " + " ".join(_NOT_WORD.sub(" ", text.lower()).split()) + " "


def researchable_employers(ledger: dict, history: str) -> list[dict]:
    """The scenario's dossiers whose employer the candidate's history names, once each."""
    seen: set[str] = set()
    out: list[dict] = []
    for dossier in ledger["dossiers"]:
        employer = dossier["employer"]
        keys = employer_keys(employer)
        if employer and not keys & seen and stated_in(history, employer):
            seen |= keys
            out.append(dossier)
    return out


def stated_education(record: dict | None, history: str) -> dict | None:
    """The education record, only when it is the one the history states."""
    if record is None or not record["found"]:
        return None
    if stated_in(history, record["as_written"]) or stated_in(history, record["institution"]):
        return record
    return None
