import { useEffect, useState } from "react";
import { LogsPage, ServiceStats, getLogs } from "../api.ts";

type Mode = "all" | "single" | "range";

export function LogsView({ uploadId, services }: { uploadId: string; services: ServiceStats[] }) {
  const [mode, setMode] = useState<Mode>("all");
  const [day, setDay] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [service, setService] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LogsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // reset to page 1 whenever a filter changes
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
    const filters =
      mode === "single"
        ? { from: day || undefined, to: day || undefined }
        : mode === "range"
          ? { from: from || undefined, to: to || undefined }
          : {};
    getLogs(uploadId, { ...filters, service: service || undefined, status: status || undefined, page, pageSize: 50 })
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
        {data && <span className="period">{data.total.toLocaleString()} records</span>}
      </div>

      <div className="filters">
        <div className="filter">
          <label>Date</label>
          <select value={mode} onChange={(e) => changed<Mode>(setMode)(e.target.value as Mode)}>
            <option value="all">All dates</option>
            <option value="single">Single day</option>
            <option value="range">Date range</option>
          </select>
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
          <select value={service} onChange={(e) => changed(setService)(e.target.value)}>
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s.service_id} value={s.service_id}>
                {s.service_name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter">
          <label>Status</label>
          <select value={status} onChange={(e) => changed(setStatus)(e.target.value)}>
            <option value="">All</option>
            <option value="up">Up</option>
            <option value="down">Down (5xx)</option>
            <option value="invalid">Invalid</option>
          </select>
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
                <td className="mono">{r.timestamp.replace("T", " ").replace(".000Z", "")}</td>
                <td>{r.service_name}</td>
                <td>
                  <span className={`badge ${r.status_class}`}>{r.status_code}</span>
                </td>
                <td className="mono">{r.latency_ms != null ? `${r.latency_ms} ms` : "—"}</td>
                <td>{r.region || "—"}</td>
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
        {loading && <div className="table-loading">Loading…</div>}
      </div>

      {data && data.pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </button>
          <span>
            Page {data.page} of {data.pages}
          </span>
          <button className="btn" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </section>
  );
}
