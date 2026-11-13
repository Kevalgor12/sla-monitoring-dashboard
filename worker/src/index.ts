/**
 * index.ts — the Worker entry point. THIS is the stateless serverless function.
 *
 * Flow:
 *   POST /api/upload                  raw CSV  -> parse/clean/validate -> D1 -> stats
 *   GET  /api/uploads                 list processed uploads (newest first)
 *   GET  /api/uploads/:id/stats       the precomputed dashboard stats
 *   GET  /api/uploads/:id/logs        paginated, date/service/status-filterable checks
 *   GET  /api/health                  liveness
 *
 * The heavy CPU work (parse + clean + stats) runs once per upload — an infrequent
 * operation. D1 writes/reads are I/O and do not count toward the Worker CPU budget.
 */

import { clean, epochToIso } from "./clean.ts";
import { computeStats } from "./stats.ts";

export interface Env {
  DB: D1Database;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/api/health") return json({ ok: true, now: new Date().toISOString() });

      if (path === "/api/upload" && request.method === "POST") return await handleUpload(request, env, url);

      if (path === "/api/uploads" && request.method === "GET") return await listUploads(env);

      const m = path.match(/^\/api\/uploads\/([^/]+)\/(stats|logs)$/);
      if (m && request.method === "GET") {
        const uploadId = decodeURIComponent(m[1]);
        return m[2] === "stats" ? await getStats(env, uploadId) : await getLogs(env, uploadId, url);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: "Internal error", detail: (err as Error).message }, 500);
    }
  },
};

/** Read the uploaded CSV text whether it arrives as a raw body or multipart/form-data. */
async function readCsv(request: Request, url: URL): Promise<{ text: string; filename: string }> {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const entry = form.get("file") as unknown as { text?: () => Promise<string>; name?: string } | null;
    if (entry && typeof entry.text === "function") {
      return { text: await entry.text(), filename: entry.name || "upload.csv" };
    }
  }
  const text = await request.text();
  const filename = url.searchParams.get("filename") || "upload.csv";
  return { text, filename };
}

async function handleUpload(request: Request, env: Env, url: URL): Promise<Response> {
  const { text, filename } = await readCsv(request, url);
  if (!text || text.trim() === "") return json({ error: "Empty upload" }, 400);

  const result = clean(text);
  if (result.checks.length === 0) {
    return json({ error: "No usable rows found. Is this a monitoring-checks CSV?", issues: result.issues }, 422);
  }
  const stats = computeStats(result.checks);

  const uploadId = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();

  // 1) the upload header row
  await env.DB.prepare(
    `INSERT INTO uploads
       (id, filename, uploaded_at, date_start, date_end, day_count, rows_raw, rows_clean, issues_json, stats_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      uploadId,
      filename,
      uploadedAt,
      result.date_start,
      result.date_end,
      result.day_count,
      result.issues.rows_raw,
      result.issues.rows_clean,
      JSON.stringify(result.issues),
      JSON.stringify(stats)
    )
    .run();

  // 2) the cleaned checks — multi-row INSERTs (<=100 bound params/statement on D1),
  //    grouped into batches to stay well under the 50-subrequest/invocation limit.
  const ROWS_PER_STMT = 10; // 10 * 9 cols = 90 params (< 100)
  const STMTS_PER_BATCH = 100;
  const insertHead =
    "INSERT INTO checks (upload_id, service_id, service_name, epoch_ms, status_code, latency_ms, status_class, region, agent_count) VALUES ";
  const rowPlaceholder = "(?,?,?,?,?,?,?,?,?)";

  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < result.checks.length; i += ROWS_PER_STMT) {
    const slice = result.checks.slice(i, i + ROWS_PER_STMT);
    const sql = insertHead + slice.map(() => rowPlaceholder).join(",");
    const binds: (string | number | null)[] = [];
    for (const c of slice) {
      binds.push(
        uploadId,
        c.service_id,
        c.service_name,
        c.epoch_ms,
        c.status_code,
        c.latency_ms,
        c.status_class,
        c.region,
        c.agent_count
      );
    }
    statements.push(env.DB.prepare(sql).bind(...binds));
  }
  for (let i = 0; i < statements.length; i += STMTS_PER_BATCH) {
    await env.DB.batch(statements.slice(i, i + STMTS_PER_BATCH));
  }

  return json({
    uploadId,
    filename,
    uploaded_at: uploadedAt,
    date_start: result.date_start,
    date_end: result.date_end,
    day_count: result.day_count,
    issues: result.issues,
    stats,
  });
}

async function listUploads(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, filename, uploaded_at, date_start, date_end, day_count, rows_raw, rows_clean
       FROM uploads ORDER BY uploaded_at DESC LIMIT 100`
  ).all();
  return json({ uploads: results ?? [] });
}

async function getStats(env: Env, uploadId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, filename, uploaded_at, date_start, date_end, day_count, rows_raw, rows_clean, issues_json, stats_json
       FROM uploads WHERE id = ?`
  )
    .bind(uploadId)
    .first();
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
    issues: JSON.parse(row.issues_json as string),
    stats: JSON.parse(row.stats_json as string),
  });
}

/** Parse a `YYYY-MM-DD` (or full ISO) into a UTC epoch. `endOfDay` pushes to 23:59:59.999. */
function boundToEpoch(value: string | null, endOfDay: boolean): number | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const base = Date.parse(value + "T00:00:00Z");
    if (Number.isNaN(base)) return null;
    return endOfDay ? base + 24 * 3600 * 1000 - 1 : base;
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

async function getLogs(env: Env, uploadId: string, url: URL): Promise<Response> {
  const from = boundToEpoch(url.searchParams.get("from"), false);
  const to = boundToEpoch(url.searchParams.get("to"), true);
  const service = url.searchParams.get("service");
  const status = url.searchParams.get("status"); // up | down | invalid
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));

  const where: string[] = ["upload_id = ?"];
  const args: (string | number)[] = [uploadId];
  if (from !== null) {
    where.push("epoch_ms >= ?");
    args.push(from);
  }
  if (to !== null) {
    where.push("epoch_ms <= ?");
    args.push(to);
  }
  if (service) {
    where.push("service_id = ?");
    args.push(service);
  }
  if (status) {
    where.push("status_class = ?");
    args.push(status);
  }
  const whereSql = where.join(" AND ");

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM checks WHERE ${whereSql}`)
    .bind(...args)
    .first<{ n: number }>();
  const total = countRow?.n ?? 0;

  const { results } = await env.DB.prepare(
    `SELECT service_id, service_name, epoch_ms, status_code, latency_ms, status_class, region, agent_count
       FROM checks WHERE ${whereSql}
       ORDER BY epoch_ms ASC, service_id ASC
       LIMIT ? OFFSET ?`
  )
    .bind(...args, pageSize, (page - 1) * pageSize)
    .all();

  const rows = (results ?? []).map((r) => ({
    service_id: r.service_id,
    service_name: r.service_name,
    timestamp: epochToIso(r.epoch_ms as number),
    status_code: r.status_code,
    latency_ms: r.latency_ms,
    status_class: r.status_class,
    region: r.region,
    agent_count: r.agent_count,
  }));

  return json({ total, page, pageSize, pages: Math.ceil(total / pageSize), rows });
}
