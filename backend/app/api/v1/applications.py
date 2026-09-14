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
from app.models.resume import BaseResume, TailoredResume
from app.schemas.common import Page
from app.schemas.tracking import (
    ApplicationCreate,
    ApplicationDetail,
    ApplicationPatch,
    ApplicationRow,
    NextStepSuggestion,
    StageCreate,
    StageOut,
    StagePatch,
    StageUpdated,
    TailoredResumeBrief,
    TailoredResumeOption,
)
from app.services.links import link_resume, suggest_resume
from app.services.tracking import load_stage_meetings, stage_out

router = APIRouter(tags=["applications"])

# Passing these effectively decides the application.
TERMINAL_STAGE_KINDS = {"offer", "contract_signed"}

# Still ahead of the candidate, so the first of these is "where they are".
OPEN_STAGE_STATUSES = (
    StageStatus.SCHEDULED,
    StageStatus.PENDING,
    StageStatus.IN_PROGRESS,
    StageStatus.WAITING_FEEDBACK,
    StageStatus.RESCHEDULED,
    StageStatus.NO_SHOW,
)


async def _owned(session: Session, user: CurrentUser, app_id: uuid.UUID) -> JobApplication:
    row = await session.scalar(
        select(JobApplication)
        .options(selectinload(JobApplication.stages))
        .where(JobApplication.id == app_id, JobApplication.user_id == user.id)
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return row


async def _require_tailored(
    session: Session, user: CurrentUser, resume_id: uuid.UUID
) -> None:
    owns = await session.scalar(
        select(TailoredResume.id).where(
            TailoredResume.id == resume_id, TailoredResume.user_id == user.id
        )
    )
    if owns is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tailored resume not found"
        )


async def _detail(session: Session, row: JobApplication) -> ApplicationDetail:
    """The applicant view: pipeline with meetings, and the resume that was sent."""
    stages = sorted(row.stages, key=lambda s: s.seq)
    meetings = await load_stage_meetings(session, (s.id for s in stages))

    brief = None
    if row.tailored_resume_id:
        found = (
            await session.execute(
                select(TailoredResume, BaseResume.display_name)
                .outerjoin(BaseResume, TailoredResume.base_resume_id == BaseResume.id)
                .where(TailoredResume.id == row.tailored_resume_id)
            )
        ).first()
        if found:
            resume, base_name = found
            brief = TailoredResumeBrief(
                id=resume.id,
                display_name=resume.display_name,
                base_resume_id=resume.base_resume_id,
                base_resume_name=base_name,
                status=resume.status.value,
                job_url=resume.job_url,
                job_source=resume.job_source,
                must_have_covered=resume.must_have_covered,
                must_have_total=resume.must_have_total,
                must_have_coverage_percent=_float(resume.must_have_coverage_percent),
                nice_to_have_coverage_percent=_float(resume.nice_to_have_coverage_percent),
                years_required=resume.years_required,
                years_shown=_float(resume.years_shown),
                content_markdown=resume.content_markdown,
                flags=resume.flags,
                created_at=resume.created_at,
            )

    return ApplicationDetail(
        **ApplicationDetail.model_validate(row).model_dump(
            exclude={"stages", "tailored_resume", "suggested_tailored_resume"}
        ),
        stages=[stage_out(s, meetings[s.id]) for s in stages],
        tailored_resume=brief,
        suggested_tailored_resume=await _suggestion(session, row),
    )


async def _suggestion(session: Session, row: JobApplication) -> TailoredResumeOption | None:
    found = await suggest_resume(session, row)
    if found is None:
        return None
    return TailoredResumeOption(
        id=found.id,
        display_name=found.display_name,
        base_resume_id=found.base_resume_id,
        must_have_coverage_percent=_float(found.must_have_coverage_percent),
        created_at=found.created_at,
    )


def _float(value: object) -> float | None:
    return float(value) if value is not None else None


@router.post(
    "/applications", response_model=ApplicationDetail, status_code=status.HTTP_201_CREATED
)
async def create_application(
    body: ApplicationCreate, user: CurrentUser, session: Session
) -> ApplicationDetail:
    """Create an application and seed its pipeline from a stage template."""
    if body.tailored_resume_id:
        await _require_tailored(session, user, body.tailored_resume_id)

    row = JobApplication(
        user_id=user.id,
        **body.model_dump(exclude={"stage_template_id"}),
    )
    if row.status is not ApplicationStatus.SAVED and row.applied_at is None:
        row.applied_at = utc_now()
    session.add(row)
    await session.flush()
    if row.tailored_resume_id:
        await link_resume(session, row, row.tailored_resume_id)

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
    return await _detail(session, row)


@router.get("/applications", response_model=Page[ApplicationRow])
async def list_applications(
    user: CurrentUser,
    session: Session,
    status_filter: ApplicationStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, le=300),
    offset: int = 0,
) -> Page[ApplicationRow]:
    """The tracking table.

    Every stage - with its meetings - is inlined, because each stage is a
    column of the table. Three queries in total, however many rows.
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
    meetings = await load_stage_meetings(session, (s.id for r in rows for s in r.stages))
    coverage: dict[uuid.UUID, float] = {}
    if app_ids:
        for app_id, percent in await session.execute(
            select(JobApplication.id, TailoredResume.must_have_coverage_percent)
            .join(TailoredResume, JobApplication.tailored_resume_id == TailoredResume.id)
            .where(JobApplication.id.in_(app_ids))
        ):
            if percent is not None:
                coverage[app_id] = float(percent)

    now = utc_now()
    items = []
    for r in rows:
        stages = [stage_out(s, meetings[s.id]) for s in sorted(r.stages, key=lambda s: s.seq)]
        current = next((s for s in stages if s.status in OPEN_STAGE_STATUSES), None)
        upcoming = sorted(
            (
                m
                for s in stages
                for m in s.meetings
                if m.status == MeetingStatus.SCHEDULED and m.starts_at >= now
            ),
            key=lambda m: m.starts_at,
        )
        items.append(
            ApplicationRow(
                **ApplicationRow.model_validate(r).model_dump(
                    exclude={"stages", "current_stage", "next_meeting", "stage_count",
                             "stages_passed", "must_have_coverage_percent"}
                ),
                stages=stages,
                current_stage=current,
                next_meeting=upcoming[0] if upcoming else None,
                stage_count=len(stages),
                stages_passed=sum(1 for s in stages if s.status == StageStatus.PASSED),
                must_have_coverage_percent=coverage.get(r.id),
            )
        )

    return Page(items=items, total=total or 0, limit=limit, offset=offset)


@router.get("/applications/{application_id}", response_model=ApplicationDetail)
async def get_application(
    application_id: uuid.UUID, user: CurrentUser, session: Session
) -> ApplicationDetail:
    return await _detail(session, await _owned(session, user, application_id))


@router.patch("/applications/{application_id}", response_model=ApplicationDetail)
async def update_application(
    application_id: uuid.UUID,
    body: ApplicationPatch,
    user: CurrentUser,
    session: Session,
) -> ApplicationDetail:
    row = await _owned(session, user, application_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("tailored_resume_id"):
        await _require_tailored(session, user, data["tailored_resume_id"])
    for field in ("company_name", "role_title", "status"):
        # These columns are NOT NULL; an explicit null means "leave it".
        if field in data and data[field] is None:
            del data[field]
    if "tailored_resume_id" in data:
        await link_resume(session, row, data.pop("tailored_resume_id"))
    for field, value in data.items():
        setattr(row, field, value)
    if "status" in data and row.status is not ApplicationStatus.SAVED and row.applied_at is None:
        row.applied_at = utc_now()
    await session.flush()
    return await _detail(session, row)


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
        if field == "status" and value is None:
            continue
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
        _advance_application(application, stage, previous, body.status)

    await session.flush()

    suggestion = None
    if body.status == StageStatus.PASSED:
        suggestion = await _suggest_next(session, application, stage)

    meetings = await load_stage_meetings(session, [stage.id])
    return StageUpdated(
        stage=stage_out(stage, meetings[stage.id]),
        application_status=application.status,
        suggested_next_stage=suggestion,
    )


def _advance_application(
    application: JobApplication,
    stage: ApplicationStage,
    previous: StageStatus,
    new_status: StageStatus,
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
    # Undoing a mis-click. A stage that no longer says "failed" cannot be what
    # rejected the application, and an offer stage that no longer says "passed"
    # cannot be what produced the offer.
    elif (previous == StageStatus.FAILED and application.status == ApplicationStatus.REJECTED) or (
        previous == StageStatus.PASSED
        and stage.kind in TERMINAL_STAGE_KINDS
        and application.status in (ApplicationStatus.OFFER, ApplicationStatus.HIRED)
    ):
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
