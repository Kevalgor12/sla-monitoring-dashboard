import type { SummaryProps } from "../interfaces";

/** Headline number tile in the overview grid. */
export function Summary({ label, value, sub, big, tone }: SummaryProps) {
  return (
    <div className={`summary ${big ? "big" : ""} ${tone ?? ""}`}>
      <div className="summary-val">{value}</div>
      {sub && <div className="summary-sub">{sub}</div>}
      <div className="summary-label">{label}</div>
    </div>
  );
}
