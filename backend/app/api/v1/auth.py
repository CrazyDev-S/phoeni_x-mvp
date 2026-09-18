"""Registration, login, token refresh, and extension personal access tokens."""

from __future__ import annotations

import uuid

import jwt
from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.deps import CurrentUser, Session
from app.core.security import (
    create_token,
    decode_token,
    generate_pat,
    hash_password,
    verify_password,
)
from app.core.timezone import utc_now
from app.models.profile import AutofillProfile
from app.models.user import ApiToken, User, UserSettings
from app.schemas.auth import (
    ApiTokenCreate,
    ApiTokenCreated,
    ApiTokenOut,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserOut,
)
from app.services.seed import seed_default_stage_templates

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_pair(user: User) -> TokenPair:
    settings = get_settings()
    return TokenPair(
        access_token=create_token(user.id, "access"),
        refresh_token=create_token(user.id, "refresh"),
        expires_in=settings.access_token_ttl_minutes * 60,
    )


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, session: Session) -> TokenPair:
    user = User(
        email=str(body.email),
        password_hash=hash_password(body.password),
        display_name=body.display_name,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists",
        ) from exc

    # Every user starts with usable defaults rather than an empty app.
    session.add(UserSettings(user_id=user.id))
    session.add(AutofillProfile(user_id=user.id, fields={}))
    await seed_default_stage_templates(session, user.id)
    await session.flush()
    return _token_pair(user)


@router.post("/login", response_model=TokenPair)
async def login(body: LoginRequest, session: Session) -> TokenPair:
    user = await session.scalar(select(User).where(User.email == str(body.email)))
    # Verify unconditionally against a dummy hash when the user is missing, so
    # response timing does not reveal whether an email is registered.
    if user is None:
        hash_password("timing-equalizer")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    if not verify_password(body.password, user.password_hash) or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    return _token_pair(user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest, session: Session) -> TokenPair:
    try:
        payload = decode_token(body.refresh_token, expected_type="refresh")
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        ) from exc
    user = await session.get(User, uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )
    return _token_pair(user)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user


@router.get("/tokens", response_model=list[ApiTokenOut])
async def list_tokens(user: CurrentUser, session: Session) -> list[ApiToken]:
    rows = await session.scalars(
        select(ApiToken)
        .where(ApiToken.user_id == user.id)
        .order_by(ApiToken.created_at.desc())
    )
    return list(rows)


@router.post(
    "/tokens", response_model=ApiTokenCreated, status_code=status.HTTP_201_CREATED
)
async def create_api_token(
    body: ApiTokenCreate, user: CurrentUser, session: Session
) -> ApiTokenCreated:
    """Mint a long-lived token for the browser extension.

    The plaintext is returned exactly once; only its SHA-256 hash is stored.
    """
    plaintext, token_hash = generate_pat()
    row = ApiToken(user_id=user.id, name=body.name, token_hash=token_hash)
    session.add(row)
    await session.flush()
    return ApiTokenCreated(
        id=row.id,
        name=row.name,
        last_used_at=None,
        revoked_at=None,
        created_at=row.created_at,
        token=plaintext,
    )


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_token(
    token_id: uuid.UUID, user: CurrentUser, session: Session
) -> None:
    row = await session.scalar(
        select(ApiToken).where(ApiToken.id == token_id, ApiToken.user_id == user.id)
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    row.revoked_at = utc_now()
