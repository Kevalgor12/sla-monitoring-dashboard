// HTTP response helpers.

import { CORS } from "../constants";

/** JSON response with CORS. */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/** CORS pre-flight (OPTIONS) response. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
