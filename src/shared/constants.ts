/** Centralized constants used across main and renderer processes */

// Debounce timings (ms)
/**
 * The product name people see (window title, PDFs, About). Safe to change.
 * Display only: never use it for paths, key stores or identifiers.
 */
export const PRODUCT_NAME = 'Pulse by BaringaSoft'
/**
 * The error an IPC handler returns when the database can't be written to
 * right now (enforceWritable()). The renderer compares against it to show a
 * plain message instead of a generic failure.
 */
export const IPC_READ_ONLY = 'READ_ONLY'
/** Public source code (Pulse is free software under the GNU GPL v3) */
export const SOURCE_CODE_URL = 'https://github.com/J2matlock/pulse-app'

/** License texts bundled with the app (package.json build.extraResources), readable offline. */
export type LicenseDoc = 'license' | 'third-party'

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

// Auto-lock (HIPAA automatic logoff). There is deliberately no "never" option.
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
