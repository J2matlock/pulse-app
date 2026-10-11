/**
 * friendlyError — what an error toast may say (audit 2.15 / N-28).
 *
 * Main-process messages written for people ("That record is no longer
 * available.") pass through. Developer text — validation codes like "Invalid
 * ID", "Row not found", raw SQLite or Electron transport errors — becomes the
 * fallback sentence instead. Wrap every error toast's message in it.
 */
export const DEFAULT_ERROR = "Something went wrong and the change wasn't saved. Please try again."

const TECHNICAL: RegExp[] = [
  /^invalid(\s+\w+){0,2}$/i,                  // "Invalid ID", "Invalid reorder payload"
  /^(\w+\s+){0,2}(\w+\s)?not found$/i,         // "Row not found", "Grid 12 not found"
  /^unknown\s+\w+(\s+\w+)?$/i,                 // "Unknown settings key"
  /constraint failed|SQLITE_|no such (table|column)|syntax error/i,
  /Error invoking remote method|IPC|ipcRenderer/i,
  /Cannot read propert|is not a function|undefined|\bnull\b|NaN/,
  /payload|only allowed for/i,
  /^[A-Z_]{4,}$/,                              // bare codes: READ_ONLY, ENOENT
]

export function isTechnicalError(message: string): boolean {
  const m = message.trim()
  return m.length === 0 || TECHNICAL.some(re => re.test(m))
}

export function friendlyError(message: string | null | undefined, fallback: string = DEFAULT_ERROR): string {
  if (!message) return fallback
  if (message === 'READ_ONLY') return "Changes can't be saved right now. Please try again in a moment."
  return isTechnicalError(message) ? fallback : message
}
