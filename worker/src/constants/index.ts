// App-wide constants: schema, SLA policy, D1 limits, pagination, CORS.

/** CSV columns the cleaner reads (matched by name, so order can vary). */
export const EXPECTED_COLS = [
  "service_id",
  "service_name",
  "timestamp",
  "status_code",
  "latency",
  "latency_unit",
  "agent",
  "region",
] as const;

/** Milliseconds in a UTC day. */
export const MS_PER_DAY = 86_400_000;

/** One check = one 15-minute window. */
export const MINUTES_PER_CHECK = 15;

/** SLA availability target (%). */
export const SLA_TARGET = 99.9;

/** A single recovered window does not split an incident; two do. */
export const INCIDENT_GAP_TOLERANCE = 1;

/** 10 rows/statement = 90 bound params, under D1's 100 cap. */
export const ROWS_PER_STMT = 10;
/** Statements per db.batch(), under the 50-subrequest cap. */
export const STMTS_PER_BATCH = 100;

/** Logs pagination. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Max uploads returned by the list endpoint. */
export const UPLOADS_LIST_LIMIT = 100;

/** CORS headers on every response. */
export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
