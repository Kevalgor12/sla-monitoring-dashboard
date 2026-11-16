// POST /api/upload - read CSV, clean + validate, compute stats, persist.

import { insertChecks, insertUpload } from "../lib/db";
import { json } from "../lib/http";
import { clean } from "../services/clean";
import { computeStats } from "../services/stats";
import { validateUploadText } from "../validations";
import type { Env, MultipartFileEntry, UploadedCsv } from "../interfaces";

/** Read CSV text from a raw body or multipart/form-data. */
async function readCsv(request: Request, url: URL): Promise<UploadedCsv> {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const entry = form.get("file") as unknown as MultipartFileEntry | null;
    if (entry && typeof entry.text === "function") {
      return { text: await entry.text(), filename: entry.name || "upload.csv" };
    }
  }
  const text = await request.text();
  const filename = url.searchParams.get("filename") || "upload.csv";
  return { text, filename };
}

export async function handleUpload(request: Request, env: Env, url: URL): Promise<Response> {
  const { text, filename } = await readCsv(request, url);

  const valid = validateUploadText(text);
  if (!valid.ok) return json({ error: valid.error }, 400);

  const result = clean(text);
  if (result.checks.length === 0) {
    return json({ error: "No usable rows found. Is this a monitoring-checks CSV?", issues: result.issues }, 422);
  }
  const stats = computeStats(result.checks);

  const uploadId = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();

  await insertUpload(env.DB, { id: uploadId, filename, uploadedAt, result, stats });
  await insertChecks(env.DB, uploadId, result.checks);

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
