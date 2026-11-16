// Parse, validate, clean and de-duplicate a raw CSV. Pure (no I/O).

import { EXPECTED_COLS, MS_PER_DAY } from "../constants";
import { classifyStatus, normalizeLatency, normalizeTimestamp } from "../helpers";
import { cmpStr, epochToIso } from "../utils";
import type { CheckpointAcc, CleanCheck, CleanResult, Issues, ServiceRef } from "../interfaces";
import type { StatusClass } from "../types";

export function clean(csvText: string): CleanResult {
  const lines = csvText.split(/\r?\n/);

  // header = first non-empty line
  let h = 0;
  while (h < lines.length && lines[h] === "") h++;
  const header = (lines[h] ?? "").split(",").map((s) => s.trim());
  const nCols = header.length;

  // map expected columns by name -> index
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

  // one accumulator per (service, timestamp); duplicate agent reports merge in
  const byKey = new Map<string, CheckpointAcc>();
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

  const checks: CleanCheck[] = [];
  let minMs = Infinity;
  let maxMs = -Infinity;
  const days = new Set<number>();

  for (const acc of byKey.values()) {
    // merged status: down beats up beats invalid
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
    days.add(Math.floor(acc.epoch_ms / MS_PER_DAY));
  }

  checks.sort((a, b) => a.epoch_ms - b.epoch_ms || cmpStr(a.service_id, b.service_id));
  issues.rows_clean = checks.length;

  const services: ServiceRef[] = [...serviceNames.entries()]
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
