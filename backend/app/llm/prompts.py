"""Prompt assembly.

The system prefix is ONE frozen string: the generator prompt verbatim plus an
output contract. Nothing is interpolated into it - not the date, not the mode,
not the user's name. Interpolating anything here invalidates the whole ~16k
token prefix on every request, which is the most common and most expensive
caching regression. Volatile values go in the first user message instead.
"""

from __future__ import annotations

import functools
from pathlib import Path

PROMPT_VERSION = "v1"
PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"

# Replaces the prompt's own 4-block text output. Appended INSIDE the frozen
# prefix, so it costs nothing extra and invalidates nothing.
OUTPUT_CONTRACT = """
===============================================================================
                       OUTPUT CONTRACT (v1) - OVERRIDES §OUTPUT FORMAT
===============================================================================

This deployment consumes your work programmatically. The reasoning above is
unchanged and still governs every decision; only the delivery format changes.

**The four blocks are delivered across three separate turns, not in one reply.**
Produce exactly what the current turn asks for, and nothing else. Do not
restate a previous block, do not add commentary, do not wrap output in prose.

TURN 1 - BLOCK 1, the scenario ledger, as JSON matching the supplied schema.
TURN 2 - BLOCK 2, the resume, as Resume Markdown v1 - the exact
         grammar below, and nothing else. No code fence, no preamble.
TURN 3 - BLOCK 4, flags and next actions, as JSON matching the supplied schema.

BLOCK 3 (the ATS match report) is NOT yours to write. Its counts and
percentages are computed deterministically from your Phase 1/4 keyword plan and
the finished resume, so they can never disagree with the document. Supply the
keyword plan in Turn 1 and the arithmetic is handled for you.

-------------------------------------------------------------------------------
CANONICAL RESUME MARKDOWN (Resume Markdown v1) - the exact grammar for TURN 2
-------------------------------------------------------------------------------

A parser reads this back to build the .docx, so there is exactly one valid way
to write each construct. A document that does not parse is rejected.

    ---
    name: Full Name
    title: Target Job Title
    location: City, Country
    work_preference: Remote
    timezone_note: UTC+7 (20:00-01:00 ICT / US Eastern coverage)
    phone: +1 727 732 3633
    email: name@example.com
    links:
      - linkedin.com/in/handle
    availability: Available with 4 weeks' notice
    ---

    ## PROFESSIONAL SUMMARY

    One paragraph. No bullets, no line breaks inside it.

    ## TECHNICAL SKILLS

    - **Label One**: item, item, item
    - **Label Two**: item, item, item
    - **Label Three**: item, item, item
    - **Label Four**: item, item, item

    ## PROFESSIONAL EXPERIENCE

    ### Company Name - City, Country (On-site)
    **Mon YYYY - Mon YYYY**
    > One-line context: division, product, team shape.

    #### Senior Title - Mon YYYY - Mon YYYY
    *Promoted from Prior Title after ...*

    - Bullet.
    - Bullet.

    #### Prior Title - Mon YYYY - Mon YYYY

    - Bullet.

    ## EDUCATION

    ### B.Eng. in Computer Science and Technology
    University Name - City, Country / 2018

    ## LANGUAGES

    - Language - Proficiency

Rules the parser enforces:

- Frontmatter is YAML between `---` fences. `name`, `title` and `location` are
  required; every other key is optional but must be omitted rather than blank.
- Section headings are `## ` plus one of, in this order:
  PROFESSIONAL SUMMARY, TECHNICAL SKILLS, PROFESSIONAL EXPERIENCE,
  SELECTED PROJECTS, EDUCATION, CERTIFICATIONS, LANGUAGES.
  Never invent a heading. Omit a section entirely rather than leave it empty.
- The company line is `### {Company} {EM-DASH} {City}, {Country} ({Mode})`,
  where the separator is an em dash and Mode is On-site, Hybrid or Remote.
  A company whose own name contains brackets is fine - the work mode is the
  LAST parenthetical on the line.
- The line directly after a company is its total tenure in bold:
  `**Mon YYYY {EN-DASH} Mon YYYY**`, or `**Mon YYYY {EN-DASH} Present**`.
  This line is REQUIRED whenever a company has two title blocks.
- The context line is a blockquote, `> text`, and is one line.
- A title block is `#### {Title} {MIDDLE-DOT} {Mon YYYY} {EN-DASH} {Mon YYYY|Present}`.
  Newest first. At most two per company. Only the newest may say Present.
- A promotion note is a single italic line `*text*` directly under its title.
- Bullets are `- text`, one achievement each.
- Dates are always `Mon YYYY` with a three-letter English month.

Separator characters, exactly: em dash U+2014 between company and location and
between institution and location; en dash U+2013 inside every date range;
middle dot U+00B7 between a title and its dates, and before an education year.

-------------------------------------------------------------------------------
STANDING RULES THAT ARE MACHINE-CHECKED AFTER YOU REPLY
-------------------------------------------------------------------------------

These are verified in code, not taken on trust. A violation is returned to you
for repair, so getting them right the first time saves a round trip:

1. Zero placeholder tokens. No `X%`, `[N]`, `<metric>`, `TBD`, and none of the
   banned vague words: several, various, numerous, significant, substantial,
   multiple, many, a number of.
2. Exactly four skill categories.
3. At most three employers.
4. At least one company shows an internal promotion (two title blocks).
5. Role months sum to the years claimed in the summary, within a quarter.
6. No unexplained employment gap over three months.
7. Companies in reverse-chronological order; no end date in the future.
8. In Mode B with strict dossiers on, every company named in the resume has a
   dossier in your Turn 1 ledger carrying at least one source URL.
"""


@functools.lru_cache(maxsize=1)
def frozen_system_prompt() -> str:
    """The byte-stable cached prefix. Never interpolate into this."""
    generator = (PROMPTS_DIR / f"resume_generator_{PROMPT_VERSION}.md").read_text(
        encoding="utf-8"
    )
    return generator.rstrip() + "\n\n" + OUTPUT_CONTRACT.strip() + "\n"


# --- per-turn user messages ------------------------------------------------

def scenario_turn(
    *,
    mode: str,
    today: str,
    base_country: str,
    target_title: str,
    job_description: str | None,
    candidate_profile: str | None,
    extra_instructions: str | None,
    allow_real_company_names: bool,
    research_enabled: bool = False,
    skill_count: int | None = None,
) -> str:
    """Turn 1. Everything volatile lives here, never in the system prefix."""
    parts = [
        (
            "PHASE 1-3. Decode the inputs, build the career scenario, and run "
            "the 12-check validation gate. Reply with BLOCK 1 as JSON only."
        ),
        "",
        f"TODAY: {today}",
        f"MODE: {'B (constructed)' if mode == 'constructed' else 'A (grounded)'}",
        "",
        "CONSTRAINTS:",
        (
            f"- Base country: {base_country}. This OVERRIDES the prompt's China "
            f"default. Use {base_country}'s own universities, academic calendar, "
            "graduation month, work-mode timeline and industry events."
        ),
        f"- Target title: {target_title}",
    ]

    if research_enabled:
        parts.append(
            "- You have a web_search tool. Use it. Section 2.3 Step 1 is in "
            "force: a company may not appear in the ledger or the resume until "
            "its dossier is complete, and every field is verified by search - "
            "founding date and operating status, the specific office and when "
            "it opened, headcount in the claimed year, the level ladder and the "
            "public job title of that era. Run at least three searches per "
            "company BEFORE accepting it. A field you cannot verify kills the "
            "company: discard it and pick another rather than guessing or "
            "softening it to 'approximately'. Record the URLs you actually "
            "retrieved in each dossier's sources array - a dossier with no "
            "source is rejected downstream and the whole resume is held back."
        )
    elif not allow_real_company_names and mode == "constructed":
        parts.append(
            "- Company research is unavailable, so do NOT name real employers. "
            "Use archetype descriptions instead (e.g. 'a ~200-person Series B "
            "payments company'), framed as a template the candidate replaces "
            "with their own history."
        )
    if skill_count:
        parts.append(
            f"- The candidate asked for roughly {skill_count} technologies "
            "overall, still distributed across exactly four categories."
        )
    if extra_instructions:
        parts += ["", "ADDITIONAL USER INSTRUCTIONS:", extra_instructions.strip()]
    if candidate_profile:
        parts += ["", "CANDIDATE_PROFILE:", candidate_profile.strip()]
    else:
        parts += ["", "CANDIDATE_PROFILE: (none supplied)"]
    if job_description:
        parts += ["", "JOB_DESCRIPTION:", job_description.strip()]
    else:
        parts += [
            "",
            (
                "JOB_DESCRIPTION: (none supplied - this is a story-driven "
                "generation; infer the ideal target role from the title and "
                "instructions above)"
            ),
        ]
    return "\n".join(parts)


DRAFT_TURN = (
    "PHASE 4-5. The ledger above is validated. Draft the resume now.\n\n"
    "Reply with BLOCK 2 ONLY, as Resume Markdown v1 exactly as the "
    "output contract specifies. Start with the `---` frontmatter fence and end "
    "with the last line of the last section. No code fence, no commentary."
)

FLAGS_TURN = (
    "BLOCK 4. Reply with JSON only: every estimated figure and how it was "
    "derived, JD requirements the resume does not cover, facts the candidate "
    "must verify before sending, and the interview questions this timeline "
    "most invites."
)


def repair_turn(findings: list[dict], raw_error: str | None = None) -> str:
    """One bounded repair turn naming the exact failures."""
    lines = [
        (
            "The document failed machine validation. Fix ONLY these issues and "
            "re-emit the complete resume in Resume Markdown v1. Change nothing else."
        ),
        "",
    ]
    if raw_error:
        lines += [f"PARSE ERROR: {raw_error}", ""]
    for f in findings:
        lines.append(f"- [{f['rule_id']}] {f['message']}")
        if f.get("excerpt"):
            lines.append(f"    in: {f['excerpt']}")
        if f.get("suggested_fix"):
            lines.append(f"    fix: {f['suggested_fix']}")
    return "\n".join(lines)


def tailor_turn(
    *, base_resume_md: str, job_description: str, today: str, company: str | None
) -> str:
    return "\n".join(
        [
            (
                "Tailor the existing resume below to the job description. Keep "
                "every employer, title and date exactly as they are - this is a "
                "reframing, not a new scenario. Re-prioritise skills, rewrite "
                "bullets to carry the job's must-have terminology in "
                "load-bearing sentences, and retarget the summary and header "
                "title."
            ),
            "",
            f"TODAY: {today}",
            f"TARGET COMPANY: {company or 'unstated'}",
            "",
            "Reply with BLOCK 2 ONLY: the complete tailored resume in Resume Markdown v1.",
            "",
            "=== EXISTING RESUME (Resume Markdown v1) ===",
            base_resume_md.strip(),
            "",
            "=== JOB DESCRIPTION ===",
            job_description.strip(),
        ]
    )


def instruction_turn(*, base_resume_md: str, instructions: str, today: str) -> str:
    return "\n".join(
        [
            (
                "Apply the user's edit instructions to the resume below. Make "
                "only the changes asked for; leave everything else identical."
            ),
            "",
            f"TODAY: {today}",
            "",
            "Reply with BLOCK 2 ONLY: the complete updated resume in Resume Markdown v1.",
            "",
            "=== INSTRUCTIONS ===",
            instructions.strip(),
            "",
            "=== EXISTING RESUME (Resume Markdown v1) ===",
            base_resume_md.strip(),
        ]
    )
