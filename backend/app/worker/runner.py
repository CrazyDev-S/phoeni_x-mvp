"""The generation worker.

Runs in-process as a background task by default (one process, no extra
infrastructure), and can equally be started standalone with
``python -m app.worker.runner`` when you want it off the web process.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from datetime import timedelta

from sqlalchemy import select

from app.core.config import get_settings
from app.core.timezone import app_today, utc_now
from app.db.session import SessionLocal
from app.llm.factory import get_provider
from app.llm.prompts import FULL_UPGRADE_INSTRUCTIONS, IMPORT_SYSTEM, PREP_SYSTEM
from app.llm.provider import LLMError
from app.llm.schemas import SCENARIO_LEDGER, shape
from app.models.application import JobApplication
from app.models.enums import (
    GenerationKind,
    GenerationStatus,
    ResumeSource,
    ResumeStatus,
)
from app.models.generation import Generation
from app.models.job_link import JobLink
from app.models.resume import CURRENT_MARKDOWN_VERSION, BaseResume, TailoredResume
from app.models.user import UserSettings
from app.remote.orchestration import ats_report
from app.remote.orchestration.resume_pipeline import (
    GenerationResult,
    PipelineInput,
    ResumePipeline,
)
from app.remote.resume.parser import ResumeMarkdownError
from app.remote.services.links import (
    link_application_posting,
    link_posting_applications,
    link_resume,
)
from app.remote.services.resumes import free_display_name as _free_display_name
from app.services.generation import (
    claim_next,
    emit,
    emit_now,
    is_cancelled,
    job_description_hash,
    reclaim_stale,
    record_calls,
)

log = logging.getLogger("worker")
POLL_SECONDS = 1.0
# A job that has emitted nothing for this long is presumed abandoned. The
# slowest healthy gap is one model turn, well under a minute on the heavy
# tier, so this leaves generous headroom.
STALE_AFTER = timedelta(minutes=10)
# How often a running job is checked for a Stop. A model turn can take a
# minute, so this is the most a stopped run keeps spending.
STOP_POLL_SECONDS = 1.0


async def run_once() -> bool:
    """Claim and process one job. Returns False when the queue is empty."""
    async with SessionLocal() as session:
        # A worker that died mid-job left its row in RUNNING; nothing else
        # would ever pick it up.
        if await reclaim_stale(session, older_than=STALE_AFTER):
            await session.commit()
        claimed = await claim_next(session)
        if claimed is None:
            return False
        # Keep the plain UUID, not the ORM object. Once its session closes the
        # instance is detached, and reading any attribute from the error
        # handler raises DetachedInstanceError - which masks the real failure
        # and leaves the job stuck in RUNNING forever.
        generation_id = claimed.id
        await session.commit()

    try:
        await _run_until_stopped(generation_id)
    except Exception as exc:
        log.exception("generation %s failed", generation_id)
        async with SessionLocal() as session:
            row = await session.get(Generation, generation_id)
            if row.status is GenerationStatus.CANCELLED:
                # Stopped by the user; the error is just the abort unwinding.
                return True
            row.status = GenerationStatus.FAILED
            row.finished_at = utc_now()
            row.error_code = getattr(exc, "code", type(exc).__name__)
            row.error_detail = str(exc)[:2000]
            await emit(
                session, row.id, "error",
                {"code": row.error_code, "detail": row.error_detail},
            )
            await session.commit()
    return True


async def _run_job(generation_id: uuid.UUID) -> None:
    async with SessionLocal() as session:
        generation = await session.get(Generation, generation_id)
        await _process(session, generation)
        await session.commit()


async def _watch_for_stop(generation_id: uuid.UUID) -> None:
    while True:
        await asyncio.sleep(STOP_POLL_SECONDS)
        try:
            if await is_cancelled(generation_id):
                return
        except Exception:
            # A database blip must not end the watch, or Stop stops working.
            log.exception("stop check for %s failed", generation_id)


async def _run_until_stopped(generation_id: uuid.UUID) -> None:
    """Run a job, abandoning it the moment the user stops it.

    Cancelling the task cuts the in-flight model request, so a stopped run
    stops costing money rather than finishing in the background and being
    thrown away.
    """
    job = asyncio.create_task(_run_job(generation_id))
    watcher = asyncio.create_task(_watch_for_stop(generation_id))
    try:
        await asyncio.wait({job, watcher}, return_when=asyncio.FIRST_COMPLETED)
        if job.done():
            job.result()
        else:
            log.info("generation %s stopped by the user", generation_id)
    finally:
        for task in (job, watcher):
            task.cancel()
        await asyncio.gather(job, watcher, return_exceptions=True)


async def _was_stopped(session, generation: Generation) -> bool:
    """Whether the user stopped the job, checked under a lock on its row.

    The lock is held until the worker commits, so a Stop arriving after this
    check waits and then finds the job finished (and is refused), instead of
    marking a saved result cancelled.
    """
    status = await session.scalar(
        select(Generation.status).where(Generation.id == generation.id).with_for_update()
    )
    return status is GenerationStatus.CANCELLED


async def _process(session, generation: Generation) -> None:
    payload = generation.input or {}
    if generation.kind is GenerationKind.PROPOSAL:
        # The Freelancing engine. Today it needs no model, so it must not go
        # through get_provider, which would refuse a user with no API key.
        from app.freelancing.proposals.run import run_proposal_generation

        await run_proposal_generation(session, generation)
        return

    settings = await session.get(UserSettings, generation.user_id)
    tier = "fast" if generation.kind is GenerationKind.JD_PARSE else "heavy"

    provider = await get_provider(session, generation.user_id, tier)
    generation.provider = settings.default_provider if settings else None
    generation.model = getattr(provider, "model", None)

    spec = PipelineInput(
        target_title=payload.get("target_title", ""),
        mode=payload.get("mode", "grounded"),
        base_country=(settings.base_country if settings else "Thailand"),
        job_description=payload.get("job_description"),
        candidate_profile=payload.get("candidate_profile"),
        extra_instructions=payload.get("extra_instructions"),
        skill_count=payload.get("skill_count"),
        allow_real_company_names=bool(settings and settings.allow_real_company_names),
        strict_dossier=bool(settings and settings.strict_dossier),
        research_dossiers=bool(settings and settings.research_dossiers),
        today=app_today(settings.display_timezone if settings else "America/New_York"),
        imported=generation.kind is GenerationKind.RESUME_IMPORT,
    )

    pipeline = ResumePipeline(
        provider,
        research_dossiers=spec.research_dossiers,
        system_prompt={
            GenerationKind.RESUME_IMPORT: IMPORT_SYSTEM,
            GenerationKind.RESUME_PREP: PREP_SYSTEM,
        }.get(generation.kind),
    )
    # Lets a long turn report progress while it is still running.
    pipeline.on_event = lambda event: emit_now(generation.id, event.type, event.data)
    # Set when the job rewrites an existing row, so a user edit saved while it
    # ran is detected instead of overwritten.
    target: BaseResume | TailoredResume | None = None
    repaired_from: str | None = None
    if generation.kind in (GenerationKind.RESUME_STORY, GenerationKind.RESUME_JOB):
        stream = pipeline.generate(spec)
    elif generation.kind is GenerationKind.TAILOR_JOB:
        base = await session.get(BaseResume, uuid.UUID(payload["base_resume_id"]))
        # Tailoring a job's resume rewrites that resume, of either kind.
        in_place = payload.get("tailored_resume_id") or payload.get("base_in_place")
        if payload.get("tailored_resume_id"):
            target = await session.get(
                TailoredResume, uuid.UUID(payload["tailored_resume_id"])
            )
        elif payload.get("base_in_place"):
            target = base
        if in_place:
            if target is None or target.user_id != generation.user_id:
                raise LLMError("RESUME_NOT_FOUND", "The resume to upgrade no longer exists.")
            repaired_from = target.content_markdown

        if payload.get("strategy") == "full":
            # A new resume built for the posting, with the existing one as the
            # candidate's profile - the same path as generating from a job.
            spec.job_description = payload.get("job_description", "")
            spec.candidate_profile = base.content_markdown if base else payload["base_resume_md"]
            spec.mode = str(base.mode) if base else "grounded"
            spec.extra_instructions = FULL_UPGRADE_INSTRUCTIONS
            stream = pipeline.generate(spec)
        else:
            ledger = (target.ledger if target else None) or (base.ledger if base else None)
            stream = pipeline.tailor(
                # The resume as it is now, not as it was when the run was queued.
                base_resume_md=repaired_from or payload["base_resume_md"],
                job_description=payload.get("job_description", ""),
                company=payload.get("company_name"),
                spec=spec,
                ledger=_stored_ledger(ledger),
            )
    elif generation.kind is GenerationKind.TAILOR_INSTRUCTION:
        stream = pipeline.apply_instructions(
            base_resume_md=payload["base_resume_md"],
            instructions=payload.get("instructions", ""),
            spec=spec,
        )
    elif generation.kind is GenerationKind.RESUME_IMPORT:
        stream = pipeline.import_document(
            source_text=payload["source_text"],
            filename=payload.get("filename") or "resume",
            spec=spec,
        )
    elif generation.kind is GenerationKind.RESUME_PREP:
        row = await _prep_target(session, generation, payload)
        spec.target_title = (
            row.job_title if isinstance(row, TailoredResume) else row.target_title
        ) or ""
        spec.job_description = row.job_description_text
        stream = pipeline.prepare(
            resume_md=row.content_markdown,
            spec=spec,
            origin=_origin(row),
            ledger=_stored_ledger(row.ledger),
        )
    elif generation.kind is GenerationKind.RESUME_REPAIR:
        target = await session.get(BaseResume, uuid.UUID(payload["base_resume_id"]))
        if target is None or target.user_id != generation.user_id:
            raise LLMError("RESUME_NOT_FOUND", "The resume to upgrade no longer exists.")
        repaired_from = target.content_markdown
        spec.mode = str(target.mode)
        spec.target_title = target.target_title
        stream = pipeline.upgrade(
            base_resume_md=repaired_from,
            ledger=_stored_ledger(target.ledger),
            spec=spec,
        )
    else:
        raise ValueError(f"unsupported generation kind {generation.kind}")

    result: GenerationResult | None = None
    try:
        async for event in stream:
            if event.type == "done":
                result = event.data["result"]
                break
            # Committed immediately in its own transaction. Writing it here
            # would hide it until the whole job finished.
            await emit_now(generation.id, event.type, event.data)
    except ResumeMarkdownError as exc:
        raise LLMError("CRM_UNPARSEABLE", str(exc)) from exc

    assert result is not None
    if target is not None and repaired_from is not None:
        # Minutes pass during an upgrade. Writing over an edit the user saved
        # meanwhile would silently throw their change away.
        await session.refresh(target)
        if target.content_markdown != repaired_from:
            raise LLMError(
                "RESUME_CHANGED",
                "The resume was edited while the upgrade ran, so the upgrade was "
                "not saved. Run it again on the saved version.",
            )
    await record_calls(session, generation, result.calls)
    if await _was_stopped(session, generation):
        # Spent, so recorded - but never saved, linked, or announced.
        return
    await _persist(session, generation, payload, result)

    generation.status = (
        GenerationStatus.NEEDS_REVIEW if result.needs_review else GenerationStatus.SUCCEEDED
    )
    generation.finished_at = utc_now()
    generation.progress_percent = 100
    await emit(
        session, generation.id, "complete",
        {
            "result_kind": generation.result_kind,
            "result_id": str(generation.result_id) if generation.result_id else None,
            "needs_review": result.needs_review,
            "findings": [f.as_dict() for f in result.findings],
            "report": result.report,
            "usage": result.usage,
        },
    )


async def _persist(session, generation: Generation, payload: dict, result) -> None:
    """Where a result lands depends on the kind.

    Job-based tailoring becomes a tailored_resume; instruction-based editing
    saves back to base_resumes. That routing is a product requirement, not an
    implementation detail. Tailoring a job's own resume rewrites that resume,
    whichever table it is in.
    """
    status = ResumeStatus.NEEDS_REVIEW if result.needs_review else ResumeStatus.FINAL

    if generation.kind is GenerationKind.RESUME_PREP:
        # Only the prep changes; the resume, its rules and its report stay.
        row = await _prep_target(session, generation, payload)
        row.flags = result.flags
        generation.result_kind = f"{payload['resume_kind']}_resume"
        generation.result_id = row.id
        return

    if generation.kind is GenerationKind.RESUME_REPAIR:
        # An upgrade fixes the resume the user is looking at, not a copy. The
        # ledger and interview prep describe the same scenario, so they stay.
        row = await session.get(BaseResume, uuid.UUID(payload["base_resume_id"]))
        row.content_markdown = result.content_markdown
        row.content_text = result.content_text
        row.markdown_version = CURRENT_MARKDOWN_VERSION
        row.validation = {"findings": [f.as_dict() for f in result.findings]}
        row.ats_report = result.report or row.ats_report
        row.status = status
        generation.result_kind = "base_resume"
        generation.result_id = row.id
        return

    common = {
        "user_id": generation.user_id,
        "content_markdown": result.content_markdown,
        "content_text": result.content_text,
        "markdown_version": CURRENT_MARKDOWN_VERSION,
        "ledger": result.ledger_record(),
        "ats_report": result.report or None,
        "flags": result.flags,
        "validation": {"findings": [f.as_dict() for f in result.findings]},
        "generation_meta": {
            "mode": payload.get("mode"),
            **result.usage,
            **(
                {"source_file": payload.get("filename"), "source_kind": payload.get("source_kind")}
                if generation.kind is GenerationKind.RESUME_IMPORT
                else {}
            ),
        },
    }

    if generation.kind is GenerationKind.TAILOR_JOB and payload.get("base_in_place"):
        # The base resume linked to a job, rewritten for it rather than copied.
        # It keeps its name and title; its report now describes this job.
        row = await session.get(BaseResume, uuid.UUID(payload["base_resume_id"]))
        for key, value in common.items():
            # What the generation that made it recorded stays.
            if key == "generation_meta" or (
                key in ("ledger", "flags", "ats_report") and value is None
            ):
                continue
            setattr(row, key, value)
        row.job_description_text = payload.get("job_description") or row.job_description_text
        row.status = status
        generation.result_kind = "base_resume"
    elif generation.kind is GenerationKind.TAILOR_JOB:
        jd_hash = job_description_hash(payload.get("job_description", ""))
        if payload.get("tailored_resume_id"):
            row = await session.get(TailoredResume, uuid.UUID(payload["tailored_resume_id"]))
            if row.job_description_hash != jd_hash:
                await _retarget(session, row, payload, jd_hash)
        else:
            # A unique index allows one non-draft row per (base, posting). A
            # re-run - forced, or a full upgrade - replaces that row rather than
            # dying on the index after the whole generation was paid for.
            row = await session.scalar(
                select(TailoredResume).where(
                    TailoredResume.base_resume_id == uuid.UUID(payload["base_resume_id"]),
                    TailoredResume.job_description_hash == jd_hash,
                    TailoredResume.status != ResumeStatus.DRAFT,
                )
            )
        outcome = {
            **common,
            "status": status,
            "generation_id": generation.id,
            **ats_report.coverage_columns(result.report),
        }
        if row is None:
            row = TailoredResume(
                base_resume_id=payload["base_resume_id"],
                display_name=payload.get("display_name")
                or f"{payload.get('company_name') or 'Tailored'} — {payload.get('target_title', '')}".strip(" —"),
                company_name=payload.get("company_name"),
                job_title=payload.get("target_title"),
                job_url=payload.get("job_url"),
                job_source=payload.get("job_source", "web"),
                job_description_text=payload.get("job_description", ""),
                job_description_hash=jd_hash,
                **outcome,
            )
        else:
            for key, value in outcome.items():
                # A tailoring pass writes no interview prep; keep what exists.
                if key == "flags" and value is None:
                    continue
                setattr(row, key, value)
        generation.result_kind = "tailored_resume"
    else:
        source = {
            GenerationKind.RESUME_STORY: ResumeSource.GENERATED_STORY,
            GenerationKind.RESUME_JOB: ResumeSource.GENERATED_JOB,
            GenerationKind.TAILOR_INSTRUCTION: ResumeSource.TAILORED_INSTRUCTION,
            GenerationKind.RESUME_IMPORT: ResumeSource.UPLOAD,
        }[generation.kind]
        row = BaseResume(
            display_name=await _free_display_name(
                session,
                generation.user_id,
                payload.get("display_name") or _auto_name(generation, result, payload),
            ),
            target_title=payload.get("target_title") or result.resume.header.title,
            stack_label=payload.get("stack_label"),
            stack_tags=_stack_tags(result),
            source=source,
            mode=payload.get("mode", "grounded"),
            job_description_text=payload.get("job_description"),
            status=status,
            source_generation_id=generation.id,
            **common,
        )
        generation.result_kind = "base_resume"
        if generation.kind is GenerationKind.RESUME_IMPORT:
            # The uploaded text has done its job; the resume is the record.
            generation.input = {k: v for k, v in payload.items() if k != "source_text"}

    session.add(row)
    await session.flush()
    generation.result_id = row.id

    # Every posting the side panel started this run from - two tabs can be the
    # same job - now uses its result, even if the panel was closed. So does an
    # application tracking that posting.
    postings = await session.scalars(
        select(JobLink).where(
            JobLink.generation_id == generation.id,
            JobLink.user_id == generation.user_id,
        )
    )
    for link in postings:
        if isinstance(row, TailoredResume):
            link.resume_kind = "tailored"
            link.tailored_resume_id = row.id
        else:
            link.resume_kind = "base"
            link.base_resume_id = row.id
        await link_posting_applications(session, link)

    if generation.kind is GenerationKind.TAILOR_JOB and payload.get("application_id"):
        # Tailored from a tracked application: link it there, on both sides.
        application = await session.get(JobApplication, uuid.UUID(payload["application_id"]))
        if application is not None and application.user_id == generation.user_id:
            await link_resume(session, application, tailored_id=row.id)
            await link_application_posting(session, application)


async def _retarget(session, row: TailoredResume, payload: dict, jd_hash: bytes) -> None:
    """A tailored resume tailored to a different job now describes that job."""
    clash = await session.scalar(
        select(TailoredResume).where(
            TailoredResume.base_resume_id == row.base_resume_id,
            TailoredResume.job_description_hash == jd_hash,
            TailoredResume.status != ResumeStatus.DRAFT,
            TailoredResume.id != row.id,
        )
    )
    if clash is not None:
        raise LLMError(
            "ALREADY_TAILORED",
            f"“{clash.display_name}” is already tailored from the same base resume for "
            "this job, so the upgrade was not saved. Link that one instead.",
        )
    row.job_description_text = payload.get("job_description", "")
    row.job_description_hash = jd_hash
    # The flags' gaps were the old job's.
    row.flags = None
    for key, value in (
        ("company_name", payload.get("company_name")),
        ("job_title", payload.get("target_title")),
        ("job_url", payload.get("job_url")),
    ):
        if value:
            setattr(row, key, value)


def _auto_name(generation: Generation, result, payload: dict) -> str:
    """Display name carries the stack, per the product requirement."""
    if generation.kind is GenerationKind.RESUME_IMPORT:
        header = result.resume.header
        return f"{header.name} — {header.title}"
    title = payload.get("target_title") or result.resume.header.title
    tags = _stack_tags(result)[:2]
    return f"{title} — {'/'.join(tags)}" if tags else title


def _stack_tags(result) -> list[str]:
    tags: list[str] = []
    for category in result.resume.skills:
        tags.extend(category.items[:2])
    return tags[:8]


async def _prep_target(
    session, generation: Generation, payload: dict
) -> BaseResume | TailoredResume:
    model = TailoredResume if payload.get("resume_kind") == "tailored" else BaseResume
    row = await session.get(model, uuid.UUID(payload["resume_id"]))
    if row is None or row.user_id != generation.user_id:
        raise LLMError("RESUME_NOT_FOUND", "The resume no longer exists.")
    return row


def _origin(row: BaseResume | TailoredResume) -> str:
    if isinstance(row, TailoredResume):
        return "tailored for the job description below from the candidate's base resume"
    if row.source is ResumeSource.UPLOAD:
        return "the candidate's own resume, uploaded by them"
    if row.mode == "constructed":
        return "generated as a constructed scenario; the ledger records how"
    return "generated from the candidate's own career history"


def _stored_ledger(raw: dict | None) -> dict | None:
    """A saved ledger in the scenario's shape, or None when the resume has none."""
    return shape(SCENARIO_LEDGER, raw) if raw else None


async def worker_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            worked = await run_once()
        except Exception:
            log.exception("worker loop error")
            worked = False
        if not worked:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=POLL_SECONDS)


async def run_workers(stop: asyncio.Event, count: int) -> None:
    """Several loops over the one queue.

    SKIP LOCKED in claim_next keeps two loops from taking the same job.
    """
    await asyncio.gather(*(worker_loop(stop) for _ in range(count)))


if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_workers(asyncio.Event(), get_settings().worker_concurrency))
