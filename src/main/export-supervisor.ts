/**
 * export-supervisor.ts — the Summary report (formerly "Supervisor report"), PDF and CSV.
 */

import Papa from 'papaparse'

import type { Grid } from '../shared/types'
import { getDb } from './database'
import { activityLabel } from './activity-types'

import {
  jsPDF,
  autoTable,
  lastTableY,
  atomicWriteFileAsync,
  sanitizeCsvFormula,
  formatCellValue,
  cellDisplayText,
  batchGetClientNames,
  stripHtml,
  loadGridData,
  pickColumns,
  showDeadlinesAsText,
  savedDateFormat,
  lineHeight,
} from './export-shared'
import type { SupervisorReportOptions } from './export-shared'
import { parseDbTimestamp, shortDate } from '../shared/dates'
import { toRuleInterval } from '../shared/ruleInterval'
import { localDateString } from '../shared/dates'
import { toYmd, ymdToDate } from '../shared/ymd'
import { evaluate, isUsedUp } from '../shared/deadlineEngine'
import { loadDeadlines } from './deadlines'
import { PRODUCT_NAME } from '../shared/constants'
import { vocabFor } from './vocab'
import { HUMAN_SERVICES_VOCAB, term } from '../shared/vocab'
import { ARCHIVED_ROW, LIVE_ROW, NOT_TRASHED_ROW, archivedRow, liveRow, notTrashedRow } from '../shared/liveRecords'

export async function exportSupervisorReport(options: SupervisorReportOptions): Promise<void> {
  // Report words follow the list's vocabulary ("Total Active Clients" / "Total Active Vehicles")
  const v = vocabFor(options.gridId)
  const recs = term(v, 'record', { many: true })
  const RecCap = term(v, 'record', { cap: true }), RecsCap = term(v, 'record', { many: true, cap: true })
  const ListCap = term(v, 'list', { cap: true })
  const WorkerCap = term(v, 'worker', { cap: true })
  const acts = term(v, 'activity', { many: true }), ActsCap = term(v, 'activity', { many: true, cap: true })
  const Pri = term(v, 'priority', { cap: true }), PriMany = term(v, 'priority', { many: true, cap: true })
  // "Protected health information" is a legal term for human services; a car shop's report
  // shouldn't claim it. Other words get a plain confidentiality line in their own record word.
  const confidentialBanner = v.record.one.toLowerCase() === HUMAN_SERVICES_VOCAB.record.one
    ? 'CONFIDENTIAL \u2014 PROTECTED HEALTH INFORMATION'
    : `CONFIDENTIAL \u2014 CONTAINS ${term(v, 'record').toUpperCase()} INFORMATION`
  const { gridId, dateRange, columnIds, includeActivityLog, includeSystemActivity, includeTaskSummary, format, destPath, workerName, workerTitle, workerOrg } = options
  const db = getDb()
  const grid = db.prepare('SELECT * FROM grids WHERE id = ?').get(gridId) as Grid & { acuity_enabled?: number }
  // The roster shows what the table shows: deadlines as "Due …", Age and Days-until worked out,
  // linked records by name and file counts, from the same loader as the other exports (AUDIT-036)
  // Hidden columns too: the dialog offers them, and nothing chosen still means the visible ones (Q-034)
  const { columns: allColumns, rows } = loadGridData(gridId, { includeHidden: true })
  const selectedColumns = pickColumns(allColumns, columnIds)
  showDeadlinesAsText(gridId, selectedColumns, rows)
  const rosterText = (format: 'csv' | 'pdf') => rows.map(r => selectedColumns.map(col => {
    const value = (r[`col_${col.id}` as const] as string | null | undefined) ?? null
    return format === 'csv' ? formatCellValue(value, col.column_type) : cellDisplayText(value, col.column_type)
  }))

  // Compute stats
  const totalActive = (db.prepare(`SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND ${liveRow('')}`).get(gridId) as { n: number }).n
  // Added in the period, archived since or not, so "N new, M archived" adds up and an
  // old period's figure doesn't shrink as records are archived later (F-018)
  const newAdded = (db.prepare(`
    SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND ${notTrashedRow('')}
    AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?
  `).get(gridId, dateRange.start, dateRange.end) as { n: number }).n

  const archivedClients = (db.prepare(`
    SELECT COUNT(*) as n FROM rows
    WHERE grid_id = ? AND ${archivedRow('')}
    AND date(archived_at, 'localtime') >= ? AND date(archived_at, 'localtime') <= ?
  `).get(gridId, dateRange.start, dateRange.end) as { n: number }).n

  const deletedClients = (db.prepare(`
    SELECT COUNT(*) as n FROM rows
    WHERE grid_id = ? AND deleted_at IS NOT NULL
    AND date(deleted_at, 'localtime') >= ? AND date(deleted_at, 'localtime') <= ?
  `).get(gridId, dateRange.start, dateRange.end) as { n: number }).n

  // Names of archived clients in this period (for the report detail)
  const archivedClientNames = archivedClients > 0
    ? db.prepare(`
        SELECT r.display_name AS client_name,
               date(r.archived_at, 'localtime') AS archived_date,
               COALESCE(r.archived_reason, '') AS reason
        FROM rows r
        WHERE r.grid_id = ? AND ${ARCHIVED_ROW}
          AND date(r.archived_at, 'localtime') >= ? AND date(r.archived_at, 'localtime') <= ?
        ORDER BY r.archived_at DESC
      `).all(gridId, dateRange.start, dateRange.end) as Array<{ client_name: string; archived_date: string; reason: string }>
    : []

  // Names of deleted clients in this period (for the report detail)
  const deletedClientNames = deletedClients > 0
    ? db.prepare(`
        SELECT r.display_name AS client_name,
               date(r.deleted_at, 'localtime') AS deleted_date
        FROM rows r
        WHERE r.grid_id = ? AND r.deleted_at IS NOT NULL
          AND date(r.deleted_at, 'localtime') >= ? AND date(r.deleted_at, 'localtime') <= ?
        ORDER BY r.deleted_at DESC
      `).all(gridId, dateRange.start, dateRange.end) as Array<{ client_name: string; deleted_date: string }>
    : []

  // New client names in this period (for the report detail)
  const newClientNames = newAdded > 0
    ? db.prepare(`
        SELECT r.display_name AS client_name,
               date(r.created_at, 'localtime') AS added_date
        FROM rows r
        WHERE r.grid_id = ? AND ${NOT_TRASHED_ROW}
          AND date(r.created_at, 'localtime') >= ? AND date(r.created_at, 'localtime') <= ?
        ORDER BY r.created_at DESC
      `).all(gridId, dateRange.start, dateRange.end) as Array<{ client_name: string; added_date: string }>
    : []

  // Acuity breakdown (if enabled)
  interface AcuityRow { name: string; points: number; color: string; cnt: number }
  let acuityBreakdown: AcuityRow[] = []
  let acuityTotal = 0
  const acuityEnabled = !!grid.acuity_enabled
  if (acuityEnabled) {
    acuityBreakdown = db.prepare(`
      SELECT al.name, al.points, al.color, COUNT(r.id) as cnt
      FROM acuity_levels al
      LEFT JOIN rows r ON r.acuity_level_id = al.id AND ${LIVE_ROW} AND r.grid_id = ?
      WHERE al.grid_id = ?
      GROUP BY al.id ORDER BY al.position
    `).all(gridId, gridId) as AcuityRow[]
    acuityTotal = acuityBreakdown.reduce((sum, a) => sum + a.cnt * a.points, 0)
  }

  // Overdue / at-risk deadline snapshot, worked out by the shared engine like the dashboard.
  // Old-style columns that keep `interval_days` in their own config (no rule) count too (D-011).
  const todayYmd = localDateString()
  const legacy = (db.prepare(`
    SELECT r.id AS row_id, c.value, CAST(json_extract(col.config, '$.interval_days') AS INTEGER) AS days
    FROM cells c
    JOIN rows r ON r.id = c.row_id AND ${LIVE_ROW} AND r.grid_id = ?
    JOIN columns col ON col.id = c.column_id AND col.column_type = 'date'
    WHERE c.value IS NOT NULL AND c.value != ''
      AND json_extract(col.config, '$.alert_rule_id') IS NULL AND json_extract(col.config, '$.interval_days') IS NOT NULL
  `).all(gridId) as Array<{ row_id: number; value: string; days: number | null }>).map(l => ({ row_id: l.row_id, ...evaluate(
    { id: 0, kind: 'interval', interval: toRuleInterval(l.days ?? 0), config: null, condition: null, businessDays: false },
    { today: todayYmd, columnDate: l.value },
  ) }))
  // The sentence says "N records", so count records, not deadlines; a used-up quota is
  // overdue, as on the dashboard and in the briefing (deadlineCounts) (F-017)
  const overdueRows = new Set<number>(), approachingRows = new Set<number>()
  for (const d of [...loadDeadlines({ gridId, today: todayYmd }), ...legacy]) {
    if (d.daysUntil === null) continue
    if (d.daysUntil < 0 || isUsedUp(d)) overdueRows.add(d.row_id)
    else if (d.daysUntil <= 7) approachingRows.add(d.row_id)
  }
  const overdueCount = overdueRows.size
  const approachingCount = approachingRows.size

  // The period's ends are calendar days; new Date('2026-10-01') would be UTC midnight, a day early in the US
  const periodDate = (s: string) => {
    const ymd = toYmd(s)
    return shortDate(ymd ? ymdToDate(ymd) : parseDbTimestamp(s))
  }
  const dateRangeLabel = `${periodDate(dateRange.start)} \u2013 ${periodDate(dateRange.end)}`
  // Deadlines are as they stand today, whatever the period; say so (F-017)
  const asOf = `as of ${periodDate(todayYmd)}`
  const recordsWord = (n: number) => `${n} ${term(v, 'record', { count: n })}`

  // Build executive summary paragraph
  const summaryParts: string[] = []
  // The deleted figure counts what is still in the Trash, so it can drop after Empty Trash or a restore (D-012)
  summaryParts.push(`During ${dateRangeLabel}, ${workerName || `the ${term(v, 'worker')}`} managed ${totalActive} active ${recs} (${newAdded} new, ${archivedClients} archived, ${deletedClients} deleted and still in the Trash).`)
  if (overdueCount > 0) summaryParts.push(`${asOf.charAt(0).toUpperCase()}${asOf.slice(1)}, ${recordsWord(overdueCount)} ${overdueCount === 1 ? 'has' : 'have'} overdue deadlines.`)
  if (approachingCount > 0) summaryParts.push(`${approachingCount} ${approachingCount === 1 ? 'has' : 'have'} deadlines within 7 days.`)
  if (acuityEnabled && acuityBreakdown.length > 0) {
    const parts = acuityBreakdown.filter(a => a.cnt > 0).map(a => `${a.cnt} ${a.name} (${a.cnt * a.points} pts)`)
    if (parts.length > 0) summaryParts.push(`${Pri}: ${parts.join(', ')} — Total: ${acuityTotal} pts.`)
  }
  const executiveSummary = summaryParts.join(' ')

  // Build acuity label for summary rows
  const acuityLabel = acuityBreakdown.filter(a => a.cnt > 0).map(a => `${a.cnt} ${a.name} (${a.cnt * a.points} pts)`).join(', ') + (acuityTotal > 0 ? ` — Total: ${acuityTotal} pts` : '')

  if (format === 'csv') {
    // ── CSV report ──
    // Every date column follows Settings → Date format, like the roster beside it (Q-076)
    const dateFormat = savedDateFormat()
    const csvDate = (ymd: string | null | undefined) => formatCellValue(ymd ? ymd.slice(0, 10) : null, 'date', dateFormat)
    const csvSections: unknown[][] = [
      [confidentialBanner],
      [],
      ['Summary report', ''],
      [ListCap, sanitizeCsvFormula(grid.name)],
      [WorkerCap, sanitizeCsvFormula(workerName || '')],
      ['Title', sanitizeCsvFormula(workerTitle || '')],
      ['Organization', sanitizeCsvFormula(workerOrg || '')],
      ['Period', dateRangeLabel],
      ['Generated', `${new Date().toLocaleDateString()} — ${PRODUCT_NAME}`],
      [],
      ['Executive Summary'],
      [sanitizeCsvFormula(executiveSummary)],
      [],
      ['Summary'],
      [`Total Active ${RecsCap}`, String(totalActive)],
      [`New ${RecsCap} (Period)`, String(newAdded)],
      [`${RecsCap} Archived (Period)`, String(archivedClients)],
      [`${RecsCap} Deleted (Period, Still in the Trash)`, String(deletedClients)],
    ]

    if (overdueCount > 0) csvSections.push(['Overdue Deadlines', `${recordsWord(overdueCount)} (${asOf})`])
    if (approachingCount > 0) csvSections.push(['Approaching (next 7 days)', `${recordsWord(approachingCount)} (${asOf})`])
    if (acuityEnabled && acuityLabel) csvSections.push([`${PriMany} breakdown`, sanitizeCsvFormula(acuityLabel)])

    if (archivedClientNames.length > 0) {
      csvSections.push([], [`${RecsCap} Archived`], [`${RecCap} Name`, 'Date Archived', 'Reason'])
      for (const a of archivedClientNames) {
        csvSections.push([sanitizeCsvFormula(a.client_name), csvDate(a.archived_date), sanitizeCsvFormula(a.reason)])
      }
    }

    if (deletedClientNames.length > 0) {
      csvSections.push([], [`${RecsCap} Removed From ${ListCap} (Still in the Trash)`], [`${RecCap} Name`, 'Date Removed'])
      for (const d of deletedClientNames) {
        csvSections.push([sanitizeCsvFormula(d.client_name), csvDate(d.deleted_date)])
      }
    }

    if (newClientNames.length > 0) {
      csvSections.push([], [`New ${RecsCap} Added`], [`${RecCap} Name`, 'Date Added'])
      for (const n of newClientNames) {
        csvSections.push([sanitizeCsvFormula(n.client_name), csvDate(n.added_date)])
      }
    }

    csvSections.push(
      [],
      [`${ListCap} Roster`],
      selectedColumns.map(c => sanitizeCsvFormula(c.name)),
      ...rosterText('csv'),
    )

    if (includeTaskSummary) {
      const completedTasks = completedTasksInPeriod(db, gridId, dateRange.start, dateRange.end)
      csvSections.push([], ['Task Summary'], ['Task', 'Priority', 'Category', 'Due Date', 'Completed'])
      for (const t of completedTasks) {
        csvSections.push([sanitizeCsvFormula(t.title), sanitizeCsvFormula(t.priority), sanitizeCsvFormula(t.category ?? ''), csvDate(t.due_date), csvDate(localDateString(parseDbTimestamp(t.completed_at)))])
      }
      if (completedTasks.length === 0) csvSections.push(['No tasks completed in this period.'])
    }

    if (includeActivityLog) {
      const { rows: logRows, total: logTotal } = activityInPeriod(db, gridId, dateRange.start, dateRange.end)
      const activityNames = batchGetClientNames(db, logRows.map(e => e.row_id), gridId)
      csvSections.push([], [`${term(v, 'activityLog', { cap: true })} (${ActsCap})`], ['Date', 'Type', `${RecCap}`, term(v, 'activity', { cap: true })])
      for (const e of logRows) {
        csvSections.push([csvDate(localDateString(parseDbTimestamp(e.created_at))), sanitizeCsvFormula(activityLabel(e.log_type)), sanitizeCsvFormula(activityNames.get(e.row_id) || `${RecCap} #${e.row_id}`), sanitizeCsvFormula(stripHtml(e.content))])
      }
      if (logRows.length === 0) csvSections.push([`No ${acts} in this period.`])
      if (logTotal > logRows.length) csvSections.push([`Showing the latest ${logRows.length} of ${logTotal} ${acts}.`])
    }

    if (includeSystemActivity) {
      const { rows: sysRows, total: sysTotal } = systemActivityInPeriod(db, gridId, dateRange.start, dateRange.end)
      const sysNames = batchGetClientNames(db, sysRows.map(e => e.row_id), gridId)
      csvSections.push([], ['System Activity (Auto-Logged)'], ['Date', `${RecCap}`, 'Activity'])
      for (const e of sysRows) {
        csvSections.push([csvDate(localDateString(parseDbTimestamp(e.created_at))), sanitizeCsvFormula(sysNames.get(e.row_id) || `${RecCap} #${e.row_id}`), sanitizeCsvFormula(e.content)])
      }
      if (sysRows.length === 0) csvSections.push(['No system activity in this period.'])
      if (sysTotal > sysRows.length) csvSections.push([`Showing the latest ${sysRows.length} of ${sysTotal} system entries.`])
    }

    const csv = Papa.unparse(csvSections)
    // A byte-order mark, so Excel reads accented names and the dashes as UTF-8 (X-21)
    await atomicWriteFileAsync(destPath, '\uFEFF' + csv, 'utf-8')
    return
  }

  // ── PDF report ──
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const marginL = 16
  const marginR = pageW - 16
  const footerBarH = 12

  let y = 18

  // Header — expanded to include title/org
  let headerH = 42
  const workerSubline = [workerTitle, workerOrg].filter(Boolean).join(' | ')
  if (workerName && workerSubline) headerH = 49

  doc.setFillColor(71, 85, 105)
  doc.rect(0, 0, pageW, headerH, 'F')
  doc.setTextColor(255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('Summary report', marginL, 16)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(grid.name, marginL, 25)
  let hY = 32
  if (workerName) {
    doc.text(`${WorkerCap}: ${workerName}`, marginL, hY)
    hY += 7
  }
  if (workerSubline) {
    doc.setFontSize(9)
    doc.text(workerSubline, marginL, hY)
    hY += 7
  }
  doc.setFontSize(10)
  doc.text(`Period: ${dateRangeLabel}`, marginL, hY)
  doc.setTextColor(0)
  y = headerH + 2

  // Confidentiality banner
  doc.setFillColor(254, 243, 199)
  doc.rect(0, y, pageW, 8, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(146, 64, 14)
  doc.text(confidentialBanner, pageW / 2, y + 5.5, { align: 'center' })
  doc.setTextColor(0)
  doc.setFont('helvetica', 'normal')
  y += 12

  // Executive summary box
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(226, 232, 240)
  const boxInnerW = marginR - marginL - 10 // 5mm padding each side
  doc.setFontSize(9)
  const summaryLines = doc.splitTextToSize(executiveSummary, boxInnerW) as string[]
  const summaryBoxH = summaryLines.length * 4.2 + 8
  doc.roundedRect(marginL, y, marginR - marginL, summaryBoxH, 2, 2, 'FD')
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(71, 85, 105)
  doc.text(summaryLines, marginL + 5, y + 5.5)
  doc.setTextColor(0)
  doc.setFont('helvetica', 'normal')
  y += summaryBoxH + 6

  const wrap = (text: string, width: number) => doc.splitTextToSize(text, width) as string[]

  function sectionTitle(title: string): void {
    const curPageH = doc.internal.pageSize.height
    const curPageW = doc.internal.pageSize.width
    if (y > curPageH - footerBarH - 25) { doc.addPage(); y = 18 }
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(71, 85, 105)
    doc.text(title, marginL, y)
    doc.setDrawColor(71, 85, 105)
    doc.setLineWidth(0.4)
    doc.line(marginL, y + 1.5, curPageW - 16, y + 1.5)
    doc.setTextColor(0)
    y += 8
  }

  // A capped list says so above its table (F-019)
  function cutNotice(text: string): void {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(120)
    doc.text(text, marginL, y)
    doc.setTextColor(0)
    doc.setFont('helvetica', 'normal')
    y += 6
  }

  // Summary cards
  sectionTitle(`${ListCap} Summary`)
  const stats: Array<[string, string]> = [
    [`Total Active ${RecsCap}`, String(totalActive)],
    [`New ${RecsCap} This Period`, String(newAdded)],
    [`${RecsCap} Archived This Period`, String(archivedClients)],
    [`${RecsCap} Deleted This Period`, String(deletedClients)],
  ]
  if (overdueCount > 0) stats.push(['Overdue Deadlines', `${recordsWord(overdueCount)} (${asOf})`])
  if (approachingCount > 0) stats.push(['Approaching (next 7 days)', `${recordsWord(approachingCount)} (${asOf})`])

  for (const [label, val] of stats) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(label, marginL, y)
    doc.setFont('helvetica', 'normal')
    doc.text(val, marginL + 80, y)
    y += 7
  }

  // Acuity breakdown — vertically stacked per level
  if (acuityEnabled && acuityBreakdown.some(a => a.cnt > 0)) {
    y += 2
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text(`${PriMany} breakdown`, marginL, y)
    y += 6
    doc.setFontSize(9)
    for (const a of acuityBreakdown) {
      if (a.cnt === 0) continue
      doc.setFont('helvetica', 'bold')
      doc.text(a.name, marginL + 4, y)
      doc.setFont('helvetica', 'normal')
      doc.text(`${a.cnt} ${term(v, 'record', { count: a.cnt })}  (${a.cnt * a.points} pts)`, marginL + 40, y)
      y += 5.5
    }
    doc.setFont('helvetica', 'bold')
    doc.text('Total', marginL + 4, y)
    doc.setFont('helvetica', 'normal')
    doc.text(`${acuityTotal} pts`, marginL + 40, y)
    y += 7
  }

  // Clients Archived
  if (archivedClientNames.length > 0) {
    y += 4
    sectionTitle(`${RecsCap} Archived`)
    doc.setFontSize(9)
    for (const a of archivedClientNames) {
      // Long names and reasons wrap in their own column instead of running over the date or off the page (Q-077)
      const nameLines = wrap(a.client_name, 64)
      const reasonLines = a.reason ? wrap(a.reason, marginR - (marginL + 100)) : []
      const extra = (Math.max(nameLines.length, reasonLines.length) - 1) * lineHeight(doc)
      if (y + extra > pageH - footerBarH - 10) { doc.addPage(); y = 18 }
      doc.setFont('helvetica', 'normal')
      doc.text(nameLines, marginL + 4, y)
      doc.setTextColor(100)
      doc.text(a.archived_date, marginL + 70, y)
      if (reasonLines.length > 0) {
        doc.text(reasonLines, marginL + 100, y)
      }
      doc.setTextColor(0)
      y += 5.5 + extra
    }
  }

  // Clients Removed From Caseload
  if (deletedClientNames.length > 0) {
    y += 4
    sectionTitle(`${RecsCap} Removed From ${ListCap} (Still in the Trash)`)
    doc.setFontSize(9)
    for (const d of deletedClientNames) {
      const nameLines = wrap(d.client_name, 84)
      const extra = (nameLines.length - 1) * lineHeight(doc)
      if (y + extra > pageH - footerBarH - 10) { doc.addPage(); y = 18 }
      doc.setFont('helvetica', 'normal')
      doc.text(nameLines, marginL + 4, y)
      doc.setTextColor(100)
      doc.text(d.deleted_date, marginL + 90, y)
      doc.setTextColor(0)
      y += 5.5 + extra
    }
  }

  // New Clients Added
  if (newClientNames.length > 0) {
    y += 4
    sectionTitle(`New ${RecsCap} Added`)
    doc.setFontSize(9)
    for (const n of newClientNames) {
      const nameLines = wrap(n.client_name, 84)
      const extra = (nameLines.length - 1) * lineHeight(doc)
      if (y + extra > pageH - footerBarH - 10) { doc.addPage(); y = 18 }
      doc.setFont('helvetica', 'normal')
      doc.text(nameLines, marginL + 4, y)
      doc.setTextColor(100)
      doc.text(n.added_date, marginL + 90, y)
      doc.setTextColor(0)
      y += 5.5 + extra
    }
  }

  y += 4

  // Caseload Roster
  const colCount = selectedColumns.length
  // Use landscape when >5 columns so columns aren't squished
  const rosterLandscape = colCount > 5
  const rosterFontSize = colCount > 16 ? 6 : colCount > 10 ? 7 : 8

  // Start a fresh landscape page for the roster if needed
  if (rosterLandscape) {
    doc.addPage('a4', 'landscape')
    y = 18
  }

  sectionTitle(`${ListCap} Roster`)

  const rosterBody = rosterText('pdf')

  const rosterMarginL = rosterLandscape ? 12 : marginL
  const rosterMarginR = rosterLandscape ? 12 : 16

  // Compute column widths: Name gets more space, others share the rest
  const rosterPageW = rosterLandscape ? 297 : 210
  const rosterUsable = rosterPageW - rosterMarginL - rosterMarginR
  const rosterColStyles: Record<number, { cellWidth?: number }> = {}
  if (colCount > 1) {
    const nameW = Math.min(rosterUsable * 0.3, 60)
    const otherW = (rosterUsable - nameW) / (colCount - 1)
    rosterColStyles[0] = { cellWidth: nameW }
    for (let i = 1; i < colCount; i++) {
      rosterColStyles[i] = { cellWidth: otherW }
    }
  }

  autoTable(doc, {
    head: [selectedColumns.map(c => c.name)],
    body: rosterBody,
    startY: y,
    styles: { fontSize: rosterFontSize, cellPadding: rosterFontSize <= 6 ? 1.5 : 2, overflow: 'linebreak' },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: rosterColStyles,
    margin: { left: rosterMarginL, right: rosterMarginR, bottom: footerBarH + 4 },
  })
  y = lastTableY(doc) + 8

  if (rosterLandscape) {
    // Return to portrait for remaining sections
    doc.addPage('a4', 'portrait')
    y = 18
  }

  // Task Summary (optional)
  if (includeTaskSummary) {
    const completedTasks = completedTasksInPeriod(db, gridId, dateRange.start, dateRange.end)

    if (y > pageH - footerBarH - 40) { doc.addPage(); y = 18 }
    sectionTitle('Task Summary \u2014 Completed This Period')
    if (completedTasks.length === 0) {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(120)
      doc.text('No tasks completed in this period.', marginL, y)
      doc.setTextColor(0)
      y += 8
    } else {
      autoTable(doc, {
        head: [['Completed', 'Task', 'Priority', 'Category', 'Due Date']],
        body: completedTasks.map(t => [
          pdfDay(parseDbTimestamp(t.completed_at)),
          t.title,
          t.priority,
          t.category ?? '\u2014',
          t.due_date ? pdfDay(ymdToDate(t.due_date.slice(0, 10))) : '\u2014',
        ]),
        startY: y,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [71, 85, 105], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        // Wide enough for a date with its year on one line
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 'auto' }, 4: { cellWidth: 24 } },
        margin: { left: marginL, right: 16, bottom: footerBarH + 4 }
      })
      y = lastTableY(doc) + 8
    }
  }

  // Activity Log — case notes (optional)
  if (includeActivityLog) {
    const { rows: logRows, total: logTotal } = activityInPeriod(db, gridId, dateRange.start, dateRange.end)

    if (y > pageH - footerBarH - 40) { doc.addPage(); y = 18 }
    sectionTitle(`${term(v, 'activityLog', { cap: true })} \u2014 ${ActsCap} This Period`)
    if (logRows.length === 0) {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(120)
      doc.text(`No ${acts} in this period.`, marginL, y)
      doc.setTextColor(0)
      y += 8
    } else {
      if (logTotal > logRows.length) cutNotice(`Showing the latest ${logRows.length} of ${logTotal} ${acts}.`)
      const pdfActivityNames = batchGetClientNames(db, logRows.map(e => e.row_id), gridId)
      autoTable(doc, {
        head: [['Date', 'Type', `${RecCap}`, term(v, 'activity', { cap: true })]],
        body: logRows.map(e => [
          pdfDay(parseDbTimestamp(e.created_at)),
          activityLabel(e.log_type),
          pdfActivityNames.get(e.row_id) || `${RecCap} #${e.row_id}`,
          shorten(stripHtml(e.content), 120),
        ]),
        startY: y,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [71, 85, 105], textColor: 255 },
        columnStyles: { 0: { cellWidth: 20 }, 3: { cellWidth: 'auto' } },
        margin: { left: marginL, right: 16, bottom: footerBarH + 4 }
      })
      y = lastTableY(doc) + 8
    }
  }

  // System Activity — auto-logged events (optional)
  if (includeSystemActivity) {
    const { rows: sysRows, total: sysTotal } = systemActivityInPeriod(db, gridId, dateRange.start, dateRange.end)

    if (y > pageH - footerBarH - 40) { doc.addPage(); y = 18 }
    sectionTitle('System Activity \u2014 Auto-Logged Events This Period')
    if (sysRows.length === 0) {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(120)
      doc.text('No system activity in this period.', marginL, y)
      doc.setTextColor(0)
      y += 8
    } else {
      if (sysTotal > sysRows.length) cutNotice(`Showing the latest ${sysRows.length} of ${sysTotal} system entries.`)
      const pdfSysNames = batchGetClientNames(db, sysRows.map(e => e.row_id), gridId)
      autoTable(doc, {
        head: [['Date', `${RecCap}`, 'Activity']],
        body: sysRows.map(e => [
          pdfDay(parseDbTimestamp(e.created_at)),
          pdfSysNames.get(e.row_id) || `${RecCap} #${e.row_id}`,
          e.content,
        ]),
        startY: y,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [100, 116, 139], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 0: { cellWidth: 20 }, 2: { cellWidth: 'auto' } },
        margin: { left: marginL, right: 16, bottom: footerBarH + 4 }
      })
      y = lastTableY(doc) + 8
    }
  }

  // Branded footer bar on all pages (handles mixed portrait/landscape)
  const genTimestamp = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const pW = doc.internal.pageSize.width
    const pH = doc.internal.pageSize.height
    const barY = pH - footerBarH
    doc.setFillColor(226, 232, 240) // slate-200
    doc.rect(0, barY, pW, footerBarH, 'F')
    doc.setFontSize(9)
    doc.setTextColor(71, 85, 105)
    const footerCenter = `Generated ${genTimestamp} by ${workerName || 'Unknown'}  |  ${PRODUCT_NAME}`
    doc.text(footerCenter, pW / 2, barY + 7.5, { align: 'center' })
    doc.text(`Page ${p} of ${totalPages}`, pW - 16, barY + 7.5, { align: 'right' })
    doc.setTextColor(0)
  }

  await new Promise(resolve => setImmediate(resolve))
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
}

/** The most notes and system entries the report lists; the rest are counted (F-019) */
const ACTIVITY_CAP = 200
const SYSTEM_CAP = 500

type ActivityRow = { content: string; log_type: string; created_at: string; row_id: number }

/** Notes in the period, latest first (dated by when they happened), capped, with the full count */
function activityInPeriod(db: ReturnType<typeof getDb>, gridId: number, start: string, end: string): { rows: ActivityRow[]; total: number } {
  const where = `FROM case_log cl JOIN rows r ON r.id = cl.row_id
    WHERE r.grid_id = ? AND cl.log_type != 'system' AND cl.voided_at IS NULL AND ${NOT_TRASHED_ROW}
      AND date(cl.occurred_at, 'localtime') >= ? AND date(cl.occurred_at, 'localtime') <= ?`
  const rows = db.prepare(`SELECT cl.content, cl.log_type, cl.occurred_at AS created_at, r.id as row_id ${where}
    ORDER BY cl.occurred_at DESC LIMIT ${ACTIVITY_CAP}`).all(gridId, start, end) as ActivityRow[]
  const total = rows.length < ACTIVITY_CAP ? rows.length : (db.prepare(`SELECT COUNT(*) AS n ${where}`).get(gridId, start, end) as { n: number }).n
  return { rows, total }
}

/** Entries Pulse wrote itself in the period, latest first, capped, with the full count */
function systemActivityInPeriod(db: ReturnType<typeof getDb>, gridId: number, start: string, end: string): { rows: Array<{ content: string; created_at: string; row_id: number }>; total: number } {
  const where = `FROM case_log cl JOIN rows r ON r.id = cl.row_id
    WHERE r.grid_id = ? AND cl.log_type = 'system' AND ${NOT_TRASHED_ROW}
      AND date(cl.created_at, 'localtime') >= ? AND date(cl.created_at, 'localtime') <= ?`
  const rows = db.prepare(`SELECT cl.content, cl.created_at, r.id as row_id ${where}
    ORDER BY cl.created_at DESC LIMIT ${SYSTEM_CAP}`).all(gridId, start, end) as Array<{ content: string; created_at: string; row_id: number }>
  const total = rows.length < SYSTEM_CAP ? rows.length : (db.prepare(`SELECT COUNT(*) AS n ${where}`).get(gridId, start, end) as { n: number }).n
  return { rows, total }
}

/** A day in the PDF tables, with its year: a report can span the new year */
function pdfDay(d: Date): string {
  return shortDate(d)
}

/** Cut long text for a table cell, and show that it was cut */
function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text
}

/**
 * Tasks finished in the period. A repeating task goes straight back to open
 * when it's ticked off, so each time it was done comes from its history; a
 * weekly task done four times shows four times (bug sweep S2). Tasks that are
 * done for good come from the task itself, as before.
 */
function completedTasksInPeriod(db: ReturnType<typeof getDb>, gridId: number, start: string, end: string): Array<{ title: string; priority: string; category: string | null; completed_at: string; due_date: string | null }> {
  return db.prepare(`
    SELECT title, priority, category, completed_at, due_date FROM (
      SELECT t.title, t.priority, t.category, h.completed_at, NULL AS due_date
      FROM caseload_task_history h JOIN caseload_tasks t ON t.id = h.task_id
      WHERE (t.grid_id = ? OR t.grid_id IS NULL)
        AND date(h.completed_at, 'localtime') BETWEEN ? AND ?
        AND NOT (t.is_completed = 1 AND t.completed_at IS h.completed_at)
      UNION ALL
      SELECT title, priority, category, completed_at, due_date FROM caseload_tasks
      WHERE (grid_id = ? OR grid_id IS NULL)
        AND is_completed = 1 AND date(completed_at, 'localtime') BETWEEN ? AND ?
    )
    ORDER BY completed_at DESC
  `).all(gridId, start, end, gridId, start, end) as Array<{ title: string; priority: string; category: string | null; completed_at: string; due_date: string | null }>
}
