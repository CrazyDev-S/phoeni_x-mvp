from __future__ import annotations

import uuid
from datetime import datetime

from app.models.enums import GenerationKind, GenerationStatus, LLMProvider
from app.schemas.common import ORMModel


class GenerationOut(ORMModel):
    id: uuid.UUID
    kind: GenerationKind
    status: GenerationStatus
    phase: str | None
    progress_percent: int
    provider: LLMProvider | None
    model: str | None
    result_kind: str | None
    result_id: uuid.UUID | None
    error_code: str | None
    error_detail: str | None
    total_cost_usd_micros: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class GenerationAccepted(ORMModel):
    id: uuid.UUID
    status: GenerationStatus
    kind: GenerationKind
    # Set when the instant path served a cached equivalent instead of running.
    reused: bool = False
    result_kind: str | None = None
    result_id: uuid.UUID | None = None


class GenerationEventOut(ORMModel):
    seq: int
    type: str
    payload: dict
    created_at: datetime
