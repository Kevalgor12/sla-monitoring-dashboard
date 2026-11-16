// Client-side upload validation (server still validates authoritatively).

import { ACCEPTED_CSV_EXTENSIONS, MAX_UPLOAD_BYTES } from "../constants";
import type { FileValidationResult } from "../interfaces";

/** Validate a selected file before upload. */
export function validateCsvFile(file: File | null): FileValidationResult {
  if (!file) return { ok: false, error: "Choose a CSV file first." };

  const name = file.name.toLowerCase();
  const hasCsvExt = ACCEPTED_CSV_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!hasCsvExt) return { ok: false, error: "File must be a .csv." };

  if (file.size === 0) return { ok: false, error: "File is empty." };
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    return { ok: false, error: `File is larger than ${mb} MB.` };
  }

  return { ok: true };
}
