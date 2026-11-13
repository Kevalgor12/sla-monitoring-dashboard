# SLA Monitoring Dashboard

Upload raw health-check logs → a **serverless function cleans & validates them** → cleaned
checks land in a **database** → a **single-screen dashboard** shows availability, SLA credits,
incidents and a filterable log view.

Built on Cloudflare's free tier end to end: **Pages** (UI) + **Worker** (the serverless
function) + **D1** (SQLite). No credit card, no containers, no servers.

---

## Live URLs

| Piece | URL |
|---|---|
| Dashboard (Pages) | `https://<your-project>.pages.dev` _(fill after deploy)_ |
| Serverless function (Worker API) | `https://sla-monitor.<your-subdomain>.workers.dev` |

**Last verified live:** _<fill date after you deploy>_. Both `*.pages.dev` and `*.workers.dev`
stay up indefinitely on the free tier (no cold-shutdown). If anything is down at review time,
redeploy with the steps in [Deployment](#deployment) — it takes ~2 minutes.

---

## Architecture — what runs where, and why

```
┌──────────────┐  POST raw CSV   ┌──────────────────┐  cleaned rows  ┌──────────┐
│  React SPA   │ ──────────────▶ │  Cloudflare      │ ─────────────▶ │   D1     │
│ (Pages)      │                 │  Worker          │                │ (SQLite) │
│ upload +     │ ◀────────────── │  parse/validate/ │ ◀───────────── │          │
│ dashboard    │  stats + logs   │  clean + query   │    query       └──────────┘
└──────────────┘                 └──────────────────┘
  *.pages.dev                      *.workers.dev
```

| Layer | Choice | Why |
|---|---|---|
| **Upload UI + dashboard** | React + Vite, static, on **Cloudflare Pages** | A dashboard is a client-rendered SPA; static hosting is free and trivially cacheable. |
| **Serverless function** | **Cloudflare Worker** (standalone) | This is the "stateless serverless function" the brief requires. Kept separate from Pages so the architecture maps 1:1 to the flow and the function has its own URL you can point at. Runs on Cloudflare's edge — genuinely serverless, not a container. |
| **Database** | **Cloudflare D1** (SQLite) | Free, zero-ops, SQL, bound directly to the Worker (`env.DB`). Cleaned data is persisted and re-queryable after upload — it is not held in memory. |

Single provider → one `wrangler deploy` + a Pages git connection. The only seam between UI and
function is CORS (handled in the Worker).

### Request flow
1. User picks a CSV and clicks **Upload & analyze**.
2. The file is POSTed to the Worker `POST /api/upload`.
3. The Worker **parses, validates, cleans and de-duplicates** the data (`clean.ts`), **computes
   the stats** (`stats.ts`), writes one `uploads` row + the cleaned `checks` rows to D1, and
   returns the stats.
4. The dashboard renders the stats and lazily queries `GET /api/uploads/:id/logs` for the
   filterable table. Stats are **computed once at upload** and stored as JSON on the upload row,
   so every later page view is a single cheap read.

---

## Data findings — every issue, and how it's handled

The data is deliberately messy. I wrote a profiler (not shipped) and ran it across **all five**
provided files; the issue set is identical in every one, so the cleaner handles all of them
without any per-file assumptions. The day range is **detected from the data** — nothing is
hard-coded (files range from 9 to 30 days).

| # | Issue | Evidence (per file) | How it's handled | Why |
|---|---|---|---|---|
| 1 | **Mixed timestamp formats** — ISO 8601 (`2025-05-13T12:45:00Z`) *and* raw Unix epoch seconds (`1746938700`) | ~1.5% of rows are Unix (70 in 9-day → 233 in 30-day) | Detect (a Unix value has no `-`), convert to a UTC instant. | A timestamp you can't place in time is useless for availability windows. |
| 2 | **Mixed latency units** — `ms` and `s` in the same column, disambiguated by `latency_unit` (`0.717 s` == `717 ms`) | ~20% of rows are in seconds | Normalize everything to **ms** using `latency_unit`. | Mixing units silently corrupts every latency percentile. |
| 3 | **Missing latency** — blank cell | ~1.2% (56 → 186) | Keep the row (its status still counts for availability), set `latency_ms = NULL`, exclude from latency stats. | A missing latency doesn't mean the check didn't happen. |
| 4 | **Negative latency** — impossible value | exactly **1 per file** | Null it + flag it. | Physically impossible; would skew percentiles. |
| 5 | **Invalid status code `999`** — not a real HTTP code | exactly **1 per file** | Classify as `invalid`; **exclude from availability** (not counted up or down), surface the count. | A monitoring glitch isn't a real service state; counting it either way distorts the SLA number. |
| 6 | **Duplicate check-points** — the same `(service, timestamp)` reported by **two agents** | ~7% of rows (352 → 1,173 extra) | De-duplicate to one logical checkpoint per `(service, timestamp)`; **average** the agents' latency. | Two probes of the same check are one data point, not two. Double-counting warps availability and latency. |

**Key observation that made dedup safe:** across every file, the two agents **always agree on
the status code** (verified: 0 up/down disagreements). They differ only by a few ms of latency.
So collapsing them can't hide or invent an outage. The merge rule is still defensive — if agents
ever disagreed, a real outage (`down`) would win over `up` — but in this data it never triggers.

After cleaning, each service has exactly **96 checkpoints/day** (24h × 4/15min), which is the
sanity check that dedup and timestamp normalization are correct.

---

## Key design decisions & assumptions

Where the brief was open, here's what I chose and why.

- **What counts as "down":** a `5xx` status. `2xx`/`3xx`/`4xx` = up (the service responded; a
  `4xx` is the client's fault). Invalid codes (e.g. `999`) are excluded from the up/down math.
- **Availability** = `up_checks / (up_checks + down_checks)` over the detected period. Each check
  is a 15-minute window, so downtime = `down_checks × 15 min`.
- **SLA target = 99.9%.** Credit ladder (an assumption — a typical availability SLA):
  | Availability | Credit |
  |---|---|
  | ≥ 99.9% | 0% |
  | 99.0–99.9% | 10% |
  | 95.0–99.0% | 25% |
  | < 95% | 100% |
- **Incidents** are contiguous runs of `down` checks, with a **1-checkpoint gap tolerance**: a
  single recovered 15-min window does *not* split an incident. A service flapping `5xx→200→5xx`
  for an hour is one outage to a responder, not six. (Every down window still counts fully toward
  downtime/availability — coalescing only affects how incidents are *grouped*.) The data mixes a
  low rate of random transient `5xx` with a couple of deliberate sustained outages; this surfaces
  the sustained ones as single incidents while transient blips stay as 1-check incidents.
- **Latency is averaged** across the two agents per checkpoint; percentiles (p50/p95/p99) are
  computed per service from non-null values via linear interpolation.
- **Chosen stats** (the brief asks you to decide what matters for on-call / billing):
  - Per service: **availability %**, **SLA breach + credit owed**, up/down counts, **incident
    count**, **total downtime**, **longest outage**, **p50/p95/p99 latency**.
  - Overall: period + days (detected), total checks, overall availability, **# services breaching
    SLA**, total incidents, total downtime, **worst service**.
  - **Data-quality panel**: raw→clean row counts and every issue fixed — because the whole premise
    is that the pipeline must be *trustworthy*, so it shows its work.

### A free-tier constraint I designed around (and the judgement call)
Cloudflare's **Worker free plan caps CPU at ~10 ms per request** (I/O waiting on D1 does *not*
count). Parsing + cleaning + stats for the 30-day file (15.5k rows) measures ~40–55 ms of CPU in
local Node — over that budget. Two things make single-request upload the right call anyway:
1. The docs grant **"built-in flexibility ... where your Worker infrequently runs over the
   configured limit"**; termination only happens when you hit it *consistently*. An upload is
   **infrequent** (you upload a handful of times); the *frequent* requests — dashboard stats/logs
   — are cheap reads well under budget.
2. On Cloudflare's dedicated isolates the real CPU is lower than loaded local Node.

So I kept the design simple and validated it, rather than over-engineering chunked ingestion for
a limit the platform explicitly relaxes for infrequent work. I still **optimized the hot path**
(comma split instead of a char parser; `Date.parse` + a cheap Unix check instead of a regex;
store the integer epoch and format ISO only on read, not 15k times at ingest) — roughly halving
the cost. **Documented fallback** if a much larger file ever triggers `Error 1102`: split the
upload into line-chunks across multiple requests (each gets its own CPU budget) and dedupe in SQL.

Inserts respect D1's limits too: multi-row `INSERT` at 10 rows/statement (≤100 bound params) in
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
npm test            # vitest run — 56 tests
```

- **Unit tests** for the cleaner (timestamp/latency normalization, status classification, agent
  de-duplication, issue counting) and the stats math (availability, SLA credit tiers, incident
  coalescing, latency percentiles).
- **Regression tests** that run **all five sample datasets** through the real pipeline and assert
  the known-good numbers — day counts (detected, not hard-coded), `5 × 96 × days` clean
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

**3) Deploy the dashboard to Pages** (dashboard → Pages → connect this repo), with:
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
├── worker/                    # the serverless function
│   ├── src/
│   │   ├── index.ts           # router: /api/upload, /api/uploads, /:id/stats, /:id/logs + CORS
│   │   ├── clean.ts           # parse / validate / normalize / de-duplicate  (pure, unit-testable)
│   │   └── stats.ts           # availability, SLA credit, incidents, latency percentiles
│   ├── schema.sql             # D1 schema (uploads + checks)
│   └── wrangler.toml
├── web/                       # React + Vite dashboard → Cloudflare Pages
│   └── src/
│       ├── api.ts             # typed API client
│       ├── App.tsx
│       └── components/        # UploadPanel, StatsSection (collapsible), LogsView (filterable)
├── sample-data/               # the 5 provided CSVs, for testing the live app
└── README.md
```

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/upload?filename=` | Upload raw CSV → clean → persist → return stats |
| `GET`  | `/api/uploads` | List processed datasets |
| `GET`  | `/api/uploads/:id/stats` | Stored dashboard stats for a dataset |
| `GET`  | `/api/uploads/:id/logs?from=&to=&service=&status=&page=` | Paginated, filterable checks |

---

## What I'd do with more time

- **Integration tests hitting a live D1.** The committed Vitest suite covers `clean.ts`/`stats.ts`
  (unit + regression across all five datasets); I'd add an end-to-end test that POSTs to a local
  `wrangler dev` and asserts the `/stats` and `/logs` responses.
- **Chunked ingestion** as the default (not just a fallback), so arbitrarily large files are
  guaranteed under the CPU budget.
- **Incident drill-down & charts** — an availability timeline and latency sparkline per service.
- **CSV export** of the filtered log view.
- **Idempotent re-upload** (hash the file; replace rather than duplicate a dataset).

## Out of scope (per the brief)
No authentication / accounts, no multi-tenancy, no CI pipeline.
