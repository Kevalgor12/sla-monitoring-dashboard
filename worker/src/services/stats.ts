// Turn cleaned checkpoints into the dashboard stats (per service + overall).

import { INCIDENT_GAP_TOLERANCE, MINUTES_PER_CHECK, SLA_TARGET } from "../constants";
import { creditForAvailability } from "../helpers";
import { cmpStr, epochToIso, percentile, round } from "../utils";
import type { CleanCheck, DashboardStats, Incident, OverallStats, ServiceStats } from "../interfaces";

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
    let startEpoch = 0;
    let lastDownEpoch = 0;
    let downInRun = 0;
    let gapRun = 0;
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

  services.sort((a, b) => a.availability_pct - b.availability_pct || cmpStr(a.service_id, b.service_id));

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
