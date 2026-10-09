/**
 * The calendar's other layers (W07 §6): deadlines, note follow-ups and tasks
 * for a date range. Appointments come from listAppointments.
 */
import { getDb } from './database'
import { loadDeadlines } from './deadlines'
import type { CalendarItem } from '../shared/calendar'

export function calendarItems(from: string, to: string): CalendarItem[] {
  const db = getDb()
  const deadlines: CalendarItem[] = loadDeadlines({ from, to }).filter(d => d.due).map(d => ({
    kind: 'deadline', key: `deadline-${d.row_id}-${d.column_id}`, date: d.due!.slice(0, 10), title: d.column_name,
    rowId: d.row_id, gridId: d.grid_id, recordName: d.client_name || '(unnamed)', state: d.state, daysUntil: d.daysUntil, columnId: d.column_id,
  }))
  const followUps = (db.prepare(`
    SELECT cl.id, cl.row_id, r.grid_id, COALESCE(NULLIF(r.display_name, ''), '(unnamed)') AS name, cl.follow_up_date AS due, cl.content
    FROM case_log cl
    JOIN rows r ON r.id = cl.row_id AND r.is_active = 1 AND r.deleted_at IS NULL
    JOIN grids g ON g.id = r.grid_id AND g.is_active = 1
    WHERE cl.follow_up_date BETWEEN ? AND ? AND cl.follow_up_completed = 0 AND cl.voided_at IS NULL
  `).all(from, to) as Array<{ id: number; row_id: number; grid_id: number; name: string; due: string; content: string }>).map(f => ({
    kind: 'followup' as const, key: `followup-${f.id}`, date: f.due.slice(0, 10), title: 'Follow-up', rowId: f.row_id, gridId: f.grid_id, recordName: f.name,
  }))
  const tasks = (db.prepare(`
    SELECT ct.id, ct.title, ct.due_date AS due FROM caseload_tasks ct LEFT JOIN grids g ON g.id = ct.grid_id
    WHERE ct.is_completed = 0 AND ct.due_date BETWEEN ? AND ? AND (ct.grid_id IS NULL OR g.is_active = 1)
  `).all(from, to) as Array<{ id: number; title: string; due: string }>).map(t => ({
    kind: 'task' as const, key: `task-${t.id}`, date: t.due.slice(0, 10), title: t.title,
  }))
  return [...deadlines, ...followUps, ...tasks].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
}
