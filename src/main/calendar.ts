/**
 * The calendar's other layers (W07 §6): deadlines, note follow-ups and tasks
 * for a date range. Appointments come from listAppointments.
 */
import { getDb } from './database'
import { loadDeadlines, loadWorkCalendar } from './deadlines'
import { word } from './vocab'
import { HIDDEN_DEADLINES_KEY, parseHiddenColumns, type CalendarItem, type DeadlineDayOption } from '../shared/calendar'
import { LIVE_GRID, LIVE_ROW, NOT_TRASHED_ROW } from '../shared/liveRecords'
import { engineRuleFrom, referencedColumns, type MeterConfig } from '../shared/deadlineEngine'
import { storedDateForDue, type InverseProblem } from '../shared/deadlineInverse'
import { unhandledCase } from '../shared/assertNever'

/** The first words of a note, for its follow-up on the calendar */
export function noteSnippet(content: string, max = 40): string {
  const text = content.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Deadline columns turned off on the calendar (none when never set) */
export function hiddenDeadlineColumns(): Set<number> {
  const raw = (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(HIDDEN_DEADLINES_KEY) as { value: string } | undefined)?.value
  return parseHiddenColumns(raw)
}

/**
 * Everything but appointments in a date range; with `gridId`, only that list's (audit S-32).
 * Deadline columns turned off on the calendar are left out here, so day counts and "N more" stay right.
 */
export function calendarItems(from: string, to: string, gridId?: number): CalendarItem[] {
  const db = getDb()
  const hidden = hiddenDeadlineColumns()
  const deadlines: CalendarItem[] = loadDeadlines({ from, to, ...(gridId !== undefined ? { gridId } : {}) }).filter(d => d.due && !hidden.has(d.column_id)).map(d => ({
    kind: 'deadline', key: `deadline-${d.row_id}-${d.column_id}`, date: d.due!.slice(0, 10), title: d.column_name,
    rowId: d.row_id, gridId: d.grid_id, recordName: d.client_name || '(unnamed)', state: d.state, daysUntil: d.daysUntil, columnId: d.column_id,
  }))
  const followUps = (db.prepare(`
    SELECT cl.id, cl.row_id, r.grid_id, COALESCE(NULLIF(r.display_name, ''), '(unnamed)') AS name, cl.follow_up_date AS due, cl.content
    FROM case_log cl
    JOIN rows r ON r.id = cl.row_id AND ${LIVE_ROW}
    JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
    WHERE cl.follow_up_date BETWEEN ? AND ? AND cl.follow_up_completed = 0 AND cl.voided_at IS NULL AND (? IS NULL OR r.grid_id = ?)
  `).all(from, to, gridId ?? null, gridId ?? null) as Array<{ id: number; row_id: number; grid_id: number; name: string; due: string; content: string }>).map(f => ({
    kind: 'followup' as const, key: `followup-${f.id}`, date: f.due.slice(0, 10), title: noteSnippet(f.content ?? '') || 'Follow-up', rowId: f.row_id, gridId: f.grid_id, recordName: f.name,
  }))
  const tasks = (db.prepare(`
    SELECT ct.id, ct.title, ct.due_date AS due FROM caseload_tasks ct LEFT JOIN grids g ON g.id = ct.grid_id
    WHERE ct.is_completed = 0 AND ct.due_date BETWEEN ? AND ? AND (ct.grid_id IS NULL OR ${LIVE_GRID}) AND (? IS NULL OR ct.grid_id = ?)
  `).all(from, to, gridId ?? null, gridId ?? null) as Array<{ id: number; title: string; due: string }>).map(t => ({
    kind: 'task' as const, key: `task-${t.id}`, date: t.due.slice(0, 10), title: t.title, taskId: t.id,
  }))
  return [...deadlines, ...followUps, ...tasks].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
}

// ── Deadline for a record (calendar-flexibility plan, Part 2) ────────────────

/** The plain reason a deadline can't be set from a due date */
function problemText(p: InverseProblem, names: Map<number, string>, unit: string | null, record: string): string {
  const col = (id: number) => `“${names.get(id) ?? 'another column'}”`
  switch (p.code) {
    case 'meter': return `It's worked out from ${unit ?? 'meter'} readings, so it can't be set from a date.`
    case 'quota': return 'It counts how many are used in a period, so it can\'t be set from a date.'
    case 'sequence': return 'It has steps counted from a start date, so it can\'t be set from a date.'
    case 'anchored': return `It's worked out from ${col(p.columnId)}. Change that date instead.`
    case 'needs_date': return `It repeats each year on the date in ${col(p.columnId)}, which is empty for this ${record}.`
    case 'day_off': return 'That\'s a day off, and this deadline always falls on a working day.'
    case 'month_end': return 'This deadline is always due on the last day of a month.'
    case 'not_on_schedule': return 'This deadline is only due on its scheduled dates.'
    case 'unreachable': return 'This deadline\'s rule can\'t land on that day.'
    default: unhandledCase(p); return 'This deadline can\'t be set from a date.'
  }
}

/**
 * A record's deadline columns, each with the date to store so it's due on
 * `due` (or why that can't be done); null when the record is gone. Works the
 * rule backwards with the record's own values, days off and current date.
 */
export function deadlineOptionsForDay(rowId: number, due: string): DeadlineDayOption[] | null {
  const db = getDb()
  const row = db.prepare(`SELECT r.id, r.grid_id FROM rows r JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID} WHERE r.id = ? AND ${NOT_TRASHED_ROW}`).get(rowId) as { id: number; grid_id: number } | undefined
  if (!row) return null
  const cols = db.prepare(`
    SELECT col.id AS column_id, col.name AS column_name, ar.id, ar.interval_days, ar.interval_months, ar.end_of_month, ar.kind, ar.rule_config, ar.rule_condition, ar.business_days
    FROM columns col JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE col.grid_id = ? AND col.column_type IN ('date', 'deadline') AND json_extract(col.config, '$.alert_rule_id') IS NOT NULL
    ORDER BY col.position, col.id
  `).all(row.grid_id) as Array<{ column_id: number; column_name: string; id: number; interval_days: number | null; interval_months: number | null; end_of_month: number | null; kind: string | null; rule_config: string | null; rule_condition: string | null; business_days: number | null }>
  if (cols.length === 0) return []
  const names = new Map((db.prepare('SELECT id, name FROM columns WHERE grid_id = ?').all(row.grid_id) as Array<{ id: number; name: string }>).map(c => [c.id, c.name]))
  const cellOf = db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?')
  const value = (columnId: number) => (cellOf.get(rowId, columnId) as { value: string | null } | undefined)?.value ?? null
  const cal = loadWorkCalendar()
  return cols.map(c => {
    const rule = engineRuleFrom(c)
    const values: Record<number, string | null> = {}
    for (const id of referencedColumns(rule)) values[id] = value(id)
    const current = value(c.column_id)
    const res = storedDateForDue(rule, due, { values, holidays: cal.holidays, weekend: cal.weekend, current })
    const unit = rule.kind === 'meter' && rule.config ? (rule.config as MeterConfig).unit : null
    return {
      columnId: c.column_id, columnName: c.column_name, current: current || null,
      value: res.ok ? res.value : null,
      reason: res.ok ? null : problemText(res.problem, names, unit, word('record', undefined, row.grid_id)),
      nearest: !res.ok && 'nearest' in res.problem ? res.problem.nearest : [],
    }
  })
}
