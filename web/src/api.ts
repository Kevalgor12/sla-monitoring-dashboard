// API client + shared types. Mirrors the Worker's response shapes.

export const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8787").replace(/\/$/, "");

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
  worst_service: { service_id: string; service_name: string; availability_pct: number } | null;
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
  status_class: "up" | "down" | "invalid";
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

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
}

export async function uploadCsv(file: File): Promise<UploadResponse> {
  const res = await fetch(`${API_BASE}/api/upload?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    body: file,
  });
  return asJson<UploadResponse>(res);
}

export async function listUploads(): Promise<UploadMeta[]> {
  const res = await fetch(`${API_BASE}/api/uploads`);
  const body = await asJson<{ uploads: UploadMeta[] }>(res);
  return body.uploads;
}

export async function getStats(
  id: string
): Promise<{ upload: UploadMeta; issues: Issues; stats: DashboardStats }> {
  const res = await fetch(`${API_BASE}/api/uploads/${encodeURIComponent(id)}/stats`);
  return asJson(res);
}

export interface LogFilters {
  from?: string;
  to?: string;
  service?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function getLogs(id: string, filters: LogFilters): Promise<LogsPage> {
  const qs = new URLSearchParams();
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.service) qs.set("service", filters.service);
  if (filters.status) qs.set("status", filters.status);
  qs.set("page", String(filters.page ?? 1));
  qs.set("pageSize", String(filters.pageSize ?? 50));
  const res = await fetch(`${API_BASE}/api/uploads/${encodeURIComponent(id)}/logs?${qs}`);
  return asJson<LogsPage>(res);
}
