import type { MetricProps } from "../interfaces";

/** Value + label tile. */
export function Metric({ label, value }: MetricProps) {
  return (
    <div className="metric">
      <div className="metric-val">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}
