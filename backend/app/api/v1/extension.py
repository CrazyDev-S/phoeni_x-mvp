"""Endpoints the browser side panel calls.

Thin wrappers over the same services the portal uses — the extension is a
client, not a second implementation.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, Session
from app.core.timezone import utc_now
from app.llm.factory import get_provider
from app.models.application import ApplicationStage, JobApplication, StageTemplate
from app.models.enums import ApplicationStatus, GenerationKind, StageStatus
from app.models.profile import ApplicationFormAnswer, AutofillProfile
from app.models.resume import BaseResume, TailoredResume
from app.orchestration.form_pipeline import answer_form, fingerprint
from app.schemas.extension import (
    AutofillRequest,
    AutofillResponse,
    ExtensionTailorRequest,
    SaveApplicationRequest,
)
from app.schemas.generation import GenerationAccepted
from app.schemas.tracking import ApplicationDetail
from app.services.generation import enqueue, idempotency_key, job_description_hash

router = APIRouter(prefix="/extension", tags=["extension"])


@router.post(
    "/tailor", response_model=GenerationAccepted, status_code=status.HTTP_202_ACCEPTED
)
async def extension_tailor(
    body: ExtensionTailorRequest, user: CurrentUser, session: Session
) -> GenerationAccepted:
    """Tailor against the page the user has open.

    Nothing is saved as an application here — that only happens if the user
    presses Save afterwards, exactly as the flow requires.
    """
    base = await session.scalar(
        select(BaseResume).where(
            BaseResume.id == body.base_resume_id, BaseResume.user_id == user.id
        )
    )
    if base is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Base resume not found"
        )

    # Instant path: the same posting tailored recently returns immediately, so
    # a re-click costs nothing and feels instantaneous.
    cached = await session.scalar(
        select(TailoredResume).where(
            TailoredResume.user_id == user.id,
            TailoredResume.base_resume_id == base.id,
            TailoredResume.job_description_hash == job_description_hash(body.job.description_text),
        )
    )
    if cached is not None:
        return GenerationAccepted(
            id=cached.generation_id or cached.id,
            status="succeeded",
            kind=GenerationKind.TAILOR_JOB,
            reused=True,
            result_kind="tailored_resume",
            result_id=cached.id,
        )

    gen = await enqueue(
        session,
        user_id=user.id,
        kind=GenerationKind.TAILOR_JOB,
        payload={
            "base_resume_id": str(base.id),
            "base_resume_md": base.content_markdown,
            "job_description": body.job.description_text,
            "job_url": body.job.url,
            "company_name": body.job.company,
            "target_title": body.job.title or base.target_title,
            "job_source": "extension",
            "mode": "grounded",
        },
        key=idempotency_key("ext-tailor", user.id, base.id, body.job.description_text),
    )
    return GenerationAccepted(id=gen.id, status=gen.status, kind=gen.kind)


@router.post("/autofill", response_model=AutofillResponse)
async def extension_autofill(
    body: AutofillRequest, user: CurrentUser, session: Session
) -> AutofillResponse:
    """Answer a scraped form.

    Synchronous on purpose: this is a fast-tier call of a few seconds, and the
    panel needs the answers in hand before it can touch the page.
    """
    resume_text = ""
    if body.base_resume_id:
        row = await session.scalar(
            select(BaseResume).where(
                BaseResume.id == body.base_resume_id, BaseResume.user_id == user.id
            )
        )
        resume_text = row.content_text if row else ""
    if not resume_text:
        row = await session.scalar(
            select(BaseResume)
            .where(BaseResume.user_id == user.id, BaseResume.is_archived.is_(False))
            .order_by(BaseResume.created_at.desc())
            .limit(1)
        )
        resume_text = row.content_text if row else ""

    autofill = await session.get(AutofillProfile, user.id)
    fields = autofill.fields if autofill else {}

    fingerprint_value = fingerprint(body)
    cached = await session.scalar(
        select(ApplicationFormAnswer).where(
            ApplicationFormAnswer.user_id == user.id,
            ApplicationFormAnswer.form_fingerprint == fingerprint_value,
        )
    )
    if cached is not None:
        cached.hit_count += 1
        return AutofillResponse.model_validate(
            {**cached.answers, "cached": True, "form_fingerprint": fingerprint_value}
        )

    provider = await get_provider(session, user.id, "fast")
    result = await answer_form(
        provider, body, resume_text=resume_text, autofill_fields=fields
    )

    session.add(
        ApplicationFormAnswer(
            user_id=user.id,
            form_fingerprint=fingerprint_value,
            ats=body.job.ats if body.job else None,
            source_url=body.job.url if body.job else None,
            answers=result.model_dump(exclude={"cached", "form_fingerprint"}),
        )
    )
    return result


@router.post(
    "/save-application",
    response_model=ApplicationDetail,
    status_code=status.HTTP_201_CREATED,
)
async def extension_save_application(
    body: SaveApplicationRequest, user: CurrentUser, session: Session
) -> JobApplication:
    """Promote a tailoring session into a tracked application."""
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
        tailored_resume_id=body.tailored_resume_id,
        company_name=body.company_name,
        role_title=body.role_title,
        job_url=body.job_url,
        job_description_text=body.job_description_text,
        location=body.location,
        notes_markdown=body.notes_markdown,
        status=ApplicationStatus.APPLIED,
        origin="extension",
        applied_at=utc_now(),
    )
    session.add(row)
    await session.flush()

    template = await session.scalar(
        select(StageTemplate).where(
            StageTemplate.user_id == user.id, StageTemplate.is_default.is_(True)
        )
    )
    if template:
        await session.refresh(template, ["items"])
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
