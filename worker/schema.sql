-- D1 (SQLite) schema for the SLA monitoring dashboard.
-- One `uploads` row per processed CSV; many `checks` rows (cleaned, de-duplicated).

CREATE TABLE IF NOT EXISTS uploads (
  id             TEXT PRIMARY KEY,          -- uuid
  filename       TEXT NOT NULL,
  uploaded_at    TEXT NOT NULL,             -- ISO 8601 UTC
  date_start     TEXT NOT NULL,             -- first check in the data (ISO)
  date_end       TEXT NOT NULL,             -- last check in the data (ISO)
  day_count      INTEGER NOT NULL,
  rows_raw       INTEGER NOT NULL,          -- lines in the uploaded file
  rows_clean     INTEGER NOT NULL,          -- checkpoints after cleaning + dedupe
  issues_json    TEXT NOT NULL,             -- data-quality issue counts (what we fixed)
  stats_json     TEXT NOT NULL              -- precomputed dashboard stats
);

CREATE TABLE IF NOT EXISTS checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id     TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  service_id    TEXT NOT NULL,
  service_name  TEXT NOT NULL,
  epoch_ms      INTEGER NOT NULL,           -- UTC instant; ISO is derived on read (keeps ingest CPU low)
  status_code   INTEGER NOT NULL,
  latency_ms    REAL,                       -- normalized to ms; NULL when missing/invalid
  status_class  TEXT NOT NULL,             -- 'up' | 'down' | 'invalid'
  region        TEXT,
  agent_count   INTEGER NOT NULL DEFAULT 1  -- how many agent readings were merged
);

CREATE INDEX IF NOT EXISTS idx_checks_upload       ON checks(upload_id);
CREATE INDEX IF NOT EXISTS idx_checks_upload_epoch ON checks(upload_id, epoch_ms);
CREATE INDEX IF NOT EXISTS idx_checks_service      ON checks(upload_id, service_id);
