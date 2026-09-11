# Resume Tailoring Platform

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

| Area | State |
|---|---|
| PostgreSQL schema (22 tables, 12 enums, `all_resumes` view) | Done |
| Auth: register/login/refresh, JWT + extension PATs | Done |
| Canonical Resume Markdown (CRM v1) + parser + renderer | Done |
| Validation registry (10 rules, all negative-tested) | Done |
| DOCX export, `designed` + `ats_plain` profiles | Done |
| Resume CRUD + full-text search + export API | Done |
| LLM provider layer, generation pipeline | Not started |
| Tailoring, job tracking, calendar, maintenance | Not started |
| Next.js portal | Not started |
| Chrome extension | Not started |

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
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Generate real secrets rather than using the example values:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"          # APP_SECRET_KEY
python3 -c "import base64,os; print(base64.b64encode(os.urandom(32)).decode())"  # APP_KEK
```

API docs at <http://localhost:8000/docs>; the OpenAPI document both frontends
generate their types from is at `/openapi.json`.

## Tests

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

The suite deliberately covers the things that fail silently:

- **CRM round-trip is a fixed point** (`parse → render → parse` is identity).
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
  core/        config, security, crypto (AES-GCM), timezone, deps
  models/      SQLAlchemy 2.0 tables + native PG enums
  resume/      CRM dialect: ast.py, parser.py, renderer.py
  validation/  the hard-rule registry
  export/      oxml.py, carrier.py, profiles.py, docx_renderer.py
  api/v1/      auth, resumes, exports
  services/    persistence and seed data
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
