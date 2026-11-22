"""The profile writer: drafts numbered toward the next save, saves as whole versions."""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.llm.provider import LLMEvent
from app.main import app
from app.worker.runner import run_once


def reply(title: str, summary: str) -> str:
    return json.dumps(
        {
            "change_note": f"Built around {title}.",
            "questions": ["Which certifications do you hold?"],
            "brief": {"stack": "Flutter + Firebase", "rate_tier": "A"},
            "titles": [
                {"text": title, "keyword": "Flutter Developer", "intent": "hire", "tier_signal": "premium"},
                {"text": "Firebase Backend Engineer", "keyword": "Firebase", "intent": "x", "tier_signal": "premium"},
            ],
            "title_rationale": "Leads with the stack.",
            "summary": summary,
            "skills": ["Flutter", "Dart", "flutter", "Firebase"],
            "hourly_rate": "$85/hr",
            "work_history": [{"company": "Calmly", "role": "Lead", "story": "Built it."}],
            "education": [],
            "portfolio_direction": [],
            "cert_roadmap": [],
        }
    )


class Writer:
    """Answers each turn with the next reply, and keeps what it was asked."""

    model = "stub-writer"

    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.turns: list[str] = []

    async def stream(self, req):
        self.turns.append(req.messages[0]["content"])
        yield LLMEvent("text_delta", {"text": self.replies.pop(0)})
        yield LLMEvent("done", {"stop_reason": "end_turn"})


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth(client) -> dict[str, str]:
    email = f"writer-{uuid.uuid4().hex[:8]}@example.com"
    res = await client.post("/api/v1/auth/register", json={"email": email, "password": "a-strong-password"})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def use(monkeypatch, writer: Writer) -> None:
    async def provider(session, user_id, tier):
        return writer

    monkeypatch.setattr("app.freelancing.profile_writer.get_provider", provider)
    monkeypatch.setattr("app.api.v1.freelancing.profile_versions.get_provider", provider)


async def write(client, auth, **body) -> dict:
    res = await client.post("/api/v1/freelancing/profile-versions", json=body, headers=auth)
    assert res.status_code == 202, res.text
    assert await run_once() is True
    return res.json()


async def thread(client, auth, profile_id: str | None = None) -> list[dict]:
    params = {"profile_id": profile_id} if profile_id else {}
    res = await client.get("/api/v1/freelancing/profile-versions", params=params, headers=auth)
    return res.json()["items"]


def labels(items: list[dict]) -> list[str]:
    return [f"{v['major']}.{v['minor']}" if v["minor"] else str(v["major"]) for v in items]


async def test_drafts_count_toward_the_next_save(client, auth, monkeypatch) -> None:
    writer = Writer([reply("Flutter Developer · Offline-First", "First."), reply("Flutter Developer · Audio", "Second."),
                     reply("Flutter Developer · Health", "Third.")])
    use(monkeypatch, writer)

    # A profile not created yet keeps its drafts until it is.
    await write(client, auth, instruction="8 years Flutter, $85/hr, Thailand", material={"raw_profile_markdown": "Calmly, 2021-2024"})
    first = (await thread(client, auth))[0]
    assert labels([first]) == ["1.1"]
    assert first["document"]["title"] == "Flutter Developer · Offline-First"
    assert first["document"]["skills"] == ["Flutter", "Dart", "Firebase"]
    assert first["document"]["hourly_rate"] == 85
    assert "Calmly, 2021-2024" in writer.turns[0] and "<current_version>" not in writer.turns[0]

    await write(client, auth, instruction="More technical summary", based_on_id=first["id"],
                material={"title": "My own title", "overview": "First."})
    # A revision carries the intake given before it and the form as it is now.
    assert "8 years Flutter" in writer.turns[1] and '"title": "My own title"' in writer.turns[1]
    drafts = await thread(client, auth)
    assert labels(drafts) == ["1.1", "1.2"]

    created = await client.post(
        "/api/v1/freelancing/profiles",
        json={"name": "Flutter", "title": "Edited by hand", "overview": "Second.", "version_id": drafts[1]["id"]},
        headers=auth,
    )
    profile = created.json()
    assert profile["version"] == 1
    saved = await thread(client, auth, profile["id"])
    assert labels(saved) == ["1.1", "1.2", "1"]
    # The save keeps the draft's other sections under the form's own fields.
    assert saved[-1]["document"]["title"] == "Edited by hand"
    assert saved[-1]["document"]["work_history"][0]["company"] == "Calmly"
    assert await thread(client, auth) == []

    # Saving with nothing changed is not a new version.
    again = await client.patch(f"/api/v1/freelancing/profiles/{profile['id']}", json={"is_default": True}, headers=auth)
    assert again.json()["version"] == 1

    await write(client, auth, instruction="Lean into healthcare", profile_id=profile["id"], based_on_id=saved[-1]["id"])
    assert labels(await thread(client, auth, profile["id"])) == ["1.1", "1.2", "1", "2.1"]
