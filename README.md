# SLA Monitoring Dashboard

Upload raw health-check logs -> a **serverless function cleans & validates them** -> cleaned
checks land in a **database** -> a **single-screen dashboard** shows availability, SLA credits,
incidents and a filterable log view.

Built on Cloudflare's free tier end to end: **Pages** (UI) + **Worker** (the serverless
function) + **D1** (SQLite). No credit card, no containers, no servers.

---

## Live URLs

| Piece | URL |
|---|---|
| Dashboard (Pages) | https://sla-monitor-328.pages.dev |
| Serverless function (Worker API) | https://sla-monitor.kevalgor.workers.dev |

**Last verified live:** 2026-11-17. Both `*.pages.dev` and `*.workers.dev`
stay up indefinitely on the free tier (no cold-shutdown). If anything is down at review time,
redeploy with the steps in [Deployment](#deployment) - it takes ~2 minutes.

---

## Architecture - what runs where, and why

```
+--------------+  POST raw CSV   +------------------+  cleaned rows  +----------+
|  React SPA   | --------------> |  Cloudflare      | -------------> |   D1     |
| (Pages)      |                 |  Worker          |                | (SQLite) |
| upload +     | <-------------- |  parse/validate/ | <------------- |          |
| dashboard    |  stats + logs   |  clean + query   |    query       +----------+
+--------------+                 +------------------+
  *.pages.dev                      *.workers.dev
```

| Layer | Choice | Why |
|---|---|---|
| **Upload UI + dashboard** | React + Vite, static, on **Cloudflare Pages** | A dashboard is a client-rendered SPA; static hosting is free and trivially cacheable. |
| **Serverless function** | **Cloudflare Worker** (standalone) | This is the "stateless serverless function" the brief requires. Kept separate from Pages so the architecture maps 1:1 to the flow and the function has its own URL you can point at. Runs on Cloudflare's edge - genuinely serverless, not a container. |
| **Database** | **Cloudflare D1** (SQLite) | Free, zero-ops, SQL, bound directly to the Worker (`env.DB`). Cleaned data is persisted and re-queryable after upload - it is not held in memory. |

Single provider -> one `wrangler deploy` + a Pages git connection. The only seam between UI and
function is CORS (handled in the Worker).

### Request flow
1. User picks a CSV and clicks **Upload & analyze**.
2. The file is POSTed to the Worker `POST /api/upload`.
3. The Worker **parses, validates, cleans and de-duplicates** the data (`services/clean.ts`),
   **computes the stats** (`services/stats.ts`), writes one `uploads` row + the cleaned `checks`
   rows to D1, and returns the stats.
4. The dashboard renders the stats and lazily queries `GET /api/uploads/:id/logs` for the
   filterable table. Stats are **computed once at upload** and stored as JSON on the upload row,
   so every later page view is a single cheap read.

---

## Data findings - every issue, and how it's handled

The data is deliberately messy. I analysed **all five** provided files; the issue set is
identical in every one, so the cleaner handles all of them without any per-file assumptions.
The day range is **detected from the data** - nothing is hard-coded (files range from 9 to
30 days).

| # | Issue | Evidence (per file) | How it's handled | Why |
|---|---|---|---|---|
| 1 | **Mixed timestamp formats** - ISO 8601 (`2025-05-13T12:45:00Z`) *and* raw Unix epoch seconds (`1746938700`) | ~1.5% of rows are Unix (70 in 9-day -> 233 in 30-day) | Detect (a Unix value has no `-`), convert to a UTC instant. | A timestamp you can't place in time is useless for availability windows. |
| 2 | **Mixed latency units** - `ms` and `s` in the same column, disambiguated by `latency_unit` (`0.717 s` == `717 ms`) | ~20% of rows are in seconds | Normalize everything to **ms** using `latency_unit`. | Mixing units silently corrupts every latency percentile. |
| 3 | **Missing latency** - blank cell | ~1.2% (56 -> 186) | Keep the row (its status still counts for availability), set `latency_ms = NULL`, exclude from latency stats. | A missing latency doesn't mean the check didn't happen. |
| 4 | **Negative latency** - impossible value | exactly **1 per file** | Null it + flag it. | Physically impossible; would skew percentiles. |
| 5 | **Invalid status code `999`** - not a real HTTP code | exactly **1 per file** | Classify as `invalid`; **exclude from availability** (not counted up or down), surface the count. | A monitoring glitch isn't a real service state; counting it either way distorts the SLA number. |
| 6 | **Duplicate check-points** - the same `(service, timestamp)` reported by **two agents** | ~7% of rows (352 -> 1,173 extra) | De-duplicate to one logical checkpoint per `(service, timestamp)`; **average** the agents' latency. | Two probes of the same check are one data point, not two. Double-counting warps availability and latency. |

**Key observation that made dedup safe:** across every file, the two agents **always agree on
the status code** (verified: 0 up/down disagreements). They differ only by a few ms of latency.
So collapsing them can't hide or invent an outage. The merge rule is still defensive - if agents
ever disagreed, a real outage (`down`) would win over `up` - but in this data it never triggers.

After cleaning, each service has exactly **96 checkpoints/day** (24h x 4/15min), which is the
sanity check that dedup and timestamp normalization are correct.

---

## Key design decisions & assumptions

Where the brief was open, here's what I chose and why.

- **What counts as "down":** a `5xx` status. `2xx`/`3xx`/`4xx` = up (the service responded; a
  `4xx` is the client's fault). Invalid codes (e.g. `999`) are excluded from the up/down math.
- **Availability** = `up_checks / (up_checks + down_checks)` over the detected period. Each check
  is a 15-minute window, so downtime = `down_checks x 15 min`.
- **SLA target = 99.9%.** Credit ladder (an assumption - a typical availability SLA):
  | Availability | Credit |
  |---|---|
  | >= 99.9% | 0% |
  | 99.0-99.9% | 10% |
  | 95.0-99.0% | 25% |
  | < 95% | 100% |
- **Incidents** are contiguous runs of `down` checks, with a **1-checkpoint gap tolerance**: a
  single recovered 15-min window does *not* split an incident. A service flapping `5xx->200->5xx`
  for an hour is one outage to a responder, not six. (Every down window still counts fully toward
  downtime/availability - coalescing only affects how incidents are *grouped*.) The data mixes a
  low rate of random transient `5xx` with a couple of deliberate sustained outages; this surfaces
  the sustained ones as single incidents while transient blips stay as 1-check incidents.
- **Latency is averaged** across the two agents per checkpoint; percentiles (p50/p95/p99) are
  computed per service from non-null values via linear interpolation.
- **Chosen stats** (the brief asks you to decide what matters for on-call / billing):
  - Per service: **availability %**, **SLA breach + credit owed**, up/down counts, **incident
    count**, **total downtime**, **longest outage**, **p50/p95/p99 latency**.
  - Overall: period + days (detected), total checks, overall availability, **# services breaching
    SLA**, total incidents, total downtime, **worst service**.
  - **Data-quality panel**: raw->clean row counts and every issue fixed - because the whole premise
    is that the pipeline must be *trustworthy*, so it shows its work.

### A free-tier constraint I designed around (and the judgement call)
Cloudflare's **Worker free plan caps CPU at ~10 ms per request** (I/O waiting on D1 does *not*
count). Parsing + cleaning + stats for the 30-day file (15.5k rows) measures ~40-55 ms of CPU in
local Node - over that budget. Two things make single-request upload the right call anyway:
1. The docs grant **"built-in flexibility ... where your Worker infrequently runs over the
   configured limit"**; termination only happens when you hit it *consistently*. An upload is
   **infrequent** (you upload a handful of times); the *frequent* requests - dashboard stats/logs
   - are cheap reads well under budget.
2. On Cloudflare's dedicated isolates the real CPU is lower than loaded local Node.

So I kept the design simple and validated it, rather than over-engineering chunked ingestion for
a limit the platform explicitly relaxes for infrequent work. I still **optimized the hot path**
(comma split instead of a char parser; `Date.parse` + a cheap Unix check instead of a regex;
store the integer epoch and format ISO only on read, not 15k times at ingest) - roughly halving
the cost. **Documented fallback** if a much larger file ever triggers `Error 1102`: split the
upload into line-chunks across multiple requests (each gets its own CPU budget) and dedupe in SQL.

Inserts respect D1's limits too: multi-row `INSERT` at 10 rows/statement (<=100 bound params) in
`db.batch()` groups, staying well under the 50-subrequest/invocation cap.

---

## Running locally

Two terminals. Requires Node 18+.

**1) The Worker (serverless function + D1):**
```bash
cd worker
npm install
npm run db:init:local          # creates the local D1 and applies schema.sql
npm run dev                    # wrangler dev on http://localhost:8787
```

**2) The dashboard:**
```bash
cd web
npm install
npm run dev                    # vite on http://localhost:5173, talks to localhost:8787 by default
```

Open http://localhost:5173 and upload any file from `sample-data/`.

---

## Tests

```bash
cd worker
npm test            # vitest run - 56 tests
```

- **Unit tests** for the cleaner (timestamp/latency normalization, status classification, agent
  de-duplication, issue counting) and the stats math (availability, SLA credit tiers, incident
  coalescing, latency percentiles).
- **Regression tests** that run **all five sample datasets** through the real pipeline and assert
  the known-good numbers - day counts (detected, not hard-coded), `5 x 96 x days` clean
  checkpoints, the injected defects (exactly one negative latency + one invalid status per file),
  overall availability and the worst service. A change that shifts any of these fails loudly.

---

## Deployment

All free tier. You need a Cloudflare account (no card for this).

**1) Create the D1 database and apply the schema:**
```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create sla-db
```
Copy the printed `database_id` into `wrangler.toml` (replace `REPLACE_WITH_YOUR_D1_DATABASE_ID`), then:
```bash
npm run db:init:remote         # applies schema.sql to the remote D1
```

**2) Deploy the Worker:**
```bash
npx wrangler deploy            # prints your https://sla-monitor.<subdomain>.workers.dev URL
```

**3) Deploy the dashboard to Pages** (dashboard -> Pages -> connect this repo), with:
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Root directory:** `web`
- **Env var:** `VITE_API_URL = https://sla-monitor.<subdomain>.workers.dev`

Or from the CLI:
```bash
cd web
VITE_API_URL="https://sla-monitor.<subdomain>.workers.dev" npm run build
npx wrangler pages deploy dist --project-name sla-monitor
```

Put both live URLs at the top of this README.

---

## Project structure

```
sla-monitor/
+-- worker/                    # the serverless function (Cloudflare Worker + D1)
|   +-- src/
|   |   +-- index.ts           # entry: routes method + path to a handler
|   |   +-- types/             # type aliases
|   |   +-- interfaces/        # all interfaces (domain, DB rows, payloads, env)
|   |   +-- constants/         # schema columns, SLA policy, D1 limits, CORS
|   |   +-- utils/             # pure helpers (epoch/ISO, percentile, string compare)
|   |   +-- helpers/           # domain helpers (normalize, classify, SLA credit)
|   |   +-- validations/       # request validation
|   |   +-- lib/               # http (responses) + db (all D1 SQL)
|   |   +-- services/          # clean + stats (business logic, unit-tested)
|   |   +-- handlers/          # upload + query HTTP handlers
|   +-- test/                  # 56 Vitest tests (clean, stats, samples regression)
|   +-- schema.sql             # D1 schema (uploads + checks)
|   +-- wrangler.toml
+-- web/                       # React + Vite dashboard -> Cloudflare Pages
|   +-- src/
|       +-- main.tsx, App.tsx  # entry + shell
|       +-- types/             # type aliases
|       +-- interfaces/        # API shapes + component props
|       +-- constants/         # API base, labels, filter options
|       +-- lib/               # API client
|       +-- utils/             # formatters
|       +-- helpers/           # SLA-aware presentation helpers
|       +-- validations/       # file validation
|       +-- pages/             # DashboardPage
|       +-- components/        # UploadPanel, StatsSection, ServiceCard, Metric, Summary, LogsView
+-- sample-data/               # the 5 provided CSVs, for testing the live app
+-- README.md
```

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/upload?filename=` | Upload raw CSV -> clean -> persist -> return stats |
| `GET`  | `/api/uploads` | List processed datasets |
| `GET`  | `/api/uploads/:id/stats` | Stored dashboard stats for a dataset |
| `GET`  | `/api/uploads/:id/logs?from=&to=&service=&status=&page=` | Paginated, filterable checks |

---

## What I'd do with more time

- **Integration tests hitting a live D1.** The committed Vitest suite covers the cleaner and stats
  services (unit + regression across all five datasets); I'd add an end-to-end test that POSTs to a local
  `wrangler dev` and asserts the `/stats` and `/logs` responses.
- **Chunked ingestion** as the default (not just a fallback), so arbitrarily large files are
  guaranteed under the CPU budget.
- **Incident drill-down & charts** - an availability timeline and latency sparkline per service.
- **CSV export** of the filtered log view.
- **Idempotent re-upload** (hash the file; replace rather than duplicate a dataset).

## Out of scope (per the brief)
No authentication / accounts, no multi-tenancy, no CI pipeline.

---

## Glossary - abbreviations & terms

Every short form used in this project, with its full form and a one-line meaning.

### SLA / monitoring terms
| Short | Full form | Meaning here |
|---|---|---|
| **SLA** | Service Level Agreement | The reliability promise (e.g. "99.9% uptime"); missing it owes the customer a credit. |
| **svc** | service | ID prefix for a monitored service in the data (e.g. `svc-reports`, `svc-api`). |
| **2xx / 3xx / 4xx / 5xx** | HTTP status-code ranges (`x` = any digit, so `5xx` = 500-599) | `5xx` = server error -> **down**; `2xx` / `3xx` / `4xx` -> **up**. |
| **p50 / p95 / p99** | 50th / 95th / 99th percentile | Latency percentiles - e.g. p95 = 95% of responses were at least this fast. |
| **ms / s** | milliseconds / seconds | Latency units; everything is normalized to **ms** (1 s = 1000 ms). |
| **UTC** | Coordinated Universal Time | All timestamps are stored and shown in UTC (no timezone drift). |
| **ISO 8601** | International standard date-time format | e.g. `2025-05-13T12:45:00Z` - the clean timestamp format. |
| **Unix epoch** | seconds since 1 Jan 1970, UTC | The *other*, messy timestamp format in the data (e.g. `1746938700`). |

### Web / technical terms
| Short | Full form | Meaning here |
|---|---|---|
| **CSV** | Comma-Separated Values | The uploaded file format. |
| **API** | Application Programming Interface | The Worker's HTTP endpoints the dashboard calls. |
| **HTTP** | HyperText Transfer Protocol | The web request/response protocol. |
| **UI** | User Interface | The dashboard screen the user sees. |
| **SPA** | Single-Page Application | A browser-rendered web app (React) - one page, no full reloads. |
| **CDN** | Content Delivery Network | The edge network Cloudflare Pages serves the static files from. |
| **CORS** | Cross-Origin Resource Sharing | Browser rule that lets the Pages site call the Worker on a different domain. |
| **CPU** | Central Processing Unit | Compute time; the Worker free tier caps it at ~10 ms per request. |
| **JSON** | JavaScript Object Notation | The API response format; also how stats are stored on the upload row. |
| **URL** | Uniform Resource Locator | A web address (the live links). |
| **UUID** | Universally Unique Identifier | The random ID given to each upload. |
| **SQL** | Structured Query Language | The language used to query the database. |
| **SQLite** | a self-contained SQL database engine | What Cloudflare D1 is built on. |
| **FK** | Foreign Key | DB link: each `checks` row points back to its `uploads` row. |
| **DB / env** | database / environment | `env.DB` = the database binding available inside the Worker. |

### Stack & tooling (product / tool names)
| Name | What it is |
|---|---|
| **Cloudflare Pages** | Free static hosting (serves the dashboard). |
| **Cloudflare Worker** | Serverless function runtime at the edge (our API). |
| **Cloudflare D1** | Serverless SQLite database (*"D1" is a product name, not an acronym*). |
| **Wrangler** | Cloudflare's command-line tool to run & deploy Workers / D1. |
| **Vite** | Frontend build tool + dev server for the React app. |
| **Vitest** | Test runner used for the 56 tests. |
| **Node / Node.js** | The JavaScript runtime everything runs on. |
| **npm / npx** | Node Package Manager / Node Package eXecute (install & run packages). |
| **TypeScript (.ts / .tsx)** | Typed JavaScript; `.tsx` = TypeScript with React markup. |
| **CI / CD** | Continuous Integration / Continuous Delivery (out of scope per the brief). |
