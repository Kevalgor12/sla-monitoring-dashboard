-- D1 (SQLite) schema. One `uploads` row per CSV; many cleaned `checks` rows.

CREATE TABLE IF NOT EXISTS uploads (
  id             TEXT PRIMARY KEY,          -- uuid
  filename       TEXT NOT NULL,
  uploaded_at    TEXT NOT NULL,             -- ISO 8601 UTC
  date_start     TEXT NOT NULL,             -- first check (ISO)
  date_end       TEXT NOT NULL,             -- last check (ISO)
  day_count      INTEGER NOT NULL,
  rows_raw       INTEGER NOT NULL,          -- lines in the uploaded file
  rows_clean     INTEGER NOT NULL,          -- checkpoints after cleaning + dedupe
  issues_json    TEXT NOT NULL,             -- data-quality issue counts
  stats_json     TEXT NOT NULL              -- precomputed dashboard stats
);

CREATE TABLE IF NOT EXISTS checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id     TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  service_id    TEXT NOT NULL,
  service_name  TEXT NOT NULL,
  epoch_ms      INTEGER NOT NULL,           -- UTC instant; ISO derived on read
  status_code   INTEGER NOT NULL,
  latency_ms    REAL,                       -- ms; NULL when missing/invalid
  status_class  TEXT NOT NULL,             -- 'up' | 'down' | 'invalid'
  region        TEXT,
  agent_count   INTEGER NOT NULL DEFAULT 1  -- agent readings merged into this check
);

CREATE INDEX IF NOT EXISTS idx_checks_upload       ON checks(upload_id);
CREATE INDEX IF NOT EXISTS idx_checks_upload_epoch ON checks(upload_id, epoch_ms);
CREATE INDEX IF NOT EXISTS idx_checks_service      ON checks(upload_id, service_id);
