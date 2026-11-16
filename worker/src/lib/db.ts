// D1 data access. All SQL lives here.

import { ROWS_PER_STMT, STMTS_PER_BATCH, UPLOADS_LIST_LIMIT } from "../constants";
import type {
  CleanCheck,
  CountRow,
  LogQuery,
  LogQueryResult,
  UploadInsert,
  UploadListRow,
  UploadStatsRow,
} from "../interfaces";

/** Insert the upload header row. */
export async function insertUpload(db: D1Database, u: UploadInsert): Promise<void> {
  await db
    .prepare(
      `INSERT INTO uploads
         (id, filename, uploaded_at, date_start, date_end, day_count, rows_raw, rows_clean, issues_json, stats_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      u.id,
      u.filename,
      u.uploadedAt,
      u.result.date_start,
      u.result.date_end,
      u.result.day_count,
      u.result.issues.rows_raw,
      u.result.issues.rows_clean,
      JSON.stringify(u.result.issues),
      JSON.stringify(u.stats)
    )
    .run();
}

/** Insert cleaned checks as batched multi-row INSERTs. */
export async function insertChecks(db: D1Database, uploadId: string, checks: CleanCheck[]): Promise<void> {
  const insertHead =
    "INSERT INTO checks (upload_id, service_id, service_name, epoch_ms, status_code, latency_ms, status_class, region, agent_count) VALUES ";
  const rowPlaceholder = "(?,?,?,?,?,?,?,?,?)";

  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < checks.length; i += ROWS_PER_STMT) {
    const slice = checks.slice(i, i + ROWS_PER_STMT);
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
    statements.push(db.prepare(sql).bind(...binds));
  }
  for (let i = 0; i < statements.length; i += STMTS_PER_BATCH) {
    await db.batch(statements.slice(i, i + STMTS_PER_BATCH));
  }
}

/** List uploads, newest first. */
export async function selectUploads(db: D1Database): Promise<UploadListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, filename, uploaded_at, date_start, date_end, day_count, rows_raw, rows_clean
         FROM uploads ORDER BY uploaded_at DESC LIMIT ?`
    )
    .bind(UPLOADS_LIST_LIMIT)
    .all<UploadListRow>();
  return results ?? [];
}

/** One upload's stored meta + issues/stats JSON. */
export async function selectUploadById(db: D1Database, id: string): Promise<UploadStatsRow | null> {
  const row = await db
    .prepare(
      `SELECT id, filename, uploaded_at, date_start, date_end, day_count, rows_raw, rows_clean, issues_json, stats_json
         FROM uploads WHERE id = ?`
    )
    .bind(id)
    .first<UploadStatsRow>();
  return row ?? null;
}

/** Count + fetch a filtered, paginated page of checks. */
export async function queryLogs(db: D1Database, q: LogQuery): Promise<LogQueryResult> {
  const where: string[] = ["upload_id = ?"];
  const args: (string | number)[] = [q.uploadId];
  if (q.from !== null) {
    where.push("epoch_ms >= ?");
    args.push(q.from);
  }
  if (q.to !== null) {
    where.push("epoch_ms <= ?");
    args.push(q.to);
  }
  if (q.service) {
    where.push("service_id = ?");
    args.push(q.service);
  }
  if (q.status) {
    where.push("status_class = ?");
    args.push(q.status);
  }
  const whereSql = where.join(" AND ");

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM checks WHERE ${whereSql}`)
    .bind(...args)
    .first<CountRow>();
  const total = countRow?.n ?? 0;

  const { results } = await db
    .prepare(
      `SELECT service_id, service_name, epoch_ms, status_code, latency_ms, status_class, region, agent_count
         FROM checks WHERE ${whereSql}
         ORDER BY epoch_ms ASC, service_id ASC
         LIMIT ? OFFSET ?`
    )
    .bind(...args, q.pageSize, (q.page - 1) * q.pageSize)
    .all<CleanCheck>();

  return { total, rows: results ?? [] };
}
