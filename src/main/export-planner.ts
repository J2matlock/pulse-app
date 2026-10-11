/**
 * export-planner.ts — one-page printable weekly planner (PDF).
 *
 * Lists everything due in a Monday–Sunday week (deadlines by effective due
 * date, follow-ups, tasks, checklist items) with a check-off box and room to
 * write, plus anything already overdue. Many field workers prefer paper.
 */

import { getDb } from './database'
import { jsPDF, autoTable, lastTableY, atomicWriteFileAsync } from './export-shared'
import { loadDeadlines } from './deadlines'
import { featureOn, word } from './vocab'
import { formatTime } from '../shared/calendar'
import { OPEN_RECORD_SQL } from '../shared/appointments'
import { dateToYmd } from '../shared/ymd'

interface PlannerRow { due: string; client: string; what: string; kind: string }

const DAY_FMT: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', DAY_FMT)
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return dateToYmd(new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + n))
}

/** Everything due on or before `end`; rows before `start` are "overdue". */
export function loadPlannerRows(start: string, end: string): { week: PlannerRow[]; overdue: PlannerRow[] } {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT cl.follow_up_date AS due, r.display_name AS client, cl.content AS what, 'Follow-up' AS kind
      FROM case_log cl
      JOIN rows r  ON r.id = cl.row_id AND r.is_active = 1 AND r.deleted_at IS NULL
      JOIN grids g ON g.id = r.grid_id AND g.is_active = 1
      WHERE cl.follow_up_date IS NOT NULL AND cl.follow_up_completed = 0 AND cl.voided_at IS NULL
      UNION ALL
      SELECT ci.due_date, r.display_name, ci.title, 'Checklist'
      FROM checklist_items ci
      JOIN rows r  ON r.id = ci.row_id AND r.is_active = 1 AND r.deleted_at IS NULL
      JOIN grids g ON g.id = r.grid_id AND g.is_active = 1
      WHERE ci.is_completed = 0 AND COALESCE(ci.is_archived, 0) = 0 AND ci.due_date IS NOT NULL
      UNION ALL
      SELECT ct.due_date, '', ct.title, 'Task'
      FROM caseload_tasks ct
      LEFT JOIN grids g ON g.id = ct.grid_id
      WHERE ct.is_completed = 0 AND ct.due_date IS NOT NULL AND (ct.grid_id IS NULL OR g.is_active = 1)
    )
    WHERE due IS NOT NULL AND due <= ?
  `).all(end) as PlannerRow[]
  // Deadlines come from the shared engine, then everything is sorted together
  const deadlines: PlannerRow[] = loadDeadlines({ to: end }).map(d => ({ due: d.due!, client: d.client_name ?? '', what: d.column_name, kind: 'Deadline' }))
  rows.push(...deadlines)
  // Scheduled appointments this week, with their times (W07 §7)
  if (featureOn('appointments')) {
    const appts = db.prepare(`SELECT a.title, a.start_at, a.all_day, COALESCE(r.display_name, '') AS client FROM appointments a LEFT JOIN rows r ON r.id = a.row_id LEFT JOIN grids g ON g.id = r.grid_id
      WHERE a.status = 'scheduled' AND a.start_at >= ? AND a.start_at <= ? AND ${OPEN_RECORD_SQL}`).all(start, `${end}T99:99`) as Array<{ title: string; start_at: string; all_day: number; client: string }>
    rows.push(...appts.map(a => ({ due: a.start_at.slice(0, 10), client: a.client, what: a.all_day ? a.title : `${formatTime(a.start_at, '12h')}  ${a.title}`, kind: word('appointment', { cap: true }) })))
  }
  rows.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (a.client ?? '') < (b.client ?? '') ? -1 : (a.client ?? '') > (b.client ?? '') ? 1 : 0))
  // Follow-up text can be long; the planner is for scanning
  const trimmed = rows.map(r => ({ ...r, what: r.what.length > 90 ? r.what.slice(0, 87) + '…' : r.what }))
  return {
    week: trimmed.filter(r => r.due >= start),
    overdue: trimmed.filter(r => r.due < start),
  }
}

export async function exportWeeklyPlanner(weekStart: string, destPath: string, workerName?: string): Promise<void> {
  const end = addDays(weekStart, 6)
  const { week, overdue } = loadPlannerRows(weekStart, end)

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const marginL = 14
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(`Week of ${fmtDay(weekStart)} – ${fmtDay(end)}`, marginL, 18)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`${workerName ? workerName + '  ·  ' : ''}Printed ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}  ·  Contains ${word('record')} information — keep secure`, marginL, 25)

  const body = (list: PlannerRow[]) => list.map(r => ['', fmtDay(r.due), r.client || '—', r.what, r.kind, ''])
  // Standard PDF fonts have no check-mark glyph, so the tick column is a plain box
  const head = [['Done', 'Due', word('record', { cap: true }), 'What', 'Type', 'Notes']]
  const columnStyles = { 0: { cellWidth: 11 }, 1: { cellWidth: 24 }, 2: { cellWidth: 38 }, 4: { cellWidth: 20 }, 5: { cellWidth: 40 } }

  let y = 31
  if (overdue.length > 0) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(185, 28, 28)
    doc.text(`Overdue (${overdue.length})`, marginL, y + 4)
    doc.setTextColor(0, 0, 0)
    autoTable(doc, { startY: y + 7, head, body: body(overdue), styles: { fontSize: 9, cellPadding: 1.8 }, headStyles: { fillColor: [185, 28, 28] }, columnStyles, margin: { left: marginL, right: marginL } })
    y = lastTableY(doc) + 6
  }
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text(`This week (${week.length})`, marginL, y + 4)
  autoTable(doc, {
    startY: y + 7,
    head,
    body: week.length > 0 ? body(week) : [['', '', '', 'Nothing due this week', '', '']],
    styles: { fontSize: 9, cellPadding: 1.8 },
    headStyles: { fillColor: [51, 65, 85] },
    columnStyles,
    margin: { left: marginL, right: marginL },
  })
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
}
