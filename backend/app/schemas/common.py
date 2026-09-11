"""Shared response shapes."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class Message(BaseModel):
    detail: str


class IdResponse(BaseModel):
    id: uuid.UUID


class TimestampedOut(ORMModel):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None


class ErrorResponse(BaseModel):
    code: str
    detail: str
    hint: str | None = None
    meta: dict = Field(default_factory=dict)
