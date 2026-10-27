"""Importing an existing resume from any document.

The extraction tests build real files of each format; the pipeline tests run
the worker with a scripted model and check the two promises that matter: the
result is in the house format, and anything the model added that the original
did not say is called out.
"""

from __future__ import annotations

import io
import uuid
import zipfile

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import SessionLocal
from app.main import app
from app.models.enums import GenerationKind, GenerationStatus, ResumeSource, ResumeStatus
from app.models.generation import Generation
from app.models.resume import BaseResume
from app.models.user import User, UserSettings
from app.remote.export.docx_renderer import DocxRenderer
from app.remote.resume.parser import parse
from app.remote.services import documents
from app.remote.services.documents import DocumentError, extract
from app.remote.validation.import_review import review_import
from app.services.generation import enqueue
from app.worker.runner import run_once
from tests.test_resume_repair import StreamingStub, use_provider


@pytest.fixture
def aran_docx(aran_markdown) -> bytes:
    return DocxRenderer().render(parse(aran_markdown))


def pdf_with(lines: list[str]) -> bytes:
    """A one-page PDF holding these lines as real, selectable text."""
    content = "BT /F1 11 Tf 40 780 Td 14 TL\n" + "\n".join(
        f"({line.replace('(', '[').replace(')', ']')}) Tj T*" for line in lines
    ) + "\nET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = "%PDF-1.4\n", []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{body}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF"
    return out.encode("latin-1")


RESUME_LINES = [
    "Aran Thammasiri - Senior Software Engineer",
    "Bangkok, Thailand | aran.thammasiri@outlook.com | +1 727 732 3633",
    "Senior engineer who built document pipelines for banks and hospitals.",
    "Veeva Systems, Senior Engineer, Jan 2019 - Present",
    "Cut clinical backlog from 11 days to 36 hours for 214 customers.",
]


# --- reading files ---------------------------------------------------------

def test_a_word_file_is_read_in_order_with_its_header_and_bullets(aran_docx) -> None:
    doc = extract("aran.docx", aran_docx)
    assert doc.kind == "docx"
    assert doc.text.startswith("Aran Thammasiri")
    assert "aran.thammasiri@outlook.com" in doc.text
    assert doc.text.index("PROFESSIONAL SUMMARY") < doc.text.index("EDUCATION")


def test_a_pdf_is_read(aran_docx) -> None:
    doc = extract("resume.pdf", pdf_with(RESUME_LINES))
    assert doc.kind == "pdf" and doc.pages == 1
    assert "214 customers" in doc.text


def test_the_format_comes_from_the_bytes_not_the_name() -> None:
    assert extract("resume.txt", pdf_with(RESUME_LINES)).kind == "pdf"


def test_rtf_keeps_unicode_once() -> None:
    rtf = (
        b"{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Senior Engineer \\u8211? Remote\\par "
        b"Built payment pipelines for retail banks across three countries and six teams.\\par}"
    )
    doc = extract("r.rtf", rtf)
    assert "Senior Engineer – Remote" in doc.text
    assert "Arial" not in doc.text


def test_html_is_text_with_lists_marked() -> None:
    html = (
        b"<html><head><style>p{}</style></head><body><h1>Aran Thammasiri</h1>"
        b"<p>Senior engineer building document pipelines for banks and hospitals across Asia.</p>"
        b"<ul><li>Cut backlog from 11 days to 36 hours</li></ul>"
        b'<a href="https://linkedin.com/in/aran">profile</a></body></html>'
    )
    doc = extract("r.html", html)
    assert "• Cut backlog from 11 days to 36 hours" in doc.text
    assert "p{}" not in doc.text
    assert doc.links == ["https://linkedin.com/in/aran"]


def test_an_opendocument_file_is_read() -> None:
    body = (
        '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
        'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>'
        "<text:p>Aran Thammasiri, senior engineer building document pipelines for banks.</text:p>"
        "<text:list><text:list-item><text:p>Cut backlog from 11 days to 36 hours for 214 clients</text:p>"
        "</text:list-item></text:list></office:text></office:body></office:document-content>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/vnd.oasis.opendocument.text")
        z.writestr("content.xml", body)
    doc = extract("r.odt", buf.getvalue())
    assert doc.kind == "odt"
    assert "• Cut backlog" in doc.text


def test_plain_text_in_a_legacy_encoding_is_decoded() -> None:
    text = ("Zoë Müller – Senior Engineer. " * 6).encode("cp1252")
    assert "Zoë Müller – Senior Engineer." in extract("cv.txt", text).text


@pytest.mark.parametrize(
    ("name", "data", "code"),
    [
        ("empty.pdf", b"", "EMPTY_FILE"),
        ("old.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 600, "LEGACY_DOC"),
        ("scan.pdf", pdf_with([" "]), "NO_TEXT_LAYER"),
        ("photo.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 900, "UNSUPPORTED_TYPE"),
        ("huge.txt", b"x" * (documents.MAX_BYTES + 1), "FILE_TOO_LARGE"),
        ("tiny.txt", b"hello", "NO_TEXT"),
        ("broken.docx", b"PK\x03\x04 not really a zip", "CORRUPT_FILE"),
    ],
)
def test_a_file_that_cannot_be_read_says_why(name, data, code) -> None:
    with pytest.raises(DocumentError) as raised:
        extract(name, data)
    assert raised.value.code == code
    assert raised.value.message


def test_a_decompression_bomb_is_refused() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", "a" * (documents.MAX_UNZIPPED + 1))
    assert len(buf.getvalue()) < documents.MAX_BYTES
    with pytest.raises(DocumentError) as raised:
        extract("bomb.docx", buf.getvalue())
    assert raised.value.code == "FILE_TOO_LARGE"


def test_damaged_files_are_always_a_message_never_a_crash(aran_docx) -> None:
    """Found by fuzzing: a damaged Word or OpenDocument file raised BadZipFile,
    zlib.error or UnicodeDecodeError out of the reader, which the API turned
    into a 500 - shown in the browser as "Failed to fetch"."""
    import random

    rng = random.Random(7)
    originals = {"docx": aran_docx, "pdf": pdf_with(RESUME_LINES * 3)}
    for kind, data in originals.items():
        for i in range(40):
            damaged = bytearray(data)
            if i % 3 == 0:
                damaged = damaged[: rng.randint(10, len(damaged))]
            else:
                for _ in range(rng.randint(1, 40)):
                    damaged[rng.randrange(len(damaged))] = rng.randrange(256)
            try:
                extract(f"f.{kind}", bytes(damaged))
            except DocumentError as exc:
                assert exc.message


# --- the audit -------------------------------------------------------------

def test_a_faithful_conversion_raises_no_unsourced_findings(aran_markdown, aran_docx) -> None:
    source = extract("aran.docx", aran_docx).text
    findings = review_import(parse(aran_markdown), source)
    assert [f for f in findings if f.rule_id == "IMPORT_UNSOURCED"] == []


def test_anything_the_model_added_is_called_out(aran_markdown, aran_docx) -> None:
    source = extract("aran.docx", aran_docx).text
    invented = (
        aran_markdown.replace("11 days", "19 days")
        .replace("Veeva", "Initech")
        .replace("aran.thammasiri@outlook.com", "aran@example.org")
    )
    flagged = " ".join(
        f.message for f in review_import(parse(invented), source) if f.rule_id == "IMPORT_UNSOURCED"
    )
    for fact in ("'19'", "'Initech Systems'", "'aran@example.org'"):
        assert fact in flagged, f"{fact} slipped through: {flagged}"


def test_a_thin_resume_is_told_what_is_missing(aran_markdown) -> None:
    thin = aran_markdown.replace("aran.thammasiri@outlook.com", "x@y.co")
    resume = parse(thin).model_copy(
        update={"header": parse(thin).header.model_copy(update={"email": None, "phone": None, "location": "Not specified"})}
    )
    rules = {f.rule_id for f in review_import(resume, aran_markdown)}
    assert {"IMPORT_NO_EMAIL", "IMPORT_NO_PHONE", "IMPORT_NO_LOCATION"} <= rules


# --- through the worker ----------------------------------------------------

@pytest.fixture
async def user_id() -> uuid.UUID:
    async with SessionLocal() as session:
        row = User(email=f"import-{uuid.uuid4().hex[:8]}@example.com", password_hash="x")
        session.add(row)
        await session.flush()
        session.add(UserSettings(user_id=row.id))
        await session.commit()
        return row.id


async def run_import(user_id, source_text: str, **payload) -> Generation:
    async with SessionLocal() as session:
        gen = await enqueue(
            session,
            user_id=user_id,
            kind=GenerationKind.RESUME_IMPORT,
            payload={"source_text": source_text, "filename": "aran.docx", "source_kind": "docx", **payload},
        )
        await session.commit()
        generation_id = gen.id
    assert await run_once() is True
    async with SessionLocal() as session:
        return await session.get(Generation, generation_id)


async def test_an_import_saves_a_styled_resume_and_drops_the_uploaded_text(
    user_id, monkeypatch, aran_markdown, aran_docx
) -> None:
    source = extract("aran.docx", aran_docx).text
    use_provider(monkeypatch, StreamingStub([aran_markdown]))

    generation = await run_import(user_id, source)

    assert generation.status is GenerationStatus.SUCCEEDED, generation.error_detail
    assert generation.result_kind == "base_resume"
    assert "source_text" not in generation.input
    async with SessionLocal() as session:
        resume = await session.get(BaseResume, generation.result_id)
        assert resume.source is ResumeSource.UPLOAD
        assert resume.user_id == user_id
        assert resume.display_name == "Aran Thammasiri — Senior Software Engineer – AI Fullstack"
        assert resume.content_markdown == aran_markdown
        assert resume.generation_meta["source_file"] == "aran.docx"
        assert not any(f["rule_id"] == "IMPORT_UNSOURCED" for f in resume.validation["findings"])


async def test_an_invented_fact_is_flagged_on_the_saved_resume(
    user_id, monkeypatch, aran_markdown, aran_docx
) -> None:
    source = extract("aran.docx", aran_docx).text
    use_provider(
        monkeypatch, StreamingStub([aran_markdown.replace("214 life-sciences", "900 life-sciences")])
    )

    generation = await run_import(user_id, source)

    async with SessionLocal() as session:
        resume = await session.get(BaseResume, generation.result_id)
        flagged = [f for f in resume.validation["findings"] if f["rule_id"] == "IMPORT_UNSOURCED"]
        assert any("900" in f["message"] for f in flagged)
        assert all(f["severity"] == "warning" for f in flagged)


async def test_the_generators_policies_only_advise_on_a_real_resume(
    user_id, monkeypatch, aran_markdown, aran_docx
) -> None:
    """A real career has the employers and skills it has. Demanding exactly four
    skill groups or a promotion would mean inventing or deleting facts."""
    source = extract("aran.docx", aran_docx).text
    five_groups = aran_markdown.replace(
        "## PROFESSIONAL EXPERIENCE", "- **Practices**: Code review, Pairing\n\n## PROFESSIONAL EXPERIENCE", 1
    )
    use_provider(monkeypatch, StreamingStub([five_groups]))

    generation = await run_import(user_id, source)

    async with SessionLocal() as session:
        resume = await session.get(BaseResume, generation.result_id)
        by_rule = {f["rule_id"]: f["severity"] for f in resume.validation["findings"]}
        assert by_rule.get("SKILL_CATEGORY_COUNT") == "warning"
        assert resume.status is ResumeStatus.FINAL


# --- the endpoint ----------------------------------------------------------

@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", timeout=30
    ) as c:
        yield c


@pytest.fixture
async def headers(client) -> dict[str, str]:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": f"imp-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_uploading_a_word_file_queues_a_restructuring_job(client, headers, aran_docx) -> None:
    res = await client.post(
        "/api/v1/remote/resumes/import",
        headers=headers,
        files={"file": ("Aran_Resume.docx", aran_docx, "application/octet-stream")},
        data={"display_name": "Aran main"},
    )
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["direct"] is False and body["source_kind"] == "docx"
    async with SessionLocal() as session:
        gen = await session.get(Generation, uuid.UUID(body["id"]))
        assert gen.kind is GenerationKind.RESUME_IMPORT
        assert gen.input["display_name"] == "Aran main"
        assert "PROFESSIONAL SUMMARY" in gen.input["source_text"]
        gen.status = GenerationStatus.CANCELLED  # keep the shared queue empty
        await session.commit()


async def test_a_file_already_in_the_house_format_is_saved_without_the_model(
    client, headers, aran_markdown
) -> None:
    res = await client.post(
        "/api/v1/remote/resumes/import",
        headers=headers,
        files={"file": ("aran.resume.md", aran_markdown.encode(), "text/markdown")},
    )
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["direct"] is True and body["status"] == "succeeded"
    async with SessionLocal() as session:
        row = await session.get(BaseResume, uuid.UUID(body["result_id"]))
        assert row.source is ResumeSource.UPLOAD
        assert row.content_markdown == aran_markdown.strip()


async def test_pasted_plain_text_is_imported_like_a_file(client, headers) -> None:
    res = await client.post(
        "/api/v1/remote/resumes/import",
        headers=headers,
        data={"text": "\n".join(RESUME_LINES * 2)},
    )
    assert res.status_code == 202, res.text
    assert res.json()["direct"] is False
    async with SessionLocal() as session:
        gen = await session.get(Generation, uuid.UUID(res.json()["id"]))
        gen.status = GenerationStatus.CANCELLED
        await session.commit()


@pytest.mark.parametrize(
    ("files", "data", "code"),
    [
        ({"file": ("scan.pdf", pdf_with([" "]), "application/pdf")}, {}, "NO_TEXT_LAYER"),
        ({"file": ("old.doc", b"\xd0\xcf\x11\xe0" + b"\x00" * 600, "application/msword")}, {}, "LEGACY_DOC"),
        (None, {}, "NOTHING_TO_IMPORT"),
    ],
)
async def test_an_unreadable_upload_is_rejected_with_a_reason(client, headers, files, data, code) -> None:
    res = await client.post(
        "/api/v1/remote/resumes/import", headers=headers, files=files, data=data
    )
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == code
    assert res.json()["detail"]["message"]


async def test_importing_requires_a_login(client) -> None:
    res = await client.post("/api/v1/remote/resumes/import", data={"text": "x" * 200})
    assert res.status_code == 401
