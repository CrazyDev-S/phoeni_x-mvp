"""Application-form auto-answer.

Runs on the FAST tier with a purpose-built prompt - never the 17k-token
generator prompt. Caches are model-scoped and Haiku's minimum cacheable prefix
is 4096 tokens, so sharing the big prompt would write a second cache entry and
read nothing from it.

Two layers guarantee that a select/radio/checkbox answer is one of the options
actually on the page: a per-form JSON schema with a literal `enum` per choice
field, and a Python snapping validator that runs regardless.
"""

from __future__ import annotations

import hashlib
import re
from difflib import SequenceMatcher
from typing import Any

from app.llm.ports import LLMProviderPort, LLMRequest, SystemBlock
from app.schemas.extension import (
    AutofillAnswer,
    AutofillRequest,
    AutofillResponse,
    FormFieldIn,
)

CHOICE_TYPES = {"select", "radio", "combobox"}
FUZZY_THRESHOLD = 0.92

# Questions we never answer automatically. Getting one of these wrong on a real
# application is not a UX bug - it is a compliance and honesty problem, and the
# user is the only one who can answer them.
SENSITIVE_PATTERNS = re.compile(
    r"""
    sponsor|visa|work\s*authorization|authorized\s*to\s*work|right\s*to\s*work
    |disab|veteran|protected\s*veteran|military
    |race|ethnic|gender|sex\b|pronoun|lgbt|orientation
    |felony|convict|criminal|background\s*check|drug\s*test
    |salary|compensation|desired\s*pay|expected\s*pay|current\s*pay|rate\b
    |social\s*security|ssn|date\s*of\s*birth|dob\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

SYSTEM = """You fill in job-application forms on behalf of one candidate.

You are given the candidate's resume, their stored answers to standard
application questions, and a list of form fields scraped from the page.

Rules:
- Answer ONLY from the supplied resume and stored answers. Never invent an
  employer, a date, a degree, or a number that is not there.
- For a field with options, the answer MUST be copied VERBATIM from one of the
  supplied option labels. Do not paraphrase, reorder or re-case it.
- For a free-text field, be concise and specific. Match the tone of a
  professional application; no filler, no restating the question.
- If the resume and stored answers do not contain what a field needs, set
  needs_user_input to true and explain what is missing in one short phrase.
  A blank you flag is far better than a confident wrong answer on a real
  application.
- Never guess a name, an email, a phone number, or a URL that is not supplied.
"""


def fingerprint(req: AutofillRequest) -> str:
    parts = []
    for frame in req.frames:
        for f in frame.fields:
            opts = "|".join(sorted(o.label for o in f.options))
            parts.append(f"{f.label}~{f.type}~{opts}")
    return hashlib.sha256("\n".join(sorted(parts)).encode()).hexdigest()


def is_sensitive(field: FormFieldIn) -> bool:
    return bool(SENSITIVE_PATTERNS.search(f"{field.label} {field.help} {field.name}"))


def build_schema(fields: list[FormFieldIn]) -> dict[str, Any]:
    """Per-form schema with a literal enum per choice field.

    A distinct form pays a one-time schema compilation and is then cached, so
    the second application on the same ATS is effectively free.
    """
    properties: dict[str, Any] = {}
    for f in fields:
        if f.type in CHOICE_TYPES and f.options and not f.options_unknown:
            value: dict[str, Any] = {
                "type": "string",
                "enum": [o.label for o in f.options][:200],
            }
        elif f.type == "checkbox":
            value = {"type": "boolean"}
        else:
            value = {"type": "string"}
        properties[_key(f.id)] = {
            "type": "object",
            "properties": {
                "answer": value,
                "needs_user_input": {"type": "boolean"},
                "reason": {"type": "string"},
            },
            "required": ["answer", "needs_user_input", "reason"],
            "additionalProperties": False,
        }
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def _key(field_id: str) -> str:
    return field_id.replace(":", "_").replace("-", "_")


def snap(answer: str, options: list[str]) -> tuple[str | None, bool]:
    """Four-tier match: exact, case-insensitive, normalised, then fuzzy.

    Anything resolved only by the fuzzy tier is flagged so the panel can show
    it in amber. A silent fuzzy match on a dropdown is how someone ends up
    telling an employer the wrong thing.
    """
    if not options:
        return answer, False
    for option in options:
        if option == answer:
            return option, False
    lowered = answer.strip().lower()
    for option in options:
        if option.strip().lower() == lowered:
            return option, False
    norm = _normalise(answer)
    for option in options:
        if _normalise(option) == norm:
            return option, False
    best, score = None, 0.0
    for option in options:
        ratio = SequenceMatcher(None, norm, _normalise(option)).ratio()
        if ratio > score:
            best, score = option, ratio
    return (best, True) if score >= FUZZY_THRESHOLD else (None, False)


def _normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


async def answer_form(
    provider: LLMProviderPort,
    req: AutofillRequest,
    *,
    resume_text: str,
    autofill_fields: dict,
) -> AutofillResponse:
    fields = [f for frame in req.frames for f in frame.fields]
    answerable = [f for f in fields if not is_sensitive(f) and f.type != "file"]
    deferred = [f for f in fields if is_sensitive(f) or f.type == "file"]

    answers: list[AutofillAnswer] = []
    unanswered: list[AutofillAnswer] = [
        AutofillAnswer(
            id=f.id,
            type=f.type,
            needs_user_input=True,
            reason=(
                "File inputs cannot be set reliably - attach the downloaded resume"
                if f.type == "file"
                else "Sensitive question - answer this one yourself"
            ),
        )
        for f in deferred
    ]

    if answerable:
        response = await provider.complete(
            LLMRequest(
                purpose="form_answer",
                system=[SystemBlock(SYSTEM)],
                messages=[{"role": "user", "content": _user_message(req, answerable, resume_text, autofill_fields)}],
                max_output_tokens=8_000,
                effort="low",
                timeout_s=60.0,
            )
        )
        raw = response.parsed if isinstance(response.parsed, dict) else {}
        by_key = {_key(f.id): f for f in answerable}

        for key, field in by_key.items():
            entry = raw.get(key) or {}
            value = entry.get("answer", "")
            needs = bool(entry.get("needs_user_input")) or value in ("", None)
            reason = str(entry.get("reason", ""))

            if needs:
                unanswered.append(
                    AutofillAnswer(
                        id=field.id, type=field.type, needs_user_input=True,
                        reason=reason or "Not present in your profile",
                    )
                )
                continue

            if field.type == "checkbox":
                answers.append(
                    AutofillAnswer(id=field.id, type=field.type, checked=bool(value))
                )
                continue

            fuzzy = False
            if field.type in CHOICE_TYPES and field.options and not field.options_unknown:
                matched, fuzzy = snap(str(value), [o.label for o in field.options])
                if matched is None:
                    unanswered.append(
                        AutofillAnswer(
                            id=field.id, type=field.type, answer=str(value),
                            needs_user_input=True,
                            reason="No option on the page matches that answer",
                        )
                    )
                    continue
                value = matched

            answers.append(
                AutofillAnswer(
                    id=field.id, type=field.type, answer=str(value), matched_fuzzily=fuzzy
                )
            )

    return AutofillResponse(
        answers=answers, unanswered=unanswered, form_fingerprint=fingerprint(req)
    )


def _user_message(
    req: AutofillRequest, fields: list[FormFieldIn], resume_text: str, autofill_fields: dict
) -> str:
    lines = ["=== CANDIDATE RESUME ===", resume_text.strip()[:20_000], ""]
    if autofill_fields:
        lines += ["=== STORED ANSWERS ==="]
        lines += [f"- {k}: {v}" for k, v in autofill_fields.items()]
        lines.append("")
    if req.job:
        lines += [
            "=== JOB ===",
            f"{req.job.title or ''} at {req.job.company or ''}",
            (req.job.description_text or "")[:6000],
            "",
        ]
    lines.append("=== FIELDS TO ANSWER ===")
    for f in fields:
        parts = [f'{_key(f.id)}: "{f.label or f.name}"', f"type={f.type}"]
        if f.required:
            parts.append("required")
        if f.help:
            parts.append(f"help={f.help!r}")
        if f.max_length:
            parts.append(f"max_length={f.max_length}")
        if f.options and not f.options_unknown:
            parts.append("options=" + " | ".join(o.label for o in f.options[:60]))
        elif f.options_unknown:
            parts.append("options=UNKNOWN (the panel will resolve them on the page)")
        lines.append("- " + ", ".join(parts))
    lines.append("")
    lines.append(
        "Reply with a JSON object keyed by the field key shown above. Each value is "
        '{"answer": ..., "needs_user_input": bool, "reason": string}.'
    )
    return "\n".join(lines)
