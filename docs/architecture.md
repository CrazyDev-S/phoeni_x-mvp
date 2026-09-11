# Architecture notes

Decisions that are cheap now and expensive later, with the reasoning attached.

## The generator prompt is a specification, not a hint

`backend/prompts/resume_generator_v1.md` ships verbatim. An output contract is
appended to it (inside the same frozen string, so it costs nothing extra) that
replaces its 4-block text output with: a JSON ledger, the resume as CRM
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
against one unambiguous grammar - see `docs/crm-dialect.md`. The round-trip
property (`parse -> render -> parse` is a fixed point) is asserted in
`tests/test_crm.py` and is what makes editing in the portal non-destructive.

Validation runs on the parsed AST, not with regexes over prose. That is what
makes rules like "tenure arithmetic agrees with the claimed years" tractable at
all.

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
`needs_user_input` with the label surfaced.

## Honest limits

- Closed shadow roots are out of scope; they would need a MAIN-world
  `attachShadow` patch and a permanent content script.
- File inputs are reported as manual. They can sometimes be set via a
  constructed `DataTransfer`, but success cannot be verified reliably enough to
  claim.
- LinkedIn Easy Apply is deliberately not auto-filled.
- OpenAI pricing is not in this project's authoritative reference, so cost for
  that provider is reported as unknown rather than guessed.
