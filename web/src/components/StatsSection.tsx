import { useState } from "react";
import type { IssueItem, StatsSectionProps } from "../interfaces";
import { DATA_QUALITY_FIELDS } from "../constants";
import { availabilityTone } from "../helpers";
import { formatCount, formatIsoDate, formatMinutes, formatPct } from "../utils";
import { ServiceCard } from "./ServiceCard";
import { Summary } from "./Summary";

/** Collapsible overview: headline stats, per-service cards, data-quality chips. */
export function StatsSection({ meta, issues, stats }: StatsSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const o = stats.overall;

  const issueItems: IssueItem[] = DATA_QUALITY_FIELDS.map((f) => ({
    label: f.label,
    n: issues[f.key],
  })).filter((x) => x.n > 0);

  return (
    <section className="panel stats-section">
      <div className="section-head" onClick={() => setCollapsed((c) => !c)}>
        <h2>{collapsed ? ">" : "v"} Overview</h2>
        <span className="period">
          {formatIsoDate(meta.date_start)} to {formatIsoDate(meta.date_end)} | {meta.day_count} days |{" "}
          {formatCount(o.total_checkpoints)} checks
        </span>
      </div>

      {!collapsed && (
        <>
          <div className="summary-grid">
            <Summary
              big
              label="Overall availability"
              value={formatPct(o.availability_pct)}
              tone={availabilityTone(o.availability_pct, stats.sla_target_pct)}
            />
            <Summary
              label="Services breaching SLA"
              value={`${o.services_breaching_sla} / ${o.services}`}
              tone={o.services_breaching_sla ? "warn" : "ok"}
            />
            <Summary label="Total incidents" value={String(o.total_incidents)} />
            <Summary label="Total downtime" value={formatMinutes(o.total_downtime_minutes)} />
            <Summary
              label="Worst service"
              value={o.worst_service ? o.worst_service.service_name : "-"}
              sub={o.worst_service ? formatPct(o.worst_service.availability_pct, 2) : undefined}
              tone="warn"
            />
          </div>

          <h3 className="sub-head">Per service</h3>
          <div className="svc-grid">
            {stats.services.map((s) => (
              <ServiceCard key={s.service_id} service={s} />
            ))}
          </div>

          <h3 className="sub-head">
            Data quality - {formatCount(issues.rows_raw)} raw rows, {formatCount(issues.rows_clean)} clean checkpoints
          </h3>
          <div className="issues">
            {issueItems.length === 0 && <span className="muted">No issues detected.</span>}
            {issueItems.map((it) => (
              <div key={it.label} className="issue-chip">
                <span className="issue-n">{formatCount(it.n)}</span> {it.label}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
