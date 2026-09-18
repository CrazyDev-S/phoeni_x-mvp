# Architecture notes

Decisions that are cheap now and expensive later, with the reasoning attached.

## The generator prompt is a specification, not a hint

`backend/prompts/resume_generator_v1.md` ships verbatim. An output contract is
appended to it (inside the same frozen string, so it costs nothing extra) that
replaces its 4-block text output with: a JSON ledger, the resume as Resume Markdown
markdown, and a JSON flags report - delivered across three turns.

**Why three turns rather than one call.** A single call asking for all four
blocks would have the model write the resume and "12/12 PASS" in the same
breath, so the gate gates nothing. Splitting the turns lets real Python sit
between them: a parse gate, then a rule gate, each able to send one bounded
repair turn naming the exact failure.

**Why turns of one conversation rather than three calls.** Three independent
calls each re-pay the ~17k-token prefix. Turns share a growing cached prefix.

**BLOCK 3 is computed, not asked for.** Keyword coverage counts and
percentages are derived in `orchestration/ats_report.py` from the turn-1
keyword plan plus the parsed resume, so the report can never disagree with the
document it describes.

## Markdown is canonical, so the dialect is strict

Storing markdown means the exporter has to read it back. That is only safe
against one unambiguous grammar - see `docs/resume-markdown.md`. The round-trip
property (`parse -> render -> parse` is a fixed point) is asserted in
`tests/test_resume_markdown.py` and is what makes editing in the portal non-destructive.

Validation runs on the parsed AST, not with regexes over prose. That is what
makes rules like "tenure arithmetic agrees with the claimed years" tractable at
all.

## Schema without migrations

`app/db/schema.py` creates the database from `Base.metadata`. Two things cannot
come from the models and are stated explicitly there: the `citext` extension
behind the case-insensitive email column, and the `all_resumes` view.

`--reset` drops the native enum types as well as the tables. `metadata.drop_all`
leaves enum types behind, and the next `create_all` then fails with "type
already exists" — which is the usual way this approach bites people.

## Time

Six rules; follow all six and the EST/EDT bug cannot occur.

1. `timestamptz` everywhere, never `timestamp`.
2. Never store "EST"/"EDT" - they are renderings. `AT TIME ZONE 'EST'` is a
   fixed -05:00 offset and shifts every meeting by an hour for eight months a
   year. The IANA zone lives in a `display_tz` column.
3. The connection is pinned to UTC.
4. Python datetimes are always tz-aware; `app_today()` reads the display zone,
   not the server's locale.
5. The API speaks local wall-clock plus a zone, and derives the instant.
6. Recurrence expands over local wall-clock, then converts.

`timestamptz AT TIME ZONE` is STABLE, not IMMUTABLE, so it cannot appear in an
index expression - local day bounds are computed in Python and queried as a
btree range.

## The extension inverts the usual advice

All backend I/O lives in the **side panel document**, not the service worker.
MV3 workers are evicted after ~30s idle; a tailoring run takes 60-180s. The
panel is a normal long-lived page context, and `URL.createObjectURL` (needed
for the `.docx` download) does not exist in a worker at all.

Related choices:

- **Real `host_permissions`, not `activeTab`.** `activeTab` grants the main
  frame origin only, so it cannot read a Greenhouse or Lever form inside an
  iframe - which is most application forms.
- **No static content scripts.** Everything goes through `executeScript` on
  demand, which is also the panel-to-page RPC.
- **Panel scoped to the window, not the tab**, because it carries a calendar
  and a banner that should survive tab switches.
- **`sidePanel.open()` only from `action.onClicked`** - the user gesture does
  not survive a `runtime.sendMessage` round trip.
- **Zero `web_accessible_resources`**, so sites probing for known extension IDs
  find nothing.
- **Frames are addressed by Chrome's frame id.** Field ids are
  `f<frameId>:<index>`, and scan and fill each target one frame. Every frame
  used to scan itself as `f0`, so a form inside an iframe (Greenhouse's embed)
  was filled against the wrong frame and nothing in it filled.

## Many postings at once

The Apply tab lists every open tab. Selected tabs tailor side by side, and the
worker runs `WORKER_CONCURRENCY` generations at once (default 3); with one at a
time, the fifth tab waited out four full runs.

Each posting's resume is a **job link** (`job_links`), keyed by a normalised
URL (`services/job_links.py:job_key`): scheme, `www.`, fragment, tracking
parameters and an `/application` or `/apply` suffix are dropped, so a posting
and its application form share one link. A link names either a tailored resume
or a base resume used as it is, and records the latest tailoring run. The
worker attaches a finished run to every link naming it, so a run survives the
panel closing, and reopening the panel picks its progress back up. A tab with
no link still shows a resume tailored from the same URL.

Tailoring in the panel does not save the resume. It is kept, so the panel can
download it and fill the form with it, but the resume lists (`GET
/tailored-resumes`, which the portal's library and dashboard read) leave it
out until **Save & track** registers it as an application. Resumes tailored in
the portal are always listed: the portal has no separate save step.

A failed generation releases its idempotency key. Reusing it made the same
request fail forever, handing back the old error on every retry.

## Filling forms

Framework-controlled inputs swallow `el.value = x`. The working technique is
the native prototype setter plus clearing React's value tracker, then
dispatching `input`/`change` with `bubbles` **and** `composed` - without
`composed`, an event raised inside a shadow root never reaches a framework
listening at the app root.

Fills run sequentially with a ~90ms gap. Parallel fills break cascading
dependents (country -> state -> city) and trip rate-limited validators.

Verification is two-phase, at t+150ms and t+1000ms: a value present at the
first read and gone at the second was reverted by the app, which is the classic
controlled-input failure and is reported as such rather than as success.

**Never auto-answered:** sponsorship, work authorization, disability, veteran
status, race/ethnicity, criminal history, salary expectation. These return
`needs_user_input` with the label surfaced. The patterns match whole words:
without boundaries "corporate" read as a pay rate and "Essex" as a question
about sex.

**Answers come from the resume before the model.** Contact fields (name,
email, phone, links, location, current role, total years) are matched by
autocomplete token, input type and label, and answered straight from the
linked resume, with the autofill profile on top. Only what is left goes to the
fast tier, with thinking off: it shares the output budget there and could cut
the JSON off. The reply is read even when fenced. A reply that cannot be read,
or a missing key, leaves those fields to the user and is never cached; the
cache key covers the resume, profile and posting as well as the form's shape.

**Resume uploads.** A file input labelled as a resume gets the linked resume's
`.docx`, attached through a `DataTransfer` FileList and a change event. It
counts as filled only when the file name shows on the page (or a visible native
input still holds it); otherwise it is reported as unconfirmed, for the user to
check. Cover letters, PDF-only uploads and Ashby's "autofill from resume"
input, which would re-parse the file over the fields just filled, are left to
the user.

## Honest limits

- Closed shadow roots are out of scope; they would need a MAIN-world
  `attachShadow` patch and a permanent content script.
- A resume upload is attached, but a widget that uploads the file and clears
  its input without showing the name gives no signal, so it is reported as
  unconfirmed rather than filled. Drop zones with no file input are not reached.
- LinkedIn Easy Apply is deliberately not auto-filled.
- OpenAI pricing is not in this project's authoritative reference, so cost for
  that provider is reported as unknown rather than guessed.

## Measured behaviour of a real generation

Numbers from an actual run on the heavy tier, because the estimates in the
original plan were optimistic by roughly 5x:

| Turn | Wall clock | Output tokens |
|---|---|---|
| scenario | 5-8 min | up to 24k, mostly reasoning |
| draft (+2 repairs) | ~2 min | 4.2k / 2.5k / 2.8k |
| flags | ~2 min | 5.5k |
| **total** | **~10 min, ~$1.70** | |

Four things follow from that, all of them now in the code:

- **Thinking tokens count toward the output budget.** The scenario turn
  truncated at a 24k cap with the reasoning alone, and a truncated reply is a
  broken one - the JSON stops mid-token. `max_tokens` is now 64k there, and
  `stop_reason == "max_tokens"` is retried once with double the budget rather
  than silently accepted.
- **The prompt cache TTL has to be 1h, not the 5m default.** A single turn can
  outlast a five-minute entry, so the prefix expired mid-job and was re-written
  at 1.25x instead of read at 0.1x - paying the write twice and the read never.
- **Progress must be committed as it happens.** The worker holds one
  transaction for the whole job, so events written there stay invisible until
  it finishes. `emit_now` uses its own transaction, and doubles as the
  heartbeat that tells a slow job from a dead one.
- **A single phase can run for minutes.** Turns are streamed and reasoning is
  forwarded (coalesced, every 3s), or the percentage sits still long enough to
  read as a hang.

## Naming

Names are spelled out. The rule is that a reader who has never seen the file
should not have to decode anything:

- No abbreviations in identifiers, columns or API fields:
  `content_markdown` not `content_md`, `job_description_hash` not `jd_hash`,
  `years_required` not `yoe_required`, `recurrence_rule` not `rrule`,
  `search_vector` not `tsv`, `display_timezone` not `display_tz`.
- **No "CRM".** The resume format is Resume Markdown. In a product about job
  applications, "CRM" reads as Customer Relationship Management.
- Standard terms stay as they are, because expanding them would be *less*
  clear: ATS, LLM, UTC, DST, URL, ID, API, HTTP, JWT, OXML, DOCX, UUID.
- Third-party names are never "corrected": `date-fns-tz`, `dateutil.rrule`, and
  dateutil's `dtstart=` keyword are their APIs, not ours.
- No `__init__.py`. Packages are namespace packages, and the one file that did
  real work is now `app/models/registry.py`, named for what it does.

The single exception is the constraint prefixes in `app/db/base.py`
(`fk_`, `pk_`, `ix_`, `uq_`, `ck_`). PostgreSQL truncates identifiers at 63
characters and the longest foreign key here already reaches 60; spelling them
out would truncate and risk two constraints colliding on one name. The comment
in that file says so, and expands each prefix in words.
