"""Generation endpoints: enqueue, poll, and stream.

Never synchronous. A full generation runs 60-180s, which is well past what
proxies and mobile networks tolerate, and a dropped synchronous request
re-spends real money on retry.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from sqlalchemy import select
from sse_starlette.sse import EventSourceResponse

from app.core.deps import CurrentUser, Session
from app.db.session import SessionLocal
from app.models.enums import GenerationStatus
from app.models.generation import Generation, GenerationEvent
from app.schemas.generation import GenerationEventOut, GenerationOut

router = APIRouter(prefix="/generations", tags=["generations"])

POLL_INTERVAL = 0.4
TERMINAL = {
    GenerationStatus.SUCCEEDED,
    GenerationStatus.FAILED,
    GenerationStatus.CANCELLED,
    GenerationStatus.NEEDS_REVIEW,
}


async def _owned(session: Session, user: CurrentUser, gen_id: uuid.UUID) -> Generation:
    row = await session.scalar(
        select(Generation).where(
            Generation.id == gen_id, Generation.user_id == user.id
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return row


@router.get("/{generation_id}", response_model=GenerationOut)
async def get_generation(
    generation_id: uuid.UUID, user: CurrentUser, session: Session
) -> Generation:
    return await _owned(session, user, generation_id)


@router.post("/{generation_id}/cancel", response_model=GenerationOut)
async def cancel_generation(
    generation_id: uuid.UUID, user: CurrentUser, session: Session
) -> Generation:
    row = await _owned(session, user, generation_id)
    if row.status in TERMINAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Already finished"
        )
    row.status = GenerationStatus.CANCELLED
    return row


@router.get("/{generation_id}/events-json", response_model=list[GenerationEventOut])
async def poll_events(
    generation_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    after: int = -1,
) -> list[GenerationEvent]:
    """Polling alternative to the SSE stream.

    The side panel uses this rather than parsing SSE by hand: EventSource
    cannot send an Authorization header, and the panel already needs a
    resumable cursor because its document is destroyed whenever the panel
    closes. `after` is the last seq it saw.
    """
    await _owned(session, user, generation_id)
    return list(
        await session.scalars(
            select(GenerationEvent)
            .where(
                GenerationEvent.generation_id == generation_id,
                GenerationEvent.seq > after,
            )
            .order_by(GenerationEvent.seq)
            .limit(200)
        )
    )


@router.get("/{generation_id}/events")
async def stream_events(
    generation_id: uuid.UUID,
    user: CurrentUser,
    session: Session,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> EventSourceResponse:
    """SSE over the append-only event table.

    Replaying from ``Last-Event-ID`` makes a reconnect lossless, which is what
    the Chrome side panel needs: its document is destroyed the moment the panel
    is closed, and the user expects to reopen it mid-job.
    """
    await _owned(session, user, generation_id)
    cursor = int(last_event_id) if last_event_id and last_event_id.isdigit() else -1

    async def publisher():
        seq = cursor
        while True:
            async with SessionLocal() as s:
                events = list(
                    await s.scalars(
                        select(GenerationEvent)
                        .where(
                            GenerationEvent.generation_id == generation_id,
                            GenerationEvent.seq > seq,
                        )
                        .order_by(GenerationEvent.seq)
                    )
                )
                for event in events:
                    seq = event.seq
                    yield {
                        "id": str(event.seq),
                        "event": event.type,
                        "data": json.dumps(event.payload),
                    }
                if events and events[-1].type in ("complete", "error"):
                    return

                generation = await s.get(Generation, generation_id)
                if generation is not None and generation.status in TERMINAL:
                    # Never close a finished job silently. A client that
                    # reconnects having already seen every event would get an
                    # empty stream, reconnect again, and spin forever waiting
                    # for an outcome that had already been delivered. Restating
                    # the outcome costs one frame and always ends the wait.
                    yield {
                        "id": str(seq + 1),
                        "event": "error" if generation.status is GenerationStatus.FAILED else "complete",
                        "data": json.dumps(
                            {
                                "replayed": True,
                                "status": generation.status.value,
                                "result_kind": generation.result_kind,
                                "result_id": str(generation.result_id)
                                if generation.result_id
                                else None,
                                "needs_review": generation.status
                                is GenerationStatus.NEEDS_REVIEW,
                                "code": generation.error_code,
                                "detail": generation.error_detail,
                            }
                        ),
                    }
                    return
            await asyncio.sleep(POLL_INTERVAL)

    return EventSourceResponse(publisher())
