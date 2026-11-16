import { useRef, useState } from "react";
import type { UploadPanelProps } from "../interfaces";
import { uploadCsv } from "../lib";
import { validateCsvFile } from "../validations";
import { UPLOAD_HINT } from "../constants";
import { SelectBox } from "./SelectBox";

/** File picker + dataset selector. */
export function UploadPanel({ uploads, activeId, onUploaded, onSelect, onError }: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function doUpload() {
    const check = validateCsvFile(file);
    if (!check.ok) {
      onError(check.error ?? "Invalid file.");
      return;
    }
    setBusy(true);
    onError("");
    try {
      const resp = await uploadCsv(file as File);
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
          {busy ? "Processing..." : "Upload & analyze"}
        </button>

        {uploads.length > 0 && (
          <div className="dataset-select">
            <label>Dataset</label>
            <SelectBox
              value={activeId ?? ""}
              options={uploads.map((u) => ({
                value: u.id,
                label: `${u.filename} | ${u.day_count}d | ${new Date(u.uploaded_at).toLocaleString()}`,
              }))}
              onChange={onSelect}
              disabled={busy}
              ariaLabel="Dataset"
            />
          </div>
        )}
      </div>
      <p className="hint">{UPLOAD_HINT}</p>
    </section>
  );
}
