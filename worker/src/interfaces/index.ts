// Shared interfaces: domain shapes, DB rows, payloads and the Worker env.

import type { StatusClass } from "../types";

// Cleaning stage

/** One de-duplicated, normalized checkpoint. */
export interface CleanCheck {
  service_id: string;
  service_name: string;
  epoch_ms: number;
  status_code: number;
  latency_ms: number | null;
  status_class: StatusClass;
  region: string;
  agent_count: number;
}

/** Count of each data-quality issue found. */
export interface Issues {
  rows_raw: number;
  rows_parsed: number;
  rows_clean: number;
  malformed_rows: number;
  unix_timestamps: number;
  unparseable_timestamps: number;
  latency_in_seconds: number;
  latency_missing: number;
  latency_negative: number;
  invalid_status: number;
  duplicate_checkpoints: number;
}

/** A service id + display name. */
export interface ServiceRef {
  id: string;
  name: string;
}

export interface CleanResult {
  checks: CleanCheck[];
  issues: Issues;
  date_start: string;
  date_end: string;
  day_count: number;
  services: ServiceRef[];
}

export interface NormalizedTimestamp {
  ms: number | null;
  wasUnix: boolean;
}

export interface NormalizedLatency {
  ms: number | null;
  wasSeconds: boolean;
  wasMissing: boolean;
  wasNegative: boolean;
}

/** Accumulator that merges duplicate agent reports of one checkpoint. */
export interface CheckpointAcc {
  service_id: string;
  service_name: string;
  epoch_ms: number;
  region: string;
  statuses: number[];
  latSum: number;
  latN: number;
  agent_count: number;
}

// Stats stage

export interface Incident {
  start: string;
  end: string;
  checkpoints: number;
  minutes: number;
}

export interface ServiceStats {
  service_id: string;
  service_name: string;
  total_checks: number;
  up_checks: number;
  down_checks: number;
  invalid_checks: number;
  availability_pct: number;
  sla_target_pct: number;
  sla_breached: boolean;
  credit_pct: number;
  incident_count: number;
  downtime_minutes: number;
  longest_incident_minutes: number;
  incidents: Incident[];
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  latency_p99_ms: number | null;
  latency_avg_ms: number | null;
}

export interface WorstService {
  service_id: string;
  service_name: string;
  availability_pct: number;
}

export interface OverallStats {
  services: number;
  total_checkpoints: number;
  availability_pct: number;
  services_breaching_sla: number;
  total_downtime_minutes: number;
  total_incidents: number;
  worst_service: WorstService | null;
}

export interface DashboardStats {
  sla_target_pct: number;
  overall: OverallStats;
  services: ServiceStats[];
}

// HTTP + persistence

/** Worker bindings (wrangler.toml). */
export interface Env {
  DB: D1Database;
}

export interface UploadedCsv {
  text: string;
  filename: string;
}

/** Minimal File-like shape from multipart form data. */
export interface MultipartFileEntry {
  text?: () => Promise<string>;
  name?: string;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/** Payload for inserting one processed upload. */
export interface UploadInsert {
  id: string;
  filename: string;
  uploadedAt: string;
  result: CleanResult;
  stats: DashboardStats;
}

export interface UploadListRow {
  id: string;
  filename: string;
  uploaded_at: string;
  date_start: string;
  date_end: string;
  day_count: number;
  rows_raw: number;
  rows_clean: number;
}

export interface UploadStatsRow extends UploadListRow {
  issues_json: string;
  stats_json: string;
}

export interface LogQuery {
  uploadId: string;
  from: number | null;
  to: number | null;
  service: string | null;
  status: string | null;
  page: number;
  pageSize: number;
}

export interface LogQueryResult {
  total: number;
  rows: CleanCheck[];
}

export interface CountRow {
  n: number;
}

/** A log row as sent to the client (ISO timestamp, no epoch). */
export interface LogRowDto {
  service_id: string;
  service_name: string;
  timestamp: string;
  status_code: number;
  latency_ms: number | null;
  status_class: StatusClass;
  region: string;
  agent_count: number;
}
