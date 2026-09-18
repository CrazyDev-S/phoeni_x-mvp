"""Per-user seed data created at registration."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import StageTemplate, StageTemplateItem

# Stage names are plain text, never an enum, precisely so this list is editable.
DEFAULT_PIPELINE: list[tuple[str, str, int | None]] = [
    ("Applied", "applied", None),
    ("Recruiter Screen", "recruiter_screen", 30),
    ("Hiring Manager Interview", "hiring_manager", 45),
    ("Technical Screen", "technical_screen", 60),
    ("Take-home / Coding Challenge", "coding_challenge", None),
    ("System Design", "system_design", 60),
    ("Team Fit / Panel", "panel_onsite", 90),
    ("Reference Check", "reference_check", None),
    ("Offer", "offer", 30),
]


async def seed_default_stage_templates(
    session: AsyncSession, user_id: uuid.UUID
) -> StageTemplate:
    template = StageTemplate(
        user_id=user_id, name="Standard Interview Pipeline", is_default=True
    )
    session.add(template)
    await session.flush()
    for seq, (name, kind, duration) in enumerate(DEFAULT_PIPELINE):
        session.add(
            StageTemplateItem(
                template_id=template.id,
                seq=seq,
                name=name,
                kind=kind,
                default_duration_min=duration,
            )
        )
    return template
