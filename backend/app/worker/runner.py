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

from pydantic import ValidationError
from sqlalchemy import func, select, update

from app.core.config import get_settings
from app.core.timezone import app_today, utc_now
from app.db.session import SessionLocal
from app.llm.factory import get_provider
from app.llm.prompts import FULL_UPGRADE_INSTRUCTIONS
from app.llm.provider import LLMError
from app.llm.schemas import ScenarioLedger
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
from app.orchestration import ats_report
from app.orchestration.resume_pipeline import (
    GenerationResult,
    PipelineInput,
    ResumePipeline,
)
from app.resume.parser import ResumeMarkdownError
from app.services.generation import (
    claim_next,
    emit,
    emit_now,
    job_description_hash,
    reclaim_stale,
    record_calls,
)
from app.services.links import link_resume

log = logging.getLogger("worker")
POLL_SECONDS = 1.0
# A job that has emitted nothing for this long is presumed abandoned. The
# slowest healthy gap is one model turn, well under a minute on the heavy
# tier, so this leaves generous headroom.
STALE_AFTER = timedelta(minutes=10)


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
        async with SessionLocal() as session:
            generation = await session.get(Generation, generation_id)
            await _process(session, generation)
            await session.commit()
    except Exception as exc:
        log.exception("generation %s failed", generation_id)
        async with SessionLocal() as session:
            row = await session.get(Generation, generation_id)
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


async def _process(session, generation: Generation) -> None:
    payload = generation.input or {}
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
    )

    pipeline = ResumePipeline(provider, research_dossiers=spec.research_dossiers)
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
        if payload.get("tailored_resume_id"):
            target = await session.get(
                TailoredResume, uuid.UUID(payload["tailored_resume_id"])
            )
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
                base_resume_md=payload["base_resume_md"],
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
    implementation detail.
    """
    status = ResumeStatus.NEEDS_REVIEW if result.needs_review else ResumeStatus.FINAL

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
        "ledger": result.ledger.model_dump() if result.ledger else None,
        "ats_report": result.report or None,
        "flags": result.flags.model_dump() if result.flags else None,
        "validation": {"findings": [f.as_dict() for f in result.findings]},
        "generation_meta": {"mode": payload.get("mode"), **result.usage},
    }

    if generation.kind is GenerationKind.TAILOR_JOB:
        jd_hash = job_description_hash(payload.get("job_description", ""))
        if payload.get("tailored_resume_id"):
            row = await session.get(TailoredResume, uuid.UUID(payload["tailored_resume_id"]))
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
        }[generation.kind]
        row = BaseResume(
            display_name=await _free_display_name(
                session,
                generation.user_id,
                payload.get("display_name") or _auto_name(result, payload),
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

    session.add(row)
    await session.flush()
    generation.result_id = row.id

    if generation.kind is GenerationKind.TAILOR_JOB:
        # Every posting the side panel started this run from - two tabs can be
        # the same job - now uses its result, even if the panel was closed.
        await session.execute(
            update(JobLink)
            .where(
                JobLink.generation_id == generation.id,
                JobLink.user_id == generation.user_id,
            )
            .values(resume_kind="tailored", tailored_resume_id=row.id)
        )

    if generation.kind is GenerationKind.TAILOR_JOB and payload.get("application_id"):
        # Tailored from a tracked application: link it there, on both sides.
        application = await session.get(JobApplication, uuid.UUID(payload["application_id"]))
        if application is not None and application.user_id == generation.user_id:
            await link_resume(session, application, row.id)


async def _free_display_name(session, user_id, wanted: str) -> str:
    """Find a name no existing resume is using.

    Display names are unique per user, and regenerating for the same target
    title produces the same auto-generated name every time. Without this, a
    re-run fails on the unique index at the very last step - after the whole
    generation has been paid for.
    """
    taken = set(
        await session.scalars(
            select(func.lower(BaseResume.display_name)).where(
                BaseResume.user_id == user_id, BaseResume.is_archived.is_(False)
            )
        )
    )
    if wanted.lower() not in taken:
        return wanted
    for suffix in range(2, 100):
        candidate = f"{wanted} ({suffix})"
        if candidate.lower() not in taken:
            return candidate
    return f"{wanted} ({utc_now():%Y-%m-%d %H:%M:%S})"


def _auto_name(result, payload: dict) -> str:
    """Display name carries the stack, per the product requirement."""
    title = payload.get("target_title") or result.resume.header.title
    tags = _stack_tags(result)[:2]
    return f"{title} — {'/'.join(tags)}" if tags else title


def _stack_tags(result) -> list[str]:
    tags: list[str] = []
    for category in result.resume.skills:
        tags.extend(category.items[:2])
    return tags[:8]


def _stored_ledger(raw: dict | None) -> ScenarioLedger | None:
    """A saved ledger, or None when the resume never had a valid one."""
    if not raw:
        return None
    try:
        return ScenarioLedger.model_validate(raw)
    except ValidationError:
        return None


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
