"""The profile writer: an Upwork profile written, and revised, from instructions.

The method is the user's own prompt, ``prompts/profile_architect_v3.md``,
loaded verbatim as a cached system prefix. It was written for a chat (an
intake form, a brief to confirm, then revisions); ``CONTRACT`` adapts that
turn-taking to an editor where every instruction produces one new version.

Versions are numbered toward the next save. The first draft is 1.1, each
instruction after it 1.2, 1.3, ...; saving the profile records version 1, and
the drafts after that are 2.1, 2.2, ... (see ``FreelancerProfileVersion``).
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import utc_now
from app.freelancing.profile_import import _clip as clip
from app.freelancing.profile_import import _json_object as json_object
from app.freelancing.profile_import import _rate as dollars
from app.llm.factory import get_provider
from app.llm.provider import LLMError, LLMRequest, SystemBlock
from app.llm.schemas import array, obj, one_of, shape, strings, text
from app.llm.streaming import streamed_turn
from app.models.enums import GenerationKind, GenerationStatus, LLMProvider
from app.models.freelancing import FreelancerProfile, FreelancerProfileVersion
from app.models.generation import Generation
from app.models.user import UserSettings
from app.schemas.freelancing import ProfileMaterial
from app.services.generation import emit, emit_now, record_calls

PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "profile_architect_v3.md"

CONTRACT = """\
═══════════════════════════════════════════════════════════════
  HOW THIS RUNS HERE  —  the editor's contract
═══════════════════════════════════════════════════════════════

The method above was written for a chat. Here it runs inside the
candidate's profile editor, one request at a time: each request is
one instruction, and each reply becomes one new version of the
profile that the candidate reviews, refines with another
instruction, or saves. These rules adapt the method's turn-taking
to that. Everything else in it applies unchanged.

1. The intake is already answered. Never present the Intake Form
   and never wait. The candidate's intake is this request:
   their instructions, every one given so far, oldest first, and
   their profile material, which is their profile form as it is
   now (title, overview, rate, skills, portfolio, specialized
   profiles and notes; the notes often hold their employment,
   education, certifications and Upwork stats).

2. Never block. Where a REQUIRED intake field is missing or vague,
   work from the best reading the material supports and put the
   one targeted follow-up question the Intake Validation Rules
   call for in `questions`, one per gap. The candidate answers in
   their next instruction. When nothing is missing, `questions`
   is empty.

3. No confirmation step. The Stack Intelligence Brief goes in
   `brief` and the profile is written from it in the same reply.
   The candidate corrects the brief with a later instruction,
   handled as Revision Type 3.

4. Revisions. When the request carries a current version, the
   instruction revises it under the Revision Protocol. The reply
   is always the complete profile: every section the revision
   does not touch is copied from the current version word for
   word. The current version's title, summary, skills and rate
   are what the candidate's form holds now, including anything
   they edited by hand; keep their wording unless the instruction
   asks for a change. Revision Type 4 ("start over") rebuilds
   from the material and the instructions, not from the current
   version, using the same intake data.

5. Output. Reply with the JSON object the schema describes and
   nothing else. Text fields are copy-ready for Upwork's text
   fields: plain text with line breaks, no markdown, no section
   dividers or boxes (the editor lays sections out itself). Do
   not write the closing questions the method asks ("Does this
   look accurate?", "What else would you like to adjust?"); the
   editor asks them. `change_note` takes the place of the
   revision confirmation line.
"""


def _system() -> list[SystemBlock]:
    # Byte-frozen: nothing is interpolated, so the whole prefix is one cache hit.
    method = PROMPT_PATH.read_text(encoding="utf-8")
    return [SystemBlock(method), SystemBlock(CONTRACT, cache="1h")]


SYSTEM = _system()

DOCUMENT = obj(
    {
        "change_note": text(
            "One sentence for the candidate. On a first version, what the profile is "
            "built around; on a revision, what changed and what was kept, with the "
            "revision type and any keyword conflict the protocol says to flag."
        ),
        "questions": strings(
            "One targeted follow-up question per REQUIRED intake field that is missing "
            "or vague. Empty when the intake is complete."
        ),
        "brief": obj(
            {
                "stack": text(),
                "domain": text(),
                "rate_tier": one_of(["A", "B", "C"]),
                "posture": text("The rate tier's language posture, in one line."),
                "certs_verified": strings(),
                "cert_proxies": strings("Fallback proxies used, when the protocol applied."),
                "keywords_t1": strings(),
                "keywords_t2": strings(),
                "keywords_t3": strings(),
                "client_fears": strings("3-5, one sentence each."),
                "differentiators": strings("3-5."),
                "tenure_rules": strings("The Phase 1-D rules applied, each with why."),
                "portfolio_signal": strings("3 proof types, each with the fear it addresses."),
            }
        ),
        "titles": array(
            obj(
                {
                    "text": text("The title, at most 80 characters."),
                    "keyword": text("The TIER 1 keyword it targets."),
                    "intent": text("Its primary Upwork search intent."),
                    "tier_signal": one_of(["premium", "mid", "growth"]),
                }
            ),
            "Exactly 3 variations, the top pick first.",
        ),
        "title_rationale": text("One line: why the top pick outranks the others."),
        "summary": text("The Summary, with its paragraph breaks."),
        "skills": strings("Exactly 15 Upwork skill tags, strongest first."),
        "hourly_rate": text(
            "The candidate's target hourly rate in USD as a plain number, e.g. '85'. "
            "Empty when they have not given one."
        ),
        "work_history": array(
            obj(
                {
                    "company": text(),
                    "location": text("City, Country, or Remote."),
                    "role": text(),
                    "duration": text("Month YYYY – Month YYYY, or – Present."),
                    "employment_type": one_of(["Full-time", "Contract", "Freelance"]),
                    "story": text("The 80-120 word prose case study."),
                }
            ),
            "2-3 entries.",
        ),
        "education": array(
            obj(
                {
                    "school": text(),
                    "degree": text(),
                    "duration": text("YYYY – YYYY."),
                    "field": text("Department or concentration; empty when none."),
                }
            )
        ),
        "portfolio_direction": array(
            obj(
                {
                    "name": text("The piece's name or concept."),
                    "doubt": text("The Client Pain Map fear it closes."),
                    "build": text("What to build or curate, exactly, for this rate tier."),
                    "signal": text("What it proves that the Summary cannot."),
                }
            ),
            "Exactly 3.",
        ),
        "cert_roadmap": array(
            obj(
                {
                    "cert": text(),
                    "issuer": text(),
                    "time": text("Approximate time to complete."),
                    "why": text("What it unlocks for this stack, in one line."),
                }
            ),
            "The 3 certs to earn when the Fallback Protocol triggers the roadmap; else empty.",
        ),
    }
)

# The profile form's own fields in a document. Everything else is the writer's.
FORM_FIELDS = ("title", "summary", "skills", "hourly_rate")


# --- the worker step ----------------------------------------------------------------


async def run_profile_generation(session: AsyncSession, generation: Generation) -> None:
    payload = generation.input or {}
    user_id = generation.user_id
    profile_id = uuid.UUID(payload["profile_id"]) if payload.get("profile_id") else None
    if profile_id is not None:
        profile = await session.get(FreelancerProfile, profile_id)
        if profile is None or profile.user_id != user_id:
            raise LLMError("PROFILE_NOT_FOUND", "The profile being written no longer exists.")

    thread = await versions(session, user_id, profile_id)
    based_on = next((v for v in thread if str(v.id) == payload.get("based_on_id")), None)
    material = ProfileMaterial.model_validate(payload.get("material") or {})
    instruction = str(payload.get("instruction") or "").strip()

    provider = await get_provider(session, user_id, "heavy")
    settings = await session.get(UserSettings, user_id)
    generation.provider = settings.default_provider if settings else LLMProvider.ANTHROPIC
    generation.model = getattr(provider, "model", None)

    label = f"Revising {version_label(based_on)}" if based_on else "Writing your profile"
    await emit_now(generation.id, "phase", {"phase": "writing", "label": label, "percent": 10})

    response = await streamed_turn(
        provider,
        LLMRequest(
            purpose="profile_write",
            system=SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": write_turn(
                        material=material,
                        history=_lineage(thread, based_on),
                        current=_current(based_on, material),
                        instruction=instruction,
                    ),
                }
            ],
            output_schema=DOCUMENT,
            max_output_tokens=32_000,
            effort="high",
            timeout_s=600.0,
        ),
        lambda event: emit_now(generation.id, event.type, event.data),
    )
    await record_calls(
        session,
        generation,
        [
            {
                "purpose": "profile_write",
                "model": response.model,
                "latency_ms": response.latency_ms,
                "stop_reason": response.stop_reason,
                "cost_usd_micros": response.cost_usd_micros,
                **response.usage.as_dict(),
            }
        ],
    )
    if response.stop_reason == "max_tokens":
        raise LLMError("OUTPUT_TOO_LONG", "The profile ran past the length limit. Try a narrower instruction.")
    raw = response.parsed if isinstance(response.parsed, dict) else json_object(response.text)
    if raw is None:
        raise LLMError("UNREADABLE_REPLY", "The profile came back unreadable. Try again.")

    major, minor = _next_draft(thread)
    version = FreelancerProfileVersion(
        user_id=user_id,
        profile_id=profile_id,
        major=major,
        minor=minor,
        instruction=instruction,
        document=_document(shape(DOCUMENT, raw)),
        based_on_id=based_on.id if based_on else None,
        generation_id=generation.id,
    )
    session.add(version)
    await session.flush()

    generation.result_kind = "profile_version"
    generation.result_id = version.id
    generation.status = GenerationStatus.SUCCEEDED
    generation.progress_percent = 100
    generation.finished_at = utc_now()
    await session.flush()
    await emit(
        session,
        generation.id,
        "complete",
        {
            "result_kind": "profile_version",
            "result_id": str(version.id),
            "label": version_label(version),
            "needs_review": True,
            "findings": [],
            "report": None,
        },
    )


def write_turn(
    *,
    material: ProfileMaterial,
    history: list[str],
    current: dict | None,
    instruction: str,
) -> str:
    parts = [f"<profile_material>\n{_material_text(material)}\n</profile_material>"]
    if history:
        earlier = "\n\n".join(f"{n}. {text}" for n, text in enumerate(history, start=1))
        parts.append(f"<earlier_instructions>\n{earlier}\n</earlier_instructions>")
    if current is not None:
        parts.append(
            "<current_version>\n"
            + json.dumps(current, ensure_ascii=False, indent=1)
            + "\n</current_version>"
        )
    parts.append(f"<instruction>\n{instruction}\n</instruction>")
    return "\n\n".join(parts)


def _material_text(material: ProfileMaterial) -> str:
    lines: list[str] = []
    if material.title:
        lines.append(f"Title: {material.title}")
    if material.hourly_rate is not None:
        lines.append(f"Hourly rate: ${material.hourly_rate:g}")
    if material.skills:
        lines.append("Skills: " + ", ".join(material.skills))
    if material.overview:
        lines.append(f"Overview:\n{material.overview}")
    if material.portfolio:
        lines.append("Portfolio:")
        for item in material.portfolio:
            entry = f"- {item.title}" + (f" ({item.url})" if item.url else "")
            lines.append(entry + (f": {item.summary}" if item.summary else ""))
    if material.specialized_profiles:
        lines.append("Specialized profiles:")
        for item in material.specialized_profiles:
            lines.append(f"- {item.name}" + (f": {item.title}" if item.title else ""))
            if item.overview:
                lines.append(item.overview)
    if material.raw_profile_markdown:
        lines.append(f"Notes:\n{material.raw_profile_markdown}")
    return "\n".join(lines) or "(The profile form is empty.)"


def _lineage(thread: list[FreelancerProfileVersion], based_on: FreelancerProfileVersion | None) -> list[str]:
    """The instructions that led to ``based_on``, oldest first: the intake as it was given."""
    by_id = {v.id: v for v in thread}
    chain: list[str] = []
    seen: set[uuid.UUID] = set()
    node = based_on
    while node is not None and node.id not in seen:
        seen.add(node.id)
        if node.instruction:
            chain.append(node.instruction)
        node = by_id.get(node.based_on_id) if node.based_on_id else None
    return chain[::-1]


def _current(based_on: FreelancerProfileVersion | None, material: ProfileMaterial) -> dict | None:
    """The version being revised, with the form's fields as the form holds them now."""
    if based_on is None:
        return None
    current = {k: v for k, v in based_on.document.items() if k not in ("questions", "change_note")}
    current.update(
        title=material.title,
        summary=material.overview,
        skills=material.skills,
        hourly_rate=material.hourly_rate,
    )
    return current


def _document(data: dict) -> dict:
    """The reply as stored: clipped to the form's limits so applying it always saves."""
    titles = [
        {**t, "text": clip(t["text"], 200)} for t in data["titles"] if t["text"].strip()
    ][:3]
    skills: list[str] = []
    for skill in data["skills"]:
        skill = clip(skill, 60)
        if skill and skill.lower() not in (s.lower() for s in skills):
            skills.append(skill)
    return {
        "title": titles[0]["text"] if titles else None,
        "summary": clip(data["summary"], 8000, keep_lines=True) or None,
        "skills": skills[:100],
        "hourly_rate": dollars(data["hourly_rate"]),
        "titles": titles,
        "title_rationale": data["title_rationale"].strip(),
        "work_history": [w for w in data["work_history"] if w["company"].strip() or w["role"].strip()],
        "education": [e for e in data["education"] if e["school"].strip()],
        "portfolio_direction": [p for p in data["portfolio_direction"] if p["name"].strip()],
        "cert_roadmap": [c for c in data["cert_roadmap"] if c["cert"].strip()],
        "brief": data["brief"],
        "questions": [q.strip() for q in data["questions"] if q.strip()],
        "change_note": data["change_note"].strip(),
    }


# --- versions -----------------------------------------------------------------------


def version_label(version: FreelancerProfileVersion) -> str:
    return f"{version.major}.{version.minor}" if version.minor else str(version.major)


async def versions(
    session: AsyncSession, user_id: uuid.UUID, profile_id: uuid.UUID | None
) -> list[FreelancerProfileVersion]:
    """One profile's versions, oldest first; ``None`` is the profile not created yet."""
    owner = (
        FreelancerProfileVersion.profile_id == profile_id
        if profile_id is not None
        else FreelancerProfileVersion.profile_id.is_(None)
    )
    return list(
        await session.scalars(
            select(FreelancerProfileVersion)
            .where(FreelancerProfileVersion.user_id == user_id, owner)
            .order_by(FreelancerProfileVersion.created_at, FreelancerProfileVersion.minor)
        )
    )


def _saved_major(thread: list[FreelancerProfileVersion]) -> int:
    return max((v.major for v in thread if v.minor == 0), default=0)


def _next_draft(thread: list[FreelancerProfileVersion]) -> tuple[int, int]:
    major = _saved_major(thread) + 1
    return major, max((v.minor for v in thread if v.major == major), default=0) + 1


async def adopt_drafts(session: AsyncSession, user_id: uuid.UUID, profile_id: uuid.UUID) -> None:
    """A profile just created takes the drafts written before it existed."""
    await session.execute(
        update(FreelancerProfileVersion)
        .where(
            FreelancerProfileVersion.user_id == user_id,
            FreelancerProfileVersion.profile_id.is_(None),
        )
        .values(profile_id=profile_id)
    )


async def record_save(
    session: AsyncSession, profile: FreelancerProfile, version_id: uuid.UUID | None
) -> FreelancerProfileVersion | None:
    """A save is the next whole version: the form's fields over the version it was built from.

    Nothing is recorded when the written profile is unchanged since the last
    save, or when there is nothing written at all.
    """
    thread = await versions(session, profile.user_id, profile.id)
    saved = [v for v in thread if v.minor == 0]
    base = next((v for v in thread if v.id == version_id), None) or (saved[-1] if saved else None)
    fields = {
        "title": profile.title,
        "summary": profile.overview,
        "skills": list(profile.skills or []),
        "hourly_rate": float(profile.hourly_rate) if profile.hourly_rate is not None else None,
    }
    document = {**(base.document if base else {}), **fields}
    if saved and saved[-1].document == document:
        return saved[-1]
    if base is None and not any(fields.values()):
        return None
    row = FreelancerProfileVersion(
        user_id=profile.user_id,
        profile_id=profile.id,
        major=_saved_major(thread) + 1,
        minor=0,
        document=document,
        based_on_id=base.id if base else None,
    )
    session.add(row)
    await session.flush()
    return row


async def saved_numbers(session: AsyncSession, user_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """Each of the user's profiles' latest saved version number."""
    rows = await session.execute(
        select(FreelancerProfileVersion.profile_id, func.max(FreelancerProfileVersion.major))
        .where(
            FreelancerProfileVersion.user_id == user_id,
            FreelancerProfileVersion.minor == 0,
            FreelancerProfileVersion.profile_id.is_not(None),
        )
        .group_by(FreelancerProfileVersion.profile_id)
    )
    return {profile_id: major for profile_id, major in rows}


async def running_generation(
    session: AsyncSession, user_id: uuid.UUID, profile_id: uuid.UUID | None
) -> uuid.UUID | None:
    """A draft still being written for this profile, so a second is not started over it."""
    target = Generation.input["profile_id"].astext
    return await session.scalar(
        select(Generation.id)
        .where(
            Generation.user_id == user_id,
            Generation.kind == GenerationKind.PROFILE,
            Generation.status.in_([GenerationStatus.QUEUED, GenerationStatus.RUNNING]),
            target == str(profile_id) if profile_id is not None else target.is_(None),
        )
        .order_by(Generation.created_at.desc())
        .limit(1)
    )
