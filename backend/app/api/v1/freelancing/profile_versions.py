"""The profile writer: versions of a profile, and the instructions that write them.

``POST`` queues one draft per instruction; the generation's events say when
it is ready, and the draft lands in ``GET``. Saving the profile (``profile.py``)
records the whole version.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.core.deps import CurrentUser, Session
from app.freelancing.profile_writer import running_generation, versions
from app.llm.factory import get_provider
from app.llm.provider import MissingCredentialError
from app.models.enums import GenerationKind
from app.models.freelancing import FreelancerProfile, FreelancerProfileVersion
from app.schemas.freelancing import (
    ProfileVersionOut,
    ProfileVersions,
    ProfileWriteAccepted,
    ProfileWriteIn,
)
from app.services.generation import enqueue

router = APIRouter(prefix="/profile-versions", tags=["freelancing: profile writer"])


async def _own_profile(session: Session, user: CurrentUser, profile_id: uuid.UUID | None) -> None:
    if profile_id is None:
        return
    owned = await session.scalar(
        select(FreelancerProfile.id).where(
            FreelancerProfile.id == profile_id, FreelancerProfile.user_id == user.id
        )
    )
    if owned is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")


@router.get("", response_model=ProfileVersions)
async def list_versions(
    user: CurrentUser,
    session: Session,
    profile_id: uuid.UUID | None = Query(default=None, description="Omit for a profile not created yet."),
) -> ProfileVersions:
    await _own_profile(session, user, profile_id)
    return ProfileVersions(
        items=[ProfileVersionOut.model_validate(v) for v in await versions(session, user.id, profile_id)],
        running_generation_id=await running_generation(session, user.id, profile_id),
    )


@router.post("", response_model=ProfileWriteAccepted, status_code=status.HTTP_202_ACCEPTED)
async def write_version(body: ProfileWriteIn, user: CurrentUser, session: Session) -> ProfileWriteAccepted:
    """Queue the next draft: the first from the material, or a revision of ``based_on_id``."""
    await _own_profile(session, user, body.profile_id)
    if body.based_on_id is not None:
        base = await session.get(FreelancerProfileVersion, body.based_on_id)
        if base is None or base.user_id != user.id or base.profile_id != body.profile_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    if await running_generation(session, user.id, body.profile_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A version of this profile is already being written.",
        )
    try:
        # Said now rather than a minute into the run.
        await get_provider(session, user.id, "heavy")
    except MissingCredentialError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": "Add an AI provider key in Settings to write a profile."},
        ) from exc

    generation = await enqueue(
        session,
        user_id=user.id,
        kind=GenerationKind.PROFILE,
        payload={
            "profile_id": str(body.profile_id) if body.profile_id else None,
            "based_on_id": str(body.based_on_id) if body.based_on_id else None,
            "instruction": body.instruction.strip(),
            "material": body.material.model_dump(mode="json"),
        },
    )
    return ProfileWriteAccepted(id=generation.id, status=generation.status.value)
