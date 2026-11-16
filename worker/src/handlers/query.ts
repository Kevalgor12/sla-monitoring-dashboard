// GET handlers - list uploads, stored stats, and the filterable logs.

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants";
import { queryLogs, selectUploadById, selectUploads } from "../lib/db";
import { json } from "../lib/http";
import { boundToEpoch, epochToIso } from "../utils";
import type { Env, LogRowDto } from "../interfaces";

/** GET /api/uploads */
export async function listUploads(env: Env): Promise<Response> {
  const uploads = await selectUploads(env.DB);
  return json({ uploads });
}

/** GET /api/uploads/:id/stats */
export async function getStats(env: Env, uploadId: string): Promise<Response> {
  const row = await selectUploadById(env.DB, uploadId);
  if (!row) return json({ error: "Upload not found" }, 404);
  return json({
    upload: {
      id: row.id,
      filename: row.filename,
      uploaded_at: row.uploaded_at,
      date_start: row.date_start,
      date_end: row.date_end,
      day_count: row.day_count,
      rows_raw: row.rows_raw,
      rows_clean: row.rows_clean,
    },
    issues: JSON.parse(row.issues_json),
    stats: JSON.parse(row.stats_json),
  });
}

/** GET /api/uploads/:id/logs - date / service / status filters + pagination. */
export async function getLogs(env: Env, uploadId: string, url: URL): Promise<Response> {
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(url.searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
  );

  const { total, rows } = await queryLogs(env.DB, {
    uploadId,
    from: boundToEpoch(url.searchParams.get("from"), false),
    to: boundToEpoch(url.searchParams.get("to"), true),
    service: url.searchParams.get("service"),
    status: url.searchParams.get("status"),
    page,
    pageSize,
  });

  const mapped: LogRowDto[] = rows.map((r) => ({
    service_id: r.service_id,
    service_name: r.service_name,
    timestamp: epochToIso(r.epoch_ms),
    status_code: r.status_code,
    latency_ms: r.latency_ms,
    status_class: r.status_class,
    region: r.region,
    agent_count: r.agent_count,
  }));

  return json({ total, page, pageSize, pages: Math.ceil(total / pageSize), rows: mapped });
}
