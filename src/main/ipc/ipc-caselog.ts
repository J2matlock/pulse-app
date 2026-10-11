/**
 * ipc-caselog.ts — CASE_LOG_*, SCRAP_NOTE_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, validId, notifyCaseLogChanged, enforceWritable, logNonFatal } from './ipc-utils'
import { getDb, cachedStmt } from '../database'
import type { CaseLogEntry, NoteDateUpdate } from '../../shared/types'
import type { CaseLogQuery } from '../../shared/ipc-contract'
import { isValidLogType } from '../activity-types'
import { cleanExtraMeasures } from '../measures'
import { parseExtraMeasures } from '../../shared/measures'
import { applyNoteDateUpdates } from '../note-date-updates'
import { CASE_NOTE_DELETE_WINDOW_MINUTES } from '../../shared/constants'
import { word } from '../vocab'


interface NoteMeasures { minutes?: number | null; miles?: number | null; extra?: Record<string, number | null> | null }

/** Minutes: whole number up to a day. Miles: up to 2,000, rounded to tenths. */
function validMeasures(m: NoteMeasures | undefined | null): { minutes: number | null; miles: number | null } | string {
  const minutes = m?.minutes ?? null
  const miles = m?.miles ?? null
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)) return 'Minutes must be a whole number up to 1,440'
  if (miles !== null && (typeof miles !== 'number' || !Number.isFinite(miles) || miles < 0 || miles > 2000)) return 'Miles must be a number up to 2,000'
  return { minutes: minutes || null, miles: miles ? Math.round(miles * 10) / 10 : null }
}

/** The WHERE clause shared by the note list and its count, plus a cache key for its shape. */
function caseLogFilter(rowId: number, includeSystem?: boolean, includeVoided?: boolean, opts?: CaseLogQuery): { where: string; params: unknown[]; key: string } {
  const parts = ['row_id = ?']
  const params: unknown[] = [rowId]
  if (!includeSystem) parts.push("log_type != 'system'")
  if (!includeVoided) parts.push('voided_at IS NULL')
  const logType = typeof opts?.logType === 'string' && opts.logType.length <= 100 ? opts.logType : ''
  if (logType) { parts.push('log_type = ?'); params.push(logType) }
  const query = typeof opts?.query === 'string' ? opts.query.trim().slice(0, 200) : ''
  if (query) {
    // Match the words literally: % and _ are ordinary characters in a search box
    parts.push("content LIKE ? ESCAPE '\\'")
    params.push(`%${query.replace(/[\\%_]/g, c => `\\${c}`)}%`)
  }
  return { where: parts.join(' AND '), params, key: `${includeSystem ? 1 : 0}${includeVoided ? 1 : 0}${logType ? 't' : ''}${query ? 'q' : ''}` }
}

export function registerCaseLogHandlers(): void {
  secureWrap(IPC.CASE_LOG_GET, 'ipc-caselog', (_e, rowId: number, includeSystem?: boolean, includeVoided?: boolean, limit?: number, offset?: number, opts?: CaseLogQuery) => {
    if (!validId(rowId)) return fail('Invalid ID')
    const CASE_LOG_COLS = `id, row_id, content, log_type, created_at, updated_at,
      is_pinned, follow_up_date, follow_up_completed, original_content,
      edited_at, voided_at, voided_reason, source_action_id, minutes, miles, extra_measures`
    const safeLimit = Math.min(Math.max(limit ?? 200, 1), 1000)
    const safeOffset = Math.max(offset ?? 0, 0)
    const f = caseLogFilter(rowId, includeSystem, includeVoided, opts)
    // Pinned first, then by date; searching and "oldest first" happen here so they
    // cover every note, not just the page that happens to be loaded (1.31)
    const order = opts?.oldestFirst ? 'is_pinned DESC, created_at ASC, id ASC' : 'is_pinned DESC, created_at DESC, id DESC'
    const sql = `SELECT ${CASE_LOG_COLS} FROM case_log WHERE ${f.where} ORDER BY ${order} LIMIT ? OFFSET ?`
    const entries = cachedStmt(`case_log_get_${f.key}_${opts?.oldestFirst ? 'asc' : 'desc'}`, sql).all(...f.params, safeLimit, safeOffset) as CaseLogEntry[]
    return ok(entries)
  })

  secureWrap(IPC.CASE_LOG_COUNT, 'ipc-caselog', (_e, rowId: number, includeSystem?: boolean, includeVoided?: boolean, opts?: CaseLogQuery) => {
    if (!validId(rowId)) return fail('Invalid ID')
    const f = caseLogFilter(rowId, includeSystem, includeVoided, opts)
    const r = cachedStmt(`case_log_count_${f.key}`, `SELECT COUNT(*) AS n FROM case_log WHERE ${f.where}`).get(...f.params) as { n: number }
    return ok(r.n)
  })

  secureWrap(IPC.CASE_LOG_CREATE, 'ipc-caselog', (_e, rowId: number, content: string, logType: string, followUpDate: string | null, measures?: NoteMeasures) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    // New notes take an active type; archived ones only come back through restore (undo)
    if (!isValidLogType(logType)) return fail(`That kind of ${word('activity')} isn't available any more. Pick another and try again.`)
    if (typeof content !== 'string' || content.length > 100_000) return fail(`That ${word('activity')} is too long (max 100,000 characters).`)
    if (followUpDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) return fail('Invalid follow-up date format')
    const m = validMeasures(measures)
    if (typeof m === 'string') return fail(m)
    const extra = cleanExtraMeasures(measures?.extra)
    if (extra && typeof extra === 'object') return fail(extra.error)
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO case_log (row_id, content, log_type, follow_up_date, minutes, miles, extra_measures, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(rowId, content, logType, followUpDate ?? null, m.minutes, m.miles, extra)
    const entry = db.prepare(`SELECT id, row_id, content, log_type, created_at, updated_at,
      is_pinned, follow_up_date, follow_up_completed, original_content,
      edited_at, voided_at, voided_reason, source_action_id, minutes, miles, extra_measures FROM case_log WHERE id = ?`).get(result.lastInsertRowid) as CaseLogEntry
    // A date column can follow notes of chosen types ("Last Face-to-Face" ← Visit)
    let updated_dates: NoteDateUpdate[] = []
    try { updated_dates = applyNoteDateUpdates(rowId, logType) } catch (err) { logNonFatal('ipc-caselog', 'note date updates', err) }
    notifyCaseLogChanged(rowId)
    return ok({ ...entry, updated_dates })
  })

  secureWrap(IPC.CASE_LOG_UPDATE, 'ipc-caselog', (_e, id: number, content: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    if (typeof content !== 'string' || content.length > 100_000) return fail(`That ${word('activity')} is too long (max 100,000 characters).`)
    // Emptying a note isn't a way to remove it: it would leave a blank entry in the record (R-13)
    if (!content.trim()) return fail(`${word('activity', { cap: true })} can't be empty. To remove one, use Void.`)
    const db = getDb()
    db.transaction(() => {
      // Keep every earlier version (case_log_edits) so edits never erase the record.
      // original_content still holds the very first version for older UI paths.
      const current = cachedStmt('case_log_content', 'SELECT content FROM case_log WHERE id = ?').get(id) as { content: string } | undefined
      if (current && current.content !== content) {
        cachedStmt('case_log_edit_insert', "INSERT INTO case_log_edits (case_log_id, content, replaced_at) VALUES (?, ?, datetime('now'))").run(id, current.content)
      }
      db.prepare(`
        UPDATE case_log
        SET content          = ?,
            updated_at       = datetime('now'),
            original_content = COALESCE(original_content, content),
            edited_at        = datetime('now')
        WHERE id = ?
      `).run(content, id)
    })()
    const entry = cachedStmt('case_log_row_id', 'SELECT row_id FROM case_log WHERE id = ?').get(id) as { row_id: number } | undefined
    if (entry) notifyCaseLogChanged(entry.row_id)
    return ok(true)
  })

  secureWrap(IPC.CASE_LOG_DELETE, 'ipc-caselog', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    const db = getDb()
    // Records integrity: only a note written in the last few minutes (a typo, the
    // wrong client) can be deleted outright. Older notes are voided instead, which
    // keeps them in the record.
    const recent = cachedStmt('case_log_recent', `SELECT row_id FROM case_log WHERE id = ? AND created_at >= datetime('now', ?)`)
      .get(id, `-${CASE_NOTE_DELETE_WINDOW_MINUTES} minutes`) as { row_id: number } | undefined
    if (!recent) {
      return fail(`Notes older than ${CASE_NOTE_DELETE_WINDOW_MINUTES} minutes can't be deleted. Void it instead — it stays in the record but is hidden.`)
    }
    db.transaction(() => {
      db.prepare('DELETE FROM case_log WHERE id = ?').run(id)
    })()
    notifyCaseLogChanged(recent.row_id)
    return ok(true)
  })

  secureWrap(IPC.CASE_LOG_GET_EDITS, 'ipc-caselog', (_e, id: number) => {
    if (!validId(id)) return fail('Invalid ID')
    const edits = cachedStmt('case_log_edits_get', 'SELECT content, replaced_at FROM case_log_edits WHERE case_log_id = ? ORDER BY replaced_at ASC, id ASC')
      .all(id) as Array<{ content: string; replaced_at: string }>
    return ok(edits)
  })

  secureWrap(IPC.CASE_LOG_TOGGLE_PIN, 'ipc-caselog', (_e, id: number, pinned: boolean) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    const db = getDb()
    const rowId = db.transaction(() => {
      const entry = cachedStmt('case_log_row_id', 'SELECT row_id FROM case_log WHERE id = ?').get(id) as { row_id: number } | undefined
      db.prepare('UPDATE case_log SET is_pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
      return entry?.row_id ?? null
    })()
    if (rowId) notifyCaseLogChanged(rowId)
    return ok(true)
  })

  secureWrap(IPC.CASE_LOG_VOID, 'ipc-caselog', (_e, id: number, reason: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    if (typeof reason !== 'string' || reason.length > 1000) return fail('Invalid void reason')
    const db = getDb()
    const rowId = db.transaction(() => {
      const entry = cachedStmt('case_log_row_id', 'SELECT row_id FROM case_log WHERE id = ?').get(id) as { row_id: number } | undefined
      db.prepare(`UPDATE case_log SET voided_at = datetime('now'), voided_reason = ? WHERE id = ?`).run(reason ?? 'Voided', id)
      return entry?.row_id ?? null
    })()
    if (rowId) notifyCaseLogChanged(rowId)
    return ok(true)
  })

  secureWrap(IPC.CASE_LOG_UNVOID, 'ipc-caselog', (_e, id: number, opts?: { logRestore?: boolean }) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    const db = getDb()
    const rowId = db.transaction(() => {
      const entry = db.prepare('SELECT row_id, voided_at, voided_reason FROM case_log WHERE id = ?').get(id) as { row_id: number; voided_at: string | null; voided_reason: string | null } | undefined
      db.prepare(`UPDATE case_log SET voided_at = NULL, voided_reason = NULL WHERE id = ?`).run(id)
      // "Restore" on a voided note leaves a trace on the timeline and in the audit trail (R-14);
      // Undo of a void just puts it back
      if (entry?.voided_at && opts?.logRestore === true) {
        db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))")
          .run(entry.row_id, `A voided ${word('activity')} was restored${entry.voided_reason ? ` (it was voided: ${entry.voided_reason})` : ''}`)
      }
      return entry?.row_id ?? null
    })()
    if (rowId) notifyCaseLogChanged(rowId)
    return ok(true)
  })

  secureWrap(IPC.CASE_LOG_COMPLETE_FOLLOWUP, 'ipc-caselog', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    const db = getDb()
    let sysLogId: number | null = null
    let rowId: number | null = null
    const completeFollowUp = db.transaction(() => {
      const entry = db.prepare('SELECT row_id, follow_up_date, content FROM case_log WHERE id = ?').get(id) as
        { row_id: number; follow_up_date: string | null; content: string } | undefined
      db.prepare(`
        UPDATE case_log SET follow_up_completed = 1, updated_at = datetime('now') WHERE id = ?
      `).run(id)
      if (entry) {
        rowId = entry.row_id
        const dateStr = entry.follow_up_date
          ? (() => { const [y = NaN, m = NaN, d = NaN] = entry.follow_up_date.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString() })()
          : ''
        const snippet = entry.content.length > 60 ? entry.content.slice(0, 60).trimEnd() + '…' : entry.content
        const content = `Follow-up completed${dateStr ? ` (due ${dateStr})` : ''}: "${snippet}"`
        const logResult = db.prepare(`
          INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
          VALUES (?, ?, 'system', datetime('now'), datetime('now'))
        `).run(entry.row_id, content)
        sysLogId = logResult.lastInsertRowid as number
      }
    })
    completeFollowUp()
    if (rowId) notifyCaseLogChanged(rowId)
    return ok({ sysLogId })
  })

  secureWrap(IPC.CASE_LOG_UNCOMPLETE_FOLLOWUP, 'ipc-caselog', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    const db = getDb()
    const entry = cachedStmt('case_log_row_id', 'SELECT row_id FROM case_log WHERE id = ?').get(id) as { row_id: number } | undefined
    db.prepare(`UPDATE case_log SET follow_up_completed = 0, updated_at = datetime('now') WHERE id = ?`).run(id)
    if (entry) notifyCaseLogChanged(entry.row_id)
    return ok(true)
  })

  secureWrap(IPC.CASE_LOG_RESTORE, 'ipc-caselog', (_e, entry: { id: number; row_id: number; content: string; log_type: string; is_pinned: number; follow_up_date: string | null; follow_up_completed: number; voided_at: string | null; voided_reason: string | null; created_at: string; minutes?: number | null; miles?: number | null; extra_measures?: string | null }) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!entry || typeof entry.id !== 'number' || typeof entry.row_id !== 'number') return fail('Invalid entry format')
    if (typeof entry.content !== 'string' || entry.content.length > 100_000) return fail('Content missing or too large')
    if (!isValidLogType(entry.log_type, { allowArchived: true })) return fail(`Invalid log type: ${entry.log_type}`)
    if (entry.created_at) {
      const d = new Date(entry.created_at)
      if (isNaN(d.getTime())) return fail('Invalid created_at date')
      const now = Date.now()
      if (d.getTime() > now + 365 * 86400000 || d.getTime() < new Date('2020-01-01').getTime()) {
        return fail('created_at out of valid range')
      }
    }
    const db = getDb()
    // Verify the ID doesn't collide with an existing record to prevent overwriting
    const existing = db.prepare('SELECT id FROM case_log WHERE id = ?').get(entry.id)
    if (existing) return fail('Case log entry with this ID already exists')
    const restoredMeasures = validMeasures({ minutes: entry.minutes, miles: entry.miles })
    // A number archived since the note was written still comes back with it
    const restoredExtra = cleanExtraMeasures(parseExtraMeasures(entry.extra_measures), { allowArchived: true })
    if (restoredExtra && typeof restoredExtra === 'object') return fail(restoredExtra.error)
    if (typeof restoredMeasures === 'string') return fail(restoredMeasures)
    db.prepare(`
      INSERT INTO case_log
      (id, row_id, content, log_type, is_pinned, follow_up_date, follow_up_completed, voided_at, voided_reason, created_at, minutes, miles, extra_measures, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(entry.id, entry.row_id, entry.content, entry.log_type, entry.is_pinned, entry.follow_up_date ?? null, entry.follow_up_completed, entry.voided_at ?? null, entry.voided_reason ?? null, entry.created_at, restoredMeasures.minutes, restoredMeasures.miles, restoredExtra)
    notifyCaseLogChanged(entry.row_id)
    return ok(true)
  })

  // Time and mileage can be corrected after the fact (the note text has its own edit history)
  secureWrap(IPC.CASE_LOG_SET_MEASURES, 'ipc-caselog', (_e, id: number, measures: NoteMeasures) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    const m = validMeasures(measures)
    if (typeof m === 'string') return fail(m)
    const row = getDb().prepare('SELECT row_id FROM case_log WHERE id = ?').get(id) as { row_id: number } | undefined
    if (!row) return fail('Note not found')
    // Custom numbers change only when given; archived ones already on the note may stay
    const extra = measures && 'extra' in measures ? cleanExtraMeasures(measures.extra, { allowArchived: true }) : undefined
    if (extra && typeof extra === 'object') return fail(extra.error)
    // updated_at is left alone: it marks the note text as edited
    if (extra === undefined) getDb().prepare('UPDATE case_log SET minutes = ?, miles = ? WHERE id = ?').run(m.minutes, m.miles, id)
    else getDb().prepare('UPDATE case_log SET minutes = ?, miles = ?, extra_measures = ? WHERE id = ?').run(m.minutes, m.miles, extra, id)
    notifyCaseLogChanged(row.row_id)
    return ok(true)
  })

  // ── Scrap Notes ─────────────────────────────────────────────────────────────
  secureWrap(IPC.SCRAP_NOTE_GET, 'ipc-caselog', (_e, rowId: number) => {
    if (!validId(rowId)) return fail('Invalid ID')
    const note = getDb().prepare('SELECT * FROM scrap_notes WHERE row_id = ?').get(rowId)
    return ok(note ?? null)
  })

  secureWrap(IPC.SCRAP_NOTE_UPDATE, 'ipc-caselog', (_e, rowId: number, content: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    if (typeof content !== 'string' || content.length > 500_000) return fail('Scrap note too large (max 500,000 characters)')
    getDb().prepare(`
      INSERT INTO scrap_notes (row_id, content, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(row_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(rowId, content)
    return ok(true)
  })
}
