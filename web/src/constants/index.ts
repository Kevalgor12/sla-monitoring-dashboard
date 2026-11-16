// App-wide constants: config, option lists and labels.

import type { DataQualityField } from "../interfaces";

/** Worker API base URL (from VITE_API_URL at build time). */
export const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8787").replace(/\/$/, "");

/** Rows per page in the logs table. */
export const DEFAULT_PAGE_SIZE = 50;

/** Upload validation limits. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
export const ACCEPTED_CSV_EXTENSIONS = [".csv"] as const;

// Static copy

export const APP_TITLE = "SLA Monitoring Dashboard";
export const APP_SUBTITLE =
  "Upload health-check logs -> clean & validate in a serverless function -> review availability, SLA credits and incidents.";
export const APP_FOOTER_NOTE =
  "Availability counts every 15-minute window a service returned 5xx. SLA target 99.9%. See the README for assumptions.";
export const UPLOAD_HINT =
  "The CSV is sent to a Cloudflare Worker that parses, validates and de-duplicates it, then stores the cleaned checks in D1. Large files (e.g. the 30-day set) may take a moment.";

// Logs filter options

export const LOG_DATE_MODES = [
  { value: "all", label: "All dates" },
  { value: "single", label: "Single day" },
  { value: "range", label: "Date range" },
] as const;

export const LOG_STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down (5xx)" },
  { value: "invalid", label: "Invalid" },
] as const;

// Data-quality chips (Issues field -> label, in display order)

export const DATA_QUALITY_FIELDS: DataQualityField[] = [
  { key: "unix_timestamps", label: "Unix-epoch timestamps -> ISO" },
  { key: "latency_in_seconds", label: "Latency in seconds -> ms" },
  { key: "latency_missing", label: "Missing latency (kept, nulled)" },
  { key: "latency_negative", label: "Negative latency (nulled)" },
  { key: "invalid_status", label: "Invalid status code (excluded)" },
  { key: "duplicate_checkpoints", label: "Duplicate agent reports (merged)" },
  { key: "unparseable_timestamps", label: "Unparseable timestamps (dropped)" },
  { key: "malformed_rows", label: "Malformed rows (dropped)" },
];
