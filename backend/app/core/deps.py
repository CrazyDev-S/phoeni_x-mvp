"""Request-scoped dependencies: authentication and the current user."""

from __future__ import annotations

import uuid
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token, hash_pat
from app.core.timezone import utc_now
from app.db.session import get_session
from app.models.user import ApiToken, User

# auto_error=False so we can raise a consistent error body ourselves.
bearer = HTTPBearer(auto_error=False, description="JWT (web) or rat_ token (extension)")

_UNAUTH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Accept either a web JWT or an extension personal access token.

    One dependency for both so every router is agnostic to which client is
    calling it.
    """
    if creds is None or not creds.credentials:
        raise _UNAUTH

    token = creds.credentials

    if token.startswith("rat_"):
        row = await session.scalar(
            select(ApiToken).where(
                ApiToken.token_hash == hash_pat(token),
                ApiToken.revoked_at.is_(None),
            )
        )
        if row is None:
            raise _UNAUTH
        row.last_used_at = utc_now()
        user = await session.get(User, row.user_id)
    else:
        try:
            payload = decode_token(token, expected_type="access")
        except jwt.ExpiredSignatureError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token expired",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc
        except jwt.PyJWTError as exc:
            raise _UNAUTH from exc
        user = await session.get(User, uuid.UUID(payload["sub"]))

    if user is None or not user.is_active:
        raise _UNAUTH
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
Session = Annotated[AsyncSession, Depends(get_session)]
