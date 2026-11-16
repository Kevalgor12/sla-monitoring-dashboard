// Worker entry - routes method + path to a handler.

import { getLogs, getStats, listUploads } from "./handlers/query";
import { handleUpload } from "./handlers/upload";
import { json, preflight } from "./lib/http";
import type { Env } from "./interfaces";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return preflight();

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
