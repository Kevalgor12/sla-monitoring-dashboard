// Shared interfaces: API response shapes and component props.

import type { AvailabilityTone, LogDateMode, StatusClass } from "../types";

// API shapes (mirror the Worker)

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

export interface Incident {
  start: string;
  end: string;
  checkpoints: number;
  minutes: number;
}

export interface WorstService {
  service_id: string;
  service_name: string;
  availability_pct: number;
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

export interface UploadMeta {
  id: string;
  filename: string;
  uploaded_at: string;
  date_start: string;
  date_end: string;
  day_count: number;
  rows_raw: number;
  rows_clean: number;
}

export interface LogRow {
  service_id: string;
  service_name: string;
  timestamp: string;
  status_code: number;
  latency_ms: number | null;
  status_class: StatusClass;
  region: string;
  agent_count: number;
}

export interface LogsPage {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  rows: LogRow[];
}

export interface UploadResponse {
  uploadId: string;
  filename: string;
  uploaded_at: string;
  date_start: string;
  date_end: string;
  day_count: number;
  issues: Issues;
  stats: DashboardStats;
}

export interface LogFilters {
  from?: string;
  to?: string;
  service?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface ApiErrorBody {
  error?: string;
}

export interface UploadsResponse {
  uploads: UploadMeta[];
}

export interface StatsResponse {
  upload: UploadMeta;
  issues: Issues;
  stats: DashboardStats;
}

// UI + component props

/** The currently-selected dataset. */
export interface ActiveDataset {
  meta: UploadMeta;
  issues: Issues;
  stats: DashboardStats;
}

export interface UploadPanelProps {
  uploads: UploadMeta[];
  activeId: string | null;
  onUploaded: (resp: UploadResponse) => void;
  onSelect: (id: string) => void;
  onError: (msg: string) => void;
}

export interface StatsSectionProps {
  meta: UploadMeta;
  issues: Issues;
  stats: DashboardStats;
}

export interface ServiceCardProps {
  service: ServiceStats;
}

export interface MetricProps {
  label: string;
  value: string;
}

export interface SummaryProps {
  label: string;
  value: string;
  sub?: string;
  big?: boolean;
  tone?: AvailabilityTone | "";
}

export interface LogsViewProps {
  uploadId: string;
  services: ServiceStats[];
}

/** One data-quality chip. */
export interface IssueItem {
  label: string;
  n: number;
}

/** An Issues field and its chip label. */
export interface DataQualityField {
  key: keyof Issues;
  label: string;
}

/** SLA badge label + tone for a service. */
export interface SlaBadge {
  label: string;
  tone: AvailabilityTone;
}

/** Result of validating a selected upload file. */
export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

/** Logs filter UI state passed to buildLogFilters(). */
export interface LogFilterInput {
  mode: LogDateMode;
  day: string;
  from: string;
  to: string;
  service: string;
  status: string;
  page: number;
}
