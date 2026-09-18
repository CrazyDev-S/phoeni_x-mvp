from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ORMModel


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"  # noqa: S105
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(ORMModel):
    id: uuid.UUID
    email: str
    display_name: str | None
    timezone: str
    is_active: bool
    created_at: datetime


class ApiTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class ApiTokenOut(ORMModel):
    id: uuid.UUID
    name: str
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class ApiTokenCreated(ApiTokenOut):
    # Shown exactly once, at creation. Only the SHA-256 hash is stored.
    token: str
