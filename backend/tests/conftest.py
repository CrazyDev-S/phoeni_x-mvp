from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FIXTURES = ROOT / "tests" / "fixtures"
TODAY = date(2026, 9, 11)


@pytest.fixture
def aran_md() -> str:
    return (FIXTURES / "aran.crm.md").read_text()
