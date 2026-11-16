import { useState } from "react";
import type { ServiceCardProps } from "../interfaces";
import { availabilityTone, slaBadge } from "../helpers";
import { formatIncidentTime, formatLatencyCompact, formatMinutes, formatPct } from "../utils";
import { Metric } from "./Metric";

/** Per-service card with collapsible incidents. */
export function ServiceCard({ service }: ServiceCardProps) {
  const [open, setOpen] = useState(false);
  const badge = slaBadge(service);

  return (
    <div className={`svc-card ${availabilityTone(service.availability_pct, service.sla_target_pct)}`}>
      <div className="svc-head">
        <div>
          <div className="svc-name">{service.service_name}</div>
          <div className="svc-id">{service.service_id}</div>
        </div>
        <div className="svc-avail">
          <span className="avail-num">{formatPct(service.availability_pct)}</span>
          <span className={`badge ${badge.tone}`}>{badge.label}</span>
        </div>
      </div>

      <div className="svc-metrics">
        <Metric label="Up / Down" value={`${service.up_checks} / ${service.down_checks}`} />
        <Metric label="Incidents" value={String(service.incident_count)} />
        <Metric label="Downtime" value={formatMinutes(service.downtime_minutes)} />
        <Metric label="Longest" value={formatMinutes(service.longest_incident_minutes)} />
        <Metric label="p50 lat" value={formatLatencyCompact(service.latency_p50_ms)} />
        <Metric label="p95 lat" value={formatLatencyCompact(service.latency_p95_ms)} />
        <Metric label="p99 lat" value={formatLatencyCompact(service.latency_p99_ms)} />
        {service.invalid_checks > 0 && <Metric label="Invalid" value={String(service.invalid_checks)} />}
      </div>

      {service.incidents.length > 0 && (
        <div className="svc-incidents">
          <button className="link" onClick={() => setOpen((o) => !o)}>
            {open ? "v" : ">"} {service.incidents.length} incident{service.incidents.length > 1 ? "s" : ""}
          </button>
          {open && (
            <ul>
              {service.incidents
                .slice()
                .sort((a, b) => b.minutes - a.minutes)
                .map((inc, i) => (
                  <li key={i}>
                    <code>{formatIncidentTime(inc.start)}</code> | {formatMinutes(inc.minutes)} |{" "}
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
