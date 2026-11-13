import { useRef, useState } from "react";
import { UploadMeta, UploadResponse, uploadCsv } from "../api.ts";

interface Props {
  uploads: UploadMeta[];
  activeId: string | null;
  onUploaded: (resp: UploadResponse) => void;
  onSelect: (id: string) => void;
  onError: (msg: string) => void;
}

export function UploadPanel({ uploads, activeId, onUploaded, onSelect, onError }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function doUpload() {
    if (!file) return;
    setBusy(true);
    onError("");
    try {
      const resp = await uploadCsv(file);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onUploaded(resp);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel upload-panel">
      <div className="upload-row">
        <label className="file-field">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
        </label>
        <button className="btn primary" onClick={doUpload} disabled={!file || busy}>
          {busy ? "Processing…" : "Upload & analyze"}
        </button>

        {uploads.length > 0 && (
          <div className="dataset-select">
            <label htmlFor="dataset">Dataset</label>
            <select
              id="dataset"
              value={activeId ?? ""}
              onChange={(e) => onSelect(e.target.value)}
              disabled={busy}
            >
              {uploads.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.filename} · {u.day_count}d · {new Date(u.uploaded_at).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p className="hint">
        The CSV is sent to a Cloudflare Worker that parses, validates and de-duplicates it, then stores the
        cleaned checks in D1. Large files (e.g. the 30-day set) may take a moment.
      </p>
    </section>
  );
}
