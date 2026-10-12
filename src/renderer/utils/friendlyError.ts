/**
 * friendlyError — what an error toast may say (audit 2.15 / N-28, AUDIT-061).
 *
 * Main-process messages written for people ("That record is no longer
 * available.") pass through. Developer text — validation codes like "Invalid
 * ID", "Row not found", "is_completed must be 0 or 1", raw SQLite, file-system
 * or Electron transport errors — becomes the fallback sentence instead. Wrap
 * every error toast's message in it.
 *
 * tests/renderer/friendlyError.test.ts runs every fail('…') string in
 * src/main through this filter: each must either be on its list of plain
 * messages or be replaced here.
 */
import { IPC_READ_ONLY, PASSING_ERRORS } from '../../shared/constants'

export const DEFAULT_ERROR: string = PASSING_ERRORS.generic

const TECHNICAL: RegExp[] = [
  /\binvalid\b/i,                              // "Invalid ID", "Entry rules invalid"
  /^(unknown|unsupported|unauthorized|expected)\b/i, // "Unknown settings key: foo"
  /\bnot found\b/i,                            // "Row not found", "Grid 12 not found"
  /\bmust be (an? )?(integer|string|array|boolean|positive|non-negative|0 or 1|ISO)/i, // "is_completed must be 0 or 1"
  /\blimited to\b/i,                           // "Bulk action limited to 1000 rows"
  /^No \w+( \w+)? (provided|specified)\b/i,    // "No rows specified"
  /\b[a-z]+_[a-z_]+\b/,                        // snake_case keys: due_date, created_at
  /\b(?!vCard\b|macOS\b|iCloud\b|iPhone\b|iPad\b)[a-z]+[A-Z]\w*/, // camelCase: retentionMonths, rowIds
  /\b(IDs?|ISO|URLs?|JSON|IPC|ipcRenderer)\b/,
  // Not "row": an import error may rightly name a row of the person's spreadsheet
  /\b(grids?|arrays?|config|payload|fields?|chars|px|stack trace)\b/i,
  /\d(px|KB|MB)\b/,                            // "(2000px)", "(max 500KB)"
  /\(max [\d,.]+\)/i,                          // "(max 200)" with no unit
  /^(?!.*\b(is|are|was|were)\b)(\S+\s){0,3}too (large|long)\b/i, // "Content too large", "Hint too long"
  /constraint failed|SQLITE|no such (table|column)|syntax error|database is locked/i,
  /\b(ENOENT|EACCES|EPERM|EBUSY|EROFS|ENOSPC|EMFILE|EEXIST|EISDIR|ENOTDIR)\b/,
  /Error invoking remote method|^\w*Error:|\bat \S+ \(|\.(ts|js|tsx):\d+/,
  /Cannot read propert|is not a function|undefined|\bnull\b|NaN/,
  /only allowed for/i,
  /^[A-Z_]{4,}$/,                              // bare codes: READ_ONLY, ENOENT
]

export function isTechnicalError(message: string): boolean {
  const m = message.trim()
  return m.length === 0 || TECHNICAL.some(re => re.test(m))
}

export function friendlyError(message: string | null | undefined, fallback: string = DEFAULT_ERROR): string {
  if (!message) return fallback
  if (message === IPC_READ_ONLY) return "Changes can't be saved right now. Please try again in a moment."
  return isTechnicalError(message) ? fallback : message
}
