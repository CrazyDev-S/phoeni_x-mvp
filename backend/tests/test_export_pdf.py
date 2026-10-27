"""PDF export is the .docx, converted - so it says exactly what the .docx says."""

from __future__ import annotations

import io
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader

from app.main import app
from app.remote.export import pdf

needs_libreoffice = pytest.mark.skipif(
    pdf.converter() is None, reason="LibreOffice is not installed"
)


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", timeout=120
    ) as c:
        yield c


@pytest.fixture
async def headers(client) -> dict[str, str]:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": f"pdf-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def text_of(data: bytes) -> str:
    return " ".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)


@needs_libreoffice
async def test_a_saved_resume_downloads_as_a_pdf(client, headers, aran_markdown) -> None:
    created = await client.post(
        "/api/v1/remote/resumes",
        headers=headers,
        json={
            "display_name": "Aran — Senior AI Fullstack",
            "target_title": "Senior Software Engineer",
            "content_markdown": aran_markdown,
        },
    )
    assert created.status_code == 201, created.text

    res = await client.post(
        "/api/v1/remote/export/pdf",
        headers=headers,
        json={"resume_id": created.json()["id"], "kind": "base", "profile": "designed"},
    )
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/pdf"
    # Non-ASCII names survive in the RFC 5987 form.
    assert "filename*=UTF-8''Aran%20%E2%80%94%20Senior%20AI%20Fullstack.pdf" in (
        res.headers["content-disposition"]
    )
    assert res.content.startswith(b"%PDF")
    text = text_of(res.content)
    assert "Aran Thammasiri" in text
    assert "PROFESSIONAL EXPERIENCE" in text


@needs_libreoffice
async def test_the_ats_profile_and_unsaved_markdown_convert_too(
    client, headers, aran_markdown
) -> None:
    res = await client.post(
        "/api/v1/remote/export/pdf",
        headers=headers,
        json={"content_markdown": aran_markdown, "profile": "ats_plain"},
    )
    assert res.status_code == 200, res.text
    assert 'filename="Resume_ATS.pdf"' in res.headers["content-disposition"]
    assert "Aran Thammasiri" in text_of(res.content)


async def test_no_libreoffice_is_a_clear_503(client, headers, aran_markdown, monkeypatch) -> None:
    monkeypatch.setattr(pdf, "converter", lambda: None)
    res = await client.post(
        "/api/v1/remote/export/pdf",
        headers=headers,
        json={"content_markdown": aran_markdown},
    )
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "PDF_UNAVAILABLE"


async def test_another_users_resume_is_not_exported(client, headers) -> None:
    res = await client.post(
        "/api/v1/remote/export/pdf",
        headers=headers,
        json={"resume_id": str(uuid.uuid4()), "kind": "base"},
    )
    assert res.status_code == 404
