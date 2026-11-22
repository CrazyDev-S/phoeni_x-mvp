"""The proposal writer: what the model is told, what it is given, what it returns.

The method is the user's own prompt, ``prompts/proposal_generator_v1.md``
(the Proposal Agent Instruction), loaded verbatim as a cached system prefix.
``CONTRACT`` adapts it to an editor where every instruction produces one new
version, and holds it to the freelancer's real work.

The bid is not the model's: it comes from the posting's range and the
profile's rate (``bid``), and the connects from the posting (``connects``).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.freelancing.profile_import import _clip as clip
from app.freelancing.profile_writer import _material_text as material_text
from app.freelancing.proposals.research import Page
from app.freelancing.upwork_text import from_markdown
from app.llm.provider import SystemBlock
from app.llm.schemas import array, obj, one_of, strings, text
from app.models.enums import FreelanceJobType
from app.models.freelancing import FreelanceJob, FreelancerProfile
from app.schemas.freelancing import ProfileMaterial

PROMPT_PATH = Path(__file__).resolve().parents[3] / "prompts" / "proposal_generator_v1.md"
VERSION = "prompt-v1"

CONTRACT = """\
═══════════════════════════════════════════════════════════════
  HOW THIS RUNS HERE  —  the proposal editor's contract
═══════════════════════════════════════════════════════════════

The method above runs inside a freelancer's proposal editor, one
request at a time. Each request is one Upwork posting and one
instruction; each reply becomes one new version of the proposal,
which the freelancer reviews, refines with another instruction,
or saves and sends. These rules adapt the method to that.
Everything else in it applies unchanged.

1. Voice. You write as the freelancer, in the first person, from
   their profile in <freelancer>, to the client who posted
   <posting>.

2. The read. Answer the method's four detective questions before
   you write and put the answers in `read`. They are for the
   freelancer, so they can see why the letter says what it says;
   the letter never states them.

3. The experience spike is true. This replaces the method's
   fictional project brief: the letter goes to a real client who
   will hire on it, so it never claims work that did not happen.
   Build the spike from the freelancer's real work: a project in
   <freelancer> (portfolio, overview, notes, work history), or
   one the instructions name or link, using what
   <researched_pages> shows of it. Pick the one closest to the
   client's domain, stack and core problem and write it with all
   the depth and weight the method asks for. A brand-style name
   is welcome when the project has none, as long as it is clearly
   that project. Never invent a project, client, employer, metric
   or outcome, and never stretch one past what the material says.
   When nothing in the material fits, the spike becomes the
   concrete plan for this client's build instead: the same domain,
   the constraint that would drive the core decisions, what it
   would give them, framed as how the freelancer would approach
   it, never as something already shipped. Say which you did in
   `spike`, and ask in `questions` for the real project that would
   fit better.

4. Project URLs. A link in the instructions is the method's
   "project URL". The editor fetches it before you run and gives
   you the page text in <researched_pages>; a page that could not
   be read says why. Research only what you are given there, and
   never claim to have read a page you were not given.

5. Revisions. When the request carries <current_version>, the
   instruction revises it: change what the instruction asks and
   keep everything else word for word. The current version is
   what the editor holds now, including the freelancer's own
   edits; keep their wording unless the instruction asks for a
   change. An instruction to start over writes from the posting
   and the profile, not from the current version.
   <earlier_instructions> led to the current version, oldest
   first, and still apply unless the new instruction overrides
   them. With no current version, write the first draft; an empty
   instruction means "write the proposal".

6. Screening questions. Answer each question in
   <screening_questions>, in order, in the same voice: short,
   specific, first person, grounded in the profile, with the same
   truth rule as the spike. Where an honest answer needs a fact
   the material does not hold (a link, a figure, a date), write
   the answer around a bracketed placeholder such as
   [link to the repo] rather than inventing it. A question that
   asks for rate or availability is the post asking; answer it
   from the profile, or with a placeholder.

7. Questions for the freelancer. `questions` holds at most two
   short questions whose answers would make the next version
   stronger: mostly the real project, figure or link the spike
   needed and did not have. The freelancer answers them in their
   next instruction. Empty when the material was enough.

8. Output. Reply with the JSON object the schema describes and
   nothing else. `cover_letter` is the text pasted into Upwork's
   cover letter box: prose paragraphs separated by blank lines,
   the method's bold (**like this**) the only markup, no greeting
   line or sign-off. `change_note` takes the place of any remark
   to the freelancer.
"""


def _system() -> list[SystemBlock]:
    # Byte-frozen: nothing is interpolated, so the whole prefix is one cache hit.
    method = PROMPT_PATH.read_text(encoding="utf-8")
    return [SystemBlock(method), SystemBlock(CONTRACT, cache="1h")]


SYSTEM = _system()

DOCUMENT = obj(
    {
        "read": obj(
            {
                "fear": text("What the client is actually afraid of, in one line."),
                "anchor": text("The specific stack, tool or feature they called out."),
                "outcome": text("The business result or experience they are chasing."),
                "mirror": text("The word or phrase they repeated or emphasised, quoted."),
            }
        ),
        "spike": obj(
            {
                "name": text("The project's name as the letter gives it."),
                "basis": one_of(
                    ["profile", "instructions", "plan"],
                    "profile: a project from the freelancer's material; instructions: one "
                    "the instructions named or linked; plan: no real project fit, so the "
                    "spike is the approach to this client's build.",
                ),
                "source": text(
                    "What it was drawn from (the portfolio item, role or link), in a few "
                    "words. Empty for a plan."
                ),
            }
        ),
        "cover_letter": text("The letter, paragraphs separated by blank lines."),
        "answers": array(
            obj({"question": text("Copied exactly."), "answer": text()}),
            "One per screening question, in order. Empty when the posting has none.",
        ),
        "questions": strings("At most two questions for the freelancer. Empty when none."),
        "change_note": text(
            "One sentence for the freelancer. On a first draft, what the letter leads "
            "with; on a revision, what changed and what was kept."
        ),
    }
)


# --- the turn -------------------------------------------------------------------


def write_turn(
    *,
    job: FreelanceJob,
    profile: FreelancerProfile | None,
    work_history: list[dict],
    screening_questions: list[str],
    pages: list[Page],
    history: list[str],
    current: dict | None,
    instruction: str,
) -> str:
    parts = [f"<posting>\n{posting_text(job)}\n</posting>"]
    if screening_questions:
        listed = "\n".join(f"{n}. {q}" for n, q in enumerate(screening_questions, start=1))
        parts.append(f"<screening_questions>\n{listed}\n</screening_questions>")
    parts.append(f"<freelancer>\n{_freelancer_text(profile, work_history)}\n</freelancer>")
    if pages:
        parts.append("<researched_pages>\n" + "\n\n".join(_page_text(p) for p in pages) + "\n</researched_pages>")
    if history:
        earlier = "\n\n".join(f"{n}. {t}" for n, t in enumerate(history, start=1))
        parts.append(f"<earlier_instructions>\n{earlier}\n</earlier_instructions>")
    if current is not None:
        parts.append(
            "<current_version>\n" + json.dumps(current, ensure_ascii=False, indent=1) + "\n</current_version>"
        )
    parts.append(f"<instruction>\n{instruction}\n</instruction>")
    return "\n\n".join(parts)


def posting_text(job: FreelanceJob) -> str:
    client = job.client or {}
    lines = [f"Title: {job.title}"]
    terms = [
        _budget(job),
        job.experience_level,
        job.duration_label,
        job.workload,
    ]
    if any(terms):
        lines.append("Terms: " + " · ".join(t for t in terms if t))
    if job.category or job.subcategory:
        lines.append("Category: " + " / ".join(c for c in (job.category, job.subcategory) if c))
    if job.skills:
        lines.append("Skills: " + ", ".join(job.skills))
    facts = [
        client.get("company_name"),
        client.get("industry"),
        client.get("company_size") and f"{client['company_size']} people",
        ", ".join(c for c in (client.get("city"), client.get("country")) if c) or None,
        client.get("total_spent_display") and f"{client['total_spent_display']} spent",
        client.get("total_hires") is not None and f"{client['total_hires']} hires",
        client.get("hire_rate_percent") is not None and f"{client['hire_rate_percent']:g}% hire rate",
        client.get("feedback") is not None and f"{client['feedback']:g} rating",
        client.get("payment_verified") and "payment verified",
        client.get("member_since") and f"member since {client['member_since']}",
    ]
    if any(facts):
        lines.append("Client: " + " · ".join(str(f) for f in facts if f))
    if job.total_applicants is not None:
        lines.append(f"Proposals so far: up to {job.total_applicants}")
    lines.append(f"Description:\n{(job.description or '').strip() or '(none captured)'}")
    return "\n".join(lines)


def _budget(job: FreelanceJob) -> str | None:
    currency = job.budget_currency or "USD"
    if job.job_type is FreelanceJobType.HOURLY:
        low, high = job.hourly_min, job.hourly_max
        if low is not None and high is not None:
            return f"Hourly {float(low):g}-{float(high):g} {currency}/hr"
        if low is not None or high is not None:
            return f"Hourly {float(low if low is not None else high):g} {currency}/hr"
        return "Hourly"
    if job.job_type is FreelanceJobType.FIXED:
        return f"Fixed {float(job.budget_amount):g} {currency}" if job.budget_amount is not None else "Fixed price"
    return None


def _freelancer_text(profile: FreelancerProfile | None, work_history: list[dict]) -> str:
    if profile is None:
        return "(No profile. Write from the instructions alone, and ask for the material in `questions`.)"
    material = ProfileMaterial.model_validate(
        {
            "title": profile.title,
            "overview": profile.overview,
            "hourly_rate": float(profile.hourly_rate) if profile.hourly_rate is not None else None,
            "skills": list(profile.skills or []),
            "portfolio": [p for p in profile.portfolio or [] if isinstance(p, dict)],
            "specialized_profiles": [p for p in profile.specialized_profiles or [] if isinstance(p, dict)],
            "raw_profile_markdown": profile.raw_profile_markdown,
        }
    )
    lines = [f"Name: {profile.name}", material_text(material)]
    if work_history:
        lines.append("Work history:")
        for entry in work_history:
            head = " · ".join(
                str(entry.get(k) or "").strip() for k in ("role", "company", "duration") if entry.get(k)
            )
            lines.append(f"- {head}")
            if entry.get("story"):
                lines.append(str(entry["story"]).strip())
    return "\n".join(lines)


def _page_text(page: Page) -> str:
    if page.problem:
        return f'<page url="{page.url}" unreadable="{page.problem}" />'
    title = f' title="{page.title}"' if page.title else ""
    return f'<page url="{page.url}"{title}>\n{page.text}\n</page>'


# --- the reply ------------------------------------------------------------------


def document(data: dict, screening_questions: list[str]) -> dict:
    """The reply as stored, with one answer per screening question, in order.

    The letter and answers are pasted into Upwork's plain-text boxes, so the
    model's markdown is turned into the Unicode styling those boxes can show.
    """
    # The model copies a question loosely, so an answer is found by its
    # question's words, else by its place in the list it was asked in.
    replies = data["answers"]
    by_words = {_words(a["question"]): a["answer"] for a in replies if _words(a["question"])}
    answers = []
    for index, question in enumerate(screening_questions):
        fallback = replies[index]["answer"] if index < len(replies) else ""
        reply = by_words.get(_words(question), fallback).strip()
        answers.append({"question": question, "answer": clip(from_markdown(reply), 8000, keep_lines=True)})
    return {
        "cover_letter_markdown": clip(from_markdown(data["cover_letter"]), 40_000, keep_lines=True),
        "answers": answers,
        "read": {k: v.strip() for k, v in data["read"].items()},
        "spike": {k: v.strip() for k, v in data["spike"].items()},
        "questions": [q.strip() for q in data["questions"] if q.strip()][:2],
        "change_note": data["change_note"].strip(),
    }


def _words(question: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", question.lower()))


# --- the bid --------------------------------------------------------------------


def bid(job: FreelanceJob, profile: FreelancerProfile | None) -> tuple[FreelanceJobType | None, float | None, str]:
    """The profile's rate kept inside the posting's range, or the posting's fixed budget."""
    rate = float(profile.hourly_rate) if profile and profile.hourly_rate is not None else None
    currency = job.budget_currency or "USD"
    if job.job_type is FreelanceJobType.HOURLY:
        low = float(job.hourly_min) if job.hourly_min is not None else None
        high = float(job.hourly_max) if job.hourly_max is not None else None
        if rate is None:
            return FreelanceJobType.HOURLY, high or low, currency
        if high is not None and rate > high:
            return FreelanceJobType.HOURLY, high, currency
        if low is not None and rate < low:
            return FreelanceJobType.HOURLY, low, currency
        return FreelanceJobType.HOURLY, rate, currency
    if job.job_type is FreelanceJobType.FIXED:
        budget = float(job.budget_amount) if job.budget_amount is not None else None
        return FreelanceJobType.FIXED, budget, currency
    return None, rate, currency


def connects(job: FreelanceJob) -> int | None:
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
