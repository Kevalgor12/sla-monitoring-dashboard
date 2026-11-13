import { describe, it, expect } from "vitest";
import { computeStats, creditForAvailability } from "../src/stats.ts";
import type { CleanCheck, StatusClass } from "../src/clean.ts";

const BASE = Date.parse("2025-05-01T00:00:00Z");
const STEP = 15 * 60 * 1000;

/** Build a checkpoint at slot `i` (15-min spacing). */
function mk(i: number, cls: StatusClass, latency: number | null): CleanCheck {
  return {
    service_id: "svc-x",
    service_name: "x",
    epoch_ms: BASE + i * STEP,
    status_code: cls === "down" ? 500 : cls === "invalid" ? 999 : 200,
    latency_ms: latency,
    status_class: cls,
    region: "r",
    agent_count: 1,
  };
}

describe("creditForAvailability — SLA ladder", () => {
  it("applies the correct tier including boundaries", () => {
    expect(creditForAvailability(100)).toBe(0);
    expect(creditForAvailability(99.9)).toBe(0);
    expect(creditForAvailability(99.89)).toBe(10);
    expect(creditForAvailability(99.0)).toBe(10);
    expect(creditForAvailability(98.99)).toBe(25);
    expect(creditForAvailability(95.0)).toBe(25);
    expect(creditForAvailability(94.99)).toBe(100);
  });
});

describe("computeStats", () => {
  // Pattern: up up DOWN up DOWN up up DOWN DOWN up  + one invalid
  //  idx:     0  1   2  3   4  5  6   7    8  9    10
  const checks: CleanCheck[] = [
    mk(0, "up", 100),
    mk(1, "up", 100),
    mk(2, "down", null),
    mk(3, "up", 100),
    mk(4, "down", null),
    mk(5, "up", 100),
    mk(6, "up", 100),
    mk(7, "down", null),
    mk(8, "down", null),
    mk(9, "up", 100),
    mk(10, "invalid", 999), // excluded from availability + latency
  ];
  const stats = computeStats(checks);
  const s = stats.services[0];

  it("counts up / down / invalid and excludes invalid from availability", () => {
    expect(s.up_checks).toBe(6);
    expect(s.down_checks).toBe(4);
    expect(s.invalid_checks).toBe(1);
    expect(s.total_checks).toBe(10); // up + down only
    expect(s.availability_pct).toBeCloseTo(60, 3);
  });

  it("coalesces flapping outages across a 1-checkpoint gap", () => {
    // idx 2-4 (down,up,down) => one incident; idx 7-8 => another
    expect(s.incident_count).toBe(2);
    expect(s.downtime_minutes).toBe(60); // 4 down * 15
    expect(s.longest_incident_minutes).toBe(45); // idx2..idx4 span
  });

  it("excludes invalid-check latency from percentiles", () => {
    expect(s.latency_avg_ms).toBe(100);
    expect(s.latency_p50_ms).toBe(100);
    expect(s.latency_p95_ms).toBe(100);
    expect(s.latency_p99_ms).toBe(100);
  });

  it("flags the SLA breach and the right credit", () => {
    expect(s.sla_breached).toBe(true);
    expect(s.credit_pct).toBe(100); // 60% availability
  });

  it("rolls up an overall summary", () => {
    expect(stats.overall.services).toBe(1);
    expect(stats.overall.total_checkpoints).toBe(11);
    expect(stats.overall.services_breaching_sla).toBe(1);
    expect(stats.overall.worst_service?.service_id).toBe("svc-x");
  });

  it("computes percentiles over a known distribution", () => {
    const ladder: CleanCheck[] = Array.from({ length: 100 }, (_, i) => mk(i, "up", i + 1));
    const only = computeStats(ladder).services[0];
    expect(only.latency_p50_ms).toBeCloseTo(50.5, 1);
    expect(only.latency_p95_ms).toBeCloseTo(95.05, 1);
    expect(only.availability_pct).toBe(100);
    expect(only.incident_count).toBe(0);
  });
});
