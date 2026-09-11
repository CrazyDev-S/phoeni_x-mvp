"""Shared response shapes."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
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
