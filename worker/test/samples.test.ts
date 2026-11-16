import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clean } from "../src/services/clean";
import { computeStats } from "../src/services/stats";

// End-to-end regression over the five provided datasets, with pinned expected values.
const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "sample-data");

interface Case {
  file: string;
  days: number;
  availability: number; // overall, %
  worst: string; // worst service_id
}

const CASES: Case[] = [
  { file: "monitoring_checks_9d_seed101.csv", days: 9, availability: 99.051, worst: "svc-reports" },
  { file: "monitoring_checks_12d_seed505.csv", days: 12, availability: 98.663, worst: "svc-search" },
  { file: "monitoring_checks_14d_seed202.csv", days: 14, availability: 98.438, worst: "svc-reports" },
  { file: "monitoring_checks_21d_seed303.csv", days: 21, availability: 98.77, worst: "svc-reports" },
  { file: "monitoring_checks_30d_seed404.csv", days: 30, availability: 98.736, worst: "svc-reports" },
];

describe("sample datasets - end-to-end regression", () => {
  for (const c of CASES) {
    describe(c.file, () => {
      const res = clean(readFileSync(join(SAMPLES, c.file), "utf8"));
      const stats = computeStats(res.checks);

      it(`detects ${c.days} days (not hard-coded)`, () => {
        expect(res.day_count).toBe(c.days);
      });

      it("yields exactly 96 clean checkpoints per service per day after dedup", () => {
        // 5 services * 96 checks/day * days
        expect(res.issues.rows_clean).toBe(5 * 96 * c.days);
        expect(stats.overall.total_checkpoints).toBe(5 * 96 * c.days);
      });

      it("finds the injected poison values (1 negative latency, 1 invalid status)", () => {
        expect(res.issues.latency_negative).toBe(1);
        expect(res.issues.invalid_status).toBe(1);
      });

      it("finds the systematic messiness (unix timestamps, seconds-latency, duplicates)", () => {
        expect(res.issues.unix_timestamps).toBeGreaterThan(0);
        expect(res.issues.latency_in_seconds).toBeGreaterThan(0);
        expect(res.issues.duplicate_checkpoints).toBeGreaterThan(0);
        expect(res.issues.unparseable_timestamps).toBe(0);
        expect(res.issues.malformed_rows).toBe(0);
      });

      it("computes the expected availability and worst service", () => {
        expect(stats.overall.services).toBe(5);
        expect(stats.overall.availability_pct).toBeCloseTo(c.availability, 2);
        expect(stats.overall.services_breaching_sla).toBe(5);
        expect(stats.overall.worst_service?.service_id).toBe(c.worst);
      });

      it("keeps every service availability within [0, 100]", () => {
        for (const s of stats.services) {
          expect(s.availability_pct).toBeGreaterThanOrEqual(0);
          expect(s.availability_pct).toBeLessThanOrEqual(100);
          expect(s.total_checks).toBe(s.up_checks + s.down_checks);
        }
      });
    });
  }
});
