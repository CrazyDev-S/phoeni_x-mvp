"""Phase 2, the profile half: the freelancer as a proposal is written from."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select, update

from app.core.deps import CurrentUser, Session
from app.freelancing.profile_import import read_profile
from app.freelancing.profile_writer import adopt_drafts, record_save, saved_numbers
from app.llm.factory import get_provider
from app.llm.provider import LLMError
from app.models.freelancing import FreelancerProfile
from app.schemas.freelancing import (
    FreelancerProfileDraft,
    FreelancerProfileIn,
    FreelancerProfileOut,
    FreelancerProfilePatch,
    ProfileImportIn,
)

router = APIRouter(prefix="/profiles", tags=["freelancing: profile"])

_IMPORT_STATUS = {
    "NO_PROVIDER_KEY": status.HTTP_409_CONFLICT,
    "NOT_A_PROFILE": status.HTTP_422_UNPROCESSABLE_CONTENT,
    "OUTPUT_TOO_LONG": status.HTTP_422_UNPROCESSABLE_CONTENT,
    "RATE_LIMITED": status.HTTP_429_TOO_MANY_REQUESTS,
}
_IMPORT_DETAIL = {
    "NO_PROVIDER_KEY": "Add an AI provider key in Settings to fill a profile from its link.",
    "BAD_CREDENTIAL": "Your AI provider refused the key in Settings. Check it there, then try again.",
}


async def _owned(session: Session, user: CurrentUser, profile_id: uuid.UUID) -> FreelancerProfile:
    row = await session.scalar(
        select(FreelancerProfile).where(
            FreelancerProfile.id == profile_id, FreelancerProfile.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    return row


async def _make_default(session: Session, user: CurrentUser, profile_id: uuid.UUID) -> None:
    await session.execute(
        update(FreelancerProfile)
        .where(FreelancerProfile.user_id == user.id, FreelancerProfile.id != profile_id)
        .values(is_default=False)
    )


def _plain(body: FreelancerProfileIn | FreelancerProfilePatch, *, exclude_unset: bool) -> dict:
    """JSON-ready values: nested models become dicts for the JSONB columns."""
    return body.model_dump(mode="json", exclude_unset=exclude_unset, exclude={"version_id"})


async def _out(session: Session, user: CurrentUser, rows: list[FreelancerProfile]) -> list[FreelancerProfileOut]:
    """Profiles with their latest saved version number."""
    numbers = await saved_numbers(session, user.id)
    return [
        FreelancerProfileOut.model_validate(row).model_copy(update={"version": numbers.get(row.id)})
        for row in rows
    ]


@router.get("", response_model=list[FreelancerProfileOut])
async def list_profiles(user: CurrentUser, session: Session) -> list[FreelancerProfileOut]:
    rows = await session.scalars(
        select(FreelancerProfile)
        .where(FreelancerProfile.user_id == user.id)
        .order_by(FreelancerProfile.is_default.desc(), FreelancerProfile.created_at)
    )
    return await _out(session, user, list(rows))


@router.post("", response_model=FreelancerProfileOut, status_code=status.HTTP_201_CREATED)
async def create_profile(
    body: FreelancerProfileIn, user: CurrentUser, session: Session
) -> FreelancerProfileOut:
    existing = await session.scalar(
        select(func.count()).select_from(FreelancerProfile).where(FreelancerProfile.user_id == user.id)
    )
    row = FreelancerProfile(user_id=user.id, **_plain(body, exclude_unset=False))
    # The first profile is the default whether or not the form said so.
    row.is_default = body.is_default or not existing
    session.add(row)
    await session.flush()
    if row.is_default:
        await _make_default(session, user, row.id)
    # The drafts written before it existed are its own, and this save is version 1.
    await adopt_drafts(session, user.id, row.id)
    await record_save(session, row, body.version_id)
    return (await _out(session, user, [row]))[0]


@router.post("/import", response_model=FreelancerProfileDraft)
async def import_profile(
    body: ProfileImportIn, user: CurrentUser, session: Session
) -> FreelancerProfileDraft:
    """The form's fields, read from the Upwork pages the extension opened. Nothing is saved."""
    try:
        return await read_profile(await get_provider(session, user.id, "fast"), body)
    except LLMError as exc:
        # Never the provider's own status: its 401 is about the API key, and
        # the portal reads a 401 as its own session ending.
        raise HTTPException(
            status_code=_IMPORT_STATUS.get(exc.code, status.HTTP_502_BAD_GATEWAY),
            detail=_IMPORT_DETAIL.get(exc.code, exc.message),
        ) from exc


@router.get("/{profile_id}", response_model=FreelancerProfileOut)
async def get_profile(profile_id: uuid.UUID, user: CurrentUser, session: Session) -> FreelancerProfileOut:
    return (await _out(session, user, [await _owned(session, user, profile_id)]))[0]


@router.patch("/{profile_id}", response_model=FreelancerProfileOut)
async def update_profile(
    profile_id: uuid.UUID, body: FreelancerProfilePatch, user: CurrentUser, session: Session
) -> FreelancerProfileOut:
    row = await _owned(session, user, profile_id)
    data = _plain(body, exclude_unset=True)
    if data.get("name") is None:
        data.pop("name", None)
    for field, value in data.items():
        setattr(row, field, value)
    await session.flush()
    if data.get("is_default"):
        await _make_default(session, user, row.id)
    # A save is the next whole version of the written profile, when it changed.
    await record_save(session, row, body.version_id)
    return (await _out(session, user, [row]))[0]


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(profile_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    row = await _owned(session, user, profile_id)
    await session.delete(row)
