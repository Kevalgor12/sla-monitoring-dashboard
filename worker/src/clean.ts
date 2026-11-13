/**
 * clean.ts — the parse / validate / clean stage of the serverless function.
 *
 * Input:  the raw CSV text exactly as uploaded.
 * Output: de-duplicated, normalized checkpoints + a tally of every data-quality
 *         issue we found. Pure functions, no I/O, so the same code runs in the
 *         Worker AND in a local Node test harness.
 *
 * Performance note: this runs inside a Cloudflare Worker, which on the free plan
 * caps CPU at ~10 ms per request. So the hot path avoids the expensive stuff:
 *   - comma `split` instead of a char-by-char parser (the data has no quoted fields),
 *   - a fixed-shape ISO fast-path instead of Date.parse on every row,
 *   - storing the integer epoch and formatting to ISO only on read, not 14k times here.
 *
 * Expected columns:
 *   service_id, service_name, timestamp, status_code, latency, latency_unit, agent, region
 */

export type StatusClass = "up" | "down" | "invalid";

export interface CleanCheck {
  service_id: string;
  service_name: string;
  epoch_ms: number; // UTC instant; ISO is derived on read (see epochToIso)
  status_code: number;
  latency_ms: number | null; // normalized to ms; null when missing/invalid
  status_class: StatusClass;
  region: string;
  agent_count: number; // how many raw agent readings were merged into this checkpoint
}

export interface Issues {
  rows_raw: number; // data lines in the file (excluding header)
  rows_parsed: number; // rows that parsed with the right column count
  rows_clean: number; // checkpoints after de-duplication
  malformed_rows: number; // wrong column count — dropped
  unix_timestamps: number; // epoch-second timestamps converted to ISO
  unparseable_timestamps: number; // dropped (can't place in time)
  latency_in_seconds: number; // rows whose unit was "s" — converted to ms
  latency_missing: number; // blank/non-numeric latency — kept row, nulled latency
  latency_negative: number; // impossible value — nulled + flagged
  invalid_status: number; // status code outside 100–599 — excluded from uptime
  duplicate_checkpoints: number; // extra agent readings merged away
}

export interface CleanResult {
  checks: CleanCheck[];
  issues: Issues;
  date_start: string; // ISO
  date_end: string; // ISO
  day_count: number;
  services: { id: string; name: string }[];
}

const EXPECTED_COLS = [
  "service_id",
  "service_name",
  "timestamp",
  "status_code",
  "latency",
  "latency_unit",
  "agent",
  "region",
];

/** Format a UTC instant to ISO. Called rarely (date range, incident bounds, paginated reads). */
export function epochToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Timestamps arrive as ISO 8601 ("2025-05-13T12:45:00Z") OR raw Unix epoch
 * seconds ("1746938700"). Discriminate cheaply: an ISO timestamp always contains
 * a "-" (date separators); a Unix epoch never does. Date.parse handles the ISO
 * side faster than a hand-rolled regex+Date.UTC (measured), so we lean on it.
 */
export function normalizeTimestamp(raw: string): { ms: number | null; wasUnix: boolean } {
  const v = raw.trim();
  if (v === "") return { ms: null, wasUnix: false };
  if (v.indexOf("-") === -1) {
    // Unix epoch: 10 digits = seconds, 13 = milliseconds.
    const n = Number(v);
    if (!Number.isFinite(n)) return { ms: null, wasUnix: false };
    return { ms: v.length >= 13 ? n : n * 1000, wasUnix: true };
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? { ms: null, wasUnix: false } : { ms: t, wasUnix: false };
}

/** Latency comes in ms or s (see latency_unit). Normalize to ms; reject blanks and impossible values. */
export function normalizeLatency(
  raw: string,
  unit: string
): { ms: number | null; wasSeconds: boolean; wasMissing: boolean; wasNegative: boolean } {
  const v = raw.trim();
  const isSeconds = unit.trim().toLowerCase() === "s";
  if (v === "") return { ms: null, wasSeconds: false, wasMissing: true, wasNegative: false };
  const n = Number(v);
  if (!Number.isFinite(n)) return { ms: null, wasSeconds: isSeconds, wasMissing: true, wasNegative: false };
  const ms = isSeconds ? n * 1000 : n;
  if (ms < 0) return { ms: null, wasSeconds: isSeconds, wasMissing: false, wasNegative: true };
  return { ms, wasSeconds: isSeconds, wasMissing: false, wasNegative: false };
}

/**
 * Availability classification.
 *  - 5xx  => down (real server-side outage; this is what the incidents are)
 *  - valid HTTP (100–599, not 5xx) => up (service responded; 4xx is a client issue)
 *  - outside 100–599 (e.g. the injected 999) => invalid, excluded from uptime math
 */
export function classifyStatus(code: number): StatusClass {
  if (!Number.isInteger(code) || code < 100 || code > 599) return "invalid";
  if (code >= 500) return "down";
  return "up";
}

/** Plain byte-order string compare — avoids the Intl collator cost of localeCompare in hot sorts. */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function clean(csvText: string): CleanResult {
  const lines = csvText.split(/\r?\n/);
  // find header (first non-empty line)
  let h = 0;
  while (h < lines.length && lines[h] === "") h++;
  const header = (lines[h] ?? "").split(",").map((s) => s.trim());
  const nCols = header.length;

  const col: Record<string, number> = {};
  for (const name of EXPECTED_COLS) col[name] = header.indexOf(name);
  const cId = col.service_id,
    cName = col.service_name,
    cTs = col.timestamp,
    cStatus = col.status_code,
    cLat = col.latency,
    cUnit = col.latency_unit,
    cRegion = col.region;

  const issues: Issues = {
    rows_raw: 0,
    rows_parsed: 0,
    rows_clean: 0,
    malformed_rows: 0,
    unix_timestamps: 0,
    unparseable_timestamps: 0,
    latency_in_seconds: 0,
    latency_missing: 0,
    latency_negative: 0,
    invalid_status: 0,
    duplicate_checkpoints: 0,
  };

  interface Acc {
    service_id: string;
    service_name: string;
    epoch_ms: number;
    region: string;
    statuses: number[];
    latSum: number;
    latN: number;
    agent_count: number;
  }
  const byKey = new Map<string, Acc>();
  const serviceNames = new Map<string, string>();

  for (let i = h + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    issues.rows_raw++;
    const r = line.split(",");
    if (r.length !== nCols) {
      issues.malformed_rows++;
      continue;
    }
    issues.rows_parsed++;

    const service_id = r[cId].trim();
    const service_name = r[cName].trim();
    const region = r[cRegion].trim();

    const ts = normalizeTimestamp(r[cTs]);
    if (ts.wasUnix) issues.unix_timestamps++;
    if (ts.ms === null) {
      issues.unparseable_timestamps++;
      continue;
    }

    const statusRaw = Number(r[cStatus].trim());
    if (classifyStatus(statusRaw) === "invalid") issues.invalid_status++;

    const lat = normalizeLatency(r[cLat], r[cUnit]);
    if (lat.wasSeconds) issues.latency_in_seconds++;
    if (lat.wasMissing) issues.latency_missing++;
    if (lat.wasNegative) issues.latency_negative++;

    if (service_name) serviceNames.set(service_id, service_name);

    const key = service_id + "|" + ts.ms;
    const existing = byKey.get(key);
    if (existing) {
      issues.duplicate_checkpoints++;
      existing.statuses.push(statusRaw);
      if (lat.ms !== null) {
        existing.latSum += lat.ms;
        existing.latN++;
      }
      existing.agent_count++;
    } else {
      byKey.set(key, {
        service_id,
        service_name,
        epoch_ms: ts.ms,
        region,
        statuses: [statusRaw],
        latSum: lat.ms !== null ? lat.ms : 0,
        latN: lat.ms !== null ? 1 : 0,
        agent_count: 1,
      });
    }
  }

  // Resolve each checkpoint. Status: agents agree in this data, but be robust —
  // if they ever disagree, let a real outage win (down > up > invalid). Latency:
  // mean of the valid agent readings.
  const checks: CleanCheck[] = [];
  let minMs = Infinity;
  let maxMs = -Infinity;
  const days = new Set<number>(); // UTC day index = floor(ms / 86_400_000); avoids per-row Date work

  for (const acc of byKey.values()) {
    let status_class: StatusClass = "invalid";
    let status_code = acc.statuses[0];
    let sawUp = false;
    for (const s of acc.statuses) {
      const c = classifyStatus(s);
      if (c === "down") {
        status_class = "down";
        status_code = s;
        break;
      }
      if (c === "up" && !sawUp) {
        sawUp = true;
        status_class = "up";
        status_code = s;
      }
    }

    const latency_ms = acc.latN > 0 ? Math.round((acc.latSum / acc.latN) * 10) / 10 : null;

    checks.push({
      service_id: acc.service_id,
      service_name: acc.service_name || serviceNames.get(acc.service_id) || acc.service_id,
      epoch_ms: acc.epoch_ms,
      status_code,
      latency_ms,
      status_class,
      region: acc.region,
      agent_count: acc.agent_count,
    });

    if (acc.epoch_ms < minMs) minMs = acc.epoch_ms;
    if (acc.epoch_ms > maxMs) maxMs = acc.epoch_ms;
    days.add(Math.floor(acc.epoch_ms / 86_400_000));
  }

  checks.sort((a, b) => a.epoch_ms - b.epoch_ms || cmpStr(a.service_id, b.service_id));
  issues.rows_clean = checks.length;

  const services = [...serviceNames.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => cmpStr(a.id, b.id));

  return {
    checks,
    issues,
    date_start: minMs === Infinity ? "" : epochToIso(minMs),
    date_end: maxMs === -Infinity ? "" : epochToIso(maxMs),
    day_count: days.size,
    services,
  };
}
