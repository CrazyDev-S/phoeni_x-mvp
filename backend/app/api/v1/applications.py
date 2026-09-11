"""Job applications and the interview pipeline."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, Session
from app.core.timezone import utc_now
from app.models.application import (
    ApplicationStage,
    ApplicationStageEvent,
    JobApplication,
    StageTemplate,
    StageTemplateItem,
)
from app.models.calendar import Meeting
from app.models.enums import ApplicationStatus, MeetingStatus, StageStatus
from app.models.resume import TailoredResume
from app.schemas.common import Page
from app.schemas.tracking import (
    ApplicationCreate,
    ApplicationDetail,
    ApplicationPatch,
    ApplicationRow,
    MeetingOut,
    NextStepSuggestion,
    StageCreate,
    StageOut,
    StagePatch,
    StageUpdated,
)

router = APIRouter(tags=["applications"])

# Passing these effectively decides the application.
TERMINAL_STAGE_KINDS = {"offer", "contract_signed"}


async def _owned(session: Session, user: CurrentUser, app_id: uuid.UUID) -> JobApplication:
    row = await session.scalar(
        select(JobApplication)
        .options(selectinload(JobApplication.stages))
        .where(JobApplication.id == app_id, JobApplication.user_id == user.id)
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return row


@router.post(
    "/applications", response_model=ApplicationDetail, status_code=status.HTTP_201_CREATED
)
async def create_application(
    body: ApplicationCreate, user: CurrentUser, session: Session
) -> JobApplication:
    """Create an application and seed its pipeline from a stage template."""
    if body.tailored_resume_id:
        owns = await session.scalar(
            select(TailoredResume.id).where(
                TailoredResume.id == body.tailored_resume_id,
                TailoredResume.user_id == user.id,
            )
        )
        if owns is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Tailored resume not found"
            )

    row = JobApplication(
        user_id=user.id,
        **body.model_dump(exclude={"stage_template_id"}),
    )
    if row.status is not ApplicationStatus.SAVED and row.applied_at is None:
        row.applied_at = utc_now()
    session.add(row)
    await session.flush()

    template = await session.scalar(
        select(StageTemplate)
        .options(selectinload(StageTemplate.items))
        .where(
            StageTemplate.id == body.stage_template_id
            if body.stage_template_id
            else StageTemplate.user_id == user.id,
            StageTemplate.is_default.is_(True) if not body.stage_template_id else True,
        )
        .limit(1)
    )
    if template:
        for item in template.items:
            session.add(
                ApplicationStage(
                    application_id=row.id,
                    seq=item.seq,
                    name=item.name,
                    kind=item.kind,
                    status=(
                        StageStatus.PASSED if item.kind == "applied" else StageStatus.PENDING
                    ),
                )
            )
    await session.flush()
    await session.refresh(row, ["stages"])
    return row


@router.get("/applications", response_model=Page[ApplicationRow])
async def list_applications(
    user: CurrentUser,
    session: Session,
    status_filter: ApplicationStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, le=300),
    offset: int = 0,
) -> Page[ApplicationRow]:
    """The tracking table.

    Current stage and next meeting are inlined so the table renders in one
    request rather than N+1 lookups per row.
    """
    stmt = select(JobApplication).where(JobApplication.user_id == user.id)
    if status_filter:
        stmt = stmt.where(JobApplication.status == status_filter)

    total = await session.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = list(
        await session.scalars(
            stmt.options(selectinload(JobApplication.stages))
            .order_by(JobApplication.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )

    app_ids = [r.id for r in rows]
    next_meetings: dict[uuid.UUID, Meeting] = {}
    coverage: dict[uuid.UUID, float] = {}

    if app_ids:
        stage_to_app = {
            s.id: r.id for r in rows for s in r.stages
        }
        if stage_to_app:
            meetings = await session.scalars(
                select(Meeting)
                .where(
                    Meeting.stage_id.in_(stage_to_app),
                    Meeting.status == MeetingStatus.SCHEDULED,
                    Meeting.starts_at >= utc_now(),
                )
                .order_by(Meeting.starts_at)
            )
            for m in meetings:
                app_id = stage_to_app[m.stage_id]
                next_meetings.setdefault(app_id, m)

        for app_id, pct in await session.execute(
            select(JobApplication.id, TailoredResume.must_have_coverage_pct).join(
                TailoredResume, JobApplication.tailored_resume_id == TailoredResume.id
            ).where(JobApplication.id.in_(app_ids))
        ):
            if pct is not None:
                coverage[app_id] = float(pct)

    items = []
    for r in rows:
        stages = sorted(r.stages, key=lambda s: s.seq)
        current = next(
            (s for s in stages if s.status in (StageStatus.SCHEDULED, StageStatus.PENDING,
                                               StageStatus.IN_PROGRESS,
                                               StageStatus.WAITING_FEEDBACK)),
            None,
        )
        items.append(
            ApplicationRow(
                **ApplicationRow.model_validate(r).model_dump(
                    exclude={"current_stage", "next_meeting", "stage_count",
                             "stages_passed", "must_have_coverage_pct"}
                ),
                current_stage=StageOut.model_validate(current) if current else None,
                next_meeting=(
                    MeetingOut.model_validate(next_meetings[r.id])
                    if r.id in next_meetings
                    else None
                ),
                stage_count=len(stages),
                stages_passed=sum(1 for s in stages if s.status == StageStatus.PASSED),
                must_have_coverage_pct=coverage.get(r.id),
            )
        )

    return Page(items=items, total=total or 0, limit=limit, offset=offset)


@router.get("/applications/{application_id}", response_model=ApplicationDetail)
async def get_application(
    application_id: uuid.UUID, user: CurrentUser, session: Session
) -> JobApplication:
    return await _owned(session, user, application_id)


@router.patch("/applications/{application_id}", response_model=ApplicationDetail)
async def update_application(
    application_id: uuid.UUID,
    body: ApplicationPatch,
    user: CurrentUser,
    session: Session,
) -> JobApplication:
    row = await _owned(session, user, application_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    return row


@router.delete("/applications/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_application(
    application_id: uuid.UUID, user: CurrentUser, session: Session
) -> None:
    await session.delete(await _owned(session, user, application_id))


@router.post(
    "/applications/{application_id}/stages",
    response_model=StageOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_stage(
    application_id: uuid.UUID, body: StageCreate, user: CurrentUser, session: Session
) -> ApplicationStage:
    app_row = await _owned(session, user, application_id)
    seq = body.seq
    if seq is None:
        seq = 1 + max((s.seq for s in app_row.stages), default=-1)
    row = ApplicationStage(
        application_id=app_row.id, seq=seq, name=body.name, kind=body.kind
    )
    session.add(row)
    await session.flush()
    return row


@router.patch("/stages/{stage_id}", response_model=StageUpdated)
async def update_stage(
    stage_id: uuid.UUID, body: StagePatch, user: CurrentUser, session: Session
) -> StageUpdated:
    """Update a stage, and — when it passes — say what comes next.

    The suggestion in the response is what drives the "schedule the next step"
    prompt in both the tracking table and the calendar, so the behaviour cannot
    drift between the two surfaces.
    """
    stage = await session.scalar(
        select(ApplicationStage)
        .join(JobApplication)
        .where(ApplicationStage.id == stage_id, JobApplication.user_id == user.id)
    )
    if stage is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    application = await _owned(session, user, stage.application_id)
    previous = stage.status

    for field, value in body.model_dump(exclude_unset=True, exclude={"reason"}).items():
        setattr(stage, field, value)

    if body.status and body.status != previous:
        stage.decided_at = (
            utc_now()
            if body.status in (StageStatus.PASSED, StageStatus.FAILED)
            else None
        )
        session.add(
            ApplicationStageEvent(
                stage_id=stage.id,
                from_status=previous,
                to_status=body.status,
                reason=body.reason,
            )
        )
        _advance_application(application, stage, body.status)

    await session.flush()

    suggestion = None
    if body.status == StageStatus.PASSED:
        suggestion = await _suggest_next(session, application, stage)

    return StageUpdated(
        stage=StageOut.model_validate(stage),
        application_status=application.status,
        suggested_next_stage=suggestion,
    )


def _advance_application(
    application: JobApplication, stage: ApplicationStage, new_status: StageStatus
) -> None:
    if new_status == StageStatus.FAILED:
        application.status = ApplicationStatus.REJECTED
    elif new_status == StageStatus.PASSED:
        if stage.kind in TERMINAL_STAGE_KINDS:
            application.status = (
                ApplicationStatus.HIRED
                if stage.kind == "contract_signed"
                else ApplicationStatus.OFFER
            )
        elif application.status in (ApplicationStatus.SAVED, ApplicationStatus.APPLIED):
            application.status = ApplicationStatus.IN_PROCESS


async def _suggest_next(
    session: Session, application: JobApplication, passed: ApplicationStage
) -> NextStepSuggestion | None:
    upcoming = sorted(
        (s for s in application.stages if s.seq > passed.seq), key=lambda s: s.seq
    )
    nxt = next((s for s in upcoming if s.status == StageStatus.PENDING), None)
    if nxt is None:
        return None

    scheduled = await session.scalar(
        select(func.count())
        .select_from(Meeting)
        .where(Meeting.stage_id == nxt.id, Meeting.status == MeetingStatus.SCHEDULED)
    )
    duration = await session.scalar(
        select(StageTemplateItem.default_duration_min)
        .where(StageTemplateItem.kind == nxt.kind)
        .limit(1)
    )
    return NextStepSuggestion(
        stage_id=nxt.id,
        name=nxt.name,
        kind=nxt.kind,
        already_scheduled=bool(scheduled),
        suggested_duration_min=duration,
    )
