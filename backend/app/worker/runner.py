"""The generation worker.

Runs in-process as a background task by default (one process, no extra
infrastructure), and can equally be started standalone with
``python -m app.worker.runner`` when you want it off the web process.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import timedelta

from sqlalchemy import func, select

from app.core.timezone import app_today, utc_now
from app.db.session import SessionLocal
from app.llm.factory import get_provider
from app.llm.provider import LLMError
from app.models.enums import (
    GenerationKind,
    GenerationStatus,
    ResumeSource,
    ResumeStatus,
)
from app.models.generation import Generation
from app.models.resume import CURRENT_MARKDOWN_VERSION, BaseResume, TailoredResume
from app.models.user import UserSettings
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
    if generation.kind in (GenerationKind.RESUME_STORY, GenerationKind.RESUME_JOB):
        stream = pipeline.generate(spec)
    elif generation.kind is GenerationKind.TAILOR_JOB:
        stream = pipeline.tailor(
            base_resume_md=payload["base_resume_md"],
            job_description=payload.get("job_description", ""),
            company=payload.get("company_name"),
            spec=spec,
        )
    elif generation.kind is GenerationKind.TAILOR_INSTRUCTION:
        stream = pipeline.apply_instructions(
            base_resume_md=payload["base_resume_md"],
            instructions=payload.get("instructions", ""),
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
    status = ResumeStatus.NEEDS_REVIEW if result.needs_review else ResumeStatus.FINAL

    if generation.kind is GenerationKind.TAILOR_JOB:
        row = TailoredResume(
            base_resume_id=payload["base_resume_id"],
            display_name=payload.get("display_name")
            or f"{payload.get('company_name') or 'Tailored'} — {payload.get('target_title', '')}".strip(" —"),
            company_name=payload.get("company_name"),
            job_title=payload.get("target_title"),
            job_url=payload.get("job_url"),
            job_source=payload.get("job_source", "web"),
            job_description_text=payload.get("job_description", ""),
            job_description_hash=job_description_hash(payload.get("job_description", "")),
            status=status,
            generation_id=generation.id,
            must_have_covered=result.report.get("must_have_covered"),
            must_have_total=result.report.get("must_have_total"),
            must_have_coverage_percent=result.report.get("must_have_coverage_percent"),
            nice_to_have_coverage_percent=result.report.get("nice_to_have_coverage_percent"),
            years_required=result.report.get("years_required"),
            years_shown=result.report.get("years_shown"),
            **common,
        )
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


if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(level=logging.INFO)
    asyncio.run(worker_loop(asyncio.Event()))
