from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _redirect_to_test_database() -> str:
    """Point the suite at its own database, before anything imports the engine.

    Tests must never touch the development database. Sharing it once left a
    queued generation behind that the running worker then picked up and would
    have executed against a real LLM key - the suite spending the developer's
    money on fixture data.

    Set DATABASE_URL_TEST to override.
    """
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    explicit = os.environ.get("DATABASE_URL_TEST")
    if explicit:
        os.environ["DATABASE_URL"] = explicit
        return explicit

    parts = urlsplit(os.environ["DATABASE_URL"])
    name = parts.path.lstrip("/")
    if not name.endswith("_test"):
        parts = parts._replace(path=f"/{name}_test")
    url = urlunsplit(parts)
    os.environ["DATABASE_URL"] = url
    return url


TEST_DATABASE_URL = _redirect_to_test_database()

FIXTURES = ROOT / "tests" / "fixtures"
TODAY = date(2026, 9, 11)


@pytest.fixture
def aran_markdown() -> str:
    return (FIXTURES / "aran.resume.md").read_text()


@pytest.fixture(scope="session", autouse=True)
async def database():
    """Create the test database and its schema, then tear the pool down."""
    import asyncpg
    from sqlalchemy.engine.url import make_url

    url = make_url(TEST_DATABASE_URL)
    admin = await asyncpg.connect(
        host=url.host, port=url.port, user=url.username,
        password=url.password, database="postgres",
    )
    try:
        exists = await admin.fetchval(
            "select 1 from pg_database where datname = $1", url.database
        )
        if not exists:
            await admin.execute(f'CREATE DATABASE "{url.database}"')
    finally:
        await admin.close()

    from app.db.schema import create_all
    from app.db.session import engine

    await create_all(drop_first=True)
    yield
    await engine.dispose()
