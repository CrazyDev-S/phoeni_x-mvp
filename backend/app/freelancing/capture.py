"""Upwork postings, as the browser extension captures them, into job columns.

The extension is deliberately a plain harvester. For every posting on an
Upwork page it sends the job key, the title, the description, the skill
tokens, every element Upwork labels with ``data-test``/``data-qa`` (label ->
text), and the block's visible text. Upwork's own vocabulary - "Hourly: $30.00 -
$60.00", "Proposals: 10 to 15", "$10K+ spent" - is read here and nowhere else.
A change to Upwork's pages is therefore a fix in this file rather than a new
extension release, and every stored capture can be re-read by a better parser.

One posting is seen three ways: as a **tile** in a search list or feed, as
the **detail** of its own page (or the slide-over a search opens), and as the
**store** - the state Upwork's own app renders that page from, which the
extension reads while it watches the posting's client. ``raw`` keeps the last
capture of each, and the columns come from all of them, the most precise
first: the store has exact counts and timestamps, a tile shows least.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

from app.freelancing.countries import country_code, country_name
from app.models.enums import FreelanceJobType

VIEWS = ("store", "detail", "tile")

# "~021858964253717283346" (newer postings) or "~01" and hex (older ones).
JOB_KEY = re.compile(r"~0[12][0-9a-f]{10,40}", re.IGNORECASE)
JOB_URL = "https://www.upwork.com/jobs/{key}"

# Where a detail page stops describing this posting and starts on others.
_PAGE_END = re.compile(
    r"^(similar jobs|other open jobs by this client|client'?s recent history|"
    r"jobs you might like|explore similar jobs|more jobs like this)",
    re.IGNORECASE,
)
_ABOUT_CLIENT = re.compile(r"^about the client$", re.IGNORECASE)
# Lines that describe the viewer, not the posting. Never stored: the row is shared.
_PERSONAL = re.compile(
    r"available connects|^you(?:'ve| have)? (?:already )?(?:applied|submitted)", re.IGNORECASE
)

_NUM = r"([\d][\d,]*(?:\.\d+)?)"
_MONEY = rf"\$\s?{_NUM}\s*([KkMm])?"


def job_key(text: str | None) -> str | None:
    """The job key inside a URL or an id, lower-cased; None when there is none."""
    if not text:
        return None
    match = JOB_KEY.search(text)
    return match.group(0).lower() if match else None


def job_url(key: str) -> str:
    return JOB_URL.format(key=key)


def stored_view(capture: dict[str, Any], captured_at: datetime) -> dict[str, Any]:
    """What ``raw`` keeps of one capture: the harvest, minus anything about the viewer."""
    if capture.get("view") == "store":
        state = capture.get("state") or {}
        # Only the posting and its client; the rest of the store is the viewer's.
        return {
            "url": capture.get("url"),
            "state": {key: state[key] for key in STATE_KEYS if key in state},
            "captured_at": captured_at.isoformat(),
        }
    text = "\n".join(line for line in _split(capture.get("text")) if not _PERSONAL.search(line))
    labels = {
        key: value
        for key, value in (capture.get("labels") or {}).items()
        if not _PERSONAL.search(value)
    }
    return {
        "url": capture.get("url"),
        "title": capture.get("title"),
        "description": capture.get("description"),
        "skills": list(capture.get("skills") or []),
        "labels": labels,
        "text": text,
        "captured_at": captured_at.isoformat(),
    }


# --- reading one view ---------------------------------------------------------------


def _split(text: str | None) -> list[str]:
    return [re.sub(r"\s+", " ", line).strip() for line in (text or "").splitlines() if line.strip()]


def _amount(number: str, suffix: str | None = None) -> float | None:
    try:
        value = float(number.replace(",", ""))
    except ValueError:
        return None
    return value * {"k": 1_000, "m": 1_000_000}.get((suffix or "").lower(), 1)


def _int(number: str) -> int | None:
    try:
        return int(number.replace(",", ""))
    except ValueError:
        return None


def _age(phrase: str) -> timedelta | None:
    """'2 hours ago', 'an hour ago', 'yesterday', 'last week' -> how long ago."""
    phrase = phrase.strip().lower()
    if phrase in ("just now", "now", "today", "moments ago"):
        return timedelta(0)
    if phrase == "yesterday":
        return timedelta(days=1)
    match = re.search(
        r"(\d+|an?|one|last)\s*(second|sec|minute|min|hour|hr|day|week|month|year)s?\b", phrase
    )
    if not match:
        return None
    count = 1 if match.group(1) in ("a", "an", "one", "last") else int(match.group(1))
    unit = match.group(2)
    seconds = {
        "second": 1, "sec": 1, "minute": 60, "min": 60, "hour": 3600, "hr": 3600,
        "day": 86_400, "week": 7 * 86_400, "month": 30 * 86_400, "year": 365 * 86_400,
    }[unit]
    return timedelta(seconds=count * seconds)


def _instant(view: dict, phrase: str) -> tuple[datetime, timedelta] | None:
    age = _age(phrase)
    captured = view.get("captured_at")
    if age is None or not captured:
        return None
    try:
        at = datetime.fromisoformat(captured)
    except ValueError:
        return None
    return (at if at.tzinfo else at.replace(tzinfo=UTC)) - age, age


def _label(labels: dict[str, str], *names: str) -> str | None:
    """The first labelled element whose data-test/data-qa name matches, case-blind."""
    lowered = {key.lower(): value for key, value in labels.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value and value.strip():
            return value.strip()
    return None


def _sections(view: dict) -> tuple[list[str], list[str]]:
    """The posting's own lines (description removed) and the client's, for one view.

    A detail page goes on to list other jobs; everything from there is cut,
    so their budgets are never read as this one's.
    """
    lines = _split(view.get("text"))
    for index, line in enumerate(lines):
        if _PAGE_END.search(line):
            lines = lines[:index]
            break
    # The description is sent on its own; reading terms from it would take a
    # sentence like "budget is $500" for the posting's own budget.
    described = {line for line in _split(view.get("description")) if len(line) > 24}
    lines = [line for line in lines if line not in described]
    for index, line in enumerate(lines):
        if _ABOUT_CLIENT.search(line):
            return lines[:index], lines[index + 1 :]
    return lines, lines


def _first(pattern: str, text: str, flags: int = re.IGNORECASE) -> re.Match[str] | None:
    return re.search(pattern, text, flags)


def _terms(job: str) -> dict[str, Any]:
    """Job type and pay. The earliest statement wins, which on Upwork is the posting's own."""
    candidates: list[tuple[int, int, dict[str, Any]]] = []

    def add(pattern: str, specificity: int, build, flags: int = re.IGNORECASE) -> None:
        match = re.search(pattern, job, flags)
        if match:
            candidates.append((match.start(), -specificity, build(match)))

    hourly = FreelanceJobType.HOURLY
    fixed = FreelanceJobType.FIXED
    add(rf"Hourly\s*:?\s*{_MONEY}\s*(?:-|–|to)\s*{_MONEY}", 3,
        lambda m: {"job_type": hourly, "hourly_min": _amount(m[1], m[2]), "hourly_max": _amount(m[3], m[4])})
    add(rf"{_MONEY}\s*(?:-|–|to)\s*{_MONEY}\s*(?:/\s*hr\s*)?Hourly\b(?!\s*rate)", 3,
        lambda m: {"job_type": hourly, "hourly_min": _amount(m[1], m[2]), "hourly_max": _amount(m[3], m[4])})
    add(rf"Hourly\s*:?\s*{_MONEY}(?![\d,.]|\s*(?:-|–|to)\s*\$)", 2,
        lambda m: {"job_type": hourly, "hourly_min": _amount(m[1], m[2]), "hourly_max": _amount(m[1], m[2])})
    add(rf"{_MONEY}\s*(?:/\s*hr\s*)?\n?\s*Hourly\b(?!\s*rate)", 2,
        lambda m: {"job_type": hourly, "hourly_min": _amount(m[1], m[2]), "hourly_max": _amount(m[1], m[2])})
    add(rf"(?:Est\.?\s*budget|Budget)\s*:?\s*{_MONEY}", 2,
        lambda m: {"job_type": fixed, "budget_amount": _amount(m[1], m[2])})
    add(rf"{_MONEY}\s*\n?\s*Fixed[- ]price", 2,
        lambda m: {"job_type": fixed, "budget_amount": _amount(m[1], m[2])})
    add(r"^Fixed[- ]price\b|\bFixed[- ]price\s*[-–]", 1, lambda m: {"job_type": fixed}, re.MULTILINE)
    add(r"^Hourly\b(?!\s*rate)", 1, lambda m: {"job_type": hourly}, re.MULTILINE)

    if not candidates:
        return {}
    candidates.sort(key=lambda c: (c[0], c[1]))
    # The earliest statement says the type; its figures may come a little later
    # ("Fixed-price - Intermediate - Est. Budget: $300").
    kind = candidates[0][2]["job_type"]
    found = next(
        (c[2] for c in candidates if c[2]["job_type"] is kind and len(c[2]) > 1),
        candidates[0][2],
    )
    found["budget_currency"] = "USD" if len(found) > 1 else None
    return found


_EXPERIENCE = {"entry level": "ENTRY_LEVEL", "intermediate": "INTERMEDIATE", "expert": "EXPERT"}
_PROPOSAL_TIERS = {
    "less than 5": 4, "5 to 10": 10, "10 to 15": 15, "15 to 20": 20, "20 to 50": 50, "50+": 50,
}
_STOP_QUESTIONS = re.compile(
    r"^(skills and expertise|mandatory skills|nice-to-have skills|activity on this job|"
    r"about the client|preferred qualifications|apply now|submit a proposal|project type|"
    r"send a proposal|save job|flag as inappropriate)",
    re.IGNORECASE,
)


def _questions(lines: list[str]) -> list[str]:
    for index, line in enumerate(lines):
        if re.search(r"asked to answer the following questions", line, re.IGNORECASE):
            out: list[str] = []
            for follow in lines[index + 1 :]:
                if _STOP_QUESTIONS.search(follow) or len(out) == 10:
                    break
                question = re.sub(r"^\d+[.)]\s*", "", follow).strip()
                if question and question not in out:
                    out.append(question[:1000])
            return out
    return []


def _location_rule(job: str) -> list[str]:
    """The countries a posting is restricted to; empty when it is open worldwide."""
    match = _first(r"Only freelancers located in (?:the )?(.+?) may apply", job)
    # A tile's short form ("U.S. only") counts only when it names a country.
    strict = match is None
    if strict:
        match = _first(r"^([A-Z][\w.]*(?: [A-Z][\w.]*)*) only$", job, re.MULTILINE)
    if not match:
        return []
    out: list[str] = []
    for part in re.split(r",\s*|\s+and\s+|\s+or\s+", match.group(1)):
        part = part.strip(" .")
        if part.replace(".", "").upper() in ("US", "USA"):
            part = "United States"
        code = country_code(part)
        if not part or (strict and not code):
            continue
        name = country_name(code) if code else part
        if name not in out:
            out.append(name)
    return out


def _country(view: dict, client_lines: list[str]) -> tuple[str | None, str | None]:
    """The client's country and city: from Upwork's label, else a line that is a country."""
    labels = view.get("labels") or {}
    labelled = _label(labels, "client-country", "location", "client-location")
    candidates = []
    if labelled:
        candidates = _split(labelled)
    candidates += client_lines
    for index, line in enumerate(candidates):
        name = re.sub(r"^(client\s+)?location\s*:?\s*", "", line, flags=re.IGNORECASE).strip()
        if len(name) <= 3 or not country_code(name):
            continue
        city = None
        if index + 1 < len(candidates):
            match = re.match(r"^(.+?)\s+\d{1,2}:\d{2}\s*(?:AM|PM)\b", candidates[index + 1], re.IGNORECASE)
            if match:
                city = match.group(1)
        return country_name(country_code(name)), city
    return None, None


def _client(view: dict, lines: list[str]) -> dict[str, Any]:
    text = "\n".join(lines)
    labels = view.get("labels") or {}
    client: dict[str, Any] = {}
    if _first(r"Payment (?:method )?(?:not verified|unverified)", text):
        client["payment_verified"] = False
    elif _first(r"Payment (?:method )?verified", text):
        client["payment_verified"] = True
    if _first(r"Phone number verified", text):
        client["phone_verified"] = True
    if match := _first(r"([0-5](?:\.\d+)?)\s+of\s+([\d,]+)\s+reviews?", text):
        client["feedback"] = float(match[1])
        client["total_reviews"] = _int(match[2])
    elif match := _first(r"Rating is ([0-5](?:\.\d+)?) out of 5", text):
        client["feedback"] = float(match[1])
    if match := _first(rf"{_MONEY}(\+?)\s*(?:total\s+)?spent", text):
        client["total_spent"] = _amount(match[1], match[2])
        client["total_spent_display"] = f"${match[1]}{(match[2] or '').upper()}{match[3]}"
    if match := _first(r"([\d,]+)\s+hires?\b", text, 0):
        client["total_hires"] = _int(match[1])
    if match := _first(r"(\d{1,3})%\s+hire rate", text):
        client["hire_rate_percent"] = float(match[1])
    if match := _first(r"([\d,]+)\s+jobs?\s+posted", text):
        client["total_posted_jobs"] = _int(match[1])
    if match := _first(rf"{_MONEY}\s*/\s*hr\s+avg hourly rate paid", text):
        client["avg_hourly_rate"] = _amount(match[1], match[2])
    if match := _first(r"Member since\s+(.+)$", text, re.IGNORECASE | re.MULTILINE):
        client["member_since"] = match[1].strip()
    if industry := _label(labels, "client-company-profile-industry"):
        client["industry"] = industry
    if size := _label(labels, "client-company-profile-size"):
        client["company_size"] = size
    country, city = _country(view, lines)
    if country:
        client["country"] = country
    if city:
        client["city"] = city
    return client


def _activity(view: dict, job: str) -> dict[str, Any]:
    activity: dict[str, Any] = {}
    for key, pattern in (
        ("total_invited_to_interview", r"Interviewing:\s*(\d+)"),
        ("invites_sent", r"Invites sent:\s*(\d+)"),
        ("total_unanswered_invites", r"Unanswered invites:\s*(\d+)"),
        ("total_hired", r"^Hires?:\s*(\d+)"),
    ):
        if match := _first(pattern, job, re.IGNORECASE | re.MULTILINE):
            activity[key] = int(match[1])
    if (match := _first(r"Last viewed by client:?\s*(.+?ago|yesterday)", job)) and (
        seen := _instant(view, match[1])
    ):
        activity["last_client_activity"] = seen[0].isoformat()
    return activity


def _skills(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        skill = re.sub(r"\s+", " ", str(value)).strip()
        if not skill or len(skill) > 60 or re.fullmatch(r"\+?\d+( more)?|more|less|show (more|less)", skill, re.IGNORECASE):
            continue
        if skill.lower() not in seen:
            seen.add(skill.lower())
            out.append(skill)
    return out[:40]


def _description(text: str | None) -> str | None:
    if not text:
        return None
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    while lines and re.fullmatch(r"\s*(…|\.\.\.)?\s*(more|less|show more|show less)\s*", lines[-1], re.IGNORECASE):
        lines.pop()
    joined = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    joined = re.sub(r"\s*(…|\.\.\.)\s*more$", "…", joined, flags=re.IGNORECASE)
    return joined or None


def read_view(view: dict) -> dict[str, Any]:
    """Everything one capture says about the posting, keyed by column (or extra) name."""
    if "state" in view:
        return read_state(view)
    job_lines, client_lines = _sections(view)
    job = "\n".join(job_lines)
    out: dict[str, Any] = {
        "title": re.sub(r"\s+", " ", view.get("title") or "").strip() or None,
        "description": _description(view.get("description")),
        "skills": _skills(view.get("skills") or []),
        **_terms(job),
        "client": _client(view, client_lines),
        "screening_questions": _questions(job_lines),
        "activity": _activity(view, job),
        "preferred_freelancer_location": _location_rule(job),
    }
    if match := _first(r"\b(Entry level|Intermediate|Expert)\b", job, 0) or _first(r"\b(Entry Level)\b", job, 0):
        out["experience_level"] = _EXPERIENCE[match[1].lower()]
    if match := _first(r"(Less than (?:1|one) month|1 to 3 months|3 to 6 months|More than 6 months)", job):
        out["duration_label"] = match[1][0].upper() + match[1][1:]
    if match := _first(r"(Less than 30 hrs/week|More than 30 hrs/week|30\+ hrs/week|Hours to be determined)", job):
        out["workload"] = match[1][0].upper() + match[1][1:]
    if match := _first(r"Proposals:?\s*(Less than 5|5 to 10|10 to 15|15 to 20|20 to 50|50\+)", job):
        out["proposals_label"] = match[1][0].upper() + match[1][1:]
        out["total_applicants"] = _PROPOSAL_TIERS[match[1].lower()]
    if match := _first(r"(?:Send a proposal for|Required Connects to submit a proposal):?\s*(\d+)", job):
        out["connects_required"] = int(match[1])
    if match := _first(r"Need to hire (\d+) freelancers?", job):
        out["freelancers_to_hire"] = int(match[1])
    posted = _label(view.get("labels") or {}, "job-pubilshed-date", "job-published-date", "posted-on", "PostedOn")
    phrase = posted or (m[1] if (m := _first(r"Posted\s+(?:on\s+)?(.+?ago|yesterday|just now|today)", job)) else None)
    if phrase and (when := _instant(view, re.sub(r"^posted\s+", "", phrase, flags=re.IGNORECASE))):
        out["published_at"], out["posted_age"] = when
    return out


# --- the store view: Upwork's own page state ------------------------------------------

# The parts of the job-details store that describe the posting and its client.
STATE_KEYS = ("job", "buyer", "sands")
_TIERS = {1: "ENTRY_LEVEL", 2: "INTERMEDIATE", 3: "EXPERT"}


def instant(value: Any) -> datetime | None:
    """Upwork's timestamps (and our own ISO strings): ISO with or without a zone (UTC when absent), or epoch ms."""
    if isinstance(value, (int, float)) and value > 0:
        return datetime.fromtimestamp(value / 1000, tz=UTC)
    if not isinstance(value, str) or not value:
        return None
    try:
        at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def _num(value: Any) -> float | None:
    """A number, a numeric string, or a money object ({"amount": ...})."""
    if isinstance(value, dict):
        value = value.get("amount")
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"-?[\d,]*\.?\d+", str(value))
    return _amount(match.group(0)) if match else None


def _count(value: Any) -> int | None:
    number = _num(value)
    return int(number) if number is not None else None


def _name(value: Any) -> str | None:
    if isinstance(value, dict):
        value = value.get("name") or value.get("prefLabel") or value.get("label")
    return value.strip() if isinstance(value, str) and value.strip() else None


def _find(tree: Any, key: str) -> Any:
    """The first value stored under ``key`` anywhere in ``tree``, breadth first."""
    queue = [tree]
    while queue:
        node = queue.pop(0)
        if isinstance(node, dict):
            if node.get(key) is not None:
                return node[key]
            queue.extend(v for v in node.values() if isinstance(v, (dict, list)))
        elif isinstance(node, list):
            queue.extend(v for v in node if isinstance(v, (dict, list)))
    return None


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _state_skills(sands: dict) -> list[str]:
    """Skill names from the store's skill groups, one level of children deep."""
    names: list[str] = []
    for key in ("ontologySkills", "additionalSkills", "skills"):
        for item in sands.get(key) or []:
            for skill in [item, *_dict(item).get("children", [])]:
                if name := _name(skill):
                    names.append(name)
    return _skills(names)


def read_state(view: dict) -> dict[str, Any]:
    """The store view, read into the same keys as a text capture.

    Every field is optional: a key Upwork renamed reads as missing, and the
    other views (or the next capture) fill the column instead.
    """
    state = _dict(view.get("state"))
    job, buyer = _dict(state.get("job")), _dict(state.get("buyer"))
    seen = _dict(job.get("clientActivity"))

    activity: dict[str, Any] = {}
    for key, source in (
        ("total_invited_to_interview", "totalInvitedToInterview"),
        ("invites_sent", "invitationsSent"),
        ("total_unanswered_invites", "unansweredInvites"),
        ("total_hired", "totalHired"),
    ):
        if (value := _count(seen.get(source))) is not None:
            activity[key] = value
    if last := instant(seen.get("lastBuyerActivity")):
        activity["last_client_activity"] = last.isoformat()

    budget = _dict(job.get("extendedBudgetInfo"))
    hourly_min, hourly_max = _num(budget.get("hourlyBudgetMin")), _num(budget.get("hourlyBudgetMax"))
    fixed = _num(job.get("budget"))
    terms: dict[str, Any] = {}
    if hourly_min or hourly_max:
        terms = {"job_type": FreelanceJobType.HOURLY, "hourly_min": hourly_min or hourly_max,
                 "hourly_max": hourly_max or hourly_min, "budget_currency": "USD"}
    elif fixed:
        currency = _dict(job.get("budget")).get("currencyCode") or "USD"
        terms = {"job_type": FreelanceJobType.FIXED, "budget_amount": fixed, "budget_currency": currency}

    stats, place = _dict(buyer.get("stats")), _dict(buyer.get("location"))
    client: dict[str, Any] = {}
    if isinstance(buyer.get("isPaymentMethodVerified"), bool):
        client["payment_verified"] = buyer["isPaymentMethodVerified"]
    if (spent := _num(stats.get("totalCharges"))) is not None:
        client["total_spent"] = spent
    if (reviews := _count(stats.get("feedbackCount"))) is not None:
        client["total_reviews"] = reviews
    if (score := _num(stats.get("score"))) is not None and score > 0:
        client["feedback"] = score
    if (hires := _count(stats.get("totalHires") or stats.get("totalJobsWithHires"))) is not None:
        client["total_hires"] = hires
    if (code := country_code(str(place.get("country") or ""))) is not None:
        client["country"] = country_name(code)
    if city := _name(place.get("city")):
        client["city"] = city
    if since := instant(_dict(buyer.get("company")).get("contractDate")):
        client["member_since"] = f"{since:%b} {since.day}, {since.year}"

    questions = [
        str(q.get("question")).strip()[:1000]
        for q in (job.get("questions") or [])
        if isinstance(q, dict) and q.get("question")
    ][:10]
    posted = instant(job.get("postedOn") or job.get("publishTime") or job.get("createdOn"))
    out: dict[str, Any] = {
        "title": re.sub(r"\s+", " ", str(job.get("title") or "")).strip() or None,
        "description": _description(job.get("description")),
        "skills": _state_skills(_dict(state.get("sands"))),
        **terms,
        "client": client,
        "screening_questions": questions,
        "activity": activity,
        "preferred_freelancer_location": [],
        "category": _name(job.get("categoryGroup")),
        "subcategory": _name(job.get("category")),
        "total_applicants": _count(seen.get("totalApplicants")),
        "connects_required": _count(_find(state, "requiredConnects")),
        "experience_level": _TIERS.get(_count(job.get("contractorTier")) or 0),
        "duration_label": _name(job.get("durationLabel")),
    }
    if posted:
        # An exact time: it beats every "posted ... ago" a text view rounds.
        out["published_at"], out["posted_age"] = posted, timedelta(0)
    return out


# --- both views to columns -------------------------------------------------------------

COLUMNS = (
    "title", "description", "job_type", "budget_amount", "budget_currency", "hourly_min",
    "hourly_max", "duration_label", "workload", "experience_level", "category", "subcategory",
    "skills", "total_applicants", "freelancers_to_hire", "preferred_freelancer_location",
)
EXTRAS = ("screening_questions", "activity", "proposals_label", "connects_required")


def normalize(raw: dict) -> dict[str, Any]:
    """Column values (and ``extras``) from every view ``raw`` holds, the most precise first.

    A value one view lacks comes from another, so a tile seen after the
    detail never blanks out what only the detail page showed.
    """
    readings = [read_view(raw[view]) for view in VIEWS if isinstance(raw.get(view), dict)]
    if not readings:
        return {}

    def pick(key: str) -> Any:
        for reading in readings:
            value = reading.get(key)
            if value not in (None, [], {}, ""):
                return value
        return None

    out: dict[str, Any] = {key: pick(key) for key in COLUMNS}
    # A tile's title is the link Upwork itself renders; a detail page's is read
    # from its heading. The description and skills are whichever view has more,
    # which is the detail unless its page was half loaded.
    out["title"] = next((r["title"] for r in reversed(readings) if r.get("title")), None)
    out["description"] = max((r["description"] for r in readings if r.get("description")), key=len, default=None)
    out["skills"] = max((r["skills"] for r in readings), key=len, default=[])
    out["preferred_freelancer_location"] = out["preferred_freelancer_location"] or []
    # Pay comes as a set: a detail that states the type wins whole, never mixed
    # with a tile's figures for the other type.
    terms = next((r for r in readings if r.get("job_type")), {})
    for key in ("job_type", "budget_amount", "budget_currency", "hourly_min", "hourly_max"):
        out[key] = terms.get(key)
    client: dict[str, Any] = {}
    for reading in reversed(readings):
        client.update({k: v for k, v in reading["client"].items() if v is not None})
    out["client"] = client
    # The freshest "posted ... ago" is the most precise: Upwork rounds older ages.
    dated = [r for r in readings if r.get("published_at")]
    out["published_at"] = min(dated, key=lambda r: r["posted_age"])["published_at"] if dated else None
    activity: dict[str, Any] = {}
    for reading in reversed(readings):
        activity.update(reading["activity"])
    out["extras"] = {key: pick(key) for key in EXTRAS} | {"activity": activity}
    return out


def extras(raw: dict | None) -> dict[str, Any]:
    """What the posting's page shows beyond the columns."""
    found = (raw or {}).get("extras") or {}
    return {
        "screening_questions": list(found.get("screening_questions") or []),
        "activity": dict(found.get("activity") or {}),
        "proposals_label": found.get("proposals_label"),
        "connects_required": found.get("connects_required"),
    }
