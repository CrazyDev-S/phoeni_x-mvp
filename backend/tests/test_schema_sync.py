"""Enum values added in Python reach a database that already exists.

The tests build their schema from scratch, so a missing label never fails here
- it failed in the running app instead, as a 500 on the first import:
'invalid input value for enum generation_kind: "resume_import"'.
"""

from __future__ import annotations

from sqlalchemy import text

from app.db.schema import _add_missing_enum_values, sync_enum_values
from app.db.session import engine


async def labels(conn, name: str) -> list[str]:
    rows = await conn.execute(
        text(f"SELECT unnest(enum_range(NULL::{name}))::text")
    )
    return [r[0] for r in rows]


async def test_a_label_added_in_python_is_added_to_the_existing_type() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("DROP TYPE IF EXISTS zz_sync_probe"))
        await conn.execute(text("CREATE TYPE zz_sync_probe AS ENUM ('first')"))
    try:
        async with engine.begin() as conn:
            added = await _add_missing_enum_values(
                conn, {"zz_sync_probe": ["first", "second"], "zz_not_created": ["x"]}
            )
        assert added == ["zz_sync_probe.second"]
        async with engine.connect() as conn:
            assert await labels(conn, "zz_sync_probe") == ["first", "second"]
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DROP TYPE IF EXISTS zz_sync_probe"))


async def test_a_current_database_is_left_alone() -> None:
    assert await sync_enum_values() == []
    async with engine.connect() as conn:
        assert "resume_import" in await labels(conn, "generation_kind")
