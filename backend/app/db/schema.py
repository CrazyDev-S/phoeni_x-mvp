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
        await _apply_upgrades(conn)
        await conn.execute(text(ALL_RESUMES_VIEW))


async def sync_enum_values() -> list[str]:
    """Bring the database's enum types up to the Python enums. Returns what it added.

    Run on every startup. A value added to a Python enum (a new generation kind,
    say) is otherwise rejected by the running database until someone remembers
    to run this module - and the tests cannot catch it, because they build
    their database from scratch.
    """
    async with engine.begin() as conn:
        return await _add_missing_enum_values(conn)


async def _add_missing_enum_values(
    conn: AsyncConnection, wanted: dict[str, list[str]] | None = None
) -> list[str]:
    """Add enum labels introduced after their type was created.

    ``create_all`` skips a type that already exists, so a value added to a
    Python enum would otherwise be rejected by the database until a --reset
    wiped every row. Only missing labels are altered, so a database that is
    already current is left untouched.
    """
    wanted = wanted if wanted is not None else _model_enums()
    rows = await conn.execute(
        text(
            "SELECT t.typname, e.enumlabel FROM pg_type t "
            "JOIN pg_enum e ON e.enumtypid = t.oid "
            "JOIN pg_namespace n ON n.oid = t.typnamespace "
            "WHERE n.nspname = current_schema()"
        )
    )
    present: dict[str, set[str]] = {}
    for name, label in rows:
        present.setdefault(name, set()).add(label)

    added: list[str] = []
    for name, labels in wanted.items():
        if name not in present:
            # Not created yet; create_all makes it whole.
            continue
        for label in labels:
            if label in present[name]:
                continue
            quoted = label.replace("'", "''")
            await conn.execute(
                text(f"ALTER TYPE \"{name}\" ADD VALUE IF NOT EXISTS '{quoted}'")
            )
            added.append(f"{name}.{label}")
    return added


def _model_enums() -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for table in Base.metadata.tables.values():
        for column in table.columns:
            kind = column.type
            if isinstance(kind, SAEnum) and kind.name and kind.name not in found:
                found[kind.name] = list(kind.enums)
    return found


# Changes to EXISTING tables. ``create_all`` only ever adds whole tables, so a
# column or constraint added to a table that already exists has to be stated
# here, in a form that is safe to run again. Newest last.
UPGRADES = (
    # 2026-09: the calendar and job maintenance learn about Freelancing tracks.
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS freelance_track_id uuid "
    "REFERENCES freelance_job_tracks(id) ON DELETE CASCADE",
    "ALTER TABLE meetings DROP CONSTRAINT IF EXISTS ck_meetings_exactly_one_owner",
    "ALTER TABLE meetings ADD CONSTRAINT ck_meetings_exactly_one_owner "
    "CHECK (num_nonnulls(stage_id, maintained_job_id, freelance_track_id) = 1)",
    "ALTER TABLE maintained_jobs ADD COLUMN IF NOT EXISTS freelance_track_id uuid "
    "UNIQUE REFERENCES freelance_job_tracks(id) ON DELETE SET NULL",
    # 2026-10: Freelancing and Remote are separate portals, so a maintained job
    # says which one it belongs to. Jobs promoted from a track were Freelancing.
    "ALTER TABLE maintained_jobs ADD COLUMN IF NOT EXISTS category text "
    "NOT NULL DEFAULT 'remote'",
    "UPDATE maintained_jobs SET category = 'freelancing' "
    "WHERE freelance_track_id IS NOT NULL AND category <> 'freelancing'",
    "ALTER TABLE maintained_jobs DROP CONSTRAINT IF EXISTS ck_maintained_jobs_category",
    "ALTER TABLE maintained_jobs ADD CONSTRAINT ck_maintained_jobs_category "
    "CHECK (category IN ('remote', 'freelancing'))",
    # 2026-10: Claude work runs on Sonnet 5.5 at every tier. Only the default
    # for new accounts; a saved choice is the user's and is left alone.
    "ALTER TABLE user_settings ALTER COLUMN heavy_model SET DEFAULT 'claude-sonnet-5-5'",
    "ALTER TABLE user_settings ALTER COLUMN mid_model SET DEFAULT 'claude-sonnet-5-5'",
    "ALTER TABLE user_settings ALTER COLUMN fast_model SET DEFAULT 'claude-sonnet-5-5'",
    # 2026-10: an application can go with a base resume, used as it is.
    "ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS base_resume_id uuid "
    "CONSTRAINT fk_job_applications_base_resume_id_base_resumes "
    "REFERENCES base_resumes(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS ix_job_applications_base_resume_id "
    "ON job_applications (base_resume_id)",
    "ALTER TABLE job_applications DROP CONSTRAINT IF EXISTS ck_job_applications_one_resume",
    "ALTER TABLE job_applications ADD CONSTRAINT ck_job_applications_one_resume "
    "CHECK (num_nonnulls(tailored_resume_id, base_resume_id) <= 1)",
)


async def _apply_upgrades(conn: AsyncConnection) -> None:
    for statement in UPGRADES:
        await conn.execute(text(statement))


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
