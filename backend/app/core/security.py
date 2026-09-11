"""Password hashing, JWTs, and extension personal access tokens."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta
from typing import Any, Literal

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.core.timezone import utc_now

_hasher = PasswordHash.recommended()

# S105/S107 flag these as "possible hardcoded password"; they are literal
# token KINDS, not secrets.
TokenType = Literal["access", "refresh"]
PAT_PREFIX = "rat_"  # resume assistant token


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _hasher.verify(password, password_hash)


def create_token(
    subject: uuid.UUID | str,
    token_type: TokenType = "access",  # noqa: S107
    extra: dict[str, Any] | None = None,
) -> str:
    settings = get_settings()
    now = utc_now()
    ttl = (
        timedelta(minutes=settings.access_token_ttl_minutes)
        if token_type == "access"  # noqa: S105 - a token kind, not a secret
        else timedelta(days=settings.refresh_token_ttl_days)
    )
    payload: dict[str, Any] = {
        "sub": str(subject),
        "typ": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "jti": secrets.token_urlsafe(12),
        **(extra or {}),
    }
    return jwt.encode(payload, settings.app_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_type: TokenType | None = None) -> dict[str, Any]:
    settings = get_settings()
    payload = jwt.decode(
        token, settings.app_secret_key, algorithms=[settings.jwt_algorithm]
    )
    if expected_type and payload.get("typ") != expected_type:
        raise jwt.InvalidTokenError(
            f"expected a {expected_type} token, got {payload.get('typ')!r}"
        )
    return payload


def generate_pat() -> tuple[str, str]:
    """Return (plaintext, sha256 hash). The plaintext is shown exactly once."""
    plaintext = PAT_PREFIX + secrets.token_urlsafe(32)
    return plaintext, hash_pat(plaintext)


def hash_pat(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode()).hexdigest()
