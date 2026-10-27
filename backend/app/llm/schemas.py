"""Structured-output schemas, written as the JSON Schema the provider receives.

Each one goes to the SDK exactly as written here - nothing generates or
rewrites it on the way - so what is on this page is what the model reads:
field names, a description where the name alone does not say what goes in
it, and an enum where the answer is one of a few words.

Both providers' strict modes want every property listed as required and no
additional properties; ``obj`` writes that, so the literals stay readable.
Constraints the providers ignore (``minItems``, ``maxLength``, ``pattern``)
are left out rather than implied. Real enforcement is
``remote/validation/rules.py``.

Replies come back as plain dicts. ``shape`` fills any field a reply left out
or filled with the wrong type, so code reads ``ledger["keyword_plan"]``
without guarding every key.
"""

from __future__ import annotations

from typing import Any


def text(description: str = "") -> dict:
    return _described({"type": "string"}, description)


def integer(description: str = "") -> dict:
    return _described({"type": "integer"}, description)


def boolean(description: str = "") -> dict:
    return _described({"type": "boolean"}, description)


def one_of(values: list[str], description: str = "") -> dict:
    return _described({"type": "string", "enum": values}, description)


def array(items: dict, description: str = "") -> dict:
    return _described({"type": "array", "items": items}, description)


def strings(description: str = "") -> dict:
    return array({"type": "string"}, description)


def obj(properties: dict[str, dict], description: str = "") -> dict:
    return _described(
        {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        },
        description,
    )


def _described(schema: dict, description: str) -> dict:
    return {**schema, "description": description} if description else schema


def shape(schema: dict, value: Any) -> Any:
    """``value`` in the form ``schema`` describes: every property present,
    each of its declared type, and nothing else. What a reply left out, or
    filled with the wrong type, reads as empty."""
    kind = schema.get("type")
    if kind == "object":
        value = value if isinstance(value, dict) else {}
        return {key: shape(sub, value.get(key)) for key, sub in schema["properties"].items()}
    if kind == "array":
        return [shape(schema["items"], v) for v in value] if isinstance(value, list) else []
    if kind == "string":
        return value if isinstance(value, str) else ""
    if kind == "integer":
        return _whole(value)
    if kind == "boolean":
        return value if isinstance(value, bool) else False
    return value


def _whole(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return 0


# The model's way to say "this cannot be done". Without it a model that will
# not build the resume has to fill the schema anyway, and refuses later in
# prose - where it reads as a parse error.
INPUT_PROBLEM = text(
    "Empty, unless the input cannot or should not become a resume. Then the "
    "reason, in one or two plain sentences, and nothing else filled."
)

KEYWORD_PLAN = array(
    obj(
        {
            "keyword": text("The term exactly as the posting spells it."),
            "priority": one_of(
                ["MUST", "NICE"],
                "MUST: required, essential, repeated, or in the title. "
                "NICE: preferred, bonus or plus.",
            ),
            "planned_sections": array(
                one_of(["Summary", "Skills", "Experience"]),
                "Where it lands. Every MUST goes in Skills and Experience.",
            ),
        }
    ),
    "Every hard skill, language, framework, tool, methodology, certification "
    "and domain term the work requires.",
)


# --- BLOCK 1: the scenario ledger -------------------------------------------

# Field for field the ledger of §2.6 of the generator prompt, which defines
# what each one holds.
DOSSIER = obj(
    {
        "employer": text(),
        "founded": text(),
        "status": text(),
        "office": text(),
        "headcount_at_hire": text(),
        "sector": text(),
        "ladder": text(),
        "public_title": text(),
        "culture": text(),
        "employment_start": text(),
        "employment_end": text(),
        "work_mode": text(),
        "checks": text(),
        "reason_for_leaving": text(),
        "sources": strings("URLs actually retrieved. Empty means model recall only."),
        "verification": one_of(["verified_external", "asserted_by_user", "unverified"]),
    }
)

GATE_CHECK = obj(
    {
        "id": integer(),
        "name": text(),
        "result": one_of(["PASS", "FAIL"]),
        "evidence": text(),
    }
)

SCENARIO_LEDGER = obj(
    {
        "mode": text(),
        # Early in the schema so it is decided before anything else is written.
        "input_problem": INPUT_PROBLEM,
        "base_location": text(),
        "current_location": text(),
        "relocations": text(),
        "remote_pitch": text(),
        "education": text(),
        "career_start": text(),
        "total_years": integer(),
        "job_required_years": integer(),
        "size_arc": text(),
        "industry_arc": text(),
        "employer_country_arc": text(),
        "engagement_structure": text(),
        "dossiers": array(DOSSIER),
        "gaps": text(),
        "promotions_shown": text(),
        "world_anchors_used": text(),
        "life_events_used": text(),
        "stack_era_checks": text(),
        "positioning_line": text(),
        "evidence_spine": strings(),
        "keyword_plan": KEYWORD_PLAN,
        # Self-reported. Stored and displayed as such - the mechanisable subset
        # is independently re-verified in Python.
        "gate": array(GATE_CHECK),
    },
    "BLOCK 1, the scenario ledger, as §2.6 of the prompt defines it.",
)


# --- stage 1: the posting's criteria ----------------------------------------

JOB_CRITERIA = obj(
    {
        "input_problem": text(
            "Empty, unless the text is not a job posting (a captcha, a login "
            "wall, page code). Then the reason in one plain sentence, and "
            "nothing else filled."
        ),
        "title": text("The role's title as the posting gives it, without posting or platform words."),
        "standard_title": text("The industry-standard equivalent of title."),
        "role_family": text("e.g. Backend, Data Engineering, Platform/DevOps."),
        "seniority": text("IC, lead or manager, and the level."),
        "required_years": integer("Minimum years of experience asked for; 0 if none."),
        "core_stack": strings("The two to six technologies the role is built on."),
        "keyword_plan": KEYWORD_PLAN,
        "essential_experience": strings(
            "Experience the hire must already have, one item each, phrased as "
            "work done, with the posting's scale figures."
        ),
        "domain": text("The industry."),
        "domain_terms": strings("The domain vocabulary the posting uses."),
        "education": text("The degree required or preferred; empty if none."),
        "certifications": strings("Certifications the posting names."),
        "spoken_languages": strings("Human languages required, with the level."),
        "work_arrangement": text("Remote, hybrid or on-site; the timezone, hours or locations required."),
        "company_profile": text("The hiring company's size, stage, sector and market, without its name."),
        "hidden_priority": text("The one problem this hire exists to solve, inferred."),
        "spelling_locale": one_of(["US", "UK"], "From the posting's own spelling."),
    },
    "What the posting asks of the work. Nothing about the hiring platform or the application.",
)


# --- stage 3: research on the candidate's own history ------------------------

SOURCES = strings("URLs actually retrieved. Empty when nothing was searched.")
VERIFICATION = one_of(
    ["verified_external", "model_recall"],
    "verified_external only when a retrieved source supports the entry.",
)
CONFLICTS = text("Where the history disagrees with the record. Reported, never fixed.")

COMPANY_RESEARCH = obj(
    {
        "employers": array(
            obj(
                {
                    "employer": text("Exactly as given."),
                    "legal_name": text("The official name, when it differs."),
                    "founded": text("Founding year."),
                    "status": text("Operating, acquired (by whom, when), renamed or closed."),
                    "office": text("The office in the candidate's city, and when it opened."),
                    "headcount": text("Approximate headcount in those years, with the year."),
                    "sector": text("What the company did then."),
                    "products": text("Flagship products, or the business unit the title points to."),
                    "stack_in_era": text(
                        "Technologies it is publicly known to have used then, "
                        "naming any of the target role's core stack among them."
                    ),
                    "ladder": text("Its level ladder and the public job titles it used then."),
                    "conflicts": CONFLICTS,
                    "sources": SOURCES,
                    "verification": VERIFICATION,
                }
            ),
            "One entry per employer given, in the order given.",
        )
    }
)

EDUCATION_RECORD = obj(
    {
        "found": boolean("False when the history states no education; then nothing else is filled."),
        "as_written": text("The institution exactly as the history writes it."),
        "institution": text("Its official English name."),
        "city": text("Where the institution, or the campus, is."),
        "country": text("The institution's country."),
        "degree": text("As the history states it, in the institution's own English wording."),
        "program_note": text("The program's official name, and whether it ran in the years stated."),
        "graduation": text("As the history states it (Mon YYYY or YYYY); empty if it does not."),
        "calendar": text("The usual program length and graduation month there."),
        "conflicts": CONFLICTS,
        "sources": SOURCES,
        "verification": VERIFICATION,
    }
)


# --- BLOCK 4: flags and interview prep --------------------------------------

FLAGS_REPORT = obj(
    {
        "estimated_figures": array(
            obj(
                {
                    "figure": text("Exactly as written in the resume."),
                    "where": text("The role or section."),
                    "derivation": text("What it measures and what it rests on."),
                    "how_to_reconstruct": text("How to re-derive or explain it when asked."),
                }
            ),
            "Every number in the resume.",
        ),
        "uncovered_requirements": array(
            obj(
                {
                    "requirement": text("As the job states it."),
                    "how_to_close": text(
                        "Real adjacent experience to point to, something to learn, "
                        "or a point for the cover letter."
                    ),
                }
            ),
            "Requirements of the job the resume does not cover.",
        ),
        "must_verify": strings(
            "Facts the candidate must confirm and be able to evidence before sending, one per item."
        ),
        "interview_probes": array(
            obj(
                {
                    "question": text("As an interviewer would ask it."),
                    "suggested_answer": text("A short outline built only from what the resume states."),
                }
            ),
            "The questions an interviewer is most likely to ask about this resume.",
        ),
        "notes": text("One to three sentences on the biggest risk and the strongest angle."),
    }
)
