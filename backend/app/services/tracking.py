"""The seam between the interview pipeline and the calendar.

A stage's status and its meetings describe the same fact from two sides, so
the rules that keep them agreeing live here, once, rather than being
re-derived in each router.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import ApplicationStage, ApplicationStageEvent, JobApplication
from app.models.calendar import Meeting
from app.models.enums import ApplicationStatus, MeetingStatus, StageStatus
from app.models.maintenance import MaintainedJob
from app.schemas.tracking import CalendarMeetingOut, MeetingOut, StageOut

# A stage in one of these states has been decided by the user; a calendar
# change must not quietly overrule that.
DECIDED_STAGE_STATUSES = {
    StageStatus.PASSED,
    StageStatus.FAILED,
    StageStatus.SKIPPED,
    StageStatus.CANCELLED,
}


async def load_stage_meetings(
    session: AsyncSession, stage_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, list[Meeting]]:
    ids = list(stage_ids)
    grouped: dict[uuid.UUID, list[Meeting]] = {stage_id: [] for stage_id in ids}
    if not ids:
        return grouped
    for meeting in await session.scalars(
        select(Meeting).where(Meeting.stage_id.in_(ids)).order_by(Meeting.starts_at)
    ):
        grouped[meeting.stage_id].append(meeting)
    return grouped


def stage_out(stage: ApplicationStage, meetings: list[Meeting]) -> StageOut:
    return StageOut.model_validate(stage).model_copy(
        update={"meetings": [MeetingOut.model_validate(m) for m in meetings]}
    )


async def sync_stage(
    session: AsyncSession,
    stage_id: uuid.UUID,
    *,
    trigger: MeetingStatus | None = None,
) -> None:
    """Bring a stage's status and ``scheduled_for`` in line with its meetings.

    * A scheduled meeting ahead means the stage is scheduled.
    * A meeting that was held, with nothing else booked, means the stage is
      waiting on feedback.
    * A no-show or an explicit "rescheduled" is recorded as such.
    * Cancelling or deleting the only meeting returns the stage to pending,
      so the tracking table stops claiming a call that will not happen.
    """
    await session.flush()
    stage = await session.get(ApplicationStage, stage_id)
    if stage is None:
        return

    meetings = list(
        await session.scalars(
            select(Meeting).where(Meeting.stage_id == stage_id).order_by(Meeting.starts_at)
        )
    )
    upcoming = next((m for m in meetings if m.status == MeetingStatus.SCHEDULED), None)
    held = [m for m in meetings if m.status == MeetingStatus.HELD]

    if upcoming:
        stage.scheduled_for = upcoming.starts_at
    elif held:
        stage.scheduled_for = held[-1].starts_at
    else:
        stage.scheduled_for = None

    if stage.status in DECIDED_STAGE_STATUSES:
        return

    if upcoming:
        target = StageStatus.SCHEDULED
    elif trigger == MeetingStatus.NO_SHOW:
        target = StageStatus.NO_SHOW
    elif trigger == MeetingStatus.RESCHEDULED:
        target = StageStatus.RESCHEDULED
    elif held:
        target = StageStatus.WAITING_FEEDBACK
    elif stage.status in (StageStatus.SCHEDULED, StageStatus.RESCHEDULED):
        target = StageStatus.PENDING
    else:
        target = stage.status

    if target != stage.status:
        session.add(
            ApplicationStageEvent(
                stage_id=stage.id,
                from_status=stage.status,
                to_status=target,
                reason=f"meeting {trigger.value}" if trigger else "meeting changed",
                actor="calendar",
            )
        )
        stage.status = target

    # Booking any real interview means the application reached a conversation.
    if target == StageStatus.SCHEDULED and stage.kind != "applied":
        application = await session.get(JobApplication, stage.application_id)
        if application and application.status in (
            ApplicationStatus.SAVED,
            ApplicationStatus.APPLIED,
        ):
            application.status = ApplicationStatus.IN_PROCESS


async def describe_meetings(
    session: AsyncSession, meetings: list[Meeting]
) -> list[CalendarMeetingOut]:
    """Name each meeting's owner in two queries, however many meetings there are."""
    stage_ids = {m.stage_id for m in meetings if m.stage_id}
    job_ids = {m.maintained_job_id for m in meetings if m.maintained_job_id}

    stages: dict[uuid.UUID, dict] = {}
    if stage_ids:
        rows = await session.execute(
            select(
                ApplicationStage.id,
                ApplicationStage.name,
                ApplicationStage.kind,
                JobApplication.id,
                JobApplication.company_name,
                JobApplication.role_title,
            )
            .join(JobApplication, ApplicationStage.application_id == JobApplication.id)
            .where(ApplicationStage.id.in_(stage_ids))
        )
        for stage_id, stage_name, stage_kind, app_id, company, role in rows:
            stages[stage_id] = {
                "kind": "application",
                "application_id": app_id,
                "company_name": company,
                "role_title": role,
                "stage_name": stage_name,
                "stage_kind": stage_kind,
            }

    jobs: dict[uuid.UUID, dict] = {}
    if job_ids:
        rows = await session.execute(
            select(MaintainedJob.id, MaintainedJob.employer_name, MaintainedJob.role_title)
            .where(MaintainedJob.id.in_(job_ids))
        )
        for job_id, employer, role in rows:
            jobs[job_id] = {"company_name": employer, "role_title": role}

    return [
        CalendarMeetingOut(
            **MeetingOut.model_validate(m).model_dump(),
            **(stages.get(m.stage_id) or jobs.get(m.maintained_job_id) or {}),
        )
        for m in meetings
    ]
