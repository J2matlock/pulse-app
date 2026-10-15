/**
 * export-planner.ts — printable lists of what's due (PDF).
 *
 * "Print what's due" lists what the dashboard's Overdue and Next N days tabs
 * list (deadlines by effective due date, checklist items, tasks, follow-ups,
 * optionally appointments), worst first, with a check-off box. The weekly
 * planner lists one calendar week. Many field workers prefer paper.
 */

import { getDb } from './database'
import { jsPDF, autoTable, lastTableY, atomicWriteFileAsync, stripHtml } from './export-shared'
import { loadDeadlines } from './deadlines'
import { featureOn, word } from './vocab'
import { formatTime } from '../shared/calendar'
import { OPEN_RECORD_SQL } from '../shared/appointments'
import { addDays, daysBetween, toYmd } from '../shared/ymd'
import { LIVE_GRID, LIVE_ROW } from '../shared/liveRecords'
import { localDateString, shortDate, ymdLocalDate } from '../shared/dates'
import { dueWithin, isLateDeadline } from '../shared/deadlineTiles'
import { deadlineLabel } from '../shared/deadlineLabel'
import type { DeadlineState } from '../shared/deadlineEngine'

interface PlannerRow { due: string; client: string; what: string; kind: string }

const DAY_FMT: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', DAY_FMT)
}


/** Everything due on or before `end`; rows before `start` are "overdue". */
export function loadPlannerRows(start: string, end: string): { week: PlannerRow[]; overdue: PlannerRow[] } {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT cl.follow_up_date AS due, r.display_name AS client, cl.content AS what, 'Follow-up' AS kind
      FROM case_log cl
      JOIN rows r  ON r.id = cl.row_id AND ${LIVE_ROW}
      JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
      WHERE cl.follow_up_date IS NOT NULL AND cl.follow_up_completed = 0 AND cl.voided_at IS NULL
      UNION ALL
      SELECT ci.due_date, r.display_name, ci.title, 'Checklist'
      FROM checklist_items ci
      JOIN rows r  ON r.id = ci.row_id AND ${LIVE_ROW}
      JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
      WHERE ci.is_completed = 0 AND COALESCE(ci.is_archived, 0) = 0 AND ci.due_date IS NOT NULL
      UNION ALL
      SELECT ct.due_date, '', ct.title, 'Task'
      FROM caseload_tasks ct
      LEFT JOIN grids g ON g.id = ct.grid_id
      WHERE ct.is_completed = 0 AND ct.due_date IS NOT NULL AND (ct.grid_id IS NULL OR ${LIVE_GRID})
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

// ── What's due (persona study R7) ────────────────────────────────────────────

/** One line of "Print what's due" */
export interface DueRow {
  due: string
  /** Days from today; negative is late */
  daysUntil: number
  /** Late, or a used-up quota: the dashboard's Overdue (isLateDeadline) */
  late: boolean
  client: string
  what: string
  kind: string
}

export interface WhatsDueOptions {
  /** List scheduled appointments too (only while the feature is on) */
  includeAppointments?: boolean
  /** For tests: the day to count from */
  today?: string
}

/**
 * The dashboard's Overdue tab plus its next-`days` window, over the same items
 * (every deadline whatever its colour rules, checklist items, tasks with a due
 * date that aren't snoozed, follow-ups), counted the same way (`isLateDeadline`,
 * `dueWithin`), and named the same way (`deadlineLabel`). Late first, the most
 * late first, then the soonest.
 */
export function loadDueRows(days: number, opts: WhatsDueOptions = {}): DueRow[] {
  const today = opts.today ?? localDateString()
  const end = addDays(today, days)
  const db = getDb()
  const out: DueRow[] = []
  const keep = (r: Omit<DueRow, 'late'> & { state?: DeadlineState }) => {
    const late = isLateDeadline(r)
    if (!late && !dueWithin(r, days)) return
    out.push({ due: r.due, daysUntil: r.daysUntil, late, client: r.client, what: r.what, kind: r.kind })
  }

  const rules = new Map((db.prepare('SELECT id, name, kind, rule_config FROM alert_rules').all() as Array<{ id: number; name: string; kind: string | null; rule_config: string | null }>).map(r => [r.id, r]))
  for (const d of loadDeadlines({ today })) {
    if (d.daysUntil === null || !d.due) continue
    let ruleId: number | null = null
    try { ruleId = (JSON.parse(d.column_config || '{}') as { alert_rule_id?: number }).alert_rule_id ?? null } catch { /* the plain column name below */ }
    const what = deadlineLabel(ruleId != null ? rules.get(ruleId) : null, { name: d.column_name }).title
    keep({ due: d.due, daysUntil: d.daysUntil, state: d.state, client: d.client_name ?? '', what, kind: 'Deadline' })
  }

  const dated = (due: string) => ({ due, daysUntil: daysBetween(today, due) })
  const others = db.prepare(`
    SELECT cl.follow_up_date AS due, r.display_name AS client, cl.content AS what, 'Follow-up' AS kind
    FROM case_log cl
    JOIN rows r  ON r.id = cl.row_id AND ${LIVE_ROW}
    JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
    WHERE cl.follow_up_date IS NOT NULL AND cl.follow_up_completed = 0 AND cl.voided_at IS NULL AND cl.follow_up_date <= ?
  `).all(end) as Array<{ due: string; client: string | null; what: string; kind: string }>
  if (featureOn('checklists')) {
    others.push(...db.prepare(`
      SELECT ci.due_date AS due, r.display_name AS client, ci.title AS what, 'Checklist' AS kind
      FROM checklist_items ci
      JOIN rows r  ON r.id = ci.row_id AND ${LIVE_ROW}
      JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
      WHERE ci.is_completed = 0 AND COALESCE(ci.is_archived, 0) = 0 AND ci.due_date IS NOT NULL AND ci.due_date <= ?
    `).all(end) as typeof others)
  }
  if (featureOn('tasks')) {
    // Like the dashboard: a snoozed task waits until its snooze ends
    others.push(...db.prepare(`
      SELECT ct.due_date AS due, '' AS client, ct.title AS what, 'Task' AS kind
      FROM caseload_tasks ct
      LEFT JOIN grids g ON g.id = ct.grid_id
      WHERE ct.is_completed = 0 AND ct.due_date IS NOT NULL AND ct.due_date <= ?
        AND (ct.snoozed_until IS NULL OR ct.snoozed_until <= ?) AND (ct.grid_id IS NULL OR ${LIVE_GRID})
    `).all(end, today) as typeof others)
  }
  for (const o of others) {
    const due = toYmd(o.due)
    if (due) keep({ ...dated(due), client: o.client ?? '', what: stripHtml(o.what ?? '').replace(/\s+/g, ' ').trim(), kind: o.kind })
  }

  if (opts.includeAppointments && featureOn('appointments')) {
    const appts = db.prepare(`SELECT a.title, a.start_at, a.all_day, COALESCE(r.display_name, '') AS client FROM appointments a LEFT JOIN rows r ON r.id = a.row_id LEFT JOIN grids g ON g.id = r.grid_id
      WHERE a.status = 'scheduled' AND a.start_at >= ? AND a.start_at <= ? AND ${OPEN_RECORD_SQL}`).all(today, `${end}T99:99`) as Array<{ title: string; start_at: string; all_day: number; client: string }>
    for (const a of appts) {
      keep({ ...dated(a.start_at.slice(0, 10)), client: a.client, what: a.all_day ? a.title : `${formatTime(a.start_at, '12h')}  ${a.title}`, kind: word('appointment', { cap: true }) })
    }
  }

  out.sort((a, b) => (a.late === b.late ? 0 : a.late ? -1 : 1) || a.daysUntil - b.daysUntil
    || a.client.localeCompare(b.client) || a.what.localeCompare(b.what))
  return out.map(r => ({ ...r, what: r.what.length > 120 ? r.what.slice(0, 117) + '…' : r.what }))
}

/** "12 days late", "Today", "Tomorrow", "in 7 days"; a used-up quota is due "Now" */
export function daysLeftText(r: Pick<DueRow, 'daysUntil' | 'late'>): string {
  const n = r.daysUntil
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} late`
  if (r.late) return 'Now'
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  return `in ${n} days`
}

/** "Oct 15 – Nov 14, 2026", or with both years when the range crosses one */
export function dueRangeText(start: string, end: string): string {
  const a = ymdLocalDate(start), b = ymdLocalDate(end)
  const day = (d: Date) => shortDate(d).replace(/, \d+$/, '')
  return a.getFullYear() === b.getFullYear() ? `${day(a)} – ${shortDate(b)}` : `${shortDate(a)} – ${shortDate(b)}`
}

const BLACK = [0, 0, 0]
/** 1 pt in mm */
const PT = 0.3528

/**
 * "Print what's due": overdue and the next `days` days, worst first, in letters
 * a low-vision reader can read (12 pt body, 14 pt headings, black on white, no
 * colour that carries meaning on its own: late lines are bold).
 */
export async function exportWhatsDue(days: number, destPath: string, workerName?: string, opts: WhatsDueOptions = {}): Promise<number> {
  const today = opts.today ?? localDateString()
  const rows = loadDueRows(days, { ...opts, today })
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const marginL = 12
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(`What's due: next ${days} days (${dueRangeText(today, addDays(today, days))})`, marginL, 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text(`${workerName ? workerName + '  ·  ' : ''}Printed ${shortDate(new Date())}  ·  Contains ${word('record')} information — keep secure`, marginL, 25)
  const late = rows.filter(r => r.late).length
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  // The same rows as the dashboard, so this can't say "nothing" while it lists something
  if (rows.length === 0) {
    doc.text(`Nothing is overdue or due in the next ${days} days.`, marginL, 34)
    await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
    return 0
  }
  doc.text(`${late} overdue, ${rows.length - late} coming up: late first, then the soonest`, marginL, 34)

  const head = [['Done', 'Days left', 'Due', word('record', { cap: true }), 'What', 'Kind']]
  const body = rows.map(r => ['', daysLeftText(r), fmtDay(r.due), r.client || '—', r.what, r.kind])
  autoTable(doc, {
    startY: 39,
    head,
    body,
    styles: { fontSize: 12, cellPadding: 2, textColor: BLACK, lineColor: BLACK, lineWidth: 0 },
    headStyles: { fillColor: [255, 255, 255], textColor: BLACK, fontStyle: 'bold', fontSize: 12, lineColor: BLACK, lineWidth: { bottom: PT } },
    bodyStyles: { lineColor: BLACK, lineWidth: { bottom: PT / 4 } },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    // Widths fit the longest header word and "123 days late" at 12 pt, so no word wraps
    columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 33, fontStyle: 'bold' }, 2: { cellWidth: 27 }, 3: { cellWidth: 38 }, 5: { cellWidth: 28 } },
    margin: { left: marginL, right: marginL },
    didParseCell: (data: { section: string; row: { index: number }; cell: { styles: Record<string, unknown> } }) => {
      // Late is bold, not only a colour
      if (data.section === 'body' && rows[data.row.index]?.late) data.cell.styles.fontStyle = 'bold'
    },
    // Standard PDF fonts have no check-mark glyph, so the Done column gets a drawn box to tick
    didDrawCell: (data: { section: string; column: { index: number }; cell: { x: number; y: number; height: number } }) => {
      if (data.section !== 'body' || data.column.index !== 0) return
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(PT)
      doc.rect(data.cell.x + 5, data.cell.y + 2, 5, 5)
    },
  })
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
  return rows.length
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
  doc.text(`${workerName ? workerName + '  ·  ' : ''}Printed ${shortDate(new Date())}  ·  Contains ${word('record')} information — keep secure`, marginL, 25)

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
