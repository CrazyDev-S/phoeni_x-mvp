"""Interview Assist: a shared tool that is planned, not built.

The endpoint exists so both surfaces can show the same honest status rather
than a hardcoded "coming soon", and so the plan lives next to the code that
will implement it (``app/shared/interview``).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.shared.interview.status import InterviewAssistStatus, current_status

router = APIRouter(prefix="/interview", tags=["shared: interview assist"])


@router.get("/status", response_model=InterviewAssistStatus)
async def read_status() -> InterviewAssistStatus:
    return current_status()
