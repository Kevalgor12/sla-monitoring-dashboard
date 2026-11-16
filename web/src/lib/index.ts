// API client - talks to the Worker over HTTP.

import { API_BASE, DEFAULT_PAGE_SIZE } from "../constants";
import type {
  ApiErrorBody,
  LogFilters,
  LogsPage,
  StatsResponse,
  UploadMeta,
  UploadResponse,
  UploadsResponse,
} from "../interfaces";

/** Parse JSON, throwing the Worker's error message on failure. */
async function asJson<T>(res: Response): Promise<T> {
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as ApiErrorBody).error;
    throw new Error(message || `Request failed (${res.status})`);
  }
  return body as T;
}

/** POST a raw CSV -> cleaned, persisted, stats returned. */
export async function uploadCsv(file: File): Promise<UploadResponse> {
  const res = await fetch(`${API_BASE}/api/upload?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    body: file,
  });
  return asJson<UploadResponse>(res);
}

/** List processed datasets (newest first). */
export async function listUploads(): Promise<UploadMeta[]> {
  const res = await fetch(`${API_BASE}/api/uploads`);
  const body = await asJson<UploadsResponse>(res);
  return body.uploads;
}

/** Stored dashboard stats for one dataset. */
export async function getStats(id: string): Promise<StatsResponse> {
  const res = await fetch(`${API_BASE}/api/uploads/${encodeURIComponent(id)}/stats`);
  return asJson<StatsResponse>(res);
}

/** A filtered, paginated page of cleaned checks. */
export async function getLogs(id: string, filters: LogFilters): Promise<LogsPage> {
  const qs = new URLSearchParams();
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.service) qs.set("service", filters.service);
  if (filters.status) qs.set("status", filters.status);
  qs.set("page", String(filters.page ?? 1));
  qs.set("pageSize", String(filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const res = await fetch(`${API_BASE}/api/uploads/${encodeURIComponent(id)}/logs?${qs}`);
  return asJson<LogsPage>(res);
}
