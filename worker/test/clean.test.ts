import { describe, it, expect } from "vitest";
import {
  clean,
  classifyStatus,
  normalizeLatency,
  normalizeTimestamp,
} from "../src/clean.ts";

describe("normalizeTimestamp", () => {
  it("parses ISO 8601", () => {
    const r = normalizeTimestamp("2025-05-13T12:45:00Z");
    expect(r.ms).toBe(Date.parse("2025-05-13T12:45:00Z"));
    expect(r.wasUnix).toBe(false);
  });

  it("parses Unix epoch seconds (10 digits) → ms, flagged as unix", () => {
    const r = normalizeTimestamp("1746938700");
    expect(r.ms).toBe(1746938700 * 1000);
    expect(r.wasUnix).toBe(true);
  });

  it("parses Unix epoch milliseconds (13 digits)", () => {
    const r = normalizeTimestamp("1746938700000");
    expect(r.ms).toBe(1746938700000);
    expect(r.wasUnix).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeTimestamp("  2025-05-13T12:45:00Z ").ms).toBe(
      Date.parse("2025-05-13T12:45:00Z")
    );
  });

  it("returns null for empty and unparseable", () => {
    expect(normalizeTimestamp("").ms).toBeNull();
    expect(normalizeTimestamp("not-a-timestamp").ms).toBeNull();
  });
});

describe("normalizeLatency", () => {
  it("keeps milliseconds", () => {
    expect(normalizeLatency("707", "ms")).toMatchObject({ ms: 707, wasSeconds: false });
  });

  it("converts seconds to ms and flags it", () => {
    expect(normalizeLatency("0.717", "s")).toMatchObject({ ms: 717, wasSeconds: true });
  });

  it("flags blank as missing", () => {
    expect(normalizeLatency("", "ms")).toMatchObject({ ms: null, wasMissing: true });
  });

  it("flags non-numeric as missing", () => {
    expect(normalizeLatency("abc", "ms")).toMatchObject({ ms: null, wasMissing: true });
  });

  it("flags negative as negative and nulls it", () => {
    expect(normalizeLatency("-5", "ms")).toMatchObject({ ms: null, wasNegative: true });
  });
});

describe("classifyStatus", () => {
  it("treats 2xx/3xx/4xx as up", () => {
    expect(classifyStatus(200)).toBe("up");
    expect(classifyStatus(301)).toBe("up");
    expect(classifyStatus(404)).toBe("up");
  });
  it("treats 5xx as down", () => {
    expect(classifyStatus(500)).toBe("down");
    expect(classifyStatus(503)).toBe("down");
  });
  it("treats out-of-range / non-integer codes as invalid", () => {
    expect(classifyStatus(999)).toBe("invalid");
    expect(classifyStatus(0)).toBe("invalid");
    expect(classifyStatus(99)).toBe("invalid");
    expect(classifyStatus(600)).toBe("invalid");
    expect(classifyStatus(200.5)).toBe("invalid");
  });
});

describe("clean() — integration over a messy CSV", () => {
  const unixTs = Math.floor(Date.UTC(2025, 4, 1, 2, 0, 0) / 1000); // epoch seconds
  const csv = [
    "service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region",
    // same checkpoint reported by two agents (100ms + 200ms -> avg 150)
    "svc-a,A,2025-05-01T00:00:00Z,200,100,ms,agent-1,ap-south-1",
    "svc-a,A,2025-05-01T00:00:00Z,200,200,ms,agent-2,ap-south-1",
    // unix timestamp + latency in seconds (0.5s -> 500ms)
    `svc-a,A,${unixTs},200,0.5,s,agent-1,ap-south-1`,
    // missing latency
    "svc-b,B,2025-05-01T00:15:00Z,200,,ms,agent-1,ap-south-1",
    // negative latency
    "svc-b,B,2025-05-01T00:30:00Z,200,-5,ms,agent-1,ap-south-1",
    // invalid status code
    "svc-b,B,2025-05-01T00:45:00Z,999,120,ms,agent-1,ap-south-1",
    // real outage
    "svc-b,B,2025-05-01T01:00:00Z,500,130,ms,agent-1,ap-south-1",
  ].join("\n");

  const res = clean(csv);

  it("counts every data-quality issue", () => {
    expect(res.issues.rows_raw).toBe(7);
    expect(res.issues.duplicate_checkpoints).toBe(1);
    expect(res.issues.unix_timestamps).toBe(1);
    expect(res.issues.latency_in_seconds).toBe(1);
    expect(res.issues.latency_missing).toBe(1);
    expect(res.issues.latency_negative).toBe(1);
    expect(res.issues.invalid_status).toBe(1);
    expect(res.issues.malformed_rows).toBe(0);
  });

  it("de-duplicates the two agents into one checkpoint and averages latency", () => {
    expect(res.issues.rows_clean).toBe(6); // 7 rows - 1 duplicate
    const cp = res.checks.find(
      (c) => c.service_id === "svc-a" && c.epoch_ms === Date.parse("2025-05-01T00:00:00Z")
    )!;
    expect(cp.agent_count).toBe(2);
    expect(cp.latency_ms).toBe(150);
    expect(cp.status_class).toBe("up");
  });

  it("normalizes the unix timestamp and second-latency row", () => {
    const cp = res.checks.find((c) => c.epoch_ms === unixTs * 1000)!;
    expect(cp).toBeDefined();
    expect(cp.latency_ms).toBe(500);
  });

  it("nulls the negative latency but keeps the row", () => {
    const cp = res.checks.find((c) => c.epoch_ms === Date.parse("2025-05-01T00:30:00Z"))!;
    expect(cp.latency_ms).toBeNull();
    expect(cp.status_class).toBe("up");
  });

  it("marks the 999 row invalid and the 500 row down", () => {
    const invalid = res.checks.find((c) => c.status_code === 999)!;
    expect(invalid.status_class).toBe("invalid");
    const down = res.checks.find((c) => c.status_code === 500)!;
    expect(down.status_class).toBe("down");
  });

  it("reports the detected day range and services", () => {
    expect(res.day_count).toBe(1);
    expect(res.services.map((s) => s.id).sort()).toEqual(["svc-a", "svc-b"]);
  });
});
