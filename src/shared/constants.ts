/** Centralized constants used across main and renderer processes */

// Debounce timings (ms)
/**
 * The product name people see (window title, PDFs, About). Safe to change.
 * Display only: never use it for paths, key stores or identifiers.
 */
export const PRODUCT_NAME = 'Pulse by BaringaSoft'
/** Public source code (Pulse is free software under the GNU GPL v3) */
export const SOURCE_CODE_URL = 'https://github.com/J2matlock/pulse-app'
export const LICENSE_URL = 'https://www.gnu.org/licenses/gpl-3.0.html'

/**
 * The name Electron uses for the data folder (~/.config/<name> on Linux,
 * ~/Library/Application Support/<name> on macOS) and the OS key-store entry
 * that protects the database key. It's package.json's `name`, which is what
 * every existing install was created under. NEVER CHANGE IT: users would see
 * an empty app, or be unable to unlock.
 */
export const INTERNAL_APP_NAME = 'baringasoft-pulse'

export const DEBOUNCE_SEARCH = 150
export const DEBOUNCE_CELL_SAVE = 300
export const DEBOUNCE_RESIZE = 500
export const DEBOUNCE_TASK_RELOAD = 300
export const DEBOUNCE_ANNOUNCE = 300

// UI animation timings (ms)
export const SPINNER_DELAY = 200
export const ANIM_STAR_BOUNCE = 400
export const ANIM_CHECKED_FLASH = 1500

// Time constants
export const MS_PER_DAY = 86_400_000

// Dashboard / deadline bucket thresholds (days)
export const DAYS_THIS_WEEK = 7
export const DAYS_THIS_MONTH = 30

// Data limits — payload size validation
/** Maximum length for a single cell value */
export const MAX_CELL_VALUE_LENGTH = 50_000
/** Maximum number of alert rules */
export const MAX_ALERT_RULES = 50
/** Default cache size for import rows */
export const MAX_CACHE_ROWS = 10_000

// Auto-lock (HIPAA automatic logoff). There is deliberately no "never" option.
export const AUTO_LOCK_OPTIONS = [5, 15, 30, 60, 120] as const
/** 15: what the security checkup and most organizations expect */
export const AUTO_LOCK_DEFAULT_MINUTES = 15
export const AUTO_LOCK_MAX_MINUTES = 120

/**
 * Turn a stored auto-lock value into a usable number of minutes.
 * 0 meant "Never" in older versions; those users get the longest option
 * instead of no lock at all. Anything unparseable falls back to the default.
 */
export function normalizeAutoLockMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return AUTO_LOCK_DEFAULT_MINUTES
  if (n <= 0) return AUTO_LOCK_MAX_MINUTES
  return Math.min(Math.max(Math.round(n), 1), AUTO_LOCK_MAX_MINUTES)
}

/** Case notes can be deleted only this soon after they're written; after that they're voided (kept, hidden). */
export const CASE_NOTE_DELETE_WINDOW_MINUTES = 15
