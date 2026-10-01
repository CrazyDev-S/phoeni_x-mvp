"""Application-form auto-answer.

Answers come from three places, most certain first:

1. Contact details - name, email, phone, links, location, current role - are
   read straight off the linked resume, with the autofill profile on top. A
   model is never asked to copy an email address into an Email field.
2. A resume upload is answered with the linked resume; the panel attaches it.
3. Everything else goes to the FAST tier with a purpose-built prompt - never
   the 17k-token generator prompt. Caches are model-scoped and Haiku's minimum
   cacheable prefix is 4096 tokens, so sharing the big prompt would write a
   second cache entry and read nothing from it.

A select/radio answer is always one of the options actually on the page: a
Python snapping validator runs over every choice answer, whichever source it
came from.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from app.llm.provider import LLMError, LLMProviderPort, LLMRequest, SystemBlock
from app.schemas.extension import (
    AutofillAnswer,
    AutofillRequest,
    AutofillResponse,
    FormFieldIn,
)

CHOICE_TYPES = {"select", "radio", "combobox"}
# Long-form answers. A contact detail never belongs in one, however the
# question happens to mention an email.
PROSE_TYPES = {"textarea", "richtext"}
FUZZY_THRESHOLD = 0.92
DOCX_ACCEPTS = {
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/*",
    "*/*",
    "*",
}
UNREADABLE_REPLY = "The answer came back unreadable - press Re-scan to try again"

# Questions we never answer automatically. Getting one of these wrong on a real
# application is not a UX bug - it is a compliance and honesty problem, and the
# user is the only one who can answer them.
#
# The word boundaries are load-bearing: without them "corporate" and "accurate"
# read as a pay rate, "advisable" as a visa and "Essex" as a question about sex,
# and each of those fields was handed back to the user unanswered.
SENSITIVE_PATTERNS = re.compile(
    r"""
    sponsor|\bvisas?\b|work\s*authori[sz]ation|authori[sz]ed\s*to\s*work|right\s*to\s*work
    |\bdisab|\bveteran|\bmilitary
    |\brace\b|\bethnic|\bgender|\bsex\b|\bpronoun|\blgbt|sexual\s*orientation
    |\bfelony|\bconvict|\bcriminal|background\s*check|drug\s*test
    |\bsalary|\bcompensation|desired\s*pay|expected\s*pay|current\s*pay|\brate\b
    |social\s*security|\bssn\b|date\s*of\s*birth|\bdob\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

# The HTML standard's own autocomplete tokens, for the forms that set them.
AUTOCOMPLETE_FACTS = {
    "name": "full_name",
    "given-name": "first_name",
    "family-name": "last_name",
    "email": "email",
    "tel": "phone",
    "tel-national": "phone",
    "url": "website",
    "organization": "current_company",
    "organization-title": "current_title",
    "address-level2": "city",
    "country-name": "country",
}

# Someone else's details, never the candidate's. Anchored at the start of a
# word: "preferred" contains "referr" and "preference" contains "reference".
NOT_THE_CANDIDATE = re.compile(
    r"\b(referr|reference|emergency|manager|supervisor|recruiter)|\b(country|area)\s+code\b",
    re.IGNORECASE,
)
# A question, not a field name. Contact fields are named in a few words.
MAX_FACT_LABEL = 80


@dataclass(frozen=True)
class FactRule:
    fact: str
    pattern: re.Pattern[str]
    unless: re.Pattern[str] | None = None


def _rule(fact: str, pattern: str, unless: str | None = None) -> FactRule:
    return FactRule(
        fact,
        re.compile(pattern, re.IGNORECASE),
        re.compile(unless, re.IGNORECASE) if unless else None,
    )


# The first rule that matches decides, so the specific come before the
# general: "LinkedIn profile URL" is not a personal website.
FACT_RULES = [
    _rule("first_name", r"\b(first|given|preferred)\s*name\b|^first$"),
    _rule("last_name", r"\b(last|family)\s*name\b|\bsurname\b|^last$"),
    _rule("full_name", r"^(your\s+|candidate\s+|applicant\s+)?(full\s+)?(legal\s+)?name$"),
    _rule("email", r"\be-?mail\b"),
    _rule("phone", r"\b(phone|mobile|cell|telephone)\b"),
    _rule("linkedin", r"linked\s*-?in"),
    _rule("github", r"git\s*hub"),
    _rule("website", r"\b(portfolio|website|personal\s+(site|url|page)|blog)\b"),
    _rule(
        "current_company",
        r"\b(current|most\s+recent|present)\s+(company|employer|organi[sz]ation)\b",
    ),
    _rule("current_title", r"\b(current|most\s+recent|present)\s+(job\s+)?(title|role|position)\b"),
    # Total years only: "years of experience with React" is not the same number.
    _rule(
        "years_experience",
        r"\byears\s+of\s+(\w+\s+)?experience\b|\bhow\s+many\s+years\b",
        unless=r"\b(with|in|using)\b",
    ),
    _rule("city", r"^(current\s+)?city\b"),
    _rule("country", r"^(current\s+)?country(\s+of\s+residence)?$"),
    _rule(
        "location",
        r"^(current\s+|your\s+)?location\b|\bwhere\s+(are\s+you|do\s+you)\s+(currently\s+)?"
        r"(located|based|live)\b|\bcurrent\s+(location|address)\b",
        unless=r"relocat|prefer|willing|open\s+to|office",
    ),
]

RESUME_UPLOAD = re.compile(r"resume|résumé|\bcv\b|curriculum", re.IGNORECASE)
# Ashby's "autofill from resume" upload re-parses the file and overwrites the
# fields just filled, so it is left alone along with the uploads that are not a resume.
NOT_A_RESUME_UPLOAD = re.compile(
    r"cover|letter|transcript|portfolio|writing\s+sample|auto-?fill|\bparse", re.IGNORECASE
)

SYSTEM = """You fill in job-application forms on behalf of one candidate.

You are given the candidate's resume, their contact details, their stored
answers to standard application questions, and a list of form fields scraped
from the page.

Rules:
- Answer ONLY from the supplied resume, details and stored answers. Never
  invent an employer, a date, a degree, or a number that is not there.
- For a field with options, the answer MUST be copied VERBATIM from one of the
  supplied option labels. Do not paraphrase, reorder or re-case it.
- For a free-text field, be concise and specific. Match the tone of a
  professional application; no filler, no restating the question.
- If the supplied material does not contain what a field needs, set
  needs_user_input to true and explain what is missing in one short phrase.
  A blank you flag is far better than a confident wrong answer on a real
  application.
- Never guess a name, an email, a phone number, or a URL that is not supplied.
"""


@dataclass
class FormContext:
    """What a form is answered from."""

    resume_text: str = ""
    # None when no resume could be found; nothing is uploaded then.
    resume_name: str | None = None
    facts: dict[str, str] = field(default_factory=dict)
    # Facts the autofill profile supplied, rather than the resume.
    profile_facts: frozenset[str] = frozenset()
    autofill_fields: dict = field(default_factory=dict)
    notes: str | None = None


ModelFactory = Callable[[], Awaitable[LLMProviderPort]]


def fingerprint(req: AutofillRequest, context: str = "") -> str:
    """The cache key for a form's answers: its shape, and what answered it.

    Shape alone is not enough. The same Ashby form on two postings asks "why
    this company" of both, and replaying the first posting's answer on the
    second - or an answer from a resume since replaced - is wrong.
    """
    parts = []
    for frame in req.frames:
        for f in frame.fields:
            opts = "|".join(sorted(o.label for o in f.options))
            parts.append(f"{f.label}~{f.type}~{opts}")
    return hashlib.sha256(("\n".join(sorted(parts)) + "\n" + context).encode()).hexdigest()


def context_key(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


def is_sensitive(field: FormFieldIn) -> bool:
    return bool(SENSITIVE_PATTERNS.search(f"{field.label} {field.help} {field.name}"))


def fact_for(field: FormFieldIn) -> str | None:
    """Which candidate fact a field asks for, if it plainly asks for one."""
    label = field.label.strip()
    name = re.sub(r"[\W_]+", " ", field.name).strip()
    if len(label) > MAX_FACT_LABEL or NOT_THE_CANDIDATE.search(f"{label} {name}"):
        return None
    for token in field.autocomplete.lower().split():
        if token in AUTOCOMPLETE_FACTS:
            return AUTOCOMPLETE_FACTS[token]
    for text in (label, name):
        if not text:
            continue
        for rule in FACT_RULES:
            if rule.pattern.search(text) and not (rule.unless and rule.unless.search(text)):
                return rule.fact
    if field.type == "email":
        return "email"
    if field.type == "tel":
        return "phone"
    return None


def fact_answer(field: FormFieldIn, context: FormContext) -> AutofillAnswer | None:
    """A field answered directly from the candidate's facts, or None."""
    if field.type in PROSE_TYPES or field.type in ("checkbox", "file", "date"):
        return None
    fact = fact_for(field)
    value = context.facts.get(fact) if fact else None
    if not value:
        return None

    if field.type in CHOICE_TYPES:
        if field.options and not field.options_unknown:
            matched, fuzzy = snap(value, [o.label for o in field.options])
            # A near miss is the model's call to make, not a silent guess.
            if matched is None or fuzzy:
                return None
            value = matched
        elif not field.options_unknown:
            return None
    elif field.max_length and len(value) > field.max_length:
        return None

    return AutofillAnswer(
        id=field.id,
        type=field.type,
        label=field.label,
        answer=value,
        source="profile" if fact in context.profile_facts else "resume",
    )


def accepts_docx(accept: str) -> bool:
    tokens = {t.strip().lower() for t in accept.split(",") if t.strip()}
    return not tokens or bool(tokens & DOCX_ACCEPTS)


def upload_answer(field: FormFieldIn, context: FormContext) -> AutofillAnswer:
    """A file input: the linked resume where the form asks for one."""
    described = f"{field.label} {field.name}"
    if not RESUME_UPLOAD.search(described) or NOT_A_RESUME_UPLOAD.search(described):
        return _needs(field, "Attach this file yourself")
    if context.resume_name is None:
        return _needs(field, "Link or tailor a resume for this job, and it is attached for you")
    if not accepts_docx(field.accept):
        return _needs(field, f"This upload only takes {field.accept} - attach it yourself")
    return AutofillAnswer(
        id=field.id,
        type="file",
        label=field.label,
        answer="resume",
        reason=f"Attaches {context.resume_name}",
        source="resume",
    )


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


def _needs(field: FormFieldIn, reason: str, answer: str = "") -> AutofillAnswer:
    return AutofillAnswer(
        id=field.id,
        type=field.type,
        label=field.label,
        answer=answer,
        needs_user_input=True,
        reason=reason,
    )


def _key(field_id: str) -> str:
    return field_id.replace(":", "_").replace("-", "_")


async def answer_form(
    get_model: ModelFactory, req: AutofillRequest, *, context: FormContext
) -> AutofillResponse:
    """Answer every field on a form, or say why a field was left to the user.

    ``get_model`` is only called when some field needs the model, so a form of
    contact details fills even with no API key configured.
    """
    fields = [f for frame in req.frames for f in frame.fields]
    answers: list[AutofillAnswer] = []
    unanswered: list[AutofillAnswer] = []
    for_model: list[FormFieldIn] = []

    for f in fields:
        if f.type == "file":
            upload = upload_answer(f, context)
            (unanswered if upload.needs_user_input else answers).append(upload)
        elif is_sensitive(f):
            unanswered.append(_needs(f, "Sensitive question - answer this one yourself"))
        elif (direct := fact_answer(f, context)) is not None:
            answers.append(direct)
        else:
            for_model.append(f)

    complete = True
    if for_model:
        complete = await _ask_model(get_model, req, for_model, context, answers, unanswered)

    # The page is filled in this order, and dependents such as
    # country -> state -> city only work top to bottom.
    order = {f.id: i for i, f in enumerate(fields)}
    answers.sort(key=lambda a: order[a.id])
    unanswered.sort(key=lambda a: order[a.id])
    return AutofillResponse(
        answers=answers,
        unanswered=unanswered,
        complete=complete,
        form_fingerprint=fingerprint(req),
    )


async def _ask_model(
    get_model: ModelFactory,
    req: AutofillRequest,
    fields: list[FormFieldIn],
    context: FormContext,
    answers: list[AutofillAnswer],
    unanswered: list[AutofillAnswer],
) -> bool:
    """Answer ``fields`` with the model. False when it could not be asked or read."""
    try:
        provider = await get_model()
        response = await provider.complete(
            LLMRequest(
                purpose="form_answer",
                system=[SystemBlock(SYSTEM)],
                messages=[{"role": "user", "content": _user_message(req, fields, context)}],
                max_output_tokens=8_000,
                effort="low",
                # Copying answers out of a resume needs no reasoning, and on the
                # fast tier thinking spends the same output budget: a long form
                # could use it all up and cut the JSON off mid-object.
                thinking=False,
                timeout_s=60.0,
            )
        )
    except LLMError as exc:
        unanswered.extend(_needs(f, exc.message) for f in fields)
        return False

    raw = response.parsed if isinstance(response.parsed, dict) else _json_object(response.text)
    if raw is None:
        unanswered.extend(_needs(f, UNREADABLE_REPLY) for f in fields)
        return False

    for f in fields:
        entry = raw.get(_key(f.id))
        if not isinstance(entry, dict):
            entry = {}
        value = entry.get("answer", "")
        reason = str(entry.get("reason", ""))

        if f.type == "checkbox":
            if entry.get("needs_user_input") or value in ("", None):
                unanswered.append(_needs(f, reason or "Not present in your profile"))
            else:
                checked = value is True or str(value).strip().lower() in {"true", "yes", "checked"}
                answers.append(
                    AutofillAnswer(id=f.id, type=f.type, label=f.label, checked=checked, source="model")
                )
            continue

        value = "" if value is None else str(value)
        if entry.get("needs_user_input") or not value.strip():
            # A suggestion the model was unsure of is still worth showing.
            unanswered.append(_needs(f, reason or "Not present in your profile", value))
            continue

        fuzzy = False
        if f.type in CHOICE_TYPES and f.options and not f.options_unknown:
            matched, fuzzy = snap(value, [o.label for o in f.options])
            if matched is None:
                unanswered.append(
                    _needs(f, "No option on the page matches that answer", value)
                )
                continue
            value = matched

        answers.append(
            AutofillAnswer(
                id=f.id, type=f.type, label=f.label, answer=value,
                matched_fuzzily=fuzzy, source="model",
            )
        )
    return True


def _json_object(text: str) -> dict | None:
    """The JSON object in a reply, fenced or wrapped in a sentence.

    Without a schema the fast tier often puts its answer in a ```json fence.
    json.loads rejects that, and every field used to come back as "not present
    in your profile" - the model's formatting reported as the user's missing data.
    """
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        value = json.loads(text[start : end + 1])
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _user_message(req: AutofillRequest, fields: list[FormFieldIn], context: FormContext) -> str:
    lines = ["=== CANDIDATE RESUME ===", context.resume_text.strip()[:20_000], ""]
    details = {k: v for k, v in context.facts.items() if k != "summary"}
    if details:
        lines += ["=== CANDIDATE DETAILS ==="]
        lines += [f"- {k}: {v}" for k, v in details.items()]
        lines.append("")
    if context.autofill_fields:
        lines += ["=== STORED ANSWERS ==="]
        lines += [f"- {k}: {v}" for k, v in context.autofill_fields.items()]
        lines.append("")
    if context.notes:
        lines += ["=== NOTES FROM THE CANDIDATE ===", context.notes.strip()[:4000], ""]
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
