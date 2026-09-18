# Phoenix Eye

Three surfaces over one backend: a **Next.js portal**, a **FastAPI + PostgreSQL**
backend, and a **Chrome MV3 side-panel extension** that tailors a resume against
whatever job page you have open and downloads the `.docx`.

The system is built around the supplied Resume Generator prompt, treated as a
specification rather than a suggestion: its hard rules (no placeholder tokens,
exactly 4 skill categories, at most 3 employers, at least one internal
promotion, tenure arithmetic that matches the claimed years) are enforced
programmatically in `backend/app/validation/rules.py`, not left to the model's
own say-so.

## Status

All three surfaces build and run.

| Area | State |
|---|---|
| PostgreSQL schema (22 tables, 12 enums, `all_resumes` view) | Done |
| Auth: register/login/refresh, JWT + extension tokens | Done |
| Resume Markdown v1: parser, renderer, round-trip property | Done |
| Validation registry (10 hard rules, every one negative-tested) | Done |
| DOCX export, `designed` + `ats_plain` profiles | Done |
| LLM layer: Anthropic + OpenAI adapters, model catalog, prompt caching | Done |
| Generation pipeline: 3 turns, 2 Python gates, bounded repair | Done |
| Job queue (Postgres `SKIP LOCKED`) + SSE and polling event streams | Done |
| Tailoring: job-based and instruction-based | Done |
| Tracking, stages, calendar, recurring meetings, maintenance | Done |
| Next.js portal (11 routes) | Done |
| Chrome MV3 side panel (5 tabs, scan + fill engines) | Done |
| Tailor many open tabs at once; a resume per posting; resume upload | Done |
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

`APP_SECRET_KEY` signs session tokens; `APP_KEK` encrypts the LLM API keys
users store in Settings. They are separate because they rotate differently —
changing the signing key just logs everyone out, while changing the KEK means
re-encrypting every stored key (which is what the `kek_version` column is for).

### Schema

There is no migration tool. `app/db/schema.py` builds the database directly
from the SQLAlchemy models, so adding a column is a model edit and nothing
else. It is idempotent — safe to re-run — and `--reset` drops everything first:

```bash
.venv/bin/python -m app.db.schema            # create anything missing
.venv/bin/python -m app.db.schema --reset    # drop and rebuild; destroys data
```

The trade-off to know about: `create_all` only ever *adds*. It will not alter
an existing column, drop one, or rename anything. While the schema is still
moving, `--reset` is the answer. Once there are applications in the database
worth keeping, either write the `ALTER TABLE` by hand or add Alembic back —
the models are unchanged either way, so nothing here blocks that.

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

### Branding

`branding/avatar.png` is the mark shown beside the wordmark; `branding/icon.png`
is the favicon and the extension's toolbar icon. After replacing either, run
`npm run brand` and commit what it writes — it lifts the white background,
crops to a square, and emits every size the portal and extension use.

### Connecting the extension

1. In the portal, open **Settings -> Extension tokens** and create one. It is
   shown exactly once - only a hash is stored.
2. Click the extension's toolbar icon (or `Alt+Shift+J`) to open the side panel.
3. Paste the backend URL and the token into the panel's **Settings** tab.

### Using it

Add an Anthropic or OpenAI key under **Settings -> API keys** before generating
anything. Everything else - uploading a resume, exporting `.docx`, tracking
applications, the calendar - works without one.

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

## Layout

```
backend/app/
  core/           config, security, crypto (AES-GCM), timezone, deps
  models/         SQLAlchemy 2.0 tables + native PG enums
  resume/         Resume Markdown: document.py, parser.py, renderer.py
  validation/     the hard-rule registry
  export/         oxml.py, carrier.py, profiles.py, docx_renderer.py
  llm/            provider, anthropic/openai adapters, catalog, prompts
  orchestration/  resume_pipeline.py, form_pipeline.py, ats_report.py
  worker/         the queue poller
  api/v1/         auth, settings, resumes, tailoring, generations, exports,
                  applications, meetings, maintenance, extension
  services/       persistence, seed data, recurrence, generation queue
backend/prompts/  resume_generator_v1.md - the frozen cached system prefix
apps/web/         Next.js portal
apps/extension/   WXT + React MV3 side panel
packages/api-types/  generated OpenAPI types, shared by both clients
```

## Conventions worth knowing before editing

- **All times are `timestamptz`.** Never store the string `EST`/`EDT` — they are
  renderings, not zones, and `AT TIME ZONE 'EST'` is a fixed −05:00 offset that
  silently shifts every meeting by an hour for eight months a year. The IANA
  zone lives in a `display_tz` column. See `app/core/timezone.py`.
- **`content_md` is canonical.** `content_text` is derived for search and
  keyword scoring; never treat it as the source of truth.
- **Nothing binary is stored.** `.docx` is rendered on demand and streamed.
- **Raw OOXML uses `insert_element_before`, never `append`** — see the comment
  at the top of `app/export/oxml.py`.
- **Stage names are `text` plus a lookup table, not an enum**, because users
  configure their own interview pipelines.
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
