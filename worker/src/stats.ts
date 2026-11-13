/**
 * stats.ts — turns cleaned checkpoints into the numbers the dashboard shows.
 * Computed once at upload time and stored on the `uploads` row (stats_json), so
 * reads are a single cheap SELECT and the math is never recomputed per page view.
 *
 * Audience: someone on-call or in billing. They care about availability vs the
 * SLA, how much credit is owed, when the outages were, and how slow things got.
 */

import { cmpStr, epochToIso, type CleanCheck } from "./clean.ts";

/** Each check represents a fixed monitoring window. 1 check / 15 min. */
export const MINUTES_PER_CHECK = 15;

/**
 * Incident coalescing: a single recovered checkpoint (one 15-min window) does
 * NOT end an incident. A service flapping 5xx→200→5xx for an hour is ONE outage
 * to a responder, not several. Two consecutive non-down windows end it.
 * (Every down window still counts fully toward downtime and availability.)
 */
const INCIDENT_GAP_TOLERANCE = 1;

/** SLA credit ladder. Documented as an assumption in the README; tweak here. */
export function creditForAvailability(pct: number): number {
  if (pct >= 99.9) return 0;
  if (pct >= 99.0) return 10;
  if (pct >= 95.0) return 25;
  return 100;
}

export interface Incident {
  start: string; // ISO — first failed check
  end: string; // ISO — last failed check
  checkpoints: number; // number of failed (5xx) checks in the incident
  minutes: number; // wall-clock span start..end inclusive (includes brief recoveries)
}

export interface ServiceStats {
  service_id: string;
  service_name: string;
  total_checks: number; // checkpoints counted toward availability (valid only)
  up_checks: number;
  down_checks: number;
  invalid_checks: number; // excluded from availability, surfaced for transparency
  availability_pct: number;
  sla_target_pct: number;
  sla_breached: boolean;
  credit_pct: number;
  incident_count: number;
  downtime_minutes: number; // sum of failed windows
  longest_incident_minutes: number;
  incidents: Incident[];
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  latency_p99_ms: number | null;
  latency_avg_ms: number | null;
}

export interface OverallStats {
  services: number;
  total_checkpoints: number;
  availability_pct: number;
  services_breaching_sla: number;
  total_downtime_minutes: number;
  total_incidents: number;
  worst_service: { service_id: string; service_name: string; availability_pct: number } | null;
}

export interface DashboardStats {
  sla_target_pct: number;
  overall: OverallStats;
  services: ServiceStats[];
}

const SLA_TARGET = 99.9;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const val = sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  return Math.round(val * 10) / 10;
}

function round(n: number, dp = 3): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

export function computeStats(checks: CleanCheck[]): DashboardStats {
  const byService = new Map<string, CleanCheck[]>();
  for (const c of checks) {
    let arr = byService.get(c.service_id);
    if (!arr) byService.set(c.service_id, (arr = []));
    arr.push(c);
  }

  const services: ServiceStats[] = [];

  for (const [service_id, list] of byService) {
    list.sort((a, b) => a.epoch_ms - b.epoch_ms);

    let up = 0;
    let down = 0;
    let invalid = 0;
    const latencies: number[] = [];

    const incidents: Incident[] = [];
    let startEpoch = 0; // first failed check of the current incident
    let lastDownEpoch = 0; // most recent failed check
    let downInRun = 0;
    let gapRun = 0; // consecutive non-down windows since the last failure
    let open = false;

    const closeRun = () => {
      if (open) {
        incidents.push({
          start: epochToIso(startEpoch),
          end: epochToIso(lastDownEpoch),
          checkpoints: downInRun,
          minutes: (lastDownEpoch - startEpoch) / 60000 + MINUTES_PER_CHECK,
        });
      }
      open = false;
      downInRun = 0;
      gapRun = 0;
    };

    for (const c of list) {
      if (c.latency_ms !== null && c.status_class !== "invalid") latencies.push(c.latency_ms);

      if (c.status_class === "down") {
        down++;
        if (!open) {
          open = true;
          startEpoch = c.epoch_ms;
          downInRun = 0;
        }
        lastDownEpoch = c.epoch_ms;
        downInRun++;
        gapRun = 0;
      } else {
        if (c.status_class === "up") up++;
        else invalid++;
        if (open) {
          gapRun++;
          if (gapRun > INCIDENT_GAP_TOLERANCE) closeRun();
        }
      }
    }
    closeRun();

    const total = up + down; // valid checks only
    const availability = total > 0 ? (up / total) * 100 : 100;
    const downtime = down * MINUTES_PER_CHECK;
    const longest = incidents.reduce((m, i) => Math.max(m, i.minutes), 0);

    latencies.sort((a, b) => a - b);
    const avg = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

    services.push({
      service_id,
      service_name: list[0].service_name,
      total_checks: total,
      up_checks: up,
      down_checks: down,
      invalid_checks: invalid,
      availability_pct: round(availability),
      sla_target_pct: SLA_TARGET,
      sla_breached: availability < SLA_TARGET,
      credit_pct: creditForAvailability(availability),
      incident_count: incidents.length,
      downtime_minutes: downtime,
      longest_incident_minutes: longest,
      incidents,
      latency_p50_ms: percentile(latencies, 50),
      latency_p95_ms: percentile(latencies, 95),
      latency_p99_ms: percentile(latencies, 99),
      latency_avg_ms: avg === null ? null : Math.round(avg * 10) / 10,
    });
  }

  services.sort(
    (a, b) => a.availability_pct - b.availability_pct || cmpStr(a.service_id, b.service_id)
  );

  const totalUp = services.reduce((s, x) => s + x.up_checks, 0);
  const totalValid = services.reduce((s, x) => s + x.total_checks, 0);
  const overall: OverallStats = {
    services: services.length,
    total_checkpoints: checks.length,
    availability_pct: totalValid > 0 ? round((totalUp / totalValid) * 100) : 100,
    services_breaching_sla: services.filter((s) => s.sla_breached).length,
    total_downtime_minutes: services.reduce((s, x) => s + x.downtime_minutes, 0),
    total_incidents: services.reduce((s, x) => s + x.incident_count, 0),
    worst_service:
      services.length > 0
        ? {
            service_id: services[0].service_id,
            service_name: services[0].service_name,
            availability_pct: services[0].availability_pct,
          }
        : null,
  };

  return { sla_target_pct: SLA_TARGET, overall, services };
}
