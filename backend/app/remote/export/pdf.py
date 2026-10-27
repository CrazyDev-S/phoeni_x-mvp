"""PDF export: the .docx, converted by headless LibreOffice.

Converting the exact .docx the user would otherwise download - rather than
drawing a second rendition - is what keeps the two from ever disagreeing. It is
also why oxml.py is strict about element order: LibreOffice silently drops what
Word would tolerate.

Each conversion is a separate ``soffice`` process. Concurrent processes cannot
share a LibreOffice profile, so each slot gets its own, kept between calls -
creating a fresh profile costs seconds every time.
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.config import get_settings

# A cold LibreOffice start plus a two-page resume is a few seconds; this only
# catches a hung process.
TIMEOUT_SECONDS = 60
SLOTS = 2

_slots: asyncio.Queue[int] | None = None


class PdfUnavailable(RuntimeError):
    """No LibreOffice on this server."""


class PdfFailed(RuntimeError):
    """LibreOffice ran but produced no PDF."""


def converter() -> str | None:
    """The soffice binary: SOFFICE_PATH if set, else whatever is on PATH."""
    configured = get_settings().soffice_path
    if configured:
        return configured if Path(configured).exists() else None
    return shutil.which("soffice") or shutil.which("libreoffice")


async def docx_to_pdf(docx: bytes) -> bytes:
    binary = converter()
    if binary is None:
        raise PdfUnavailable("LibreOffice (soffice) is not installed on the server.")
    slots = _slot_pool()
    slot = await slots.get()
    try:
        return await asyncio.to_thread(_convert, binary, docx, slot)
    finally:
        slots.put_nowait(slot)


def _slot_pool() -> asyncio.Queue[int]:
    global _slots
    if _slots is None:
        _slots = asyncio.Queue()
        for slot in range(SLOTS):
            _slots.put_nowait(slot)
    return _slots


def _convert(binary: str, docx: bytes, slot: int) -> bytes:
    profile = Path(tempfile.gettempdir()) / f"resume-pdf-profile-{slot}"
    with tempfile.TemporaryDirectory(prefix="resume-pdf-") as work:
        source = Path(work) / "resume.docx"
        source.write_bytes(docx)
        try:
            done = subprocess.run(  # noqa: S603 - fixed argv, no shell, no user input
                [
                    binary,
                    f"-env:UserInstallation={profile.as_uri()}",
                    "--headless",
                    "--norestore",
                    "--nologo",
                    "--convert-to",
                    "pdf:writer_pdf_Export",
                    "--outdir",
                    work,
                    str(source),
                ],
                capture_output=True,
                timeout=TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise PdfFailed(f"LibreOffice did not finish within {TIMEOUT_SECONDS}s.") from exc
        pdf = Path(work) / "resume.pdf"
        if done.returncode != 0 or not pdf.exists():
            detail = (done.stderr or done.stdout or b"").decode(errors="replace").strip()
            raise PdfFailed(detail[:500] or f"soffice exited with {done.returncode}")
        return pdf.read_bytes()
