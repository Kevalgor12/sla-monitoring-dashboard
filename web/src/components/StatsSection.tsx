import { useState } from "react";
import { DashboardStats, Issues, ServiceStats, UploadMeta } from "../api.ts";

function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "—";
}
function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
function availClass(pct: number, target: number): string {
  if (pct >= target) return "ok";
  if (pct >= 99) return "warn";
  return "bad";
}

function ServiceCard({ s }: { s: ServiceStats }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`svc-card ${availClass(s.availability_pct, s.sla_target_pct)}`}>
      <div className="svc-head">
        <div>
          <div className="svc-name">{s.service_name}</div>
          <div className="svc-id">{s.service_id}</div>
        </div>
        <div className="svc-avail">
          <span className="avail-num">{s.availability_pct.toFixed(3)}%</span>
          <span className={`badge ${s.sla_breached ? "bad" : "ok"}`}>
            {s.sla_breached ? `BREACH · ${s.credit_pct}% credit` : "MEETS SLA"}
          </span>
        </div>
      </div>

      <div className="svc-metrics">
        <Metric label="Up / Down" value={`${s.up_checks} / ${s.down_checks}`} />
        <Metric label="Incidents" value={String(s.incident_count)} />
        <Metric label="Downtime" value={fmtMinutes(s.downtime_minutes)} />
        <Metric label="Longest" value={fmtMinutes(s.longest_incident_minutes)} />
        <Metric label="p50 lat" value={s.latency_p50_ms != null ? `${s.latency_p50_ms}ms` : "—"} />
        <Metric label="p95 lat" value={s.latency_p95_ms != null ? `${s.latency_p95_ms}ms` : "—"} />
        <Metric label="p99 lat" value={s.latency_p99_ms != null ? `${s.latency_p99_ms}ms` : "—"} />
        {s.invalid_checks > 0 && <Metric label="Invalid" value={String(s.invalid_checks)} />}
      </div>

      {s.incidents.length > 0 && (
        <div className="svc-incidents">
          <button className="link" onClick={() => setOpen((o) => !o)}>
            {open ? "▾" : "▸"} {s.incidents.length} incident{s.incidents.length > 1 ? "s" : ""}
          </button>
          {open && (
            <ul>
              {s.incidents
                .slice()
                .sort((a, b) => b.minutes - a.minutes)
                .map((inc, i) => (
                  <li key={i}>
                    <code>{inc.start.replace("T", " ").replace(".000Z", "Z")}</code> · {fmtMinutes(inc.minutes)} ·{" "}
                    {inc.checkpoints} failed check{inc.checkpoints > 1 ? "s" : ""}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-val">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

export function StatsSection({
  meta,
  issues,
  stats,
}: {
  meta: UploadMeta;
  issues: Issues;
  stats: DashboardStats;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const o = stats.overall;

  const issueItems: { label: string; n: number }[] = [
    { label: "Unix-epoch timestamps → ISO", n: issues.unix_timestamps },
    { label: "Latency in seconds → ms", n: issues.latency_in_seconds },
    { label: "Missing latency (kept, nulled)", n: issues.latency_missing },
    { label: "Negative latency (nulled)", n: issues.latency_negative },
    { label: "Invalid status code (excluded)", n: issues.invalid_status },
    { label: "Duplicate agent reports (merged)", n: issues.duplicate_checkpoints },
    { label: "Unparseable timestamps (dropped)", n: issues.unparseable_timestamps },
    { label: "Malformed rows (dropped)", n: issues.malformed_rows },
  ].filter((x) => x.n > 0);

  return (
    <section className="panel stats-section">
      <div className="section-head" onClick={() => setCollapsed((c) => !c)}>
        <h2>
          {collapsed ? "▸" : "▾"} Overview
        </h2>
        <span className="period">
          {fmtDate(meta.date_start)} → {fmtDate(meta.date_end)} · {meta.day_count} days · {o.total_checkpoints.toLocaleString()} checks
        </span>
      </div>

      {!collapsed && (
        <>
          <div className="summary-grid">
            <Summary big label="Overall availability" value={`${o.availability_pct.toFixed(3)}%`} tone={availClass(o.availability_pct, stats.sla_target_pct)} />
            <Summary label="Services breaching SLA" value={`${o.services_breaching_sla} / ${o.services}`} tone={o.services_breaching_sla ? "warn" : "ok"} />
            <Summary label="Total incidents" value={String(o.total_incidents)} />
            <Summary label="Total downtime" value={fmtMinutes(o.total_downtime_minutes)} />
            <Summary
              label="Worst service"
              value={o.worst_service ? `${o.worst_service.service_name}` : "—"}
              sub={o.worst_service ? `${o.worst_service.availability_pct.toFixed(2)}%` : undefined}
              tone="warn"
            />
          </div>

          <h3 className="sub-head">Per service</h3>
          <div className="svc-grid">
            {stats.services.map((s) => (
              <ServiceCard key={s.service_id} s={s} />
            ))}
          </div>

          <h3 className="sub-head">Data quality — {issues.rows_raw.toLocaleString()} raw rows → {issues.rows_clean.toLocaleString()} clean checkpoints</h3>
          <div className="issues">
            {issueItems.length === 0 && <span className="muted">No issues detected.</span>}
            {issueItems.map((it) => (
              <div key={it.label} className="issue-chip">
                <span className="issue-n">{it.n.toLocaleString()}</span> {it.label}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Summary({
  label,
  value,
  sub,
  big,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  big?: boolean;
  tone?: string;
}) {
  return (
    <div className={`summary ${big ? "big" : ""} ${tone ?? ""}`}>
      <div className="summary-val">{value}</div>
      {sub && <div className="summary-sub">{sub}</div>}
      <div className="summary-label">{label}</div>
    </div>
  );
}
