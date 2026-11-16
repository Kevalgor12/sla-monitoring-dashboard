// Pure formatting helpers.

/** ISO instant -> YYYY-MM-DD (em-dash when empty). */
export function formatIsoDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "-";
}

/** Minutes -> "45m" / "2h 15m". */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** ISO instant -> "2025-05-01 00:30:00" for table cells. */
export function formatTimestamp(iso: string): string {
  return iso.replace("T", " ").replace(".000Z", "");
}

/** ISO instant -> "2025-05-01 00:30Z" for incident lines. */
export function formatIncidentTime(iso: string): string {
  return iso.replace("T", " ").replace(".000Z", "Z");
}

/** Percentage with fixed decimals. */
export function formatPct(pct: number, digits = 3): string {
  return `${pct.toFixed(digits)}%`;
}

/** Thousands-separated integer. */
export function formatCount(n: number): string {
  return n.toLocaleString();
}

/** Latency with a space ("185 ms" / "-"). */
export function formatLatency(ms: number | null): string {
  return ms != null ? `${ms} ms` : "-";
}

/** Latency compact ("185ms" / "-"). */
export function formatLatencyCompact(ms: number | null): string {
  return ms != null ? `${ms}ms` : "-";
}
