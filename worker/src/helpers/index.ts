// Domain helpers: normalize messy cells, classify status, SLA credit.

import type { NormalizedLatency, NormalizedTimestamp } from "../interfaces";
import type { StatusClass } from "../types";

/** Parse a timestamp. ISO has a "-"; a Unix epoch (10-digit s / 13-digit ms) does not. */
export function normalizeTimestamp(raw: string): NormalizedTimestamp {
  const v = raw.trim();
  if (v === "") return { ms: null, wasUnix: false };
  if (v.indexOf("-") === -1) {
    const n = Number(v);
    if (!Number.isFinite(n)) return { ms: null, wasUnix: false };
    return { ms: v.length >= 13 ? n : n * 1000, wasUnix: true };
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? { ms: null, wasUnix: false } : { ms: t, wasUnix: false };
}

/** Latency -> ms (unit "s" x1000). Flags blank, non-numeric and negative values. */
export function normalizeLatency(raw: string, unit: string): NormalizedLatency {
  const v = raw.trim();
  const isSeconds = unit.trim().toLowerCase() === "s";
  if (v === "") return { ms: null, wasSeconds: false, wasMissing: true, wasNegative: false };
  const n = Number(v);
  if (!Number.isFinite(n)) return { ms: null, wasSeconds: isSeconds, wasMissing: true, wasNegative: false };
  const ms = isSeconds ? n * 1000 : n;
  if (ms < 0) return { ms: null, wasSeconds: isSeconds, wasMissing: false, wasNegative: true };
  return { ms, wasSeconds: isSeconds, wasMissing: false, wasNegative: false };
}

/** 5xx -> down, other valid HTTP (100-599) -> up, anything else -> invalid. */
export function classifyStatus(code: number): StatusClass {
  if (!Number.isInteger(code) || code < 100 || code > 599) return "invalid";
  if (code >= 500) return "down";
  return "up";
}

/** SLA credit owed for an availability %. */
export function creditForAvailability(pct: number): number {
  if (pct >= 99.9) return 0;
  if (pct >= 99.0) return 10;
  if (pct >= 95.0) return 25;
  return 100;
}
