# PhoeniX

Two ways to find work, one place to run it all.

- **Freelancing** — bidding on Upwork: job search through the Apify actor
  `upwork-vibe/upwork-job-scraper` (or, optionally, another supported actor or
  Upwork's own API), a focus list,
  proposals drafted from a freelancer profile, and a tracker from the first
  star to hired.
- **Remote** — remote roles: resumes generated and tailored against a
  posting, applications filled from the browser, and an interview pipeline.
- **Shared tools** — the calendar, job maintenance, and Interview Assist
  (planned), which serve both categories.

Three surfaces over one backend: a **Next.js portal**, a **FastAPI +
PostgreSQL** backend, and a **Chrome MV3 side-panel extension** that tailors a
resume against whatever job page you have open and downloads the `.docx`.

The Remote category is built around the supplied Resume Generator prompt,
treated as a specification rather than a suggestion: its hard rules (no
placeholder tokens, exactly 4 skill categories, at most 3 employers, at least
one internal promotion, tenure arithmetic that matches the claimed years) are
enforced programmatically in `backend/app/remote/validation/rules.py`, not left
to the model's own say-so. The Freelancing category's proposal generator has
the same shape waiting for its prompt: see `backend/prompts/proposal_generator_v1.md`.

## Status

All three surfaces build and run.

| Area | State |
|---|---|
| PostgreSQL schema (31 tables, 16 enums, `all_resumes` view, idempotent upgrades) | Done |
| Auth: register/login/refresh, JWT + extension tokens | Done |
| **Remote** — Resume Markdown v1: parser, renderer, round-trip property | Done |
| **Remote** — Validation registry (10 hard rules, every one negative-tested) | Done |
| **Remote** — DOCX export, `designed` + `ats_plain` profiles | Done |
| **Remote** — Generation pipeline: 3 turns, 2 Python gates, bounded repair | Done |
| **Remote** — Tailoring (job- and instruction-based), applications, interview stages | Done |
| **Remote** — Chrome MV3 side panel (5 tabs, scan + fill engines, many tabs at once) | Done |
| **Freelancing** — Job sources behind one seam: Apify (default) and Upwork's own API | Done |
| **Freelancing** — Apify source: per-user token, run polling, dataset paging, run reuse; actor profiles for `upwork-vibe` (default, every filter it accepts) and `neatrat` | Done |
| **Freelancing** — Upwork API source: per-user key pair, OAuth2, token refresh, every `MarketplaceJobPostingsSearchFilter` field | Done |
| **Freelancing** — Phase 1: search, snapshots, focus, hide, saved searches, "open to my country" | Done |
| **Freelancing** — Phase 2 (initial): freelancer profiles, proposals, the engine seam + a template engine | Done — awaiting the prompt |
| **Freelancing** — Phase 3: tracking focused jobs through the bidding pipeline, with history | Done |
| **Shared** — Calendar and job maintenance, for applications, maintained jobs and freelancing bids | Done |
| **Shared** — Interview Assist | Planned (status endpoint + page) |
| LLM layer: Anthropic + OpenAI adapters, model catalog, prompt caching | Done |
| Job queue (Postgres `SKIP LOCKED`) + SSE and polling event streams | Done |
| Next.js portal (21 routes) | Done |
| PDF export, tightening ladder | Not started |
| ATS adapter registry / Workday multi-step | Not started |

## Setup

Requires PostgreSQL 16+, Python 3.12+, Node 22+.

```bash
# 1. Database
sudo -u postgres createuser -P remote_assist       # password: remote_assist_dev
sudo -u postgres createdb -O remote_assist remote_assist

# 2. Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env        # then replace APP_SECRET_KEY and APP_KEK
.venv/bin/python -m app.db.schema     # build the schema from the models
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Generate real secrets rather than using the example values:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"          # APP_SECRET_KEY
python3 -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"  # APP_KEK
```

`APP_SECRET_KEY` signs session tokens and the Upwork OAuth state; `APP_KEK`
encrypts the LLM API keys and Upwork credentials users store in Settings. They
are separate because they rotate differently — changing the signing key just
logs everyone out, while changing the KEK means re-encrypting every stored key
(which is what the `encryption_key_version` columns are for).

### Schema

There is no migration tool. `app/db/schema.py` builds the database directly
from the SQLAlchemy models, so adding a table is a model edit and nothing
else. It is idempotent — safe to re-run — and `--reset` drops everything first:

```bash
.venv/bin/python -m app.db.schema            # create anything missing
.venv/bin/python -m app.db.schema --reset    # drop and rebuild; destroys data
```

The trade-off to know about: `create_all` only ever *adds whole tables*. A
column or constraint added to a table that already exists has to be stated in
`UPGRADES` in the same file, as SQL that is safe to run twice. The September
2026 change that let meetings and maintained jobs point at a freelancing track
is there; a database built before it is brought up to date by the plain
`python -m app.db.schema` run above, with its data intact.

```bash
# 3. Web portal
npm install                    # workspace root; links apps/* and packages/*
npm run types                  # regenerate TS types from the running backend
npm run dev:web                # http://localhost:3000

# 4. Extension
npm run build:ext              # then load apps/extension/.output/chrome-mv3
                               # via chrome://extensions -> Load unpacked
```

API docs at <http://localhost:8000/docs>; the OpenAPI document both frontends
generate their types from is at `/openapi.json`.

### Setting up job search

Freelancing job search runs through a job source chosen by
`FREELANCING_JOB_SOURCE`. The default, `apify`, runs the Apify actor
[`upwork-vibe/upwork-job-scraper`](https://apify.com/upwork-vibe/upwork-job-scraper)
and needs only an Apify API token:

1. Create a token in Apify Console -> Settings -> Integrations.
2. Paste it into **Settings -> Integrations** and press **Save and test**.
   A deployment-wide token can go in `APIFY_TOKEN` instead; a user's own wins.

Each search starts one actor run, billed to that Apify account per job
returned: about $0.0105 on Apify's free plan, from $0.0045 on paid tiers,
platform usage included. "Load more" reads further into what a run already
returned before starting another, and an identical search within half an hour
reuses its run. `APIFY_UPWORK_ACTOR_ID=neatrat~upwork-job-scraper` switches to
the other supported actor. The details, including every input field the
filters map to, are in `docs/freelancing.md`.

#### Using Upwork's own API instead

Set `FREELANCING_JOB_SOURCE=upwork`. Job search then runs against Upwork's
GraphQL API on the user's behalf, so each user (or the deployment) needs an
Upwork API key:

1. Create a key at <https://www.upwork.com/developer/keys> with at least
   **Common Entities - Read-Only Access** and **Read marketplace Job
   Postings** (add **Ontology - Read-Only Access** for the category tree and
   skill autocomplete). Upwork gates key approval on account standing; see
   `docs/freelancing.md`.
2. Register the redirect URI the portal shows under **Settings ->
   Integrations** — by default
   `http://127.0.0.1:8000/api/v1/freelancing/upwork/callback`. It is derived
   from `API_PUBLIC_URL`; set that (and `PORTAL_URL`, where the callback sends
   the browser afterwards) to the addresses the *browser* reaches when the
   backend is not on the same machine.
3. Paste the client id and secret into **Settings -> Integrations** and press
   **Connect Upwork**. A deployment-wide key pair can instead go in
   `UPWORK_CLIENT_ID` / `UPWORK_CLIENT_SECRET`; a user's own pair takes
   precedence.

Access tokens last 24 hours and are refreshed automatically; a session unused
for two weeks expires and must be authorized again.

### Branding

`branding/avatar.png` is the mark shown beside the wordmark; `branding/icon.png`
is the favicon and the extension's toolbar icon. After replacing either, run
`npm run brand` and commit what it writes — it lifts the white background,
crops to a square, and emits every size the portal and extension use.

### Connecting the extension

1. In the portal, open **Settings -> Extension** and create a token. It is
   shown exactly once - only a hash is stored.
2. Click the extension's toolbar icon (or `Alt+Shift+J`) to open the side panel.
3. Paste the backend URL and the token into the panel's **Settings** tab.

### Using it

Add an Anthropic or OpenAI key under **Settings -> Models** before generating
a resume. Everything else - uploading a resume, exporting `.docx`, tracking
applications, the calendar, job search, template proposal drafts - works
without one.

## Tests

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

The suite deliberately covers the things that fail silently:

- **Resume Markdown round-trip is a fixed point** (`parse → render → parse` is identity).
  This property is what makes storing markdown as the canonical form safe.
- **Every validation rule has a negative test.** A rule that never fires is
  worse than no rule.
- **OOXML child-element order** is asserted against the ECMA-376 sequence.
  Word tolerates wrong order; LibreOffice silently drops the element, so a
  missing border is otherwise invisible until someone opens a PDF.
- **A naive extractor (`docx2txt`) must see every word** in both export
  profiles — this is the closest cheap proxy for an ATS.
- **DST edge cases** pinned to real transition dates (2026-03-08, 2026-11-01),
  including the 25-hour and 23-hour local days.
- **The exact request each job source receives** is asserted for every search
  parameter: the Upwork filter against a mocked Upwork
  (`tests/test_freelancing.py`), each actor's input and run options against a
  mocked Apify (`tests/test_freelancing_apify_vibe.py`, `tests/test_freelancing_apify.py`). A renamed field on either
  side is a one-line change in one file, and these tests say it reached the wire.
- **What an Apify search costs**: a slow run is polled, not restarted; "load
  more" reads the same dataset; a repeated search reuses its run.
- **The Freelancing flow end to end**: connect, search, focus, draft, submit,
  book a call on the shared calendar, promote a won bid into maintenance —
  including token refresh and the expired-session path.

## Layout

```
backend/app/
  core/           config, security, crypto (AES-GCM), timezone, deps
  db/             base, session, schema builder (+ idempotent upgrades)
  models/         SQLAlchemy 2.0 tables + native PG enums, one registry
  schemas/        pydantic request/response shapes
  llm/            provider port, anthropic/openai adapters, catalog, prompts
  worker/         the queue poller; dispatches by generation kind
  services/       generation queue (platform-level)
  remote/         THE REMOTE CATEGORY
    resume/       Resume Markdown: document.py, parser.py, renderer.py
    validation/   the hard-rule registry
    export/       oxml.py, carrier.py, profiles.py, docx_renderer.py
    orchestration/ resume_pipeline.py, form_pipeline.py, ats_report.py
    services/     job links, resume linking, resume storage, seed data
  freelancing/    THE FREELANCING CATEGORY
    sources/      base.py (the JobSource seam), registry.py, apify_upwork.py, upwork_graphql.py
    apify/        client.py (runs, datasets), profiles.py, vibe_scraper.py, neatrat_scraper.py
    countries.py  ISO country codes and Upwork's regions, both ways
    upwork/       oauth.py, client.py, queries.py, filters.py, normalize.py
    services/     apify_connection.py, connection.py (Upwork tokens), jobs.py, tracking.py
    snapshot.py   what every source's snapshot has in common
    proposals/    engine.py (the seam), run.py (the worker step)
  shared/         SHARED TOOLS
    calendar/     recurrence.py, tracking.py (stage <-> meeting seam)
    interview/    status.py (planned)
  api/v1/
    auth.py settings.py generations.py      account and platform
    remote/       resumes, tailored_resumes, tailoring, exports, applications, extension
    freelancing/  upwork, jobs, profile, proposals, tracking
    shared/       meetings, maintenance, interview
backend/prompts/  resume_generator_v1.md (frozen), proposal_generator_v1.md (placeholder)
apps/web/src/app/
  page.tsx                       the workspace launcher
  remote/                        overview, resumes, tailor, applications
  freelancing/                   overview, jobs, jobs/[id], proposals, proposals/[id], tracking, profile
  calendar/ maintenance/ interview/ settings/
apps/web/src/components/
  remote/ freelancing/ shared/   per category; the primitives stay at the root
apps/extension/   WXT + React MV3 side panel (a Remote surface, plus the shared calendar)
packages/api-types/  generated OpenAPI types, shared by both clients
docs/             architecture.md, freelancing.md, resume-markdown.md
```

The URL space mirrors it: `/api/v1/remote/...`, `/api/v1/freelancing/...`,
`/api/v1/shared/...`, with `/api/v1/auth`, `/settings` and `/generations` at
the top. The portal's old root routes (`/resumes`, `/tailor`, `/applications`)
redirect to their `/remote/...` homes.

## Conventions worth knowing before editing

- **All times are `timestamptz`.** Never store the string `EST`/`EDT` — they are
  renderings, not zones, and `AT TIME ZONE 'EST'` is a fixed −05:00 offset that
  silently shifts every meeting by an hour for eight months a year. The IANA
  zone lives in a `display_timezone` column. See `app/core/timezone.py`.
- **`content_markdown` is canonical.** `content_text` is derived for search and
  keyword scoring; never treat it as the source of truth.
- **Nothing binary is stored.** `.docx` is rendered on demand and streamed.
- **Raw OOXML uses `insert_element_before`, never `append`** — see the comment
  at the top of `app/remote/export/oxml.py`.
- **Stage names are `text` plus a lookup table, not an enum**, because users
  configure their own interview pipelines. Freelancing track stages *are* an
  enum: Upwork's states are fixed, and the board relies on their order.
- **Job searches go through a `JobSource`**, chosen by `FREELANCING_JOB_SOURCE`
  (default `apify`). Each provider's field names live in one file -
  `app/freelancing/apify/vibe_scraper.py`, `neatrat_scraper.py`,
  `app/freelancing/upwork/filters.py`.
  Everything else speaks this API's own vocabulary, and the search form shows
  only the filters the source in service can apply.
- **No third-party failure answers 401.** To the portal a 401 means its own
  session ended; a rejected Apify or Upwork token is a 409 with a code.
- **A job snapshot is not a mirror.** Upwork's terms allow caching a posting
  for 24 hours; unfocused, untracked snapshots are pruned after a day. A
  focused job is the user's own list and stays.
- **Track stage changes go through `set_stage`**, so the history and the
  proposal's own status cannot drift.
- **A meeting has exactly one owner** — an interview stage, a maintained job,
  or a freelancing track — enforced by a check constraint.
- **Names are spelled out** - `content_markdown`, not `content_md`. See
  `docs/architecture.md` for the rule and its one exception.
- **The system prompt is byte-frozen.** Nothing is interpolated into it - not
  the date, not the mode, not the user. Interpolating anything invalidates the
  whole ~17k-token cached prefix on every request. Volatile values go in the
  first user message. `tests/test_pipeline.py` asserts this.
- **Recurrence expands in LOCAL wall-clock, then converts to UTC.** Expanding
  in UTC turns a weekly 10:00 ET standup into 09:00 or 11:00 across a DST
  boundary.
- **All LLM network I/O in the extension lives in the side panel**, never the
  service worker: MV3 workers are evicted after ~30s idle and a generation
  takes 60-180s.
- **Provider differences are capability flags, not try/except.** `effort`
  errors on Haiku 4.5; `temperature` is rejected by current Anthropic models.
  See `app/llm/catalog.py`.
