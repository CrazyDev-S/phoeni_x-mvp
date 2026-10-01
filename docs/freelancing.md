# Freelancing: job sources, snapshots, tracking and proposals

How the Freelancing category finds Upwork jobs, what it stores, and where the
proposal generator plugs in. Job search goes through a pluggable source: by
default the Apify actor `upwork-vibe/upwork-job-scraper`, optionally another
Apify actor or Upwork's own API.

## Job sources

Searches go to whichever `JobSource` is in service, chosen by
`FREELANCING_JOB_SOURCE` (`app/freelancing/sources/registry.py`):

| Value | Source | Needs |
|---|---|---|
| `apify` (default) | an Apify actor that scrapes Upwork, `upwork-vibe~upwork-job-scraper` by default | an Apify API token |
| `upwork` | Upwork's own GraphQL API | an Upwork API key and each user's OAuth sign-in |

`GET /api/v1/freelancing/source` says which one is in service, which filters
it honours, and whether this user is ready to search (with the setup step if
not). Settings -> Integrations shows the card for that source only. The
service layer, the snapshots, focus, proposals, tracking and the calendar
never speak a provider's own vocabulary; they see `SourcePage`s of snapshot
dicts and a `SourceCapabilities` saying which `JobSearchParams` fields the
provider honours. The search form renders only those controls, and the
catalogue's `source` field says which provider answered.

Adding a provider is one file under `app/freelancing/sources/`:

1. A class with `key`, `label`, `capabilities`, and `search`, `detail`,
   `categories`, `suggest_skills`. `search` returns snapshot dicts: the
   `FreelanceJob` columns (`upwork_id` is the provider's own posting id,
   `raw` the response as received) - see `normalize.snapshot_from_search_node`
   for the full key set.
2. Raise `app.freelancing.errors.JobSourceError` (with the HTTP status the
   API should answer with) for anything that fails; the app maps it to
   `{"detail": {"code", "message"}}`.
3. `registry.register(YourSource, factory, readiness)` where
   `factory(session, user_id)` builds an instance - from a deployment key in
   `Settings`, or from a per-user credential - and `readiness` says whether
   that user can search without calling the provider.
4. A search that takes longer than a request should block returns
   `SourcePage(pending=True, end_cursor=...)`; the portal shows progress and
   asks again with the cursor until the page arrives.

`tests/test_freelancing.py::test_a_third_party_source_plugs_in_without_an_upwork_connection`
is the template: a fake source with three filters and no details runs the
whole product without an Upwork key pair.

## The Apify source

Runs an Apify actor that scrapes Upwork, so no Upwork account or key is
involved. Which actor is `APIFY_UPWORK_ACTOR_ID`; each supported actor has an
input mapping, an `ActorProfile` in `app/freelancing/apify/`:

| Actor | Profile | Status |
|---|---|---|
| [`upwork-vibe/upwork-job-scraper`](https://apify.com/upwork-vibe/upwork-job-scraper) | `vibe_scraper.py` | default |
| [`neatrat/upwork-job-scraper`](https://apify.com/neatrat/upwork-job-scraper) | `neatrat_scraper.py` | alternative |

The source (`sources/apify_upwork.py`) does what every actor needs - start a
run, poll it, page through its dataset - and the profile says what to ask for
and how to read the answer. An actor id with no profile is refused with
`APIFY_ACTOR_UNSUPPORTED` naming the supported ones. Adding an actor is one
profile module listed in `profiles.PROFILES`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `APIFY_TOKEN` | empty | Deployment-wide token; a user's own (Settings -> Integrations) wins |
| `APIFY_UPWORK_ACTOR_ID` | `upwork-vibe~upwork-job-scraper` | The actor to run |
| `APIFY_CLIENT_ACTIVITY_ADDON` | false | upwork-vibe: proposal counts, interviews, last client activity (billed per job) |
| `APIFY_CLIENT_DETAILS_ADDON` | false | upwork-vibe: client company name and work history (billed per job) |
| `APIFY_PAGES_PER_RUN` | 1 | Pages of results fetched per run |
| `APIFY_WAIT_SECONDS` | 25 | How long one search request long-polls a run (Apify caps it at 60) |
| `APIFY_RUN_TIMEOUT_SECONDS` | 300 | Apify stops a run that has not finished by then |
| `APIFY_MAX_CHARGE_USD` | unset | Optional ceiling on one run's charge |
| `APIFY_REUSE_MINUTES` | 30 | An identical search inside this window reuses its run |

Tokens are sealed with the same AES-GCM envelope as LLM keys
(`apify_connections`). `POST /api/v1/freelancing/apify/test` checks the token
(`GET /v2/users/me`) and the actor (`GET /v2/acts/{actor}`), reports the
actor's current price per job from its live pricing record, and starts nothing.

### How a search runs

A run takes tens of seconds, so the opaque cursor carries a small state
machine:

1. No cursor: start a run for the profile's first step
   (`POST /v2/acts/{actor}/runs` with `waitForFinish`, `maxItems`, `timeout`)
   and wait on it briefly.
2. Still running: answer `pending: true` with a cursor naming the run. The
   portal asks again at once; each ask long-polls
   `GET /v2/actor-runs/{id}?waitForFinish=`.
3. Finished: read our page from the run's dataset by offset
   (`GET /v2/datasets/{id}/items?offset=&limit=`), with the total from
   `X-Apify-Pagination-Total`.
4. The dataset is used up but was full: the profile says where the next run
   starts, and asking for it starts one more run. A dataset that was not full
   means there is no more.

Every run is billed per job returned, so "load more" never starts a run while
the dataset has rows left, `maxItems` caps each run at the size it was asked
for, and an identical search within `APIFY_REUSE_MINUTES` reuses its run (the
reuse key is the search itself, so a date window computed from "now" still
matches).

A run that fails with nothing to show is `APIFY_RUN_FAILED` (502) with the
actor's own message; a run that exits cleanly with a message and no jobs (an
exhausted free quota, say) shows the message instead of "nothing matched". A
rejected token is `APIFY_TOKEN_REJECTED` (409, never 401, which the portal
reads as its own session ending) and marks the token invalid in Settings. Out
of credit is `APIFY_OUT_OF_CREDIT` (402).

## The upwork-vibe actor (default)

The actor searches its own index of Upwork jobs - newest first, up to 10,000
a run, with no cookies or proxies involved. Its field names live in
`app/freelancing/apify/vibe_scraper.py`, taken from its published input schema
and README (build 0.0.40, July 2026). Its category list is read live from the
actor's default build, with a bundled copy as the fallback.

### Cost

About $0.0105 per job returned on Apify's free plan, less on paid tiers (from
$0.0045), platform usage included and no minimum per run. A 20-job search
costs about 21 cents on the free plan. The client-activity and client-details
add-ons each add about $0.009 per job on the free plan, and are off by
default. The Settings test shows the actor's current price.

### Paging

The actor takes a `limit` and a posted-date window, not a page number. A
search's first run asks for `page_size` jobs (times `APIFY_PAGES_PER_RUN`),
from `now - posted_within_hours` when that is set. The next run asks for the
jobs posted before the oldest one already returned, one second earlier so it
is not fetched and billed twice, keeping the same lower bound.

### Input mapping

The input is flat with dotted keys, money is sent as strings, and locations
are `{"type", "value"}` objects.

| This API | Actor input | Notes |
|---|---|---|
| `query`, `or_terms`, `exact_terms` | `includeKeywords.keywords`, matched in title, description and skills | the search box is split on commas; any keyword matches |
| `exclude_terms` | `excludeKeywords.keywords`, matched everywhere | |
| `category_ids`, `subcategory_ids` | `jobCategories` | names from the actor's enum; "All - X" is a whole group |
| `workload` | `budget.hourlyWorkloads` | full time -> `MORE_THAN_30_HOURS`; part time and as needed -> `LESS_THAN_30_HOURS` |
| `durations` | `budget.jobDurations` | week and month -> `UP_TO_ONE_MONTH`, quarter -> `UP_TO_THREE_MONTHS`, semester -> `UP_TO_SIX_MONTHS`, ongoing -> `MORE_THAN_SIX_MONTHS` |
| `experience_level` | `vendor.experienceLevel` | `BEGINNER`, `INTERMEDIATE`, `EXPERT` |
| `budget_min` / `budget_max` | `budget.fixedPrice.min` / `.max` | strings |
| `hourly_rate_min` / `hourly_rate_max` | `budget.hourlyRate.min` / `.max` | strings |
| `connects_min` / `connects_max` | `budget.connectsPrice.min` / `.max` | |
| `client_min_hire_rate` | `budget.minClientHireRate` | percent |
| `client_hires_min` / `client_hires_max` | `client.hireHistory` | the buckets `NONE`, `UP_TO` (1-10), `MORE_THAN` (11+) the range overlaps |
| `verified_payment_only` | `client.paymentMethodVerified` | |
| `phone_verified_only` | `client.phoneNumberVerified` | |
| `client_locations` / `exclude_client_locations` | `client.includeLocations` / `client.excludeLocations` | country names or ISO codes, regions (Europe), subregions (Northern America); anything else is refused with `UNKNOWN_LOCATION` (422) before a run starts |
| `client_timezone` | `client.timezones` | IANA name |
| `client_min_rating` | `client.minFeedbackScore` | string |
| `client_min_spent` / `client_max_spent` | `client.totalSpent.min` / `.max` | strings |
| `english_level` | `vendor.englishProficiency` | |
| `contractor_type` | `vendor.type` | `FREELANCER`, `AGENCY` |
| `featured_only` | `vendor.includeFeatured` | |
| `exclude_with_questions` | `vendor.excludeWithQuestions` | |
| `open_to_country` | `vendor.includeLocations` + `vendor.includeWithoutCountryPreference` | postings open to the country or to anyone; also checked on this side |
| `posted_within_hours` | `fromDate` | computed once, kept for every later page |
| `page_size` | `limit` | times `APIFY_PAGES_PER_RUN` |

Not offered, because the actor cannot express them: "all of these words",
words in the title only, skills only, job type, proposal counts, occupations,
enterprise clients, talent clouds, area, and any sort but newest first. The
search form hides those controls for this actor.

### Output mapping

Each dataset item becomes a snapshot (`snapshot_from_item`): `uid` is the
posting id; `budget.hourlyRate.min/max` or `budget.fixedBudget` gives the job
type and money; `createdAt` is the published time; `skills`, `category` and
`externalLink` (or the `ciphertext`) map across. The client block comes from
`client.countryCode` (as a country name), `timezone`, `industry`,
`paymentMethodVerified`, `phoneNumberVerified`, and `client.stats`
(`totalSpent`, `totalHires`, `hireRate`, `avgRate`, `feedbackRate`,
`feedbackCount`); `enterprise` is the enterprise flag; `companyName` arrives
with the client-details add-on. `vendor.countryCodes` become the countries a
posting is restricted to. `applicationCost` (connects to apply), `featured` and
`customJobScore` show on the card, and the proposal template bids the real
connects cost. Screening questions, the English level and contractor type
asked for, and the add-on's activity figures (`totalApplicants` becomes the
proposal count) go into `raw.extras`, where the job page reads them.

## The neatrat actor

Selected with `APIFY_UPWORK_ACTOR_ID=neatrat~upwork-job-scraper`. It reads
Upwork's search pages with its own cookies, proxies and CAPTCHA handling, and
pages by Upwork result page. Its field names live in
`app/freelancing/apify/neatrat_scraper.py`, from its published input and
dataset schemas (build 0.0.86, September 2026). It bills about $0.0035 per job
on Apify's free plan with a minimum of ten jobs per run, plus platform usage;
Apify's free plan allows it 10 runs and 100 results in total.

#### Input mapping

| This API | Actor input | Notes |
|---|---|---|
| `query`, `and_terms`, `exact_terms`, `or_terms` | `query` | terms appended in Upwork's boolean syntax: `a b "exact" (x OR y)` |
| `title` | `customFilters: title includes` | |
| `skills` | `customFilters: tags includes [...]` | any of them; skill names as Upwork shows them |
| `exclude_terms` | `customFilters: title / description notIncludes [...]` | |
| `job_type` | `jobType: ["hourly"\|"fixed"]` | |
| `experience_level` | `experienceLevel: ["entry"\|"intermediate"\|"expert"]` | |
| `budget_min` / `budget_max` | `fixedPriceRange: [min, max]` | open ends become 0 and 1,000,000 |
| `hourly_rate_min` / `hourly_rate_max` | `hourlyRateRange: [min, max]` | open ends become 0 and 1,000 |
| `client_hires_min` / `client_hires_max` | `clientHistory` | the buckets `noHires`, `1to9Hires`, `10+Hires` the range overlaps |
| `verified_payment_only` | `paymentVerified: true` | |
| `client_locations` | `location` | regions, subregions or countries, spelled as Upwork does |
| `posted_within_hours` | `maxJobAge: {value, unit: "hours"}` | only this source offers it |
| `sort` | `sort` | `recency` -> `newest`, `relevance` -> `relevance` |
| `page_size` | `perPage` | rounded up to Upwork's 10 / 20 / 50 |

Not offered, because the actor cannot apply them: categories, occupations,
ontology skill ids, workload, duration, proposal counts, enterprise and talent
clouds, timezone, area. The search form hides those controls for this source.

`open_to_country` works with every source and is applied on this side: it
drops postings whose `allowedApplicantCountries` excludes the country.

#### Output mapping

Each dataset item becomes a snapshot (`snapshot_from_item`): `id` is the
posting id, `budget` ("$25.00 - $50.00", "$1,500.00") is parsed into the
hourly range or the fixed amount by `jobType`, `absoluteDate` is the published
time, `tags` are the skills, `proposals` the applicant count, and the client
figures (`clientLocation`, `paymentVerified` - which can be "unknown" -
`clientTotalSpent`, `clientRating`, `clientHireRatePercent`,
`clientAvgHourlyRate`) fill the client block. `clientName` is kept only when
`clientNameConfidence` is at least 0.6; the proposal template greets the
client by it. Screening questions (`questions`) and `hasHired` go into
`raw.extras`, so the job page and the proposal engine read them the same way
they read Upwork's own aggregate. There is no separate detail fetch: the
dataset item is already the whole posting.

## The Upwork API source

Used when `FREELANCING_JOB_SOURCE=upwork`. Upwork's field names live in
`app/freelancing/upwork/`, from its GraphQL schema reference as of August 2026.

### Authentication

| Item | Value |
|---|---|
| Authorize | `GET https://www.upwork.com/ab/account-security/oauth2/authorize` |
| Token | `POST https://www.upwork.com/api/v3/oauth2/token` (form-encoded) |
| GraphQL | `POST https://api.upwork.com/graphql` |
| Grant | authorization code (client credentials is enterprise-only) |
| Access token | 24 hours |
| Refresh token | expires after two weeks unused; every refresh returns a new one |
| Organisation | `X-Upwork-API-TenantId: <organizationId>`, from `companySelector` |

The round trip lives in `app/api/v1/freelancing/upwork.py`. `POST /authorize`
returns the Upwork sign-in URL with a signed `state` (a 15-minute JWT naming
the user, `typ = upwork_oauth`); the browser goes there and comes back to
`GET /callback`, which is the one unauthenticated endpoint in the category.
The callback exchanges the code, seals both tokens with the same AES-GCM
envelope as LLM keys, fetches who the token belongs to, and redirects the
browser to `PORTAL_URL/settings?tab=integrations&upwork=connected|error`.

`services/connection.py` refreshes a token five minutes before it expires. A
refresh Upwork refuses marks the connection **expired** in its own
transaction, because the request that discovered it is about to fail and
would roll the status back with it.

Credentials come from the user's row in `upwork_connections` first and the
environment (`UPWORK_CLIENT_ID` / `UPWORK_CLIENT_SECRET`) second.

#### Scopes the key needs

Scopes are chosen when the key is created on upwork.com; a missing one comes
back as HTTP 200 with an `errors` entry mentioning "oauth2 permissions", which
the client turns into `UPWORK_MISSING_SCOPE` (403).

- Common Entities - Read-Only Access (always required)
- Read marketplace Job Postings (`marketplaceJobPostingsSearch`, `marketplaceJobPosting`)
- Ontology - Read-Only Access (`ontologyCategories`, skill autocomplete)

Upwork approves keys for accounts in good standing with a verified identity
and payment method and at least $25,000 lifetime earnings or spend; a
freelancer also needs a job success score of 90% or better.

#### Limits

300 requests a minute per IP address (a 429 with `Retry-After` is mapped to
`UPWORK_RATE_LIMITED`, 429, and the header is forwarded). A key is granted for
40,000 requests a day. Upwork's terms allow caching a posting for **24 hours**;
see "Snapshots" below.

### Search

`POST /api/v1/freelancing/jobs/search` takes `JobSearchParams`; the Upwork
source sends one `marketplaceJobPostingsSearch` query (`queries.JOB_SEARCH`).
The mapping in `filters.to_search_filter` is:

| This API | Upwork filter field | Notes |
|---|---|---|
| `query` | `searchExpression_eq` | Lucene-style; makes `searchTerm_eq` ignored |
| `and_terms` / `or_terms` / `exact_terms` / `exclude_terms` | `searchTerm_eq.{andTerms_all, orTerms_any, exactTerms_any, excludeTerms_any}` | only sent when `query` is empty |
| `title` | `titleExpression_eq` | |
| `skills` | `skillExpression_eq` | comma-joined slugs, OR |
| `category_ids` / `subcategory_ids` / `occupation_ids` | `categoryIds_any` / `subcategoryIds_any` / `occupationIds_any` | ids from `ontologyCategories` |
| `ontology_skill_ids` | `ontologySkillIds_all` | AND |
| `job_type` | `jobType_eq` | `HOURLY`, `FIXED` |
| `workload` | `workload_eq` | `FULL_TIME`, `PART_TIME`, `AS_NEEDED`, `NOT_SURE` |
| `durations` | `duration_any` | `WEEK`, `MONTH`, `QUARTER`, `SEMESTER`, `ONGOING` |
| `experience_level` | `experienceLevel_eq` | `ENTRY_LEVEL`, `INTERMEDIATE`, `EXPERT` |
| `budget_min` / `budget_max` | `budgetRange_eq {rangeStart, rangeEnd}` | hourly jobs are returned regardless |
| `hourly_rate_min` / `hourly_rate_max` | `hourlyRate_eq {rangeStart, rangeEnd}` | fixed jobs are returned regardless |
| `client_hires_min` / `client_hires_max` | `clientHiresRange_eq` | |
| `proposals_min` / `proposals_max` | `proposalRange_eq` | |
| `verified_payment_only` | `verifiedPaymentOnly_eq` | |
| `previous_clients_only` | `previousClients_eq` | |
| `client_locations` | `locations_any` | country or city |
| `client_timezone` | `timezone_eq` | |
| `enterprise_only` | `enterpriseOnly_eq` | |
| `talent_cloud_only` / `talent_cloud_ids` | `ptcOnly_eq` / `ptcIds_any` | |
| `user_location_match` | `userLocationMatch_eq` | |
| `visitor_country` | `visitorCountry_eq` | upper-cased |
| `area` | `area_eq {latitude, longitude, radius}` | miles |
| `page_size`, `cursor` | `pagination_eq {first, after}` | `after` starts at `"0"`; pass back `pageInfo.endCursor` |
| `sort` | `sortAttributes: [{field}]` | `RECENCY`, `RELEVANCE`, `CLIENT_TOTAL_CHARGE`, `CLIENT_RATING` |

`searchType` is always `USER_JOBS_SEARCH`; Upwork ignores anything else.
"Posted within N days" is deliberately absent: `daysPosted_eq` exists only on
the deprecated `MarketplaceJobFilter` type and the public search, not on the
filter the current search accepts.

`hide_hidden` and `hide_applied` are applied on this side after Upwork
answers, and the response's `hidden_count` says how many of the page went.

## Snapshots

Every node Upwork returns is upserted into `freelance_jobs` keyed by
`(user_id, upwork_id)`, with the columns the cards and the tracker need and
the whole node under `raw`. Opening a job fetches the deeper
`marketplaceJobPosting` aggregate (`queries.JOB_DETAIL`: screening questions,
bid statistics, activity, the public client company) and folds it in
(`normalize.merge_detail`), keeping it under `raw.detail`; a refetch happens
when the last one is more than six hours old.

Focus, proposals and tracking all hang off the snapshot row rather than
anything positional in a result set, because Upwork re-ranks and re-pages on
every call.

Because Upwork's terms allow caching for 24 hours, `prune_stale` runs after
every search and deletes snapshots that have not been seen for a day and are
not focused, hidden, tracked or the subject of a proposal. A focused job is
the user's own list - the same as a bookmark - and stays.

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

## Proposals

`freelancer_profiles` holds the freelancer as presented on Upwork; `proposals`
holds one draft per bid with the cover letter (markdown), screening answers,
bid, connects estimate and `engine_version`.

`POST /proposals/generate` queues a `GenerationKind.PROPOSAL` job. The worker
branches before resolving an LLM provider (`app/worker/runner.py`) and runs
`app/freelancing/proposals/run.py`, which calls whatever `get_engine()`
returns. Today that is `TemplateProposalEngine`: a deterministic scaffold
(greeting by tone, a hook from the posting, the profile's matched skills as
bullets, the unmatched required skills as a comment, portfolio evidence, the
screening questions with empty answers, and a bid inside the posting's
range). It labels itself `template-v0`, and the portal says so.

### Plugging in the real generator

1. Replace `backend/prompts/proposal_generator_v1.md` with the prompt. Delete
   the placeholder marker at its top; `prompt_is_supplied()` reads that.
2. Implement `PromptedProposalEngine.draft` in `engine.py`: a byte-frozen
   system prefix from the file with a cache breakpoint, one user turn with the
   posting (`job` columns plus `raw`), the profile, the screening questions
   and the instructions, and a JSON reply validated into `ProposalDraft`. Use
   `app.llm.factory.get_provider(session, user_id, tier)`; the worker step
   already has the session and the user.
3. Return it from `get_engine()`.

Nothing else changes: the queue, the events, the API and the pages only know
the `ProposalEngine` protocol.
