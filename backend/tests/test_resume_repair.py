"""The Upgrade button: repairing a saved resume's rule errors in place."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select, update

from app.db.session import SessionLocal
from app.llm.provider import LLMEvent
from app.models.enums import GenerationKind, GenerationStatus, ResumeSource, ResumeStatus
from app.models.generation import Generation
from app.models.resume import BaseResume, TailoredResume
from app.models.user import User, UserSettings
from app.services.generation import enqueue, job_description_hash
from app.worker.runner import run_once
from tests.test_pipeline import ANALYSIS_JSON, FLAGS_JSON, LEDGER_JSON, StubProvider


class StreamingStub(StubProvider):
    """The worker streams every turn so progress shows while it runs."""

    async def stream(self, req):
        response = await self.complete(req)
        yield LLMEvent("text_delta", {"text": response.text})
        yield LLMEvent("done", {"stop_reason": "end_turn"})


@pytest.fixture
async def user_id() -> uuid.UUID:
    async with SessionLocal() as session:
        row = User(email=f"repair-{uuid.uuid4().hex[:8]}@example.com", password_hash="x")
        session.add(row)
        await session.flush()
        # Every recorded LLM call names its provider, which comes from here.
        session.add(UserSettings(user_id=row.id))
        await session.commit()
        return row.id


async def queue_upgrade(user_id: uuid.UUID, markdown: str) -> tuple[uuid.UUID, uuid.UUID]:
    async with SessionLocal() as session:
        resume = BaseResume(
            user_id=user_id,
            display_name="Upgrade me",
            target_title="Senior Engineer",
            source=ResumeSource.GENERATED_STORY,
            content_markdown=markdown,
            content_text="x",
            status=ResumeStatus.NEEDS_REVIEW,
        )
        session.add(resume)
        await session.flush()
        generation = await enqueue(
            session,
            user_id=user_id,
            kind=GenerationKind.RESUME_REPAIR,
            payload={"base_resume_id": str(resume.id)},
        )
        await session.commit()
        return resume.id, generation.id


def use_provider(monkeypatch, provider) -> None:
    async def fake(session, user_id, tier):
        return provider

    monkeypatch.setattr("app.worker.runner.get_provider", fake)


async def test_an_upgrade_rewrites_the_same_resume(user_id, monkeypatch, aran_markdown) -> None:
    broken = aran_markdown.replace("Mentored 4 engineers", "Mentored several engineers")
    resume_id, generation_id = await queue_upgrade(user_id, broken)
    use_provider(monkeypatch, StreamingStub([aran_markdown]))

    assert await run_once() is True

    async with SessionLocal() as session:
        generation = await session.get(Generation, generation_id)
        assert generation.status is not GenerationStatus.FAILED, generation.error_detail
        assert generation.result_id == resume_id

        resume = await session.get(BaseResume, resume_id)
        assert resume.content_markdown == aran_markdown
        assert not any(
            f["rule_id"] == "PLACEHOLDER_TOKEN" for f in resume.validation["findings"]
        )
        # Fixed in place, not saved as a copy.
        count = await session.scalar(
            select(func.count()).select_from(BaseResume).where(BaseResume.user_id == user_id)
        )
        assert count == 1


async def test_an_edit_made_during_the_upgrade_is_not_overwritten(
    user_id, monkeypatch, aran_markdown
) -> None:
    broken = aran_markdown.replace("Mentored 4 engineers", "Mentored several engineers")
    resume_id, generation_id = await queue_upgrade(user_id, broken)
    edited = broken + "\n"

    class UserEditsMidRun(StreamingStub):
        async def stream(self, req):
            async with SessionLocal() as session:
                await session.execute(
                    update(BaseResume)
                    .where(BaseResume.id == resume_id)
                    .values(content_markdown=edited)
                )
                await session.commit()
            async for event in super().stream(req):
                yield event

    use_provider(monkeypatch, UserEditsMidRun([aran_markdown]))
    assert await run_once() is True

    async with SessionLocal() as session:
        generation = await session.get(Generation, generation_id)
        assert generation.status is GenerationStatus.FAILED
        assert generation.error_code == "RESUME_CHANGED"
        assert (await session.get(BaseResume, resume_id)).content_markdown == edited


JD = "Senior AI engineer. Must have FastAPI and React. Kafka is a plus."


async def queue_tailoring(
    user_id: uuid.UUID, markdown: str, *, strategy: str, in_place: bool
) -> tuple[uuid.UUID, uuid.UUID]:
    """A 0/0-scored tailored resume, as tailoring produced before this fix."""
    async with SessionLocal() as session:
        base = BaseResume(
            user_id=user_id,
            display_name=f"Base {uuid.uuid4().hex[:6]}",
            target_title="Senior Engineer",
            source=ResumeSource.GENERATED_STORY,
            content_markdown=markdown,
            content_text="x",
        )
        session.add(base)
        await session.flush()
        tailored = TailoredResume(
            user_id=user_id,
            base_resume_id=base.id,
            display_name="Tailored — Senior AI Engineer",
            job_title="Senior AI Engineer",
            job_source="extension",
            job_description_text=JD,
            job_description_hash=job_description_hash(JD),
            content_markdown=markdown,
            content_text="x",
            status=ResumeStatus.FINAL,
            must_have_covered=0,
            must_have_total=0,
        )
        session.add(tailored)
        await session.flush()
        payload = {
            "base_resume_id": str(base.id),
            "base_resume_md": markdown,
            "job_description": JD,
            "target_title": "Senior AI Engineer",
            "job_source": "extension",
            "mode": "grounded",
            "strategy": strategy,
        }
        if in_place:
            payload["tailored_resume_id"] = str(tailored.id)
        await enqueue(session, user_id=user_id, kind=GenerationKind.TAILOR_JOB, payload=payload)
        await session.commit()
        return tailored.id, base.id


async def tailored_rows(user_id: uuid.UUID) -> list[TailoredResume]:
    async with SessionLocal() as session:
        return list(
            await session.scalars(select(TailoredResume).where(TailoredResume.user_id == user_id))
        )


async def test_upgrading_a_tailored_resume_rescores_it_in_place(
    user_id, monkeypatch, aran_markdown
) -> None:
    tailored_id, _ = await queue_tailoring(user_id, aran_markdown, strategy="existing", in_place=True)
    use_provider(monkeypatch, StreamingStub([ANALYSIS_JSON, aran_markdown]))

    assert await run_once() is True

    [row] = await tailored_rows(user_id)
    assert row.id == tailored_id, "the application's linked resume must be the one rewritten"
    assert (row.must_have_covered, row.must_have_total) == (2, 2)
    assert float(row.must_have_coverage_percent) == 100.0
    assert row.years_required == 7


async def test_re_tailoring_the_same_posting_replaces_the_row(
    user_id, monkeypatch, aran_markdown
) -> None:
    """One non-draft row per (base, posting) is a unique index; a second run
    used to die on it after the whole generation was paid for."""
    tailored_id, _ = await queue_tailoring(user_id, aran_markdown, strategy="existing", in_place=False)
    use_provider(monkeypatch, StreamingStub([ANALYSIS_JSON, aran_markdown]))

    assert await run_once() is True

    async with SessionLocal() as session:
        failed = await session.scalar(
            select(Generation).where(
                Generation.user_id == user_id, Generation.status == GenerationStatus.FAILED
            )
        )
    assert failed is None, failed and failed.error_detail
    [row] = await tailored_rows(user_id)
    assert row.id == tailored_id
    assert row.must_have_total == 2


async def test_a_full_upgrade_rebuilds_from_the_job_description(
    user_id, monkeypatch, aran_markdown
) -> None:
    tailored_id, _ = await queue_tailoring(user_id, aran_markdown, strategy="full", in_place=True)
    provider = StreamingStub([LEDGER_JSON, aran_markdown, FLAGS_JSON])
    use_provider(monkeypatch, provider)

    assert await run_once() is True

    scenario = provider.requests[0].messages[0]["content"]
    assert "FULL UPGRADE" in scenario
    assert JD in scenario
    assert "Aran Thammasiri" in scenario  # the existing resume is the profile

    [row] = await tailored_rows(user_id)
    assert row.id == tailored_id
    assert row.must_have_total == 2
    assert row.flags and row.flags["must_verify"], "a full upgrade writes interview prep"
