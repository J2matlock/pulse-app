/**
 * Marking deadlines done where it takes more than setting a date
 * (plans/generalization/W05-deadline-engine.md §7). Each change is recorded
 * in field history and on the record's timeline, like any edit.
 */
import { getDb } from './database'
import { engineRuleFrom, formatDue, sequenceAnchor, extensionAnchor, referencedColumns, type MeterConfig, type SequenceConfig } from '../shared/deadlineEngine'
import { loadDeadlines } from './deadlines'
import { toYmd } from '../shared/ymd'
import { localDateString } from '../shared/dates'
import { setCellWithHistory } from './cell-write'
import { checkOccurredOn } from './note-date-updates'

/** "Done on another day…": a past day, or today when none is given */
function doneDay(doneOn: string | null | undefined): string {
  const day = checkOccurredOn(doneOn)
  if (day && typeof day === 'object') throw new DeadlineActionError(day.error)
  return day ?? localDateString()
}

/** A problem the person can fix; the message is shown as is. */
export class DeadlineActionError extends Error {}

export interface MeterDoneResult {
  /** Column id → value before, for undo */
  previous: Record<number, string | null>
  sysLogId: number
}

/**
 * "Oil change done at 45,210 mi": the rule's date becomes today (or the day
 * it was really done), and the
 * last-service reading (and the current reading, if it was lower) becomes
 * the reading given.
 */
export function markMeterDone(rowId: number, columnId: number, reading: number, doneOn?: string | null): MeterDoneResult {
  const db = getDb()
  const col = db.prepare(`
    SELECT col.name, r.grid_id AS row_grid, col.grid_id AS col_grid, ar.id, ar.kind, ar.rule_config, ar.rule_condition, ar.business_days,
           ar.interval_days, ar.interval_months, ar.end_of_month
    FROM columns col JOIN rows r ON r.id = ?
    JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE col.id = ?
  `).get(rowId, columnId) as ({ name: string; row_grid: number; col_grid: number } & Parameters<typeof engineRuleFrom>[0]) | undefined
  if (!col || col.row_grid !== col.col_grid) throw new DeadlineActionError('That deadline no longer exists.')
  const rule = engineRuleFrom(col)
  if (rule.kind !== 'meter' || !rule.config) throw new DeadlineActionError("That deadline doesn't use a reading.")
  const cfg = rule.config as MeterConfig
  if (!Number.isFinite(reading) || reading < 0 || reading > 1e10) throw new DeadlineActionError('Enter the reading as a number.')

  const today = doneDay(doneOn)
  const text = String(reading)
  return db.transaction(() => {
    const previous: Record<number, string | null> = {}
    previous[columnId] = setCellWithHistory(rowId, columnId, today)
    previous[cfg.lastServiceReadingColumnId] = setCellWithHistory(rowId, cfg.lastServiceReadingColumnId, text)
    const currentRow = db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, cfg.readingColumnId) as { value: string | null } | undefined
    const current = Number((currentRow?.value ?? '').replace(/,/g, ''))
    if (cfg.readingColumnId !== cfg.lastServiceReadingColumnId && (!currentRow?.value || !Number.isFinite(current) || current < reading)) {
      previous[cfg.readingColumnId] = setCellWithHistory(rowId, cfg.readingColumnId, text)
    }
    db.prepare("UPDATE rows SET updated_at = datetime('now') WHERE id = ?").run(rowId)
    const content = `${col.name} done ${formatDue(today)} at ${reading.toLocaleString('en-US')} ${cfg.unit}`
    const sysLogId = Number(db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))")
      .run(rowId, content).lastInsertRowid)
    return { previous, sysLogId }
  })()
}

/** A deadline column's rule and record, checked to belong together. */
function ruleFor(rowId: number, columnId: number) {
  const db = getDb()
  const col = db.prepare(`
    SELECT col.name, r.grid_id AS row_grid, col.grid_id AS col_grid, ar.id, ar.kind, ar.rule_config, ar.rule_condition, ar.business_days,
           ar.interval_days, ar.interval_months, ar.end_of_month
    FROM columns col JOIN rows r ON r.id = ?
    JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE col.id = ?
  `).get(rowId, columnId) as ({ name: string; row_grid: number; col_grid: number } & Parameters<typeof engineRuleFrom>[0]) | undefined
  if (!col || col.row_grid !== col.col_grid) throw new DeadlineActionError('That deadline no longer exists.')
  return { name: col.name, rule: engineRuleFrom(col) }
}

function cellValue(rowId: number, columnId: number): string | null {
  return (getDb().prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, columnId) as { value: string | null } | undefined)?.value ?? null
}

/** "IFSP meeting done (step 2 of 4)": checks off a step for the current anchor date. */
export function markStepDone(rowId: number, columnId: number, step: number, doneOn?: string | null): { sysLogId: number } {
  const { name, rule } = ruleFor(rowId, columnId)
  if (rule.kind !== 'sequence' || !rule.config) throw new DeadlineActionError("That deadline doesn't have steps.")
  const cfg = rule.config as SequenceConfig
  if (!Number.isInteger(step) || step < 0 || step > cfg.steps.length + 200) throw new DeadlineActionError('That step does not exist.')
  const anchorCol = cfg.anchorColumnId === 'self' ? columnId : cfg.anchorColumnId
  const anchor = sequenceAnchor(rule, cellValue(rowId, columnId), { [anchorCol]: cellValue(rowId, anchorCol) })
  if (!anchor) throw new DeadlineActionError('Enter the date the steps count from first.')
  const day = doneDay(doneOn)
  const db = getDb()
  return db.transaction(() => {
    db.prepare('INSERT OR REPLACE INTO deadline_progress (row_id, column_id, step, done_at, anchor_value) VALUES (?, ?, ?, ?, ?)')
      .run(rowId, columnId, step, day, anchor)
    const n = cfg.steps.length
    const on = day === localDateString() ? '' : ` on ${formatDue(day)}`
    const label = step < n ? `${cfg.steps[step]!.label} done${on} (step ${step + 1} of ${n})` : `${cfg.steps[n - 1]!.label} done${on} (repeat ${step - n + 1})`
    const sysLogId = Number(db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))")
      .run(rowId, `${name}: ${label}`).lastInsertRowid)
    db.prepare("UPDATE rows SET updated_at = datetime('now') WHERE id = ?").run(rowId)
    return { sysLogId }
  })()
}

/** Undo a step (the timeline entry is voided by the caller's undo). */
export function undoStep(rowId: number, columnId: number, step: number): void {
  getDb().prepare('DELETE FROM deadline_progress WHERE row_id = ? AND column_id = ? AND step = ?').run(rowId, columnId, step)
}

/**
 * Give a deadline a new date with a reason ("waiting on the doctor's report").
 * It's tied to the date it extends, so a new cycle doesn't inherit it, and
 * replaces any extension already in effect for the same deadline.
 */
export function extendDeadline(rowId: number, columnId: number, newDue: string, reason: string): { id: number; sysLogId: number } {
  const { name, rule } = ruleFor(rowId, columnId)
  const due = toYmd(newDue)
  if (!due || due !== newDue) throw new DeadlineActionError('Choose the new date.')
  const why = reason.replace(/\s+/g, ' ').trim()
  if (!why) throw new DeadlineActionError('Say why it is being extended.')
  if (why.length > 500) throw new DeadlineActionError('Keep the reason under 500 characters.')
  // What's due now, without any extension, worked out the same way the lists do
  const current = loadDeadlines({ rowIds: [rowId], includePaused: true }).find(d => d.column_id === columnId)
  const original = current?.extended?.from ?? current?.due
  if (!current || !original) throw new DeadlineActionError('There is nothing due to extend.')
  if (due === original) throw new DeadlineActionError('That is already the due date.')
  const values: Record<number, string | null> = {}
  for (const id of referencedColumns(rule)) values[id] = cellValue(rowId, id)
  const anchor = extensionAnchor(rule, cellValue(rowId, columnId), values)
  const db = getDb()
  return db.transaction(() => {
    db.prepare("UPDATE deadline_extensions SET revoked_at = datetime('now') WHERE row_id = ? AND column_id = ? AND revoked_at IS NULL AND COALESCE(step, -1) = COALESCE(?, -1)")
      .run(rowId, columnId, current.step ?? null)
    const id = Number(db.prepare('INSERT INTO deadline_extensions (row_id, column_id, step, original_due, new_due, reason, anchor_value) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(rowId, columnId, current.step ?? null, original, due, why, anchor).lastInsertRowid)
    const sysLogId = Number(db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))")
      .run(rowId, `${name} extended to ${formatDue(due)} (was ${formatDue(original)}): ${why}`).lastInsertRowid)
    return { id, sysLogId }
  })()
}

/** Remove an extension; the deadline goes back to its own date. */
export function revokeExtension(extensionId: number): { rowId: number; sysLogId: number } {
  const db = getDb()
  const ext = db.prepare(`SELECT e.row_id, e.original_due, col.name FROM deadline_extensions e JOIN columns col ON col.id = e.column_id
    WHERE e.id = ? AND e.revoked_at IS NULL`).get(extensionId) as { row_id: number; original_due: string; name: string } | undefined
  if (!ext) throw new DeadlineActionError('That extension was already removed.')
  return db.transaction(() => {
    db.prepare("UPDATE deadline_extensions SET revoked_at = datetime('now') WHERE id = ?").run(extensionId)
    const sysLogId = Number(db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))")
      .run(ext.row_id, `${ext.name} extension removed (due ${formatDue(ext.original_due)} again)`).lastInsertRowid)
    return { rowId: ext.row_id, sysLogId }
  })()
}

/** Undo support: turn an extension on or off without a timeline entry (the undo voids the original entry). */
export function setExtensionActive(extensionId: number, active: boolean): void {
  getDb().prepare(`UPDATE deadline_extensions SET revoked_at = ${active ? 'NULL' : "datetime('now')"} WHERE id = ?`).run(extensionId)
}
