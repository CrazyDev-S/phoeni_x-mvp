"""Render the AST back to Resume Markdown markdown and to flat plain text.

``render_resume_markdown`` must be the exact inverse of ``parser.parse`` - the round-trip
property test in tests/test_crm_roundtrip.py depends on it, and so does every
"edit in the portal, re-export" flow.

``render_plain_text`` produces the string a naive ATS extractor should see. It is
used for full-text search, keyword coverage scoring, and as a test oracle for
the docx exporter.
"""

from __future__ import annotations

import yaml

from app.resume.document import Resume

SECTION_ORDER = [
    ("summary", "PROFESSIONAL SUMMARY"),
    ("skills", "TECHNICAL SKILLS"),
    ("experience", "PROFESSIONAL EXPERIENCE"),
    ("projects", "SELECTED PROJECTS"),
    ("education", "EDUCATION"),
    ("certifications", "CERTIFICATIONS"),
    ("languages", "LANGUAGES"),
]

HEADER_FIELDS = [
    "name", "title", "location", "work_preference", "timezone_note",
    "phone", "email",
]


def render_resume_markdown(r: Resume) -> str:
    out: list[str] = ["---"]

    meta: dict[str, object] = {}
    for f in HEADER_FIELDS:
        if (v := getattr(r.header, f)) is not None:
            meta[f] = v
    # Dump field-by-field to preserve declaration order and keep one field per
    # line, which is also what the ATS contact-block rule wants.
    for k, v in meta.items():
        out.append(yaml.safe_dump({k: v}, allow_unicode=True, default_flow_style=False).strip())
    if r.header.links:
        out.append("links:")
        out.extend(f"  - {link.label}" for link in r.header.links)
    if r.header.availability:
        out.append(
            yaml.safe_dump(
                {"availability": r.header.availability},
                allow_unicode=True,
                default_flow_style=False,
            ).strip()
        )
    out.append("---")

    for key, heading in SECTION_ORDER:
        body = _section_lines(r, key)
        if not body:
            continue
        out += ["", f"## {heading}", ""]
        out += body

    return "\n".join(out).rstrip() + "\n"


def _section_lines(r: Resume, key: str) -> list[str]:
    if key == "summary":
        return [r.summary] if r.summary else []

    if key == "skills":
        return [f"- **{c.label}**: {c.value}" for c in r.skills]

    if key == "experience":
        lines: list[str] = []
        for i, e in enumerate(r.experience):
            if i:
                lines.append("")
            head = f"### {e.company}"
            if loc := e.location_label:
                head += f" — {loc}"
            if e.work_mode:
                head += f" ({e.work_mode})"
            lines.append(head)
            lines.append(f"**{e.total_tenure}**")
            if e.context:
                lines.append(f"> {e.context}")
            for t in e.titles:
                lines += ["", f"#### {t.title} · {t.dates}"]
                if t.promotion_note:
                    lines.append(f"*{t.promotion_note}*")
                lines.append("")
                lines += [f"- {b}" for b in t.bullets]
        return lines

    if key == "projects":
        lines = []
        for i, p in enumerate(r.projects):
            if i:
                lines.append("")
            lines.append(f"### {p.name}")
            if p.context:
                lines.append(f"> {p.context}")
            if p.bullets:
                lines.append("")
                lines += [f"- {b}" for b in p.bullets]
        return lines

    if key == "education":
        lines = []
        for i, e in enumerate(r.education):
            if i:
                lines.append("")
            lines.append(f"### {e.degree}")
            inst = e.institution
            loc = ", ".join(x for x in (e.city, e.country) if x)
            if loc:
                inst += f" — {loc}"
            if e.year:
                inst += f" · {e.year}"
            lines.append(inst)
        return lines

    if key == "certifications":
        lines = []
        for c in r.certifications:
            s = f"- {c.name}"
            if c.issuer:
                s += f" — {c.issuer}"
            if c.year:
                s += f", {c.year}"
            lines.append(s)
        return lines

    if key == "languages":
        return [f"- {lang.name} — {lang.proficiency}" for lang in r.languages]

    return []


def render_plain_text(r: Resume) -> str:
    """Flat text: what a naive extractor should see, and what we index."""
    h = r.header
    out: list[str] = [h.name, h.title, h.location]
    if h.work_preference or h.timezone_note:
        out.append(" · ".join(x for x in (h.work_preference, h.timezone_note) if x))
    out += [x for x in (h.phone, h.email) if x]
    out += [link.label for link in h.links]
    if h.availability:
        out.append(h.availability)

    out += ["", "PROFESSIONAL SUMMARY", r.summary]

    if r.skills:
        out += ["", "TECHNICAL SKILLS"]
        out += [f"{c.label}: {c.value}" for c in r.skills]

    if r.experience:
        out += ["", "PROFESSIONAL EXPERIENCE"]
        for e in r.experience:
            loc = e.location_label
            mode = f" ({e.work_mode})" if e.work_mode else ""
            out.append(f"{e.company}{' — ' + loc if loc else ''}{mode}")
            out.append(str(e.total_tenure))
            if e.context:
                out.append(e.context)
            for t in e.titles:
                out.append(f"{t.title} · {t.dates}")
                if t.promotion_note:
                    out.append(t.promotion_note)
                out += [f"• {b}" for b in t.bullets]

    if r.projects:
        out += ["", "SELECTED PROJECTS"]
        for p in r.projects:
            out.append(p.name)
            if p.context:
                out.append(p.context)
            out += [f"• {b}" for b in p.bullets]

    if r.education:
        out += ["", "EDUCATION"]
        for e in r.education:
            out.append(e.degree)
            loc = ", ".join(x for x in (e.city, e.country) if x)
            tail = " · ".join(x for x in (loc, str(e.year) if e.year else None) if x)
            out.append(f"{e.institution}{' — ' + tail if tail else ''}")

    if r.certifications:
        out += ["", "CERTIFICATIONS"]
        out += [
            " — ".join(x for x in (c.name, c.issuer, str(c.year) if c.year else None) if x)
            for c in r.certifications
        ]

    if r.languages:
        out += ["", "LANGUAGES"]
        out += [f"{lang.name} — {lang.proficiency}" for lang in r.languages]

    return "\n".join(out).strip() + "\n"
