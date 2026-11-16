// Domain presentation helpers (SLA-aware).

import { DEFAULT_PAGE_SIZE } from "../constants";
import type { LogFilterInput, LogFilters, ServiceStats, SlaBadge } from "../interfaces";
import type { AvailabilityTone } from "../types";

/** Colour tone for an availability % vs its target. */
export function availabilityTone(pct: number, target: number): AvailabilityTone {
  if (pct >= target) return "ok";
  if (pct >= 99) return "warn";
  return "bad";
}

/** SLA badge label + tone for a service. */
export function slaBadge(s: ServiceStats): SlaBadge {
  return s.sla_breached
    ? { label: `BREACH | ${s.credit_pct}% credit`, tone: "bad" }
    : { label: "MEETS SLA", tone: "ok" };
}

/** Logs UI filter state -> API query. */
export function buildLogFilters(input: LogFilterInput): LogFilters {
  const { mode, day, from, to, service, status, page } = input;
  const dateFilter: LogFilters =
    mode === "single"
      ? { from: day || undefined, to: day || undefined }
      : mode === "range"
        ? { from: from || undefined, to: to || undefined }
        : {};
  return {
    ...dateFilter,
    service: service || undefined,
    status: status || undefined,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
