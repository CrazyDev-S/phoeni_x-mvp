"""What an imported resume still needs a human to look at.

Two questions, both answered without the model so the answers cannot be
flattered by it:

* Faithfulness - did restructuring invent anything? Every employer, year,
  number, email and phone in the result is looked up in the original text. The
  model is told never to add facts; this is the check that it did not.
* Completeness - what is the file missing that an employer or an ATS expects?

Everything here is a warning or a note. A resume that is a little thin is still
the user's resume; only they can say whether a flagged number is a typo in the
original or an error in the conversion.
"""

from __future__ import annotations

import re

from app.remote.resume.document import Resume
from app.remote.validation.rules import Finding

UNSOURCED = "IMPORT_UNSOURCED"
NOT_STATED = "Not specified"

_NUMBER = re.compile(r"[$€£]?\d[\d,]*(?:\.\d+)?\s?%?[kKmMbB]?(?![\w])")
_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")


def review_import(resume: Resume, source_text: str) -> list[Finding]:
    return [*_faithfulness(resume, source_text), *_completeness(resume)]


# --------------------------------------------------------------------------
# Faithfulness
# --------------------------------------------------------------------------

def _faithfulness(resume: Resume, source: str) -> list[Finding]:
    flat = _flatten(source)
    source_numbers = _numbers(source)
    findings: list[Finding] = []

    def missing(kind: str, value: str, path: str) -> None:
        findings.append(
            Finding(
                UNSOURCED, "warning",
                f"{kind} {value!r} is not in the original file.",
                path, value,
                "Check it against your original; correct it if the conversion got it wrong.",
            )
        )

    for i, exp in enumerate(resume.experience):
        if not _mentions(flat, _lead(exp.company)):
            missing("Employer", exp.company, f"experience[{i}].company")

    header = resume.header
    if header.email and header.email.lower() not in source.lower():
        missing("Email", header.email, "header.email")
    if header.phone and _digits(header.phone) not in _digits(source):
        missing("Phone", header.phone, "header.phone")

    seen: set[str] = set()
    for path, text in _prose(resume):
        for token in _numbers(text):
            if token in source_numbers or token in seen:
                continue
            seen.add(token)
            missing("Number", token, path)

    years = {y for y in _YEAR.findall(source)}
    shown = {str(d.year) for e in resume.experience for d in (e.total_tenure.start, e.total_tenure.end) if d}
    shown |= {str(ed.year) for ed in resume.education if ed.year}
    for year in sorted(shown - years):
        # "Present" and relative dates ("since 2 years") never reach here: only
        # an explicit year the file does not contain does.
        missing("Year", year, "dates")
    return findings


def _prose(resume: Resume) -> list[tuple[str, str]]:
    out = [("summary", resume.summary)]
    for ei, e in enumerate(resume.experience):
        for ti, t in enumerate(e.titles):
            out += [(f"experience[{ei}].titles[{ti}].bullets[{bi}]", b) for bi, b in enumerate(t.bullets)]
    for pi, p in enumerate(resume.projects):
        out += [(f"projects[{pi}].bullets[{bi}]", b) for bi, b in enumerate(p.bullets)]
    return out


def _numbers(text: str) -> set[str]:
    """Figures that carry a claim: percentages, money, counts above nine.

    Years are checked on their own, and single digits are too common in prose
    ("2 teams") to be worth chasing.
    """
    found: set[str] = set()
    text = re.sub(r"(\d)\s+%", r"\1%", text)
    for m in _NUMBER.finditer(text):
        raw = m.group(0).strip().replace(",", "").lower()
        digits = re.sub(r"\D", "", raw)
        if _YEAR.fullmatch(raw) or (len(digits) < 2 and not raw.endswith(("%", "k", "m", "b"))):
            continue
        found.add(raw)
    return found


def _flatten(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _lead(company: str) -> str:
    """The employer's own name, without a parenthetical, location or suffix."""
    return re.split(r"\s*(?:\(|\s[—–-]\s|,)", company, maxsplit=1)[0].strip()


def _mentions(flat_source: str, name: str) -> bool:
    key = _flatten(name)
    return not key or key in flat_source


def _digits(text: str) -> str:
    return re.sub(r"\D", "", text)


# --------------------------------------------------------------------------
# Completeness
# --------------------------------------------------------------------------

def _completeness(resume: Resume) -> list[Finding]:
    findings: list[Finding] = []

    def note(rule: str, severity: str, message: str, path: str, fix: str) -> None:
        findings.append(Finding(rule, severity, message, path, "", fix))

    header = resume.header
    if header.location == NOT_STATED:
        note(
            "IMPORT_NO_LOCATION", "warning",
            "The file does not say where you are based.",
            "header.location", "Add your city and country.",
        )
    if not header.email:
        note(
            "IMPORT_NO_EMAIL", "warning",
            "No email address was found.", "header.email",
            "Add one; applications and recruiters need it.",
        )
    if not header.phone:
        note("IMPORT_NO_PHONE", "info", "No phone number was found.", "header.phone",
             "Add one if you want recruiters to be able to call.")
    if not any("linkedin" in (link.url or link.label).lower() for link in header.links):
        note("IMPORT_NO_LINKEDIN", "info", "No LinkedIn link was found.", "header.links",
             "Most recruiters look for one.")

    if not resume.experience:
        note("IMPORT_NO_EXPERIENCE", "warning", "No work experience was found in the file.",
             "experience", "Check the original is the resume you meant to upload.")
    if not resume.education:
        note("IMPORT_NO_EDUCATION", "info", "No education was found.", "education",
             "Add it if you have any; many applications ask.")

    bullets = [b for e in resume.experience for t in e.titles for b in t.bullets]
    if bullets:
        measured = sum(1 for b in bullets if re.search(r"\d", b))
        if measured / len(bullets) < 0.3:
            note(
                "IMPORT_FEW_METRICS", "info",
                f"Only {measured} of {len(bullets)} experience bullets carry a number.",
                "experience",
                "Add the scale or result behind your strongest achievements - "
                "only figures you can stand behind.",
            )
        long_ones = sum(1 for b in bullets if len(b) > 260)
        if long_ones:
            note(
                "IMPORT_LONG_BULLETS", "info",
                f"{long_ones} bullet{'s are' if long_ones != 1 else ' is'} very long.",
                "experience", "Shorter bullets are easier to scan.",
            )
    return findings
