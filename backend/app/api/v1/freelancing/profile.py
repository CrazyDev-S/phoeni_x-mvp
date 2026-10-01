"""Phase 2, the profile half: the freelancer as a proposal is written from."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select, update

from app.core.deps import CurrentUser, Session
from app.models.freelancing import FreelancerProfile
from app.schemas.freelancing import (
    FreelancerProfileIn,
    FreelancerProfileOut,
    FreelancerProfilePatch,
)

router = APIRouter(prefix="/profiles", tags=["freelancing: profile"])


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
    return body.model_dump(mode="json", exclude_unset=exclude_unset)


@router.get("", response_model=list[FreelancerProfileOut])
async def list_profiles(user: CurrentUser, session: Session) -> list[FreelancerProfile]:
    return list(
        await session.scalars(
            select(FreelancerProfile)
            .where(FreelancerProfile.user_id == user.id)
            .order_by(FreelancerProfile.is_default.desc(), FreelancerProfile.created_at)
        )
    )


@router.post("", response_model=FreelancerProfileOut, status_code=status.HTTP_201_CREATED)
async def create_profile(
    body: FreelancerProfileIn, user: CurrentUser, session: Session
) -> FreelancerProfile:
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
    return row


@router.get("/{profile_id}", response_model=FreelancerProfileOut)
async def get_profile(profile_id: uuid.UUID, user: CurrentUser, session: Session) -> FreelancerProfile:
    return await _owned(session, user, profile_id)


@router.patch("/{profile_id}", response_model=FreelancerProfileOut)
async def update_profile(
    profile_id: uuid.UUID, body: FreelancerProfilePatch, user: CurrentUser, session: Session
) -> FreelancerProfile:
    row = await _owned(session, user, profile_id)
    data = _plain(body, exclude_unset=True)
    if data.get("name") is None:
        data.pop("name", None)
    for field, value in data.items():
        setattr(row, field, value)
    await session.flush()
    if data.get("is_default"):
        await _make_default(session, user, row.id)
    return row


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(profile_id: uuid.UUID, user: CurrentUser, session: Session) -> None:
    row = await _owned(session, user, profile_id)
    await session.delete(row)
