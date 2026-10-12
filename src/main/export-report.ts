/**
 * export-report.ts — a built report as CSV or PDF (generalization W10 §6.3).
 * Numbers stay numbers in the CSV; text is guarded against spreadsheet formulas.
 */
import Papa from 'papaparse'
import { jsPDF, autoTable, atomicWriteFileAsync, sanitizeCsvFormula, savedDateFormat } from './export-shared'
import { formatReportCell, type ReportCell, type ReportColumn, type ReportResult } from '../shared/reports'
import { formatDateAs, type DateFormat } from '../shared/cellText'

/**
 * Numbers stay numbers; dates follow Settings → Date format like every export
 * (X-20). Month, quarter and year groups ("2026-10") aren't full dates and stay as they are.
 */
function csvCell(v: ReportCell, col: ReportColumn, dateFormat: DateFormat): string | number {
  if (typeof v === 'number') return v
  const text = v ?? ''
  return sanitizeCsvFormula(col.kind === 'date' ? formatDateAs(text, dateFormat) : text)
}

export function reportToCsv(result: ReportResult, dateFormat: DateFormat = savedDateFormat()): string {
  const data: Array<Array<string | number>> = result.rows.map(r => result.columns.map(c => csvCell(r[c.key] ?? null, c, dateFormat)))
  const hasTotals = result.columns.some(c => c.key in result.totals) && result.rows.length > 1
  if (hasTotals) data.push(result.columns.map((c, i) => c.key in result.totals ? csvCell(result.totals[c.key] ?? null, c, dateFormat) : i === 0 ? 'Total' : ''))
  // The screen and the PDF say when lines were left out; so does the CSV, or its Total reads as the sum of what's shown (F-023)
  if (result.truncated) data.push(result.columns.map((_c, i) => i === 0 ? sanitizeCsvFormula(result.truncated!) : ''))
  return '﻿' + Papa.unparse({ fields: result.columns.map(c => sanitizeCsvFormula(c.label)), data })
}

export function buildReportPdf(title: string, subtitle: string, result: ReportResult): Buffer {
  const doc = new jsPDF({ orientation: result.columns.length > 5 ? 'landscape' : 'portrait', unit: 'mm', format: 'letter' })
  const marginL = 14
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  const width = doc.internal.pageSize.width - marginL * 2
  // Names run to 100 characters; a long one wraps instead of running off the page
  const titleLines = doc.splitTextToSize(title, width) as string[]
  doc.text(titleLines, marginL, 18)
  const subTop = 25 + (titleLines.length - 1) * 7
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  // What the report covers (list, filters, dates), then when and how many; long descriptions wrap
  const lines = doc.splitTextToSize(`${subtitle}  ·  ${today}  ·  ${result.matched.toLocaleString('en-US')} matched`, width) as string[]
  doc.text(lines, marginL, subTop)
  const tableTop = subTop + lines.length * 4.5 + 2
  const numeric = (k: string) => result.columns.find(c => c.key === k)?.kind === 'number' || result.columns.find(c => c.key === k)?.kind === 'currency'
  const body = result.rows.map(r => result.columns.map(c => formatReportCell(r[c.key] ?? null, c.kind, c.bucket)))
  const hasTotals = result.columns.some(c => c.key in result.totals) && result.rows.length > 1
  const foot = hasTotals ? [result.columns.map((c, i) => c.key in result.totals ? formatReportCell(result.totals[c.key] ?? null, c.kind, c.bucket) : i === 0 ? 'Total' : '')] : undefined
  autoTable(doc, {
    startY: tableTop,
    head: [result.columns.map(c => c.label)],
    body,
    ...(foot ? { foot } : {}),
    styles: { fontSize: 9, cellPadding: 1.8 },
    headStyles: { fillColor: [71, 85, 105] },
    footStyles: { fillColor: [226, 232, 240], textColor: 20, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(result.columns.map((c, i) => [i, numeric(c.key) ? { halign: 'right' } : {}])),
    margin: { left: marginL, right: marginL },
  })
  if (result.truncated) {
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
    doc.setFontSize(9)
    doc.text(result.truncated, marginL, y)
  }
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(120)
    doc.text(`${title}  ·  CONFIDENTIAL`, marginL, doc.internal.pageSize.height - 8)
    doc.text(`Page ${p} of ${pages}`, doc.internal.pageSize.width - marginL, doc.internal.pageSize.height - 8, { align: 'right' })
    doc.setTextColor(0)
  }
  return Buffer.from(doc.output('arraybuffer'))
}

export async function writeReport(destPath: string, format: 'csv' | 'pdf', title: string, subtitle: string, result: ReportResult): Promise<void> {
  if (format === 'csv') await atomicWriteFileAsync(destPath, reportToCsv(result), 'utf8')
  else await atomicWriteFileAsync(destPath, buildReportPdf(title, subtitle, result))
}
