"""A freelancer profile, read from its Upwork pages into the profile form.

The extension opens the link the user gave in a background tab of their own
browser and reads each page as it renders: the link's page, then every other
view of the same freelancer that page links to (the specialized profiles).
The portal sends those pages here, and the model reads them.

A model, not a parser: an Upwork profile is prose, lists and figures laid out
for people, so a page rework breaks selectors silently, while the model reads
the new layout as it read the old one. It copies; it never writes.

Nothing is stored. The reply fills the form, and the user saves it.
"""

from __future__ import annotations

import json
import re

from app.llm.provider import LLMError, LLMProviderPort, LLMRequest, SystemBlock
from app.llm.schemas import array, obj, shape, strings, text
from app.schemas.freelancing import (
    FreelancerProfileDraft,
    PortfolioItem,
    ProfileImportIn,
    SpecializedProfile,
)

SYSTEM = """You read a freelancer's Upwork profile and fill in their profile form.

You are given the visible text of one or more pages of the same freelancer.
Page 1 is the link the user gave. Any further pages are other views of that
freelancer which page 1 links to, usually their specialized profiles.

Rules:
- Copy, do not write. The title, overview, skills, portfolio and specialized
  profiles are copied VERBATIM from the pages, keeping the overview's
  paragraphs and line breaks. Never improve, shorten, summarise or translate.
- Never invent anything the pages do not show. A field they do not show is
  left empty.
- The main fields (title, overview, hourly_rate, skills, portfolio) come from
  page 1.
- specialized_profiles has one entry per specialized profile: each further
  page that is one, with its own title and overview, and any page 1 only
  names (a tab or a menu entry), with its name alone. The general profile
  ("All work") is never one of them.
- Ignore the site around the profile: navigation, the viewer's own account,
  "similar freelancers", ads, buttons, cookie notices.
- Text cut short ("more", "...") is copied as far as it goes, never completed.
"""

PROFILE = obj(
    {
        "problem": text(
            "Empty, unless page 1 is not a freelancer's profile (a sign-in wall, "
            "a captcha, an error, a job posting). Then what it is, in one plain "
            "sentence, and nothing else filled."
        ),
        "label": text(
            "A 1-4 word name for this profile, from its specialty, e.g. "
            "'Data engineering' or 'Shopify development'."
        ),
        "title": text("The profile's headline."),
        "overview": text("The overview, verbatim."),
        "hourly_rate": text(
            "The hourly rate in US dollars as a plain number, e.g. '45' or '72.50'. "
            "Empty when the page shows none."
        ),
        "skills": strings("The skills listed, verbatim, in page order."),
        "portfolio": array(
            obj(
                {
                    "title": text(),
                    "url": text("The project's own link when the page shows one, else empty."),
                    "summary": text("Its description when the page shows one, else empty."),
                }
            )
        ),
        "specialized_profiles": array(
            obj(
                {
                    "name": text("The specialized profile's name, as its tab or menu shows it."),
                    "title": text(),
                    "overview": text("Verbatim."),
                }
            )
        ),
        "notes_markdown": text(
            "Everything else on page 1 a proposal could cite, as short markdown "
            "sections in this order, each only when present: Stats (job success, "
            "earnings, jobs, hours, badges such as Top Rated), Employment history, "
            "Education, Certifications, Languages, Client feedback (at most the "
            "five most recent, quoted with the job title). Facts only. Empty when "
            "there is nothing."
        ),
    }
)

# The form's own limits (FreelancerProfileIn), so a filled form always saves.
_MAX_SKILLS = 100
_MAX_PORTFOLIO = 50
_MAX_SPECIALIZED = 10
_RATE = re.compile(r"\d[\d,]*(?:\.\d+)?")


async def read_profile(provider: LLMProviderPort, body: ProfileImportIn) -> FreelancerProfileDraft:
    response = await provider.complete(
        LLMRequest(
            purpose="profile_import",
            system=[SystemBlock(SYSTEM)],
            messages=[{"role": "user", "content": _pages(body)}],
            output_schema=PROFILE,
            max_output_tokens=16_000,
            effort="low",
            # Copying needs no reasoning, and on the fast tier thinking spends
            # the same output budget a long overview needs.
            thinking=False,
            timeout_s=120.0,
        )
    )
    if response.stop_reason == "max_tokens":
        raise LLMError("OUTPUT_TOO_LONG", "This profile is too long to read in one pass.")
    raw = response.parsed if isinstance(response.parsed, dict) else _json_object(response.text)
    if raw is None:
        raise LLMError("UNREADABLE_REPLY", "The profile came back unreadable. Try again.")

    data = shape(PROFILE, raw)
    if problem := data["problem"].strip():
        raise LLMError("NOT_A_PROFILE", problem)
    return _draft(data)


def _pages(body: ProfileImportIn) -> str:
    parts = []
    for number, view in enumerate((v for v in body.views if v.text.strip()), start=1):
        head = f"Page {number}" + (" (the link given)" if number == 1 else "") + f": {view.url}"
        if view.title:
            head += f"\nTab title: {view.title}"
        parts.append(f"{head}\n\n{view.text.strip()}")
    return "\n\n---\n\n".join(parts)


def _draft(data: dict) -> FreelancerProfileDraft:
    skills: list[str] = []
    for skill in data["skills"]:
        skill = _clip(skill, 60)
        if skill and skill.lower() not in (s.lower() for s in skills):
            skills.append(skill)

    portfolio = [
        PortfolioItem(
            title=title,
            url=_clip(item["url"], 2000) or None,
            summary=_clip(item["summary"], 2000) or None,
        )
        for item in data["portfolio"]
        if (title := _clip(item["title"], 200))
    ]
    specialized = [
        SpecializedProfile(
            name=name,
            title=_clip(item["title"], 200) or None,
            overview=_clip(item["overview"], 8000, keep_lines=True) or None,
        )
        for item in data["specialized_profiles"]
        if (name := _clip(item["name"], 120))
    ]
    return FreelancerProfileDraft(
        name=_clip(data["label"], 120) or None,
        title=_clip(data["title"], 200) or None,
        overview=_clip(data["overview"], 8000, keep_lines=True) or None,
        hourly_rate=_rate(data["hourly_rate"]),
        skills=skills[:_MAX_SKILLS],
        portfolio=portfolio[:_MAX_PORTFOLIO],
        specialized_profiles=specialized[:_MAX_SPECIALIZED],
        raw_profile_markdown=_clip(data["notes_markdown"], 40_000, keep_lines=True) or None,
    )


def _clip(value: str, limit: int, *, keep_lines: bool = False) -> str:
    value = value.strip() if keep_lines else re.sub(r"\s+", " ", value).strip()
    return value[:limit].rstrip()


def _rate(value: str) -> float | None:
    match = _RATE.search(value)
    if not match:
        return None
    rate = float(match.group(0).replace(",", ""))
    return rate if 0 < rate <= 10_000 else None


def _json_object(reply: str) -> dict | None:
    """The JSON object in a reply that came back as text, fenced or not."""
    start, end = reply.find("{"), reply.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        value = json.loads(reply[start : end + 1])
    except ValueError:
        return None
    return value if isinstance(value, dict) else None
