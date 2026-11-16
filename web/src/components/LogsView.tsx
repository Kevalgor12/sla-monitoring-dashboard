import { useEffect, useState } from "react";
import type { LogsPage, LogsViewProps } from "../interfaces";
import type { LogDateMode } from "../types";
import { getLogs } from "../lib";
import { buildLogFilters } from "../helpers";
import { formatCount, formatLatency, formatTimestamp } from "../utils";
import { LOG_DATE_MODES, LOG_STATUS_OPTIONS } from "../constants";
import { SelectBox } from "./SelectBox";

/** Filterable, paginated log table. */
export function LogsView({ uploadId, services }: LogsViewProps) {
  const [mode, setMode] = useState<LogDateMode>("all");
  const [day, setDay] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [service, setService] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LogsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // reset to page 1 on any filter change
  function changed<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    getLogs(uploadId, buildLogFilters({ mode, day, from, to, service, status, page }))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => !cancelled && setErr((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [uploadId, mode, day, from, to, service, status, page]);

  return (
    <section className="panel logs-section">
      <div className="section-head static">
        <h2>Check logs</h2>
        {data && <span className="period">{formatCount(data.total)} records</span>}
      </div>

      <div className="filters">
        <div className="filter">
          <label>Date</label>
          <SelectBox
            value={mode}
            options={LOG_DATE_MODES.map((m) => ({ value: m.value, label: m.label }))}
            onChange={(v) => changed<LogDateMode>(setMode)(v as LogDateMode)}
            ariaLabel="Date filter mode"
          />
        </div>

        {mode === "single" && (
          <div className="filter">
            <label>Day</label>
            <input type="date" value={day} onChange={(e) => changed(setDay)(e.target.value)} />
          </div>
        )}
        {mode === "range" && (
          <>
            <div className="filter">
              <label>From</label>
              <input type="date" value={from} onChange={(e) => changed(setFrom)(e.target.value)} />
            </div>
            <div className="filter">
              <label>To</label>
              <input type="date" value={to} onChange={(e) => changed(setTo)(e.target.value)} />
            </div>
          </>
        )}

        <div className="filter">
          <label>Service</label>
          <SelectBox
            value={service}
            options={[
              { value: "", label: "All services" },
              ...services.map((s) => ({ value: s.service_id, label: s.service_name })),
            ]}
            onChange={(v) => changed(setService)(v)}
            ariaLabel="Service filter"
          />
        </div>

        <div className="filter">
          <label>Status</label>
          <SelectBox
            value={status}
            options={LOG_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => changed(setStatus)(v)}
            ariaLabel="Status filter"
          />
        </div>
      </div>

      {err && <div className="banner error">{err}</div>}

      <div className="table-wrap">
        <table className="logs-table">
          <thead>
            <tr>
              <th>Timestamp (UTC)</th>
              <th>Service</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Region</th>
              <th>Agents</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r, i) => (
              <tr key={i} className={r.status_class}>
                <td className="mono">{formatTimestamp(r.timestamp)}</td>
                <td>{r.service_name}</td>
                <td>
                  <span className={`badge ${r.status_class}`}>{r.status_code}</span>
                </td>
                <td className="mono">{formatLatency(r.latency_ms)}</td>
                <td>{r.region || "-"}</td>
                <td>{r.agent_count}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="muted center">
                  No records match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </button>
          <span>
            Page {data.page} of {data.pages}
          </span>
          <button className="btn" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}

      {loading && (
        <div className="section-loading" aria-live="polite" aria-busy="true">
          <span className="spinner" />
        </div>
      )}
    </section>
  );
}
