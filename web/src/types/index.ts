// Shared type aliases.

/** A check's availability class. */
export type StatusClass = "up" | "down" | "invalid";

/** Logs date-filter mode. */
export type LogDateMode = "all" | "single" | "range";

/** Status dropdown value ("" = all). */
export type StatusFilterValue = "" | StatusClass;

/** Availability colour tone. */
export type AvailabilityTone = "ok" | "warn" | "bad";
