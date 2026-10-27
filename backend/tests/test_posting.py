"""A job description that is not a job posting is turned away before any spend.

The side panel once sent a hidden reCAPTCHA frame's script as the posting. The
model refused to build a resume from it - after the whole pipeline, and six
repair passes, had been paid for.
"""

from __future__ import annotations

import base64
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.main import app
from app.models.generation import Generation
from app.models.job_link import JobLink
from app.remote.validation.posting import posting_problem

CAPTCHA = (
    'recaptcha.anchor.Main.init("[\\x22ainput\\x22,[\\x22bgdata\\x22,null,null,null,\\x22'
    + base64.b64encode(os.urandom(6000)).decode()
    + '\\x22]");'
)
WIDGET = """We couldn't access your cookies, please click the tab again to approve access.
Click here to login
/* eslint-disable max-depth */
const getData = key => window.localStorage.getItem(key);
const setData = ({ key, value }) => {
  if (typeof value !== 'string') { console.error('[BUGHERD] setData requires a string'); }
  window.localStorage.setItem(key, value);
};
const getXhrRequest = token => { const req = xhrRequests.find(r => r.token === token); return req ? req.request : null; };
function dataURLtoFile(dataurl, filename) { const arr = dataurl.split(','); const mime = arr[0].match(/:(.*?);/)[1]; }
"""
JD = (
    "Senior Backend Engineer. You will design Python and FastAPI services, own "
    "PostgreSQL schemas, and run them on AWS. Five years of backend experience."
)


@pytest.mark.parametrize(
    "text",
    [
        JD,
        # JSON-LD descriptions arrive as HTML.
        "<p><strong>Contract type:</strong> Freelance</p><p>We need a React &amp; "
        "Node.js developer with 3+ years building dashboards for B2B SaaS teams.</p>",
        "8+ years of experience in AI, Data science, ML, Python, Java, .Net/C#",
        "เรากำลังมองหาวิศวกรซอฟต์แวร์อาวุโส ที่มีประสบการณ์ 5 ปีขึ้นไป ในการพัฒนาระบบด้วย Python และ AWS",
        "我们正在招聘高级软件工程师。要求：五年以上Python开发经验，熟悉Kubernetes和AWS。",
        "Wir suchen eine Senior Softwareentwicklerin für unser Team in München, mit Erfahrung in Größenordnungen.",
    ],
    ids=["plain", "html", "terse", "thai", "chinese", "german"],
)
def test_a_real_posting_passes(text: str) -> None:
    assert posting_problem(text) is None


@pytest.mark.parametrize(
    ("text", "says"),
    [
        (CAPTCHA, "page code"),
        (WIDGET, "page code"),
        ("https://www.upwork.com/jobs/~022112199267713547296", "link"),
    ],
    ids=["captcha", "widget", "link"],
)
def test_page_code_and_links_are_not_postings(text: str, says: str) -> None:
    assert says in (posting_problem(text) or "")


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": f"posting-{uuid.uuid4().hex[:8]}@example.com", "password": "a-strong-password"},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _count(model) -> int:
    async with SessionLocal() as session:
        return await session.scalar(select(func.count()).select_from(model)) or 0


async def test_generating_from_a_captcha_is_refused_before_anything_is_queued(client, auth):
    before = await _count(Generation)
    res = await client.post(
        "/api/v1/remote/extension/generate",
        headers=auth,
        json={
            "target_title": "reCAPTCHA",
            "job_description": CAPTCHA[:60_000],
            "job_url": "https://jobs.example.com/careers/42",
        },
    )

    assert res.status_code == 422, res.text
    assert res.json()["detail"]["code"] == "NOT_A_JOB_POSTING"
    assert await _count(Generation) == before


async def test_tailoring_to_a_captcha_remembers_nothing(client, auth, aran_markdown: str):
    base = await client.post(
        "/api/v1/remote/resumes",
        headers=auth,
        json={"display_name": "Base", "target_title": "Engineer", "content_markdown": aran_markdown},
    )
    assert base.status_code == 201, base.text
    links_before = await _count(JobLink)

    res = await client.post(
        "/api/v1/remote/extension/tailor",
        headers=auth,
        json={
            "base_resume_id": base.json()["id"],
            "job": {"url": "https://jobs.example.com/careers/43", "title": "reCAPTCHA",
                    "description_text": CAPTCHA[:60_000]},
        },
    )

    assert res.status_code == 422, res.text
    assert res.json()["detail"]["code"] == "NOT_A_JOB_POSTING"
    # The captcha's text was not saved as the posting's description.
    assert await _count(JobLink) == links_before


async def _link(url: str) -> JobLink:
    async with SessionLocal() as session:
        link = await session.scalar(select(JobLink).where(JobLink.job_url == url))
        assert link is not None
        return link


async def test_linking_a_captcha_read_remembers_nothing(client, auth):
    url = f"https://jobs.lever.co/acme/{uuid.uuid4()}/apply"
    res = await client.put(
        "/api/v1/remote/extension/job-links",
        headers=auth,
        json={"url": url, "job": {"url": url, "title": "hCaptcha", "description_text": CAPTCHA[:60_000]}},
    )

    assert res.status_code == 200, res.text
    link = await _link(url)
    assert (link.job_title, link.job_description_text) == (None, None)


async def test_a_real_read_replaces_a_captcha_kept_before(client, auth):
    url = f"https://jobs.lever.co/acme/{uuid.uuid4()}"
    await client.put("/api/v1/remote/extension/job-links", headers=auth, json={"url": url})
    # Kept before captcha reads were turned away.
    async with SessionLocal() as session:
        link = await session.scalar(select(JobLink).where(JobLink.job_url == url))
        link.job_title, link.job_description_text = "hCaptcha", CAPTCHA[:60_000]
        await session.commit()

    res = await client.put(
        "/api/v1/remote/extension/job-links",
        headers=auth,
        json={"url": url, "job": {"url": url, "title": "Staff Engineer", "description_text": JD}},
    )

    assert res.status_code == 200, res.text
    link = await _link(url)
    assert (link.job_title, link.job_description_text) == ("Staff Engineer", JD)
