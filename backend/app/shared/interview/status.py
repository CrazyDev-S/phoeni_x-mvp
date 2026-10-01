"""What Interview Assist will be, stated once for both surfaces."""

from __future__ import annotations

from pydantic import BaseModel, Field


class InterviewAssistStatus(BaseModel):
    available: bool = False
    planned: list[str] = Field(default_factory=list)


PLANNED = [
    "A preparation brief for each call, built from the posting or the application, "
    "the resume or proposal, and what is known about the client.",
    "A question bank per interview kind: recruiter screen, technical, client discovery call.",
    "Live assistance during the call, from the calendar's meeting record.",
    "Notes and follow-ups written back to the application stage or the freelancing track.",
]


def current_status() -> InterviewAssistStatus:
    return InterviewAssistStatus(available=False, planned=list(PLANNED))
