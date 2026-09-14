"""Database schema creation.

The SQLAlchemy models are the single source of truth: tables come from
``Base.metadata``, so adding a column is a model edit and nothing else.

Two things cannot come from the metadata and are stated here instead:
the ``citext`` extension that backs the case-insensitive email column, and the
``all_resumes`` view that lets list endpoints read both resume tables from one
place.

Run it with ``python -m app.db.schema``.
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import Enum as SAEnum
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.db.base import Base
from app.db.session import engine

# Registers every table on Base.metadata. Required before create_all.
from app.models import registry  # noqa: F401

EXTENSIONS = ("citext",)

ALL_RESUMES_VIEW = """
CREATE OR REPLACE VIEW all_resumes AS
    SELECT id, user_id, 'base'::text AS kind, display_name, target_title,
           source::text AS source, status::text AS status, content_text,
           NULL::uuid AS base_resume_id, NULL::text AS company_name,
           NULL::text AS job_url, NULL::numeric AS must_have_coverage_percent,
           is_archived, created_at, updated_at
    FROM base_resumes
    UNION ALL
    SELECT id, user_id, 'tailored'::text, display_name, job_title,
           'tailored'::text, status::text, content_text,
           base_resume_id, company_name, job_url, must_have_coverage_percent,
           false, created_at, updated_at
    FROM tailored_resumes
"""


async def create_all(*, drop_first: bool = False) -> None:
    async with engine.begin() as conn:
        for extension in EXTENSIONS:
            await conn.execute(text(f"CREATE EXTENSION IF NOT EXISTS {extension}"))

        if drop_first:
            await _drop_everything(conn)

        await conn.run_sync(Base.metadata.create_all)
        await _add_missing_enum_values(conn)
        await conn.execute(text(ALL_RESUMES_VIEW))


async def _add_missing_enum_values(conn: AsyncConnection) -> None:
    """Add enum labels introduced after their type was created.

    ``create_all`` skips a type that already exists, so a value added to a
    Python enum would otherwise be rejected by the database until a --reset
    wiped every row.
    """
    seen: set[str] = set()
    for table in Base.metadata.tables.values():
        for column in table.columns:
            kind = column.type
            if not isinstance(kind, SAEnum) or not kind.name or kind.name in seen:
                continue
            seen.add(kind.name)
            for label in kind.enums:
                quoted = label.replace("'", "''")
                await conn.execute(
                    text(f"ALTER TYPE \"{kind.name}\" ADD VALUE IF NOT EXISTS '{quoted}'")
                )


async def _drop_everything(conn: AsyncConnection) -> None:
    """Drop the view, the tables, and the native enum types.

    ``metadata.drop_all`` leaves the enum types behind, and the next
    ``create_all`` then fails with "type already exists" - so they are dropped
    explicitly.
    """
    await conn.execute(text("DROP VIEW IF EXISTS all_resumes"))
    await conn.run_sync(Base.metadata.drop_all)
    enums = await conn.execute(
        text(
            "SELECT t.typname FROM pg_type t "
            "JOIN pg_namespace n ON n.oid = t.typnamespace "
            "WHERE t.typtype = 'e' AND n.nspname = current_schema()"
        )
    )
    for (name,) in enums:
        await conn.execute(text(f'DROP TYPE IF EXISTS "{name}" CASCADE'))


async def _main() -> None:
    reset = "--reset" in sys.argv
    if reset:
        print("Dropping and recreating every table. All data will be lost.")
    await create_all(drop_first=reset)
    async with engine.connect() as conn:
        count = await conn.scalar(
            text("SELECT count(*) FROM pg_tables WHERE schemaname = current_schema()")
        )
    print(f"Schema ready: {count} tables.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main())
