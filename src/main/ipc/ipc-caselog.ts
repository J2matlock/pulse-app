/**
 * ipc-caselog.ts — CASE_LOG_*, SCRAP_NOTE_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, validId, notifyCaseLogChanged, enforceWritable, logNonFatal } from './ipc-utils'
import { getDb, cachedStmt } from '../database'
import type { CaseLogEntry, NoteDateUpdate, NoteDateRevert } from '../../shared/types'
import { isValidLogType } from '../activity-types'
import { cleanExtraMeasures } from '../measures'
import { parseExtraMeasures } from '../../shared/measures'
import { applyNoteDateUpdates, revertNoteDates, checkOccurredOn, occurredTimestamp, localDayOf } from '../note-date-updates'
import { localDateString } from '../../shared/dates'
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

/** Notes list in the order things happened; created_at stays the time each was written */
const CASE_LOG_COLS = `id, row_id, content, log_type, created_at, updated_at, occurred_at,
  is_pinned, follow_up_date, follow_up_completed, original_content,
  edited_at, voided_at, voided_reason, source_action_id, minutes, miles, extra_measures`

export function registerCaseLogHandlers(): void {
  secureWrap(IPC.CASE_LOG_GET, 'ipc-caselog', (_e, rowId: number, includeSystem?: boolean, includeVoided?: boolean, limit?: number, offset?: number) => {
    if (!validId(rowId)) return fail('Invalid ID')
    const voidClause = includeVoided ? '' : 'AND voided_at IS NULL'
    const safeLimit = Math.min(Math.max(limit ?? 200, 1), 1000)
    const safeOffset = Math.max(offset ?? 0, 0)
    const sql = includeSystem
      ? `SELECT ${CASE_LOG_COLS} FROM case_log WHERE row_id = ? ${voidClause} ORDER BY is_pinned DESC, occurred_at DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`
      : `SELECT ${CASE_LOG_COLS} FROM case_log WHERE row_id = ? AND log_type != 'system' ${voidClause} ORDER BY is_pinned DESC, occurred_at DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`
    const cacheKey = `case_log_get_${includeSystem ? 1 : 0}_${includeVoided ? 1 : 0}`
    const entries = cachedStmt(cacheKey, sql).all(rowId, safeLimit, safeOffset) as CaseLogEntry[]
    return ok(entries)
  })

  // occurredOn: the day it happened when that isn't today (a visit written up the next morning)
  secureWrap(IPC.CASE_LOG_CREATE, 'ipc-caselog', (_e, rowId: number, content: string, logType: string, followUpDate: string | null, measures?: NoteMeasures, occurredOn?: string | null) => {
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
    const day = checkOccurredOn(occurredOn)
    if (day && typeof day === 'object') return fail(day.error)
    const noteDay = day ?? localDateString()
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO case_log (row_id, content, log_type, follow_up_date, minutes, miles, extra_measures, occurred_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(rowId, content, logType, followUpDate ?? null, m.minutes, m.miles, extra, occurredTimestamp(noteDay))
    const entry = db.prepare(`SELECT ${CASE_LOG_COLS} FROM case_log WHERE id = ?`).get(result.lastInsertRowid) as CaseLogEntry
    // A date column can follow notes of chosen types ("Last Face-to-Face" ← Visit), set to the day it happened
    let updated_dates: NoteDateUpdate[] = []
    try { updated_dates = applyNoteDateUpdates(rowId, logType, noteDay, entry.id) } catch (err) { logNonFatal('ipc-caselog', 'note date updates', err) }
    notifyCaseLogChanged(rowId)
    return ok({ ...entry, updated_dates })
  })

  secureWrap(IPC.CASE_LOG_UPDATE, 'ipc-caselog', (_e, id: number, content: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    if (typeof content !== 'string' || content.length > 100_000) return fail(`That ${word('activity')} is too long (max 100,000 characters).`)
    const db = getDb()
    db.transaction(() => {
      // Keep every earlier version (case_log_edits) so edits never erase the record.
      // original_content still holds the very first version for older UI paths.
      const current = cachedStmt('case_log_content', 'SELECT content, occurred_at FROM case_log WHERE id = ?').get(id) as { content: string; occurred_at: string | null } | undefined
      if (current && current.content !== content) {
        cachedStmt('case_log_edit_insert', "INSERT INTO case_log_edits (case_log_id, content, occurred_at, replaced_at) VALUES (?, ?, ?, datetime('now'))").run(id, current.content, current.occurred_at)
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
    // Dates the note moved go back first (L-05)
    const reverted_dates = db.transaction((): NoteDateRevert[] => {
      const reverted = revertNoteDates(id)
      db.prepare('DELETE FROM case_log WHERE id = ?').run(id)
      return reverted
    })()
    notifyCaseLogChanged(recent.row_id)
    return ok({ reverted_dates })
  })

  secureWrap(IPC.CASE_LOG_GET_EDITS, 'ipc-caselog', (_e, id: number) => {
    if (!validId(id)) return fail('Invalid ID')
    const edits = cachedStmt('case_log_edits_get', 'SELECT content, occurred_at, replaced_at FROM case_log_edits WHERE case_log_id = ? ORDER BY replaced_at ASC, id ASC')
      .all(id) as Array<{ content: string; occurred_at: string | null; replaced_at: string }>
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
    // A voided note no longer counts, so the dates it moved go back (L-05)
    const { rowId, reverted_dates } = db.transaction(() => {
      const entry = cachedStmt('case_log_row_id', 'SELECT row_id FROM case_log WHERE id = ?').get(id) as { row_id: number } | undefined
      db.prepare(`UPDATE case_log SET voided_at = datetime('now'), voided_reason = ? WHERE id = ?`).run(reason ?? 'Voided', id)
      return { rowId: entry?.row_id ?? null, reverted_dates: revertNoteDates(id) }
    })()
    if (rowId) notifyCaseLogChanged(rowId)
    return ok({ reverted_dates })
  })

  secureWrap(IPC.CASE_LOG_UNVOID, 'ipc-caselog', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    const db = getDb()
    // Counting again, it moves its dates again
    const { rowId, updated_dates } = db.transaction(() => {
      const entry = db.prepare('SELECT row_id, log_type, occurred_at, voided_at FROM case_log WHERE id = ?').get(id) as { row_id: number; log_type: string; occurred_at: string | null; voided_at: string | null } | undefined
      db.prepare(`UPDATE case_log SET voided_at = NULL, voided_reason = NULL WHERE id = ?`).run(id)
      const moved = entry?.voided_at && entry.occurred_at ? applyNoteDateUpdates(entry.row_id, entry.log_type, localDayOf(entry.occurred_at), id) : []
      return { rowId: entry?.row_id ?? null, updated_dates: moved }
    })()
    if (rowId) notifyCaseLogChanged(rowId)
    return ok({ updated_dates })
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

  secureWrap(IPC.CASE_LOG_RESTORE, 'ipc-caselog', (_e, entry: { id: number; row_id: number; content: string; log_type: string; is_pinned: number; follow_up_date: string | null; follow_up_completed: number; voided_at: string | null; voided_reason: string | null; created_at: string; occurred_at?: string | null; minutes?: number | null; miles?: number | null; extra_measures?: string | null }) => {
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
    if (entry.occurred_at != null && (typeof entry.occurred_at !== 'string' || isNaN(new Date(entry.occurred_at).getTime()))) return fail('Invalid occurred_at date')
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
      (id, row_id, content, log_type, is_pinned, follow_up_date, follow_up_completed, voided_at, voided_reason, created_at, occurred_at, minutes, miles, extra_measures, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(entry.id, entry.row_id, entry.content, entry.log_type, entry.is_pinned, entry.follow_up_date ?? null, entry.follow_up_completed, entry.voided_at ?? null, entry.voided_reason ?? null, entry.created_at, entry.occurred_at ?? null, restoredMeasures.minutes, restoredMeasures.miles, restoredExtra)
    // Back in the record, it moves its dates again
    let updated_dates: NoteDateUpdate[] = []
    if (!entry.voided_at) {
      const back = db.prepare('SELECT occurred_at FROM case_log WHERE id = ?').get(entry.id) as { occurred_at: string }
      try { updated_dates = applyNoteDateUpdates(entry.row_id, entry.log_type, localDayOf(back.occurred_at), entry.id) } catch (err) { logNonFatal('ipc-caselog', 'note date updates', err) }
    }
    notifyCaseLogChanged(entry.row_id)
    return ok({ updated_dates })
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

  // The day a note happened can be corrected; the day it had before is kept in its edit history
  secureWrap(IPC.CASE_LOG_SET_OCCURRED, 'ipc-caselog', (_e, id: number, occurredOn: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    const day = checkOccurredOn(occurredOn)
    if (day === null || typeof day === 'object') return fail(day?.error ?? 'Choose the day it happened.')
    const db = getDb()
    const note = db.prepare('SELECT row_id, content, log_type, occurred_at, voided_at FROM case_log WHERE id = ?').get(id) as
      { row_id: number; content: string; log_type: string; occurred_at: string | null; voided_at: string | null } | undefined
    if (!note) return fail('Note not found')
    if (note.log_type === 'system') return fail("Pulse's own entries keep their date.")
    if (note.occurred_at && localDayOf(note.occurred_at) === day) return ok({ occurred_at: note.occurred_at, updated_dates: [] as NoteDateUpdate[], reverted_dates: [] as NoteDateRevert[] })
    const occurred_at = occurredTimestamp(day)
    db.transaction(() => {
      db.prepare("INSERT INTO case_log_edits (case_log_id, content, occurred_at, replaced_at) VALUES (?, ?, ?, datetime('now'))").run(id, note.content, note.occurred_at)
      db.prepare(`UPDATE case_log SET occurred_at = ?, updated_at = datetime('now'), original_content = COALESCE(original_content, content),
        edited_at = datetime('now') WHERE id = ?`).run(occurred_at, id)
    })()
    // The dates it moved follow it: put back, then moved again from the new day
    let updated_dates: NoteDateUpdate[] = []
    let reverted_dates: NoteDateRevert[] = []
    if (!note.voided_at) {
      try {
        db.transaction(() => {
          reverted_dates = revertNoteDates(id)
          updated_dates = applyNoteDateUpdates(note.row_id, note.log_type, day, id)
        })()
      } catch (err) { logNonFatal('ipc-caselog', 'note date updates', err) }
    }
    notifyCaseLogChanged(note.row_id)
    return ok({ occurred_at, updated_dates, reverted_dates })
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
