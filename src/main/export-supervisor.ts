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
} from './export-shared'
import type { SupervisorReportOptions } from './export-shared'
import { parseDbTimestamp } from '../shared/dates'
import { toRuleInterval } from '../shared/ruleInterval'
import { localDateString } from '../shared/dates'
import { toYmd, ymdToDate } from '../shared/ymd'
import { evaluate } from '../shared/deadlineEngine'
import { loadDeadlines } from './deadlines'
import { PRODUCT_NAME } from '../shared/constants'
import { vocabFor } from './vocab'
import { HUMAN_SERVICES_VOCAB, term } from '../shared/vocab'

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
  const { columns: allColumns, rows } = loadGridData(gridId)
  const selectedColumns = pickColumns(allColumns, columnIds)
  showDeadlinesAsText(gridId, selectedColumns, rows)
  const rosterText = (format: 'csv' | 'pdf') => rows.map(r => selectedColumns.map(col => {
    const value = (r[`col_${col.id}` as const] as string | null | undefined) ?? null
    return format === 'csv' ? formatCellValue(value, col.column_type) : cellDisplayText(value, col.column_type)
  }))

  // Compute stats
  const totalActive = (db.prepare('SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1').get(gridId) as { n: number }).n
  const newAdded = (db.prepare(`
    SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1
    AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?
  `).get(gridId, dateRange.start, dateRange.end) as { n: number }).n

  const archivedClients = (db.prepare(`
    SELECT COUNT(*) as n FROM rows
    WHERE grid_id = ? AND is_active = 0 AND archived_at IS NOT NULL AND deleted_at IS NULL
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
        WHERE r.grid_id = ? AND r.is_active = 0 AND r.archived_at IS NOT NULL AND r.deleted_at IS NULL
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
        WHERE r.grid_id = ? AND r.is_active = 1
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
      LEFT JOIN rows r ON r.acuity_level_id = al.id AND r.is_active = 1 AND r.grid_id = ?
      WHERE al.grid_id = ?
      GROUP BY al.id ORDER BY al.position
    `).all(gridId, gridId) as AcuityRow[]
    acuityTotal = acuityBreakdown.reduce((sum, a) => sum + a.cnt * a.points, 0)
  }

  // Overdue / at-risk deadline snapshot, worked out by the shared engine like the dashboard.
  // Old-style columns that keep `interval_days` in their own config (no rule) count too.
  const todayYmd = localDateString()
  const legacy = (db.prepare(`
    SELECT c.value, CAST(json_extract(col.config, '$.interval_days') AS INTEGER) AS days
    FROM cells c
    JOIN rows r ON r.id = c.row_id AND r.is_active = 1 AND r.grid_id = ?
    JOIN columns col ON col.id = c.column_id AND col.column_type = 'date'
    WHERE c.value IS NOT NULL AND c.value != ''
      AND json_extract(col.config, '$.alert_rule_id') IS NULL AND json_extract(col.config, '$.interval_days') IS NOT NULL
  `).all(gridId) as Array<{ value: string; days: number | null }>).map(l => evaluate(
    { id: 0, kind: 'interval', interval: toRuleInterval(l.days ?? 0), config: null, condition: null, businessDays: false },
    { today: todayYmd, columnDate: l.value },
  ).daysUntil)
  const daysUntil = [...loadDeadlines({ gridId, today: todayYmd }).map(d => d.daysUntil), ...legacy].filter((n): n is number => n !== null)
  const overdueCount = daysUntil.filter(n => n < 0).length
  const approachingCount = daysUntil.filter(n => n >= 0 && n <= 7).length

  // The period's ends are calendar days; new Date('2026-10-01') would be UTC midnight, a day early in the US
  const periodDate = (s: string) => {
    const ymd = toYmd(s)
    return (ymd ? ymdToDate(ymd) : parseDbTimestamp(s)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const dateRangeLabel = `${periodDate(dateRange.start)} \u2013 ${periodDate(dateRange.end)}`

  // Build executive summary paragraph
  const summaryParts: string[] = []
  summaryParts.push(`During ${dateRangeLabel}, ${workerName || `the ${term(v, 'worker')}`} managed ${totalActive} active ${recs} (${newAdded} new, ${archivedClients} archived, ${deletedClients} deleted).`)
  if (overdueCount > 0) summaryParts.push(`${overdueCount} ${term(v, 'record', { count: overdueCount })} have overdue deadlines.`)
  if (approachingCount > 0) summaryParts.push(`${approachingCount} approaching within 7 days.`)
  if (acuityEnabled && acuityBreakdown.length > 0) {
    const parts = acuityBreakdown.filter(a => a.cnt > 0).map(a => `${a.cnt} ${a.name} (${a.cnt * a.points} pts)`)
    if (parts.length > 0) summaryParts.push(`${Pri}: ${parts.join(', ')} — Total: ${acuityTotal} pts.`)
  }
  const executiveSummary = summaryParts.join(' ')

  // Build acuity label for summary rows
  const acuityLabel = acuityBreakdown.filter(a => a.cnt > 0).map(a => `${a.cnt} ${a.name} (${a.cnt * a.points} pts)`).join(', ') + (acuityTotal > 0 ? ` — Total: ${acuityTotal} pts` : '')

  if (format === 'csv') {
    // ── CSV report ──
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
      [`${RecsCap} Deleted (Period)`, String(deletedClients)],
    ]

    if (overdueCount > 0) csvSections.push(['Overdue Deadlines', `${overdueCount} ${term(v, 'record', { count: overdueCount })}`])
    if (approachingCount > 0) csvSections.push(['Approaching (next 7 days)', `${approachingCount} ${term(v, 'record', { count: approachingCount })}`])
    if (acuityEnabled && acuityLabel) csvSections.push([`${PriMany} breakdown`, sanitizeCsvFormula(acuityLabel)])

    if (archivedClientNames.length > 0) {
      csvSections.push([], [`${RecsCap} Archived`], [`${RecCap} Name`, 'Date Archived', 'Reason'])
      for (const a of archivedClientNames) {
        csvSections.push([sanitizeCsvFormula(a.client_name), a.archived_date, sanitizeCsvFormula(a.reason)])
      }
    }

    if (deletedClientNames.length > 0) {
      csvSections.push([], [`${RecsCap} Removed From ${ListCap}`], [`${RecCap} Name`, 'Date Removed'])
      for (const d of deletedClientNames) {
        csvSections.push([sanitizeCsvFormula(d.client_name), d.deleted_date])
      }
    }

    if (newClientNames.length > 0) {
      csvSections.push([], [`New ${RecsCap} Added`], [`${RecCap} Name`, 'Date Added'])
      for (const n of newClientNames) {
        csvSections.push([sanitizeCsvFormula(n.client_name), n.added_date])
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
        csvSections.push([sanitizeCsvFormula(t.title), sanitizeCsvFormula(t.priority), sanitizeCsvFormula(t.category ?? ''), t.due_date ?? '', localDateString(parseDbTimestamp(t.completed_at))])
      }
      if (completedTasks.length === 0) csvSections.push(['No tasks completed in this period.'])
    }

    if (includeActivityLog) {
      const logRows = db.prepare(`
        SELECT cl.content, cl.log_type, cl.occurred_at AS created_at, r.id as row_id
        FROM case_log cl JOIN rows r ON r.id = cl.row_id
        WHERE r.grid_id = ? AND cl.log_type != 'system' AND cl.voided_at IS NULL AND r.deleted_at IS NULL
          AND date(cl.occurred_at, 'localtime') >= ? AND date(cl.occurred_at, 'localtime') <= ?
        ORDER BY cl.occurred_at DESC LIMIT 200
      `).all(gridId, dateRange.start, dateRange.end) as Array<{ content: string; log_type: string; created_at: string; row_id: number }>
      const activityNames = batchGetClientNames(db, logRows.map(e => e.row_id), gridId)
      csvSections.push([], [`Activity Log (${ActsCap})`], ['Date', 'Type', `${RecCap}`, 'Notes'])
      for (const e of logRows) {
        csvSections.push([localDateString(parseDbTimestamp(e.created_at)), sanitizeCsvFormula(activityLabel(e.log_type)), sanitizeCsvFormula(activityNames.get(e.row_id) || `${RecCap} #${e.row_id}`), sanitizeCsvFormula(stripHtml(e.content))])
      }
      if (logRows.length === 0) csvSections.push([`No ${acts} in this period.`])
    }

    if (includeSystemActivity) {
      const sysRows = db.prepare(`
        SELECT cl.content, cl.created_at, r.id as row_id
        FROM case_log cl JOIN rows r ON r.id = cl.row_id
        WHERE r.grid_id = ? AND cl.log_type = 'system' AND r.deleted_at IS NULL
          AND date(cl.created_at, 'localtime') >= ? AND date(cl.created_at, 'localtime') <= ?
        ORDER BY cl.created_at DESC LIMIT 500
      `).all(gridId, dateRange.start, dateRange.end) as Array<{ content: string; created_at: string; row_id: number }>
      const sysNames = batchGetClientNames(db, sysRows.map(e => e.row_id), gridId)
      csvSections.push([], ['System Activity (Auto-Logged)'], ['Date', `${RecCap}`, 'Activity'])
      for (const e of sysRows) {
        csvSections.push([localDateString(parseDbTimestamp(e.created_at)), sanitizeCsvFormula(sysNames.get(e.row_id) || `${RecCap} #${e.row_id}`), sanitizeCsvFormula(e.content)])
      }
      if (sysRows.length === 0) csvSections.push(['No system activity in this period.'])
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

  // Summary cards
  sectionTitle(`${ListCap} Summary`)
  const stats: Array<[string, string]> = [
    [`Total Active ${RecsCap}`, String(totalActive)],
    [`New ${RecsCap} This Period`, String(newAdded)],
    [`${RecsCap} Archived This Period`, String(archivedClients)],
    [`${RecsCap} Deleted This Period`, String(deletedClients)],
  ]
  if (overdueCount > 0) stats.push(['Overdue Deadlines', `${overdueCount} ${term(v, 'record', { count: overdueCount })}`])
  if (approachingCount > 0) stats.push(['Approaching (next 7 days)', `${approachingCount} ${term(v, 'record', { count: approachingCount })}`])

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
      if (y > pageH - footerBarH - 10) { doc.addPage(); y = 18 }
      doc.setFont('helvetica', 'normal')
      doc.text(a.client_name, marginL + 4, y)
      doc.setTextColor(100)
      doc.text(a.archived_date, marginL + 70, y)
      if (a.reason) {
        doc.text(a.reason, marginL + 100, y)
      }
      doc.setTextColor(0)
      y += 5.5
    }
  }

  // Clients Removed From Caseload
  if (deletedClientNames.length > 0) {
    y += 4
    sectionTitle(`${RecsCap} Removed From ${ListCap}`)
    doc.setFontSize(9)
    for (const d of deletedClientNames) {
      if (y > pageH - footerBarH - 10) { doc.addPage(); y = 18 }
      doc.setFont('helvetica', 'normal')
      doc.text(d.client_name, marginL + 4, y)
      doc.setTextColor(100)
      doc.text(d.deleted_date, marginL + 90, y)
      doc.setTextColor(0)
      y += 5.5
    }
  }

  // New Clients Added
  if (newClientNames.length > 0) {
    y += 4
    sectionTitle(`New ${RecsCap} Added`)
    doc.setFontSize(9)
    for (const n of newClientNames) {
      if (y > pageH - footerBarH - 10) { doc.addPage(); y = 18 }
      doc.setFont('helvetica', 'normal')
      doc.text(n.client_name, marginL + 4, y)
      doc.setTextColor(100)
      doc.text(n.added_date, marginL + 90, y)
      doc.setTextColor(0)
      y += 5.5
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
          parseDbTimestamp(t.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          t.title,
          t.priority,
          t.category ?? '\u2014',
          t.due_date ? (() => { const [y = NaN, m = NaN, d = NaN] = t.due_date!.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) })() : '\u2014',
        ]),
        startY: y,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [71, 85, 105], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 1: { cellWidth: 'auto' } },
        margin: { left: marginL, right: 16, bottom: footerBarH + 4 }
      })
      y = lastTableY(doc) + 8
    }
  }

  // Activity Log — case notes (optional)
  if (includeActivityLog) {
    const logRows = db.prepare(`
      SELECT cl.content, cl.log_type, cl.occurred_at AS created_at, r.id as row_id
      FROM case_log cl
      JOIN rows r ON r.id = cl.row_id
      WHERE r.grid_id = ? AND cl.log_type != 'system' AND cl.voided_at IS NULL AND r.deleted_at IS NULL
        AND date(cl.occurred_at, 'localtime') >= ? AND date(cl.occurred_at, 'localtime') <= ?
      ORDER BY cl.occurred_at DESC
      LIMIT 200
    `).all(gridId, dateRange.start, dateRange.end) as Array<{ content: string; log_type: string; created_at: string; row_id: number }>

    if (y > pageH - footerBarH - 40) { doc.addPage(); y = 18 }
    sectionTitle(`Activity Log \u2014 ${ActsCap} This Period`)
    if (logRows.length === 0) {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(120)
      doc.text(`No ${acts} in this period.`, marginL, y)
      doc.setTextColor(0)
      y += 8
    } else {
      const pdfActivityNames = batchGetClientNames(db, logRows.map(e => e.row_id), gridId)
      autoTable(doc, {
        head: [['Date', 'Type', `${RecCap}`, 'Notes']],
        body: logRows.map(e => [
          parseDbTimestamp(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          activityLabel(e.log_type),
          pdfActivityNames.get(e.row_id) || `${RecCap} #${e.row_id}`,
          stripHtml(e.content).slice(0, 120)
        ]),
        startY: y,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [71, 85, 105], textColor: 255 },
        columnStyles: { 3: { cellWidth: 'auto' } },
        margin: { left: marginL, right: 16, bottom: footerBarH + 4 }
      })
      y = lastTableY(doc) + 8
    }
  }

  // System Activity — auto-logged events (optional)
  if (includeSystemActivity) {
    const sysRows = db.prepare(`
      SELECT cl.content, cl.created_at, r.id as row_id
      FROM case_log cl
      JOIN rows r ON r.id = cl.row_id
      WHERE r.grid_id = ? AND cl.log_type = 'system' AND r.deleted_at IS NULL
        AND date(cl.created_at, 'localtime') >= ? AND date(cl.created_at, 'localtime') <= ?
      ORDER BY cl.created_at DESC
      LIMIT 500
    `).all(gridId, dateRange.start, dateRange.end) as Array<{ content: string; created_at: string; row_id: number }>

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
      const pdfSysNames = batchGetClientNames(db, sysRows.map(e => e.row_id), gridId)
      autoTable(doc, {
        head: [['Date', `${RecCap}`, 'Activity']],
        body: sysRows.map(e => [
          parseDbTimestamp(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          pdfSysNames.get(e.row_id) || `${RecCap} #${e.row_id}`,
          e.content,
        ]),
        startY: y,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [100, 116, 139], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 2: { cellWidth: 'auto' } },
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
