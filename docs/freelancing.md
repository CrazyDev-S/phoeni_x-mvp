# Freelancing: the shared Upwork job list, tracking and proposals

How Upwork jobs reach the product, what it stores, and where the proposal
generator plugs in. There is no job-search provider: the browser extension
registers every Upwork posting its users see into **one list shared by
everyone**, keyed by Upwork's own job id, and the job view reads that list.

## How a posting gets in

The extension reads Upwork pages as people browse them, and only the
job-browsing pages (search, the find-work feeds, saved jobs, a job's own
page). Proposals, messages, contracts and account pages are never read. It
reads what is on screen; the one thing it does to a page is refresh a list
left open every 5 minutes (below), as the user would with F5.

| Piece | File | Does |
|---|---|---|
| Harvester | `apps/extension/src/lib/upwork.ts` | Finds each posting on the page and lifts it as it is shown |
| Content script | `apps/extension/src/entrypoints/upwork.content.ts` | Runs on `www.upwork.com`, panel open or not; re-reads when the page changes, and refreshes a list left open every 5 min |
| Background | `apps/extension/src/lib/upwork-capture.ts` | Posts captures to the API; keeps today's tally and what each tab holds |
| Panel | `apps/extension/src/entrypoints/sidepanel/tabs/Upwork.tsx` | Collecting / paused, this page's postings, the next check, today's count, recent captures |

**Where a posting is.** A tile is the largest block around a job link that
holds links to that one job and no other, which finds tiles in a search list,
a feed and the "similar jobs" rail without knowing how any of them is built.
On a job's own page (or a search's slide-over) the open posting is a
**detail**, and every link to it is part of it, not a tile: Apply and Save,
and on a search the paging and sorting links, which carry the open
slide-over in their address. A link names a posting by its path alone - a
freelancer profile's `?referrer` can carry a job's address. The client's
past contracts (the block Upwork heads `data-test="work-history-title"`)
are never tiles: they link to closed jobs and to freelancers, not to
anything open for bids.

**What is sent.** Per posting: the job key, the link, the title, the
description, the skill tokens, every element Upwork names with
`data-test`/`data-qa`/`data-cy` (name -> visible text), and the block's
visible text line by line. The extension knows nothing of Upwork's wording;
the backend reads it (below). When Upwork changes its pages, the fix is a
server change, and every stored capture can be re-read.

**When.** A `MutationObserver` settles for 1.2 s (4 s at most) after the page
changes - a feed loading more, a search paging, a posting opening - then the
page is read again and only postings whose content changed are sent. "Posted 3
minutes ago" ticking over is not a change. A capture that was not saved
(paused, signed out, offline) is sent again on the next read. Upwork tabs open
when the extension installs get the content script injected.

**Refreshing a list left open.** A search or feed does not update itself, so
a tab left on one is refreshed - reloaded, exactly as with F5 - every 5
minutes (plus up to 30 s of jitter), and the page that comes back is read like
any other, so new postings appear on screen and in the shared list together.
Background tabs are read too, or a refresh nobody watches would be lost. A
refresh never lands on someone using the tab: there is none while a posting is
open over the list (a slide-over), and if the user clicked, typed or scrolled
in the last minute it waits until a minute after they stopped. A tab that
moves to another list waits a full interval; a job's own page is never
refreshed (the client watch covers it). Paused, or with no token, nothing is
refreshed. The page marks a refresh in `sessionStorage` before reloading, so
the page that comes back reports its first read as the refresh's result. The
panel counts down to the next refresh, says what the last one brought in, and
its button refreshes a list (or reads any other page) on demand.

`POST /api/v1/freelancing/jobs/capture` takes up to 100 captures
(`CaptureIn`) and answers which postings it created and which it refreshed.

## One row per posting

`freelance_jobs.upwork_id` is the key every Upwork job URL carries
(`~021858964253717283346`, or `~01` and hex for older postings), unique and
lower-cased. Registering a batch (`services/jobs.register`) is race-free by
construction:

1. `INSERT ... ON CONFLICT (upwork_id) DO NOTHING` makes every posting exist
   exactly once; what it returns is what this batch created.
2. The rows are selected `FOR UPDATE`, in key order (so two batches never
   deadlock), and each view captured is stored under `raw`.
3. Every column is re-derived from all the views `raw` holds.

So two people capturing the same posting at the same moment land on one row,
and a later tile never blanks out what only the detail page showed.
`captured_by_id` remembers who saw it first, `last_seen_at` when anyone last
saw it, `detail_captured_at` when anyone last had its own page open.

What one user thinks of a shared posting is theirs alone:
`freelance_job_marks` holds their focus (the star, a timestamp so the
focused list has an order) and hidden flag, one row per `(user, job)` while
either is set. Tracks and proposals were per user already and point at the
shared row. Nothing is pruned: the list is the team's.

## Reading Upwork's wording

`app/freelancing/capture.py` is the only place Upwork's vocabulary lives. A
posting is seen as a **tile**, a **detail**, and - while its client is watched
(see "Client watch and team alerts") - as the **store** Upwork renders the
page from. The columns take the most precise view first; a tile shows least.

Before reading terms, the detail's text is cut where the page starts on
other postings ("Similar jobs", "Other open jobs by this client", "Client's
recent history"), the description's own lines are removed (so "budget is
$500" in the text is never the posting's budget), and lines about the viewer
- "Available Connects: 140" - are never stored, because the row is shared.

| Read | From | Into |
|---|---|---|
| `Hourly: $40.00 - $70.00`, `$40.00 - $70.00 Hourly` | the earliest statement of pay | `job_type`, `hourly_min`, `hourly_max` |
| `Est. budget: $300`, `$300.00 Fixed-price` | the same; a type label may precede its figure | `job_type`, `budget_amount` |
| `Entry level` / `Intermediate` / `Expert` | | `experience_level` (`ENTRY_LEVEL`, ...) |
| `1 to 3 months`, `Less than 30 hrs/week` | | `duration_label`, `workload` |
| `Posted 2 hours ago` | the freshest reading, which is the most precise | `published_at` |
| `Proposals: 10 to 15` | the tier's top, so "at most 15" never admits a busier posting | `total_applicants`; the wording in `raw.extras.proposals_label` |
| `Only freelancers located in the U.S. may apply`, `U.S. only` | | `preferred_freelancer_location` |
| `Payment method verified`, `4.95 of 23 reviews`, `$52K total spent`, `30 hires`, `80% hire rate`, `45 jobs posted`, `$35.00 /hr avg hourly rate paid`, `Member since ...`, the country line and the city before the local time | the client part of the page | `client` |
| `You will be asked to answer the following questions...` and the list after it | | `raw.extras.screening_questions` |
| `Send a proposal for: 16 Connects` | | `raw.extras.connects_required`, which the proposal template bids |
| `Interviewing: 2`, `Invites sent: 5`, `Last viewed by client: 20 minutes ago` | | `raw.extras.activity` |

The title comes from the tile's link when there is one (Upwork renders it);
the description and skills from whichever view has more.

## Browsing the list

`POST /api/v1/freelancing/jobs/search` takes a `JobFilter` and answers a page
of `JobCard`s from the database: instant, free, and the same for every user
apart from their own marks. The portal asks as you type (250 ms debounce) and
re-reads every minute, so postings teammates collect appear on their own.

**Refresh** goes one step further: every Upwork search or feed open in the
user's browser is refreshed at once, the extension waits (30 s at most) for
what each reloaded page brings in, then the list is read again and a toast
says what came in (or why nothing could: no Upwork search open, collecting
paused, extension not connected). The page reaches the
extension through a relay the extension registers at runtime for the portal
URL in its Settings (`portal-bridge.content.ts`, `lib/portal-bridge.ts`;
both loopback names when it is local), so no other site can reach it and the
page needs no extension id. They exchange window messages - `upwork:check`,
answered `upwork:check:started` at once and `upwork:check:done` with the
tally - and a portal without the extension just re-reads the list.

| Filter | Meaning |
|---|---|
| `query` | every word, in the title, description or skills |
| `skills` | any of these skills, case-blind |
| `exclude_terms` | none of these words in the title or description |
| `job_type`, `experience_level` | |
| `hourly_rate_min` | hourly postings paying at least this; fixed-price ones are left alone |
| `budget_min` / `budget_max` | fixed-price budget; hourly ones are left alone |
| `posted_within_hours` | by Upwork's posting time, or when it was added if that was not shown |
| `verified_payment_only`, `client_min_spent`, `client_min_rating` | |
| `client_locations` / `exclude_client_locations` | country names or ISO codes |
| `proposals_max` | at most this many proposals so far |
| `open_to_country` | drops postings that only accept applicants from elsewhere |
| `hide_hidden` | the user's hidden postings stay out (default on) |
| `sort` | `recency` (newest posted) or `captured` (newest added) |

`GET /api/v1/freelancing/jobs?focused=true` is the user's focused list.
Saved searches store a `JobFilter` by name, create-or-replace.

## Upgrading a database from the job-source era

Until November 2026 jobs came from an Apify actor or Upwork's GraphQL API and
`freelance_jobs` held one 24-hour snapshot per user. `python -m app.db.schema`
converts such a database in place (`SHARE_FREELANCE_JOBS` in
`app/db/schema.py`, which runs only while the old shape is there): rows are
re-keyed to the `~0...` key, the copies of one posting collapse into the most
recently seen, every user's focus and hidden flag become their marks on it,
and their tracks and proposals are pointed at it. The `apify_connections` and
`upwork_connections` tables - stored tokens nothing uses any more - are dropped.

## Tracking

`freelance_job_tracks` has one row per `(user, job)`, created when the job is
focused, with a native-enum stage in pipeline order: `focused`,
`proposal_drafted`, `submitted`, `viewed`, `interviewing`, `hired`,
`declined`, `withdrawn`, `closed`. Every change goes through
`services/tracking.set_stage`, which appends to `freelance_job_track_events`
and applies the side effects: `submitted_at`, `client_replied_at`,
`closed_at`, and the proposal's own status.

Unfocusing a job whose track never left `focused` and holds nothing deletes
the track; anything further along is history and stays.

The shared tools know about tracks: a meeting can be owned by a track
(`meetings.freelance_track_id`, the third leg of the exactly-one-owner check),
and `POST /tracks/{id}/promote` turns a won bid into a maintained job.

## Filling a profile from its link

The profile form fills itself from the freelancer's Upwork link: pasting a
profile link (`/freelancers/~01…`, `/freelancers/<name>`, `/fl/<name>`) fills
at once, and **Fill from link** runs it again. Nothing is saved until Save,
and the profile's name is only filled when it is blank.

1. The portal asks the extension over the relay (`upwork:profile`, the same
   started/done exchange as Refresh; `lib/extension-bridge.ts`).
2. The extension (`lib/upwork-profile.ts`) opens the link in a background tab
   beside the portal, so the page is read signed in, as the user sees it. It
   opens "more" toggles, reads the page's visible text, then reads every other
   view of the same freelancer the page links to (same path, another query:
   the specialized profiles), up to six pages or 75 s. The tab is closed
   whatever happens. A sign-in redirect, a bot check or a page that is not a
   profile comes back as a reason, and the portal says what to do.
3. `POST /freelancing/profiles/import` hands the pages to the user's fast-tier
   model (`app/freelancing/profile_import.py`), which copies the title,
   overview, rate, skills, portfolio and specialized profiles verbatim and
   puts stats, employment, education, languages and client feedback in the
   notes. The reply is clipped to the form's limits so it always saves.

A model reads the pages rather than selectors, for the same reason captures
are read on the server: an Upwork redesign changes the markup, not the words.

## Writing a profile

The **Profile writer** panel writes the profile from an instruction and
revises it from the next one. The method is the user's own prompt,
`backend/prompts/profile_architect_v3.md` (Elite Profile Architect v3),
loaded verbatim as a byte-frozen system block. A second frozen block,
`CONTRACT` in `app/freelancing/profile_writer.py`, adapts its chat
turn-taking to the editor: the intake is the instructions plus the form, a
missing required field becomes a question in `questions` instead of a pause,
the brief is not confirmed first, and every reply is the complete profile as
JSON (`DOCUMENT`). The prefix (~15k tokens) carries one 1-hour cache mark.

Versions count toward the next save:

| Action | Version |
|---|---|
| First instruction | 1.1 |
| Each instruction after it | 1.2, 1.3, ... |
| Save profile | 1 |
| Instructions after that save | 2.1, 2.2, ... then Save is 2 |

- `freelancer_profile_versions` holds both kinds (`minor` 0 is a save). A
  version's `document` is the whole written profile: the form's fields
  (`title`, `summary`, `skills`, `hourly_rate`) and what the form has no
  field for (three annotated titles, work history, education, portfolio
  direction, cert roadmap, the intelligence brief, questions, a change note).
- `POST /freelancing/profile-versions` queues a `GenerationKind.PROFILE` run
  with the instruction, the version it revises and the form as it is now
  (`material`, so unsaved edits and a fresh link fill count). It is refused
  while another run for the same profile is going, and answers
  `NO_PROVIDER_KEY` at once rather than a minute into the run. The worker
  streams the heavy tier's turn (reasoning shows in the progress panel) and
  stores the draft; the portal puts it in the form.
- A revision sends the instructions that led to its base (the intake as it
  was given) and the base document with the form's fields as they are now,
  so a hand edit is kept unless the instruction changes it.
- `POST`/`PATCH /freelancing/profiles` take `version_id`, the version the form
  was built from. The save records the next whole version: that version's
  document under the saved fields. An unchanged save records nothing. A
  profile created from the New profile form adopts the drafts written before
  it existed (they had no `profile_id`). Profiles report `version`, their
  latest save.
- Clicking a version chip puts that version in the form; the next instruction
  revises it, so an older draft can be taken in another direction.

## Proposals

`freelancer_profiles` holds the freelancer as presented on Upwork; `proposals`
holds one bid per posting with the cover letter, screening answers, bid,
connects estimate and `engine_version`.

### Writing a proposal

The **Proposal writer** panel on a proposal's page writes the letter and the
screening answers from the posting and the profile, and revises them from the
next instruction. The method is the user's own prompt,
`backend/prompts/proposal_generator_v1.md` (the Proposal Agent Instruction),
loaded verbatim as a byte-frozen system block. Edit the prompt there; change
how it runs here through `CONTRACT` in `app/freelancing/proposals/engine.py`.

`CONTRACT` adapts the method to the editor:

- The method's four detective answers come back in `read` (fear, anchor,
  outcome, mirror) and show on the page as **The read**. The letter never
  states them.
- **The experience spike is true.** Where the method asks for a fictional
  project brief, the contract has the spike built from the freelancer's real
  work instead: their portfolio, overview, notes, the work history the
  profile writer last saved, or a project the instruction names or links.
  When nothing fits, the spike is written as the plan for the client's build,
  never as shipped work, and the writer asks for a real project in
  `questions`. `spike.basis` (`profile`, `instructions`, `plan`) says which,
  and the page badges it. The letter goes to a real client who hires on it.
- A link in the instruction is the method's "project URL". The worker reads
  it first (`proposals/research.py`: http(s) only, at most 3 links, every
  redirect hop checked to resolve to a public address so a link cannot reach
  the metadata service or the VPC) and passes the page text in
  `<researched_pages>`. The version lists what was read in `researched`.
- Screening questions are answered in the same voice; a fact the profile
  lacks becomes a bracketed placeholder (`[link to the repo]`), never an
  invention. Answers are matched back to the posting's questions by their
  words, else by position.
- `**bold**` from the model becomes Unicode bold (`upwork_text.from_markdown`),
  which Upwork's plain-text box shows as bold.
- The bid is not the model's: `engine.bid` keeps the profile's rate inside
  the posting's range (or takes the fixed budget) and `engine.connects` reads
  the posting's price. Both only fill fields that are empty, so a bid the
  freelancer set survives every revision.

Versions are numbered like the profile writer's:

| Action | Version |
|---|---|
| First draft | 1.1 |
| Each instruction after it | 1.2, 1.3, ... |
| Save | 1 |
| Instructions after that save | 2.1, 2.2, ... then Save is 2 |

- `proposal_versions` holds both kinds (`minor` 0 is a save). `document` is
  the letter and answers plus the writer's notes: `read`, `spike`,
  `questions`, `change_note`, `researched`.
- `proposals.version_id` is the version the row's letter and answers came
  from. A landed draft writes the row and points at itself; a save points at
  the version it recorded. A new instruction revises it.
- `POST /proposals/generate` queues a `GenerationKind.PROPOSAL` run with the
  instruction, the version it revises (`based_on_id`) and the editor's text
  now (`current`, so hand edits are revised rather than lost). With no
  `proposal_id` it creates the proposal and focuses the posting. It answers
  `NO_PROVIDER_KEY` at once, and is refused while another run for the same
  proposal is going. The worker streams the heavy tier's turn.
- `PATCH /proposals/{id}` takes `version_id`, the version the editor was
  built from. When the letter or answers are in the patch, the save records
  the next whole version; an unchanged save records nothing.
- `GET /proposals/{id}/versions` lists them with `running_generation_id`, so
  a page opened mid-run follows it. `DELETE /proposals/{id}/versions/{vid}`
  removes one; if the row held it, the row goes back to the newest version
  left. Numbers are never reused.
- `DELETE /proposals/{id}` removes the proposal and its versions. When it was
  the posting's only proposal, the job leaves the pipeline with it
  (`tracking.untrack`: the track and the focus go, the shared posting stays);
  otherwise the track points at the newest proposal left.

## Client watch and team alerts

While a posting is open on Upwork (its own page, or the slide-over a search
opens), the extension watches its client and tells the team the moment the
client comes back to the posting or starts interviewing.

- **Reading.** `apps/extension/src/lib/upwork-store.ts` reads Upwork's own
  job-details store in the page (the one MAIN-world script in the extension) and
  sends `{job, buyer, sands}` as a `store` capture. The backend reads it in
  `capture.read_state`: exact proposal and interview counts, and
  `lastBuyerActivity`, the moment the client was last on the posting. It goes
  through `jobs.register`, so the shared list updates as the client acts.
- **Cadence.** The open page is read once (no request to Upwork). After that,
  every ~2 minutes, a watch with alerts on reloads the posting in a hidden
  frame of the same tab; a watch with alerts off only sends a heartbeat.
- **Whose alert.** Each user's watch (`freelance_job_watches`) keeps its own
  baseline, so their extension announces only what *their* watch saw. Of the
  live watches with alerts on, the earliest started is the **relay**. Only the
  relay's findings become team alerts (`freelance_job_alerts`), and whoever was
  already told by their own watch is marked `local` on it. When the relay
  leaves or misses three heartbeats (6 minutes), the next earliest takes over.
- **Default.** Opening a posting someone is already relaying starts that watch
  with alerts off; the relay tells them anyway. The switch on the on-page card
  (`PATCH /watches/{job_id}`) turns their own checking on.
- **What counts.** A client visit is announced once when first seen within 5
  minutes of happening; activity less than 5 minutes after the last seen visit
  is the same visit. Every rise in the interview count is announced. The team
  feed keeps one alert per visit and per count, across relay handovers.
- **Delivery.** The extension polls `GET /alerts` every 30 seconds and shows an
  OS notification for each new alert that is not `local`. The portal's
  Freelancing bell lists recent alerts and toasts new ones. Postings a user hid
  never alert them.
- **Ending.** A watch ends when no tab in that browser still has the posting
  open: the background sees in-app navigation and tab closes, so a reload keeps
  the watch, its alerts and its place as relay.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/freelancing/watches` | Heartbeat, with a fresh `state` when there is one; answers alerts on/off, relay, watchers, this watch's events |
| `PATCH /api/v1/freelancing/watches/{job_id}` | `{notify}`: this user's alerts for the posting |
| `DELETE /api/v1/freelancing/watches/{job_id}` | The posting is no longer open in this browser |
| `GET /api/v1/freelancing/alerts?after=&limit=` | The team feed, newest first, with a `cursor` for the next poll |
