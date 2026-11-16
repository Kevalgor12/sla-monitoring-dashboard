// Generic helpers: time, numbers, strings.

/** UTC epoch (ms) -> ISO 8601 string. */
export function epochToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Byte-order string compare. */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Round to `dp` decimal places. */
export function round(n: number, dp = 3): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

/** Linear-interpolated percentile over a sorted ascending array. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const val = sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  return Math.round(val * 10) / 10;
}

/** `YYYY-MM-DD` (or full ISO) -> UTC epoch; endOfDay pushes to 23:59:59.999. */
export function boundToEpoch(value: string | null, endOfDay: boolean): number | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const base = Date.parse(value + "T00:00:00Z");
    if (Number.isNaN(base)) return null;
    return endOfDay ? base + 24 * 3600 * 1000 - 1 : base;
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}
