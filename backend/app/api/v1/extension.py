"""Endpoints the browser side panel calls.

Thin wrappers over the same services the portal uses — the extension is a
client, not a second implementation.
"""

from __future__ import annotations

import json
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.core.deps import CurrentUser, Session
from app.core.timezone import utc_now
from app.llm.factory import get_provider
from app.models.application import ApplicationStage, JobApplication, StageTemplate
from app.models.enums import (
    ApplicationStatus,
    GenerationKind,
    GenerationStatus,
    ResumeStatus,
    StageStatus,
)
from app.models.generation import Generation
from app.models.job_link import JobLink
from app.models.profile import ApplicationFormAnswer, AutofillProfile
from app.models.resume import BaseResume, TailoredResume
from app.orchestration.form_pipeline import FormContext, answer_form, context_key, fingerprint
from app.orchestration.resume_facts import build_facts, flat_facts
from app.resume.document import Resume
from app.resume.parser import ResumeMarkdownError, parse
from app.schemas.extension import (
    AutofillRequest,
    AutofillResponse,
    ExtensionTailorRequest,
    JobLinkIn,
    JobLinkLookup,
    JobLinkLookupOut,
    JobLinkOut,
    LinkedResume,
    LinkGeneration,
    ResumeFactsOut,
    ResumeRef,
    SaveApplicationRequest,
    ScrapedJob,
)
from app.schemas.generation import GenerationAccepted
from app.schemas.tracking import ApplicationDetail
from app.services.generation import enqueue, idempotency_key, job_description_hash
from app.services.job_links import (
    find_link,
    job_key,
    linked_resume,
    tailored_for_keys,
    upsert_link,
)
from app.services.links import link_resume

router = APIRouter(prefix="/extension", tags=["extension"])

AnyResume = BaseResume | TailoredResume


@router.post(
    "/tailor", response_model=GenerationAccepted, status_code=status.HTTP_202_ACCEPTED
)
async def extension_tailor(
    body: ExtensionTailorRequest, user: CurrentUser, session: Session
) -> GenerationAccepted:
    """Tailor against the page the user has open.

    Nothing is saved as an application here — that only happens if the user
    presses Save afterwards, exactly as the flow requires. The posting is
    linked to the run, though, so the panel can find the result again from any
    tab showing that posting.
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

    link = None
    if body.job.url:
        link = await upsert_link(
            session,
            user.id,
            body.job.url,
            company_name=body.job.company,
            job_title=body.job.title,
            ats=body.job.ats,
            job_description_text=body.job.description_text,
            base_resume_id=base.id,
        )

    # Instant path: the same posting tailored recently returns immediately, so
    # a re-click costs nothing and feels instantaneous.
    cached = body.strategy == "existing" and await session.scalar(
        select(TailoredResume).where(
            TailoredResume.user_id == user.id,
            TailoredResume.base_resume_id == base.id,
            TailoredResume.job_description_hash == job_description_hash(body.job.description_text),
            TailoredResume.status != ResumeStatus.DRAFT,
            # Results from before tailoring read the posting's keywords show
            # 0/0 coverage; re-tailor rather than serve one again.
            TailoredResume.must_have_total > 0,
        )
    )
    if cached:
        if link is not None:
            link.resume_kind = "tailored"
            link.tailored_resume_id = cached.id
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
            "strategy": body.strategy,
        },
        key=idempotency_key(
            "ext-tailor", user.id, base.id, body.job.description_text, body.strategy
        ),
    )
    if link is not None:
        # The worker attaches its result to every link naming this run.
        link.generation_id = gen.id
        if gen.status in (GenerationStatus.SUCCEEDED, GenerationStatus.NEEDS_REVIEW):
            # An identical run that already finished - before this posting was
            # linked to it, so the worker never attached it here.
            finished = gen.result_id and await session.get(TailoredResume, gen.result_id)
            if finished:
                link.resume_kind = "tailored"
                link.tailored_resume_id = finished.id
    return GenerationAccepted(id=gen.id, status=gen.status, kind=gen.kind)


@router.post("/job-links/lookup", response_model=JobLinkLookupOut)
async def lookup_job_links(
    body: JobLinkLookup, user: CurrentUser, session: Session
) -> JobLinkLookupOut:
    """What each open tab's posting already has: a resume, a run in flight, or neither.

    One item per distinct URL. A posting with no link still shows a resume
    tailored from the same URL, so jobs tailored before links existed - or in
    the portal - turn up too.
    """
    keys = {url: job_key(url) for url in body.urls}
    links = {
        row.job_key: row
        for row in await session.scalars(
            select(JobLink).where(
                JobLink.user_id == user.id, JobLink.job_key.in_(set(keys.values()))
            )
        )
    }
    without_resume = {
        key for key in keys.values() if key not in links or links[key].resume_kind is None
    }
    found = await tailored_for_keys(session, user.id, without_resume)
    return JobLinkLookupOut(
        items=[
            await _link_out(session, url, key, links.get(key), found.get(key))
            for url, key in keys.items()
        ]
    )


@router.put("/job-links", response_model=JobLinkOut)
async def link_job(body: JobLinkIn, user: CurrentUser, session: Session) -> JobLinkOut:
    """Use a resume for a posting as it is, without tailoring - or unlink it."""
    resume = await _owned_resume(session, user, body.resume) if body.resume else None
    link = await upsert_link(session, user.id, body.url)
    if body.job is not None:
        # Only what is missing. Linking from the application form reads the
        # form's page, which must not replace a posting read when tailoring.
        read = {
            "company_name": body.job.company,
            "job_title": body.job.title,
            "ats": body.job.ats,
            "job_description_text": body.job.description_text,
        }
        for name, value in read.items():
            if value and not getattr(link, name):
                setattr(link, name, value)
    if resume is None:
        link.resume_kind = None
    elif isinstance(resume, TailoredResume):
        link.resume_kind = "tailored"
        link.tailored_resume_id = resume.id
        link.base_resume_id = resume.base_resume_id
    else:
        link.resume_kind = "base"
        link.base_resume_id = resume.id
    await session.flush()
    return await _link_out(session, body.url, link.job_key, link)


@router.get("/resume-facts", response_model=ResumeFactsOut)
async def resume_facts(
    user: CurrentUser, session: Session, kind: Literal["base", "tailored"], resume_id: uuid.UUID
) -> ResumeFactsOut:
    """A resume's contact details and highlights, ready to copy into a form."""
    row = await _owned_resume(session, user, ResumeRef(kind=kind, id=resume_id))
    autofill = await session.get(AutofillProfile, user.id)
    facts, _ = build_facts(_parsed(row), autofill.fields if autofill else None)
    resume = _resume_out(row)
    assert resume is not None
    return ResumeFactsOut(resume=resume, facts=facts)


@router.post("/autofill", response_model=AutofillResponse)
async def extension_autofill(
    body: AutofillRequest, user: CurrentUser, session: Session
) -> AutofillResponse:
    """Answer a scraped form.

    Synchronous on purpose: this is a fast-tier call of a few seconds, and the
    panel needs the answers in hand before it can touch the page.
    """
    page_url = body.job_url or (body.job.url if body.job else None)
    link = await find_link(session, user.id, page_url) if page_url else None
    resume = await _form_resume(session, user, body, link)

    job = body.job
    if link is not None and link.job_description_text:
        # The posting as read when it was tailored or linked. An application
        # form's own page is mostly the form: poor context for "why us".
        job = ScrapedJob(
            url=link.job_url,
            title=link.job_title,
            company=link.company_name,
            ats=link.ats,
            description_text=link.job_description_text[:60_000],
        )
    request = body.model_copy(update={"job": job})

    autofill = await session.get(AutofillProfile, user.id)
    profile = (autofill.fields if autofill else None) or {}
    notes = autofill.extra_notes_markdown if autofill else None
    facts, from_profile = build_facts(_parsed(resume), profile)
    context = FormContext(
        resume_text=resume.content_text if resume else "",
        resume_name=resume.display_name if resume else None,
        facts=flat_facts(facts),
        profile_facts=frozenset(from_profile),
        autofill_fields=profile,
        notes=notes,
    )
    fingerprint_value = fingerprint(
        request,
        context_key(
            resume.content_markdown if resume else "",
            json.dumps(profile, sort_keys=True),
            notes or "",
            job.description_text if job else "",
        ),
    )
    extras = {
        "form_fingerprint": fingerprint_value,
        "resume": _resume_out(resume),
        "facts": facts,
    }

    cached = await session.scalar(
        select(ApplicationFormAnswer).where(
            ApplicationFormAnswer.user_id == user.id,
            ApplicationFormAnswer.form_fingerprint == fingerprint_value,
        )
    )
    if cached is not None:
        cached.hit_count += 1
        return AutofillResponse.model_validate({**cached.answers, **extras, "cached": True})

    async def fast_model():
        return await get_provider(session, user.id, "fast")

    result = await answer_form(fast_model, request, context=context)
    if result.complete:
        # Two tabs on the same form can answer it at once.
        await session.execute(
            insert(ApplicationFormAnswer)
            .values(
                user_id=user.id,
                form_fingerprint=fingerprint_value,
                ats=job.ats if job else None,
                source_url=page_url,
                answers=result.model_dump(
                    mode="json", exclude={"cached", "form_fingerprint", "resume", "facts"}
                ),
            )
            .on_conflict_do_nothing(index_elements=["user_id", "form_fingerprint"])
        )
    return result.model_copy(update=extras)


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

    description = body.job_description_text
    if not description and body.job_url:
        # Saved from the application form, whose page holds no description;
        # the posting's was kept when it was tailored or linked.
        link = await find_link(session, user.id, body.job_url)
        description = link.job_description_text if link else None

    row = JobApplication(
        user_id=user.id,
        tailored_resume_id=body.tailored_resume_id,
        company_name=body.company_name,
        role_title=body.role_title,
        job_url=body.job_url,
        job_description_text=description,
        location=body.location,
        notes_markdown=body.notes_markdown,
        status=ApplicationStatus.APPLIED,
        origin="extension",
        applied_at=utc_now(),
    )
    session.add(row)
    await session.flush()
    if row.tailored_resume_id:
        await link_resume(session, row, row.tailored_resume_id)

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


async def _owned_resume(session: Session, user: CurrentUser, ref: ResumeRef) -> AnyResume:
    model = TailoredResume if ref.kind == "tailored" else BaseResume
    row = await session.scalar(select(model).where(model.id == ref.id, model.user_id == user.id))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found")
    return row


async def _form_resume(
    session: Session, user: CurrentUser, body: AutofillRequest, link: JobLink | None
) -> AnyResume | None:
    """The resume a form is answered from: the one named, the posting's, then a base."""
    if body.resume is not None:
        return await _owned_resume(session, user, body.resume)
    if link is not None and (row := await linked_resume(session, link)) is not None:
        return row
    if body.base_resume_id:
        row = await session.scalar(
            select(BaseResume).where(
                BaseResume.id == body.base_resume_id, BaseResume.user_id == user.id
            )
        )
        if row is not None:
            return row
    return await session.scalar(
        select(BaseResume)
        .where(BaseResume.user_id == user.id, BaseResume.is_archived.is_(False))
        .order_by(BaseResume.created_at.desc())
        .limit(1)
    )


def _parsed(row: AnyResume | None) -> Resume | None:
    """The resume's document, or None when its markdown no longer parses.

    A resume mid-edit must not stop a form filling; it just answers nothing
    from its facts until it is fixed.
    """
    if row is None:
        return None
    try:
        return parse(row.content_markdown)
    except ResumeMarkdownError:
        return None


def _resume_out(row: AnyResume | None) -> LinkedResume | None:
    if row is None:
        return None
    if isinstance(row, TailoredResume):
        return LinkedResume(
            kind="tailored",
            id=row.id,
            display_name=row.display_name,
            status=row.status,
            company_name=row.company_name,
            job_title=row.job_title,
            must_have_coverage_percent=(
                float(row.must_have_coverage_percent)
                if row.must_have_coverage_percent is not None
                else None
            ),
            base_resume_id=row.base_resume_id,
            application_id=row.job_application_id,
        )
    return LinkedResume(
        kind="base", id=row.id, display_name=row.display_name, status=row.status
    )


async def _link_out(
    session: Session,
    url: str,
    key: str,
    link: JobLink | None,
    found: TailoredResume | None = None,
) -> JobLinkOut:
    resume = (await linked_resume(session, link) if link else None) or found
    generation = (
        await session.get(Generation, link.generation_id) if link and link.generation_id else None
    )
    return JobLinkOut(
        url=url,
        job_key=key,
        linked=link is not None and link.resume_kind is not None,
        company_name=(link.company_name if link else None) or (found.company_name if found else None),
        job_title=(link.job_title if link else None) or (found.job_title if found else None),
        base_resume_id=(link.base_resume_id if link else None)
        or (found.base_resume_id if found else None),
        resume=_resume_out(resume),
        generation=LinkGeneration(
            id=generation.id,
            status=generation.status,
            phase=generation.phase,
            progress_percent=generation.progress_percent,
            error_detail=generation.error_detail,
        )
        if generation
        else None,
    )
