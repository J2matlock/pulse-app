/**
 * The calendar's other layers (W07 §6): deadlines, note follow-ups and tasks
 * for a date range. Appointments come from listAppointments.
 */
import { getDb } from './database'
import { loadDeadlines } from './deadlines'
import { HIDDEN_DEADLINES_KEY, parseHiddenColumns, type CalendarItem } from '../shared/calendar'
import { LIVE_GRID, LIVE_ROW } from '../shared/liveRecords'

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
