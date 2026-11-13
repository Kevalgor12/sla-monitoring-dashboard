import { useEffect, useState } from "react";
import {
  DashboardStats,
  Issues,
  UploadMeta,
  getStats,
  listUploads,
} from "./api.ts";
import { UploadPanel } from "./components/UploadPanel.tsx";
import { StatsSection } from "./components/StatsSection.tsx";
import { LogsView } from "./components/LogsView.tsx";

interface Active {
  meta: UploadMeta;
  issues: Issues;
  stats: DashboardStats;
}

export function App() {
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshList(selectId?: string) {
    const list = await listUploads();
    setUploads(list);
    const pick = selectId ?? list[0]?.id;
    if (pick) await loadDataset(pick);
  }

  async function loadDataset(id: string) {
    setLoading(true);
    setError(null);
    try {
      const { upload, issues, stats } = await getStats(id);
      setActive({ meta: upload, issues, stats });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshList().catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>SLA Monitoring Dashboard</h1>
          <p className="subtitle">
            Upload health-check logs → clean &amp; validate in a serverless function → review availability, SLA
            credits and incidents.
          </p>
        </div>
      </header>

      <UploadPanel
        uploads={uploads}
        activeId={active?.meta.id ?? null}
        onUploaded={(resp) => refreshList(resp.uploadId)}
        onSelect={(id) => loadDataset(id)}
        onError={setError}
      />

      {error && <div className="banner error">{error}</div>}
      {loading && <div className="banner">Loading…</div>}

      {active && !loading && (
        <>
          <StatsSection meta={active.meta} issues={active.issues} stats={active.stats} />
          <LogsView uploadId={active.meta.id} services={active.stats.services} />
        </>
      )}

      {!active && !loading && !error && (
        <div className="empty">No datasets yet. Upload a monitoring-checks CSV to begin.</div>
      )}

      <footer className="app-footer">
        Availability counts every 15-minute window a service returned 5xx. SLA target 99.9%. See the README for
        assumptions.
      </footer>
    </div>
  );
}
