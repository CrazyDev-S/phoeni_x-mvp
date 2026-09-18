"""How the worker behaves when things go wrong.

Both cases here were found by running a real generation, and both lost the
entire (paid-for) result at the very last step.
"""

from __future__ import annotations

import uuid

import pytest

from app.db.session import SessionLocal
from app.models.enums import GenerationKind, GenerationStatus, ResumeSource
from app.models.generation import Generation
from app.models.resume import BaseResume
from app.models.user import User
from app.services.generation import enqueue
from app.worker.runner import _free_display_name, run_once


@pytest.fixture
async def user_id() -> uuid.UUID:
    async with SessionLocal() as session:
        row = User(email=f"worker-{uuid.uuid4().hex[:8]}@example.com", password_hash="x")
        session.add(row)
        await session.commit()
        return row.id


async def test_a_repeated_title_does_not_collide(user_id) -> None:
    """Regenerating for the same target title produces the same auto-generated
    name, and display names are unique per user. Without this the second run
    dies on the unique index after the whole generation has been paid for."""
    async with SessionLocal() as session:
        session.add(
            BaseResume(
                user_id=user_id,
                display_name="Senior Software Engineer — C#/.NET 8",
                target_title="Senior Software Engineer",
                source=ResumeSource.GENERATED_STORY,
                content_markdown="x",
                content_text="x",
            )
        )
        await session.commit()

    async with SessionLocal() as session:
        first = await _free_display_name(
            session, user_id, "Senior Software Engineer — C#/.NET 8"
        )
        assert first == "Senior Software Engineer — C#/.NET 8 (2)"

        # Case-insensitive, matching the index.
        lowered = await _free_display_name(
            session, user_id, "senior software engineer — c#/.net 8"
        )
        assert lowered.endswith("(2)")

        # An unused name is left alone.
        assert (
            await _free_display_name(session, user_id, "Something Else")
            == "Something Else"
        )


async def test_a_failing_job_is_marked_failed_not_left_running(user_id, monkeypatch) -> None:
    """The error handler used to read an attribute off a detached ORM object,
    raise DetachedInstanceError, and leave the job stuck in RUNNING forever -
    masking whatever actually went wrong."""

    async def boom(session, generation):
        raise RuntimeError("the model exploded")

    monkeypatch.setattr("app.worker.runner._process", boom)

    async with SessionLocal() as session:
        row = await enqueue(
            session,
            user_id=user_id,
            kind=GenerationKind.RESUME_STORY,
            payload={"target_title": "Engineer"},
        )
        await session.commit()
        generation_id = row.id

    assert await run_once() is True

    async with SessionLocal() as session:
        row = await session.get(Generation, generation_id)
        assert row.status is GenerationStatus.FAILED
        assert row.error_code == "RuntimeError"
        # The real cause is recorded, not swallowed by the handler's own crash.
        assert "the model exploded" in row.error_detail
        assert row.finished_at is not None
