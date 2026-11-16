import { useEffect, useState } from "react";
import type { ActiveDataset, UploadMeta } from "../interfaces";
import { getStats, listUploads } from "../lib";
import { APP_FOOTER_NOTE, APP_SUBTITLE, APP_TITLE } from "../constants";
import { UploadPanel } from "../components/UploadPanel";
import { StatsSection } from "../components/StatsSection";
import { LogsView } from "../components/LogsView";

/** The single-screen dashboard. */
export function DashboardPage() {
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  const [active, setActive] = useState<ActiveDataset | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function refreshList(selectId?: string) {
    const list = await listUploads();
    setUploads(list);
    const pick = selectId ?? list[0]?.id;
    if (pick) await loadDataset(pick);
  }

  useEffect(() => {
    refreshList().catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>{APP_TITLE}</h1>
          <p className="subtitle">{APP_SUBTITLE}</p>
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
      {loading && (
        <div className="page-loading">
          <span className="spinner" />
        </div>
      )}

      {active && !loading && (
        <>
          <StatsSection meta={active.meta} issues={active.issues} stats={active.stats} />
          <LogsView uploadId={active.meta.id} services={active.stats.services} />
        </>
      )}

      {!active && !loading && !error && (
        <div className="empty">No datasets yet. Upload a monitoring-checks CSV to begin.</div>
      )}

      <footer className="app-footer">{APP_FOOTER_NOTE}</footer>
    </div>
  );
}
