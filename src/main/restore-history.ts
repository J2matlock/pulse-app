/**
 * Restores leave a trace (persona study #19): each one that completes adds
 * { restoredAt, backupMadeAt, appVersion } to the `restore_history` settings
 * row, newest last, capped at 50. The Change history PDF lists them.
 *
 * Written only after the restored database has opened, and never allowed to
 * fail a restore: the data is already back by then, and a missing history line
 * is far better than a restore that reports an error it didn't have.
 */
import { app } from 'electron'
import { getDb } from './database'
import { logger } from './logger'

export const RESTORE_HISTORY_KEY = 'restore_history'
export const MAX_RESTORE_HISTORY = 50

export interface RestoreEntry {
  /** ISO time the restore finished */
  restoredAt: string
  /** ISO time the backup was made, when the backup says */
  backupMadeAt: string | null
  /** The Pulse that did the restore */
  appVersion: string
}

function isEntry(v: unknown): v is RestoreEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return typeof e.restoredAt === 'string' && !Number.isNaN(Date.parse(e.restoredAt))
    && (e.backupMadeAt === null || typeof e.backupMadeAt === 'string')
    && typeof e.appVersion === 'string'
}

/** The history in the open database; anything unreadable is skipped, never thrown */
export function readRestoreHistory(): RestoreEntry[] {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(RESTORE_HISTORY_KEY) as { value: string } | undefined
    if (!row) return []
    const parsed: unknown = JSON.parse(row.value)
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch (err) {
    logger.warn('restore-history', 'could not read restore_history', err)
    return []
  }
}

/**
 * Add one restore to the history in the (just restored and opened) database.
 * `carried` is the history read from the data before it was replaced, so a
 * restore of an older backup doesn't forget the restores since.
 */
export function recordRestore(backupMadeAt: string | null, carried: readonly RestoreEntry[] = []): void {
  try {
    const entry: RestoreEntry = { restoredAt: new Date().toISOString(), backupMadeAt, appVersion: app.getVersion() }
    const byTime = new Map<string, RestoreEntry>()
    for (const e of [...readRestoreHistory(), ...carried, entry]) byTime.set(e.restoredAt, e)
    const merged = [...byTime.values()]
      .sort((a, b) => Date.parse(a.restoredAt) - Date.parse(b.restoredAt))
      .slice(-MAX_RESTORE_HISTORY)
    getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(RESTORE_HISTORY_KEY, JSON.stringify(merged))
  } catch (err) {
    logger.warn('restore-history', 'could not record a restore', err)
  }
}
