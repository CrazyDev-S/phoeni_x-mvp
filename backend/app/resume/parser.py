"""Resume Markdown v1 parser.

A line-oriented state machine with one compiled regex per line shape. The
grammar is deliberately rigid: because markdown is the stored canonical form,
the exporter has to read it back, and that is only safe if there is exactly
one way to write each construct.

An unrecognised line raises ``ResumeMarkdownError`` carrying the line number and the
state the parser was in, so the repair prompt can name the exact problem.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import yaml
from pydantic import ValidationError

from app.resume.document import (
    MONTH_INDEX,
    Certification,
    ContactLink,
    DateRange,
    Education,
    Experience,
    Header,
    Language,
    Project,
    Resume,
    SkillCategory,
    YearMonth,
)

SECTIONS = {
    "PROFESSIONAL SUMMARY": "summary",
    "TECHNICAL SKILLS": "skills",
    "PROFESSIONAL EXPERIENCE": "experience",
    "SELECTED PROJECTS": "projects",
    "EDUCATION": "education",
    "CERTIFICATIONS": "certifications",
    "LANGUAGES": "languages",
}

# --- line shapes -----------------------------------------------------------
RE_SECTION = re.compile(r"^##\s+(?P<name>[A-Z][A-Z &/]+)\s*$")
RE_SKILL = re.compile(r"^-\s+\*\*(?P<label>[^*]+?)\*\*\s*:\s*(?P<items>.+?)\s*$")
RE_COMPANY = re.compile(
    r"^###\s+(?P<company>.+?)"
    r"(?:\s+—\s+(?P<location>.+?))?"
    r"(?:\s+\((?P<mode>[^)]+)\))?\s*$"
)
RE_TENURE = re.compile(r"^\*\*(?P<range>.+?)\*\*\s*$")
RE_CONTEXT = re.compile(r"^>\s*(?P<text>.+?)\s*$")
RE_TITLE = re.compile(r"^####\s+(?P<title>.+?)\s+·\s+(?P<range>.+?)\s*$")
RE_ITALIC = re.compile(r"^\*(?P<text>[^*].*?)\*\s*$")
RE_BULLET = re.compile(r"^[-•]\s+(?P<text>.+?)\s*$")
RE_EDU_DEGREE = re.compile(r"^###\s+(?P<degree>.+?)\s*$")
RE_EDU_INST = re.compile(
    r"^(?P<institution>.+?)(?:\s+—\s+(?P<location>.+?))?(?:\s+·\s+(?P<year>\d{4}))?\s*$"
)
RE_LANG = re.compile(r"^-\s+(?P<name>.+?)\s+—\s+(?P<prof>.+?)\s*$")
RE_CERT = re.compile(r"^-\s+(?P<name>.+?)(?:\s+—\s+(?P<issuer>.+?))?(?:,\s*(?P<year>\d{4}))?\s*$")

RE_DATE = re.compile(r"^(?P<mon>[A-Z][a-z]{2})?\s*(?P<year>\d{4})$")
DASHES = "–—-"


class ResumeMarkdownError(ValueError):
    def __init__(self, line_no: int, state: str, line: str, reason: str = "") -> None:
        self.line_no = line_no
        self.state = state
        self.line = line
        self.reason = reason
        detail = f" ({reason})" if reason else ""
        super().__init__(
            f"Resume Markdown parse error at line {line_no} while reading {state}{detail}: {line!r}"
        )


def _parse_ym(token: str, line_no: int, state: str, raw: str) -> YearMonth:
    m = RE_DATE.match(token.strip())
    if not m:
        raise ResumeMarkdownError(line_no, state, raw, f"unrecognised date {token!r}")
    mon = m.group("mon")
    if mon and mon not in MONTH_INDEX:
        raise ResumeMarkdownError(line_no, state, raw, f"unknown month {mon!r}")
    return YearMonth(
        year=int(m.group("year")), month=MONTH_INDEX[mon] if mon else None
    )


def _parse_range(text: str, line_no: int, state: str, raw: str) -> DateRange:
    parts = re.split(rf"\s*[{DASHES}]\s*", text.strip(), maxsplit=1)
    if len(parts) != 2:
        raise ResumeMarkdownError(
            line_no, state, raw, f"expected 'Mon YYYY – Mon YYYY|Present', got {text!r}"
        )
    start = _parse_ym(parts[0], line_no, state, raw)
    tail = parts[1].strip()
    if tail.lower() == "present":
        return DateRange(start=start, is_current=True)
    return DateRange(start=start, end=_parse_ym(tail, line_no, state, raw))


@dataclass
class _Acc:
    """Mutable accumulators used while walking the document."""

    summary: list[str] = field(default_factory=list)
    skills: list[SkillCategory] = field(default_factory=list)
    experience: list[dict] = field(default_factory=list)
    projects: list[dict] = field(default_factory=list)
    education: list[dict] = field(default_factory=list)
    certifications: list[Certification] = field(default_factory=list)
    languages: list[Language] = field(default_factory=list)


def _split_frontmatter(text: str) -> tuple[dict, list[tuple[int, str]]]:
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or lines[0].strip() != "---":
        raise ResumeMarkdownError(1, "header", lines[0] if lines else "", "missing '---' opener")
    try:
        close = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration as exc:
        raise ResumeMarkdownError(1, "header", "---", "frontmatter is never closed") from exc

    try:
        meta = yaml.safe_load("\n".join(lines[1:close])) or {}
    except yaml.YAMLError as exc:
        raise ResumeMarkdownError(2, "header", "<frontmatter>", f"invalid YAML: {exc}") from exc
    if not isinstance(meta, dict):
        raise ResumeMarkdownError(2, "header", "<frontmatter>", "frontmatter is not a mapping")

    body = [(i + 1, lines[i]) for i in range(close + 1, len(lines))]
    return meta, body


def _build_header(meta: dict) -> Header:
    links = [
        ContactLink(label=str(link)) if not isinstance(link, dict) else ContactLink(**link)
        for link in (meta.get("links") or [])
    ]
    try:
        return Header(
            name=str(meta["name"]),
            title=str(meta["title"]),
            location=str(meta["location"]),
            work_preference=_opt(meta, "work_preference"),
            timezone_note=_opt(meta, "timezone_note"),
            phone=_opt(meta, "phone"),
            email=_opt(meta, "email"),
            links=links,
            availability=_opt(meta, "availability"),
        )
    except KeyError as exc:
        raise ResumeMarkdownError(2, "header", "<frontmatter>", f"missing field {exc}") from exc
    except ValidationError as exc:
        raise ResumeMarkdownError(2, "header", "<frontmatter>", str(exc)) from exc


def _opt(meta: dict, key: str) -> str | None:
    v = meta.get(key)
    return str(v) if v not in (None, "") else None


def parse(text: str) -> Resume:
    """Parse Resume Markdown v1 markdown into the render AST."""
    meta, body = _split_frontmatter(text)
    header = _build_header(meta)
    acc = _Acc()

    section: str | None = None
    exp: dict | None = None
    title: dict | None = None
    proj: dict | None = None
    edu: dict | None = None
    # Set right after a '### Company' line so the next '**...**' is read as the
    # company tenure rather than as stray bold text.
    expect_tenure = False

    def close_title() -> None:
        nonlocal title
        if exp is not None and title is not None:
            exp["titles"].append(title)
        title = None

    def close_exp() -> None:
        nonlocal exp
        close_title()
        if exp is not None:
            acc.experience.append(exp)
        exp = None

    def close_proj() -> None:
        nonlocal proj
        if proj is not None:
            acc.projects.append(proj)
        proj = None

    def close_edu() -> None:
        nonlocal edu
        if edu is not None:
            acc.education.append(edu)
        edu = None

    for line_no, raw in body:
        line = raw.rstrip()
        if not line.strip():
            continue

        if m := RE_SECTION.match(line):
            name = m.group("name").strip()
            if name not in SECTIONS:
                raise ResumeMarkdownError(
                    line_no, section or "document", line,
                    f"unknown section; expected one of {sorted(SECTIONS)}",
                )
            close_exp()
            close_proj()
            close_edu()
            section = SECTIONS[name]
            expect_tenure = False
            continue

        if section is None:
            raise ResumeMarkdownError(line_no, "document", line, "content before any '## SECTION'")

        # --- summary ---
        if section == "summary":
            acc.summary.append(line.strip())

        # --- skills ---
        elif section == "skills":
            m = RE_SKILL.match(line)
            if not m:
                raise ResumeMarkdownError(
                    line_no, "TECHNICAL SKILLS", line,
                    "expected '- **Label**: item, item'",
                )
            items = [i.strip() for i in m.group("items").split(",") if i.strip()]
            acc.skills.append(SkillCategory(label=m.group("label").strip(), items=items))

        # --- experience ---
        elif section == "experience":
            if line.startswith("### "):
                close_exp()
                m = RE_COMPANY.match(line)
                if not m:
                    raise ResumeMarkdownError(line_no, "PROFESSIONAL EXPERIENCE", line,
                                        "expected '### Company — City, Country (Mode)'")
                city = country = None
                if loc := m.group("location"):
                    bits = [b.strip() for b in loc.split(",")]
                    city = bits[0] if bits else None
                    country = bits[-1] if len(bits) > 1 else None
                exp = {
                    "company": m.group("company").strip(),
                    "city": city,
                    "country": country,
                    "work_mode": (m.group("mode") or "").strip() or None,
                    "total_tenure": None,
                    "context": None,
                    "titles": [],
                }
                expect_tenure = True
            elif expect_tenure and (m := RE_TENURE.match(line)):
                exp["total_tenure"] = _parse_range(
                    m.group("range"), line_no, "company tenure", line
                )
                expect_tenure = False
            elif m := RE_CONTEXT.match(line):
                if exp is None:
                    raise ResumeMarkdownError(line_no, "PROFESSIONAL EXPERIENCE", line,
                                        "context line before any company")
                exp["context"] = m.group("text")
                expect_tenure = False
            elif line.startswith("#### "):
                close_title()
                m = RE_TITLE.match(line)
                if not m:
                    raise ResumeMarkdownError(line_no, "PROFESSIONAL EXPERIENCE", line,
                                        "expected '#### Title · Mon YYYY – Mon YYYY'")
                title = {
                    "title": m.group("title").strip(),
                    "dates": _parse_range(m.group("range"), line_no, "title dates", line),
                    "promotion_note": None,
                    "bullets": [],
                }
                expect_tenure = False
            elif (m := RE_ITALIC.match(line)) and title is not None and not title["bullets"]:
                title["promotion_note"] = m.group("text").strip()
            elif m := RE_BULLET.match(line):
                if title is None:
                    raise ResumeMarkdownError(line_no, "PROFESSIONAL EXPERIENCE", line,
                                        "bullet before any '#### Title' line")
                title["bullets"].append(m.group("text"))
            else:
                raise ResumeMarkdownError(line_no, "PROFESSIONAL EXPERIENCE", line)

        # --- projects ---
        elif section == "projects":
            if line.startswith("### "):
                close_proj()
                proj = {"name": line[4:].strip(), "context": None, "bullets": []}
            elif m := RE_CONTEXT.match(line):
                if proj is None:
                    raise ResumeMarkdownError(line_no, "SELECTED PROJECTS", line,
                                        "context before any project")
                proj["context"] = m.group("text")
            elif m := RE_BULLET.match(line):
                if proj is None:
                    raise ResumeMarkdownError(line_no, "SELECTED PROJECTS", line,
                                        "bullet before any project")
                proj["bullets"].append(m.group("text"))
            else:
                raise ResumeMarkdownError(line_no, "SELECTED PROJECTS", line)

        # --- education ---
        elif section == "education":
            if line.startswith("### "):
                close_edu()
                m = RE_EDU_DEGREE.match(line)
                edu = {"degree": m.group("degree").strip()}
            else:
                if edu is None:
                    raise ResumeMarkdownError(line_no, "EDUCATION", line,
                                        "institution line before any '### Degree'")
                m = RE_EDU_INST.match(line)
                if not m:
                    raise ResumeMarkdownError(line_no, "EDUCATION", line)
                city = country = None
                if loc := m.group("location"):
                    bits = [b.strip() for b in loc.split(",")]
                    city = bits[0] if bits else None
                    country = bits[-1] if len(bits) > 1 else None
                edu.update(
                    institution=m.group("institution").strip(),
                    city=city,
                    country=country,
                    year=int(m.group("year")) if m.group("year") else None,
                )

        # --- certifications ---
        elif section == "certifications":
            m = RE_CERT.match(line)
            if not m:
                raise ResumeMarkdownError(line_no, "CERTIFICATIONS", line,
                                    "expected '- Name — Issuer, YYYY'")
            acc.certifications.append(
                Certification(
                    name=m.group("name").strip(),
                    issuer=(m.group("issuer") or "").strip() or None,
                    year=int(m.group("year")) if m.group("year") else None,
                )
            )

        # --- languages ---
        elif section == "languages":
            m = RE_LANG.match(line)
            if not m:
                raise ResumeMarkdownError(line_no, "LANGUAGES", line,
                                    "expected '- Language — Proficiency'")
            acc.languages.append(
                Language(name=m.group("name").strip(), proficiency=m.group("prof").strip())
            )

    close_exp()
    close_proj()
    close_edu()

    for e in acc.experience:
        if e["total_tenure"] is None:
            # Single-title roles may omit the company tenure line; derive it.
            if not e["titles"]:
                raise ResumeMarkdownError(0, "PROFESSIONAL EXPERIENCE",
                                    f"### {e['company']}", "company has no title blocks")
            e["total_tenure"] = e["titles"][-1]["dates"] if len(e["titles"]) == 1 else None
            if e["total_tenure"] is None:
                raise ResumeMarkdownError(0, "PROFESSIONAL EXPERIENCE", f"### {e['company']}",
                                    "a company with two titles needs a '**tenure**' line")

    try:
        return Resume(
            header=header,
            summary=" ".join(acc.summary),
            skills=acc.skills,
            experience=[Experience(**e) for e in acc.experience],
            projects=[Project(**p) for p in acc.projects],
            education=[Education(**e) for e in acc.education],
            certifications=acc.certifications,
            languages=acc.languages,
        )
    except ValidationError as exc:
        first = exc.errors()[0]
        loc = ".".join(str(p) for p in first["loc"])
        raise ResumeMarkdownError(0, "document", loc, first["msg"]) from exc
