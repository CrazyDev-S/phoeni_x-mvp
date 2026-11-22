"""A proposal's versions: drafts the writer makes, saves the freelancer makes.

Drafts count toward the next save: 1.1, 1.2, ... then saving records 1, and
the drafts after it are 2.1, 2.2, ... The proposal row holds the letter and
answers of one version (``Proposal.version_id``): the latest draft when it
lands, or the save that recorded the editor's text.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import GenerationKind, GenerationStatus
from app.models.freelancing import Proposal, ProposalVersion
from app.models.generation import Generation

# The fields of a version the proposal row holds. The rest is the writer's notes.
WRITING = ("cover_letter_markdown", "answers")


def version_label(version: ProposalVersion) -> str:
    return f"{version.major}.{version.minor}" if version.minor else str(version.major)


async def versions(session: AsyncSession, proposal_id: uuid.UUID) -> list[ProposalVersion]:
    """Oldest first."""
    return list(
        await session.scalars(
            select(ProposalVersion)
            .where(ProposalVersion.proposal_id == proposal_id)
            .order_by(ProposalVersion.created_at, ProposalVersion.minor)
        )
    )


def _next_major(thread: list[ProposalVersion]) -> int:
    """The save the drafts are working toward. A save moves it on; deleting one never reuses a number."""
    return max((v.major + (1 if v.minor == 0 else 0) for v in thread), default=1)


def next_draft(thread: list[ProposalVersion]) -> tuple[int, int]:
    major = _next_major(thread)
    return major, max((v.minor for v in thread if v.major == major), default=0) + 1


def lineage(thread: list[ProposalVersion], based_on: ProposalVersion | None) -> list[str]:
    """The instructions that led to ``based_on``, oldest first."""
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


async def record_save(session: AsyncSession, proposal: Proposal, version_id: uuid.UUID | None) -> None:
    """A save is the next whole version: the row's writing over the version it was built from.

    Nothing is recorded when the writing is unchanged since the last save, or
    when nothing is written at all.
    """
    thread = await versions(session, proposal.id)
    saved = [v for v in thread if v.minor == 0]
    base = next((v for v in thread if v.id == version_id), None) or (saved[-1] if saved else None)
    writing = {"cover_letter_markdown": proposal.cover_letter_markdown, "answers": list(proposal.answers or [])}
    document = {**(base.document if base else {}), **writing}
    if saved and {k: saved[-1].document.get(k) for k in WRITING} == writing:
        proposal.version_id = saved[-1].id
        return
    if base is None and not proposal.cover_letter_markdown.strip():
        return
    row = ProposalVersion(
        user_id=proposal.user_id,
        proposal_id=proposal.id,
        major=_next_major(thread),
        minor=0,
        document=document,
        based_on_id=base.id if base else None,
    )
    session.add(row)
    await session.flush()
    proposal.version_id = row.id


async def delete_version(session: AsyncSession, proposal: Proposal, version: ProposalVersion) -> None:
    """Remove one version. When the row holds it, the row goes back to the newest one left."""
    held = proposal.version_id == version.id
    await session.delete(version)
    await session.flush()
    if not held:
        return
    remaining = await versions(session, proposal.id)
    previous = remaining[-1] if remaining else None
    proposal.version_id = previous.id if previous else None
    if previous is not None:
        proposal.cover_letter_markdown = previous.document.get("cover_letter_markdown", "")
        proposal.answers = previous.document.get("answers", [])


async def running_generation(session: AsyncSession, proposal_id: uuid.UUID) -> uuid.UUID | None:
    """A draft still being written for this proposal, so a second is not started over it."""
    return await session.scalar(
        select(Generation.id)
        .where(
            Generation.kind == GenerationKind.PROPOSAL,
            Generation.status.in_([GenerationStatus.QUEUED, GenerationStatus.RUNNING]),
            Generation.input["proposal_id"].astext == str(proposal_id),
        )
        .order_by(Generation.created_at.desc())
        .limit(1)
    )
