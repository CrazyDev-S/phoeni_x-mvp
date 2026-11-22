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


# 2026-11: freelance_jobs goes from one copy per user to one row per posting.
# Runs only while the table still has its per-user shape. Rows are re-keyed
# to Upwork's job key (the "~0..." every job URL carries), the copies of one
# posting collapse into the most recently seen, and what each user said about
# a copy - focused, hidden - becomes their mark on the survivor.
SHARE_FREELANCE_JOBS = """
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'freelance_jobs' AND column_name = 'user_id'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE freelance_jobs DROP CONSTRAINT IF EXISTS uq_freelance_jobs_user_id_upwork_id;
  UPDATE freelance_jobs SET upwork_id = lower(ciphertext) WHERE ciphertext LIKE '~0%';

  CREATE TEMP TABLE _freelance_job_keep ON COMMIT DROP AS
    SELECT id, first_value(id) OVER (
      PARTITION BY upwork_id ORDER BY last_seen_at DESC, id
    ) AS keep
    FROM freelance_jobs;

  INSERT INTO freelance_job_marks (user_id, job_id, focused_at, hidden_at)
    SELECT j.user_id, k.keep, max(j.focused_at), max(j.hidden_at)
    FROM freelance_jobs j JOIN _freelance_job_keep k ON k.id = j.id
    WHERE j.focused_at IS NOT NULL OR j.hidden_at IS NOT NULL
    GROUP BY j.user_id, k.keep
    ON CONFLICT DO NOTHING;

  UPDATE proposals p SET job_id = k.keep
    FROM _freelance_job_keep k WHERE p.job_id = k.id AND k.id <> k.keep;
  UPDATE freelance_job_tracks t SET job_id = k.keep
    FROM _freelance_job_keep k WHERE t.job_id = k.id AND k.id <> k.keep;
  DELETE FROM freelance_jobs j
    USING _freelance_job_keep k WHERE j.id = k.id AND k.id <> k.keep;

  ALTER TABLE freelance_jobs
    DROP COLUMN user_id, DROP COLUMN ciphertext, DROP COLUMN focused_at,
    DROP COLUMN hidden_at, DROP COLUMN is_premium, DROP COLUMN is_enterprise,
    DROP COLUMN renewed_at;
  ALTER TABLE freelance_jobs RENAME COLUMN detail_fetched_at TO detail_captured_at;
  ALTER TABLE freelance_jobs
    ADD CONSTRAINT uq_freelance_jobs_upwork_id UNIQUE (upwork_id),
    ADD COLUMN captured_by_id uuid
      CONSTRAINT fk_freelance_jobs_captured_by_id_users
      REFERENCES users(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS ix_freelance_jobs_published
    ON freelance_jobs (published_at DESC NULLS LAST);
  CREATE INDEX IF NOT EXISTS ix_freelance_jobs_created ON freelance_jobs (created_at DESC);
END $$
"""

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
    # 2026-11: Upwork jobs come from the browser extension into one shared
    # list. The Apify and Upwork-API sources and their credentials are gone.
    "DROP TABLE IF EXISTS apify_connections",
    "DROP TABLE IF EXISTS upwork_connections",
    "DROP TYPE IF EXISTS upwork_connection_status",
    SHARE_FREELANCE_JOBS,
    # 2026-11: proposals are written in versions; a proposal knows the one it holds.
    "ALTER TABLE proposals ADD COLUMN IF NOT EXISTS version_id uuid "
    "CONSTRAINT fk_proposals_version_id_proposal_versions "
    "REFERENCES proposal_versions(id) ON DELETE SET NULL",
)


async def _apply_upgrades(conn: AsyncConnection) -> None:
    for statement in UPGRADES:
        await conn.execute(text(statement))


async def _drop_everything(conn: AsyncConnection) -> None:
    """Drop the view, every table, and the native enum types.

    Enum types outlive their tables, and the next ``create_all`` would then
    fail with "type already exists" - so they are dropped explicitly.
    """
    await conn.execute(text("DROP VIEW IF EXISTS all_resumes"))
    # Every table in the schema, not only the ones the models still name: a
    # table left by a removed model would otherwise hold a foreign key to
    # ``users`` and block the whole reset.
    tables = await conn.execute(
        text("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()")
    )
    for (name,) in tables.all():
        await conn.execute(text(f'DROP TABLE IF EXISTS "{name}" CASCADE'))
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
