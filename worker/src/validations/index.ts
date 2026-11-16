// Request-level validation.

import type { ValidationResult } from "../interfaces";

/** Reject an empty upload body. */
export function validateUploadText(text: string): ValidationResult {
  if (!text || text.trim() === "") return { ok: false, error: "Empty upload" };
  return { ok: true };
}
