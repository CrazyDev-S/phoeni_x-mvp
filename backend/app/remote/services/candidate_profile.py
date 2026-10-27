"""The resume profile: who a generated resume is for.

The generator reads it as CANDIDATE_PROFILE. A name, contact details and
education alone keep generation Constructed - the career is built from the job
- but under the candidate's own name. A work history makes it Grounded:
employers, titles and dates stay as given.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.profile import CandidateProfile

# Settings edit one profile per user; this names the row they create.
DEFAULT_NAME = "Resume profile"


async def default_profile(session: AsyncSession, user_id: uuid.UUID) -> CandidateProfile | None:
    return await session.scalar(
        select(CandidateProfile)
        .where(CandidateProfile.user_id == user_id)
        .order_by(CandidateProfile.is_default.desc(), CandidateProfile.created_at)
        .limit(1)
    )


def has_history(profile: CandidateProfile | None) -> bool:
    """Whether there is a real career to ground on, not just who the candidate is."""
    return bool(profile and (profile.summary or "").strip())


def generation_mode(profile: CandidateProfile | None) -> str:
    return "grounded" if has_history(profile) else "constructed"


def profile_markdown(profile: CandidateProfile) -> str | None:
    """The CANDIDATE_PROFILE text, or None when the profile says nothing."""
    identity = [
        (label, value.strip())
        for label, value in (
            ("Name", profile.full_name),
            ("Headline", profile.headline),
            ("Location", profile.location),
            ("Email", profile.email),
            ("Phone", profile.phone),
        )
        if value and value.strip()
    ]
    links = [link for link in profile.links or [] if link]
    education = [entry for entry in profile.education or [] if entry]
    if not identity and not links and not education and not has_history(profile):
        return None

    lines = [f"- {label}: {value}" for label, value in identity]
    if links:
        lines.append(f"- Links: {', '.join(links)}")
    if education:
        lines += ["", "EDUCATION:", *(f"- {entry}" for entry in education)]
    if has_history(profile):
        lines += ["", "WORK HISTORY:", profile.summary.strip()]
    else:
        lines += [
            "",
            (
                "WORK HISTORY: (none supplied) Use the name, contact details, "
                "location and education above exactly as written, and build the "
                "career from the job description."
            ),
        ]
    return "\n".join(lines)
