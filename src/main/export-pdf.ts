/**
 * export-pdf.ts — PDF export: letter, grid, profile, batch, contact, directory.
 */

import type { ContactFilterParams } from '../shared/types'
import { PRODUCT_NAME } from '../shared/constants'
import { getDb } from './database'
import { logger } from './logger'
import { getProvider, getProviders, getCategories, getInteractions, getClientLinks, getCustomFields, getCustomValues } from './contacts'

import {
  jsPDF,
  autoTable,
  lastTableY,
  atomicWriteFileAsync,
  stripHtml,
  formatDate,
  cellDisplayText,
  loadGridData,
  pickColumns,
  pickRows,
  showDeadlinesAsText,
  getClientName,
  batchGetClientNames,
  lineHeight,
  savedDateFormat,
} from './export-shared'
import type { PdfProfileOptions, PdfGridOptions } from './export-shared'
import { parseDbTimestamp, shortDate } from '../shared/dates'
import { vocabFor, word } from './vocab'
import { term } from '../shared/vocab'
import { activityLabel } from './activity-types'
import { loadDeadlines } from './deadlines'
import { deadlineSummary } from '../shared/deadlineSummary'
import { availabilityLabel } from '../shared/availability'
import { normalizeHexColor } from '../shared/color'
import { COLUMN_TRAITS } from '../shared/columnTraits'

// ──────────────────────────────────────────────────────────────────────────────
// Letter Template PDF Export
// ──────────────────────────────────────────────────────────────────────────────

export async function exportLetterPdf(text: string, destPath: string): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' }) // US Letter, like batch letters and forms
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const margin = 20
  const contentW = pageW - margin * 2
  const lineHeight = 6

  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')

  const lines = doc.splitTextToSize(text, contentW) as string[]
  let y = margin

  for (const line of lines) {
    if (y + lineHeight > pageH - margin) {
      doc.addPage()
      y = margin
    }
    doc.text(line, margin, y)
    y += lineHeight
  }

  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.6 — PDF Grid Export
// ──────────────────────────────────────────────────────────────────────────────

/** The smallest text on a list's PDF */
export const GRID_PDF_MIN_PT = 11
/** Dates, numbers and worked-out days (the numeric-text trait), but not a checkbox's Yes/No */
const rightAligned = (type: string): boolean =>
  type !== 'checkbox' && (COLUMN_TRAITS as Record<string, { numericText: boolean } | undefined>)[type]?.numericText === true

export async function exportPdfGrid(options: PdfGridOptions): Promise<void> {
  const { gridId, columnIds, activeRowIds, destPath, title } = options
  const { grid, columns, rows } = loadGridData(gridId, { includeHidden: true })
  const v = vocabFor(gridId)
  logger.info('export', 'PDF grid export started', { rowCount: rows.length })

  const selectedColumns = pickColumns(columns, columnIds)
  const filteredRows = pickRows(rows, activeRowIds)
  showDeadlinesAsText(gridId, selectedColumns, filteredRows)

  // Yield to event loop before heavy PDF generation
  await new Promise(resolve => setImmediate(resolve))

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Header
  const exportTitle = title || grid.name
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  // A long title wraps, and the line under it and the table move down by the extra lines (Q-077)
  const titleLines = doc.splitTextToSize(exportTitle, doc.internal.pageSize.width - 28) as string[]
  const titleExtra = (titleLines.length - 1) * lineHeight(doc)
  doc.text(titleLines, 14, 18)
  // Black, and no smaller than the body: people read this on paper (persona study R7)
  doc.setFontSize(GRID_PDF_MIN_PT)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0)
  doc.text(`Exported ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}  ·  ${filteredRows.length} ${term(v, 'record', { count: filteredRows.length })}`, 14, 24 + titleExtra)

  const head = [selectedColumns.map(c => c.name)]
  // Read the date format once, not once per cell
  const dateFormat = savedDateFormat()
  const body = filteredRows.map(row =>
    selectedColumns.map(col => cellDisplayText(row[`col_${col.id}`] as string | null, col.column_type, dateFormat))
  )

  // Compute column widths: Name gets more space
  const gridColCount = selectedColumns.length
  const gridUsable = 297 - 28 // A4 landscape minus margins
  const gridColStyles: Record<number, { cellWidth?: number; halign?: 'right' }> = {}
  if (gridColCount > 1) {
    const nameW = Math.min(gridUsable * 0.25, 60)
    const otherW = (gridUsable - nameW) / (gridColCount - 1)
    gridColStyles[0] = { cellWidth: nameW }
    for (let i = 1; i < gridColCount; i++) {
      gridColStyles[i] = { cellWidth: otherW }
    }
  }
  // Dates, numbers and days-left line up on the right, like the table on screen
  selectedColumns.forEach((c, i) => { if (i > 0 && rightAligned(c.column_type)) gridColStyles[i] = { ...gridColStyles[i], halign: 'right' } })
  // 11 pt at the least, black on white with a black rule under the header (persona study R7):
  // wide lists wrap onto more lines instead of shrinking the letters
  const gridFontSize = gridColCount > 10 ? GRID_PDF_MIN_PT : 12

  autoTable(doc, {
    head,
    body,
    startY: 30 + titleExtra,
    styles: { fontSize: gridFontSize, cellPadding: 1.8, textColor: 0, lineColor: 0, lineWidth: 0 },
    headStyles: { fillColor: 255, textColor: 0, fontStyle: 'bold', lineColor: 0, lineWidth: { bottom: 0.35 } },
    bodyStyles: { lineColor: 0, lineWidth: { bottom: 0.1 } },
    alternateRowStyles: { fillColor: 255 },
    columnStyles: gridColStyles,
    margin: { left: 14, right: 14 },
    didDrawPage: () => {
      // Footer
      const pageNum = doc.getNumberOfPages()
      doc.setFontSize(GRID_PDF_MIN_PT)
      doc.setTextColor(0)
      doc.text('CONFIDENTIAL', 14, doc.internal.pageSize.height - 8)
      doc.text(`Page ${pageNum}`, doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 8, { align: 'right' })
    }
  })

  // Yield before file write
  await new Promise(resolve => setImmediate(resolve))
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.6 — PDF Profile Export (single client)
// ──────────────────────────────────────────────────────────────────────────────

export { deadlineSummary }

/** Phone numbers, emails and the like added with "Add contact info" on the record page. */
function manualContactsOf(db: ReturnType<typeof getDb>, rowId: number): Array<{ type: string; label: string; value: string }> {
  const raw = (db.prepare('SELECT manual_contacts FROM rows WHERE id = ?').get(rowId) as { manual_contacts: string | null } | undefined)?.manual_contacts
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return []
    return list.filter((c): c is { type: string; label: string; value: string } =>
      !!c && typeof c === 'object' && typeof (c as { value?: unknown }).value === 'string' && (c as { value: string }).value.trim() !== ''
      && typeof (c as { type?: unknown }).type === 'string' && typeof (c as { label?: unknown }).label === 'string')
  } catch { return [] }
}

/**
 * Render a single client profile into an existing jsPDF document.
 * Does NOT write the file — the caller handles that.
 * Returns the final Y position on the last page.
 */
export function renderProfileToDoc(
  doc: InstanceType<typeof jsPDF>,
  rowId: number,
  gridId: number,
  includeSections: PdfProfileOptions['includeSections'],
): number {
  const db = getDb()
  const clientName = getClientName(db, rowId, gridId)
  const v = vocabFor(gridId)
  // What the table shows: deadlines as "Due …", Age and Days-until worked out, linked
  // records by name, file counts (AUDIT-036). Archived records print too.
  const { grid, columns, rows } = loadGridData(gridId, { includeArchived: true })
  const nameColId = columns.find(c => c.is_name_column)?.id
  const shownRow = rows.filter(r => r.row_id === rowId)
  showDeadlinesAsText(gridId, columns, shownRow)
  const valueOf = (colId: number): string | null => (shownRow[0]?.[`col_${colId}` as const] as string | null | undefined) ?? null

  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const marginL = 16
  const marginR = pageW - 16
  const contentW = marginR - marginL

  let y = 18

  // ── Header ──
  doc.setFillColor(71, 85, 105)
  doc.rect(0, 0, pageW, 36, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text(clientName, marginL, 18)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`${grid.name}  ·  Printed ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, marginL, 26)
  doc.setTextColor(0, 0, 0)
  y = 44

  function addSection(title: string): void {
    if (y > pageH - 30) { doc.addPage(); y = 18 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(71, 85, 105)
    doc.text(title, marginL, y)
    doc.setDrawColor(71, 85, 105)
    doc.setLineWidth(0.5)
    doc.line(marginL, y + 1.5, marginR, y + 1.5)
    doc.setTextColor(0, 0, 0)
    y += 8
  }

  function addKeyValue(label: string, value: string, indent = 0): void {
    if (y > pageH - 20) { doc.addPage(); y = 18 }
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    const labelText = label + ':  '
    const labelW = doc.getStringUnitWidth(labelText) * 9 / doc.internal.scaleFactor
    doc.text(labelText, marginL + indent, y)
    doc.setFont('helvetica', 'normal')
    const valText = value || '\u2014'
    const availW = contentW - indent - labelW
    if (availW < 30) {
      // Label too long — put value on the next line
      y += 5
      if (y > pageH - 15) { doc.addPage(); y = 18 }
      const lines = doc.splitTextToSize(valText, contentW - indent - 4)
      for (const line of lines) {
        if (y > pageH - 15) { doc.addPage(); y = 18 }
        doc.text(line, marginL + indent + 4, y)
        y += 5
      }
      y += 1
    } else {
      // Value fits beside the label — wrap if needed
      const lines = doc.splitTextToSize(valText, availW)
      doc.text(lines[0], marginL + indent + labelW, y)
      y += 5
      for (let i = 1; i < lines.length; i++) {
        if (y > pageH - 15) { doc.addPage(); y = 18 }
        doc.text(lines[i], marginL + indent + labelW, y)
        y += 5
      }
      y += 1
    }
  }

  function addBodyText(text: string): void {
    if (!text) return
    if (y > pageH - 20) { doc.addPage(); y = 18 }
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(stripHtml(text), contentW)
    for (const line of lines) {
      if (y > pageH - 15) { doc.addPage(); y = 18 }
      doc.text(line, marginL, y)
      y += 5
    }
    y += 2
  }

  /**
   * An open checklist item: a drawn box, then the title, wrapped. "☐" isn't in
   * the PDF's built-in font and garbled the whole line (AUDIT-035).
   */
  function addChecklistItem(text: string, indent: number): void {
    if (y > pageH - 15) { doc.addPage(); y = 18 }
    const x = marginL + indent
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.3)
    doc.rect(x, y - 2.6, 2.6, 2.6)
    const lines = doc.splitTextToSize(text, contentW - indent - 5) as string[]
    lines.forEach((line, i) => {
      if (i > 0) { y += 5; if (y > pageH - 15) { doc.addPage(); y = 18 } }
      doc.text(line, x + 5, y)
    })
    y += 5
  }

  // ── Grid Data ──
  if (includeSections.gridData) {
    addSection(`${term(v, 'record', { cap: true })} information`)
    for (const col of columns) {
      if (col.id === nameColId) continue
      const val = cellDisplayText(valueOf(col.id), col.column_type)
      addKeyValue(col.name, val)
    }
    y += 4
  }

  // ── Deadlines: the same engine as the dashboard, so the PDF never disagrees with the app ──
  if (includeSections.deadlines) {
    // An archived record's page prints its deadlines too (F-020)
    const items = loadDeadlines({ gridId, rowIds: [rowId], includeArchived: true })
    if (items.length > 0) {
      addSection('Deadlines')
      for (const d of items) addKeyValue(d.column_name, deadlineSummary(d))
      y += 4
    }
  }

  // ── Other contact info ("Add contact info" on the record page) ──
  if (includeSections.contactInfo) {
    const extra = manualContactsOf(db, rowId)
    if (extra.length > 0) {
      addSection('Other contact info')
      for (const c of extra) addKeyValue(c.label || c.type, c.value)
      y += 4
    }
  }

  // ── Checklist ──
  if (includeSections.checklist) {
    const items = (db.prepare(`
      SELECT * FROM checklist_items WHERE row_id = ? AND is_archived = 0 AND is_completed = 0
      ORDER BY position LIMIT 200
    `).all(rowId)) as Array<{ title: string; due_date: string | null; priority: string; group_id: number | null }>
    if (items.length > 0) {
      addSection('Active Checklist')

      // Query groups for this row
      const groups = db.prepare('SELECT * FROM checklist_groups WHERE row_id = ? ORDER BY position').all(rowId) as Array<{ id: number; name: string }>

      // Separate ungrouped and grouped items
      const ungrouped = items.filter(i => i.group_id == null)
      const groupedByGroupId = new Map<number, typeof items>()
      for (const item of items) {
        if (item.group_id != null) {
          if (!groupedByGroupId.has(item.group_id)) groupedByGroupId.set(item.group_id, [])
          groupedByGroupId.get(item.group_id)!.push(item)
        }
      }

      // Render ungrouped items first
      for (const item of ungrouped) {
        const dueStr = item.due_date ? `  (due ${formatDate(item.due_date, 'us')})` : ''
        addChecklistItem(`${item.title}${dueStr}`, 0)
      }

      // Render grouped items by group
      for (const group of groups) {
        const groupItems = groupedByGroupId.get(group.id)
        if (!groupItems || groupItems.length === 0) continue
        if (y > pageH - 20) { doc.addPage(); y = 18 }
        // Group header
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.text(group.name, marginL, y)
        y += 5
        doc.setFont('helvetica', 'normal')
        // Group items (indented)
        for (const item of groupItems) {
          const dueStr = item.due_date ? `  (due ${formatDate(item.due_date, 'us')})` : ''
          addChecklistItem(`${item.title}${dueStr}`, 4)
        }
      }
      y += 4
    }
  }

  // ── Case Log ──
  if (includeSections.caseLog) {
    // The last 10, or all of them when asked (C-21); SQLite's LIMIT -1 is no limit
    const allNotes = includeSections.allNotes === true
    const entries = db.prepare(`
      SELECT content, log_type, occurred_at AS created_at FROM case_log
      WHERE row_id = ? AND voided_at IS NULL AND log_type != 'system'
      ORDER BY occurred_at DESC, id DESC LIMIT ?
    `).all(rowId, allNotes ? -1 : 10) as Array<{ content: string; log_type: string; created_at: string }>
    if (entries.length > 0) {
      addSection(allNotes
        ? `${term(v, 'activity', { many: true, cap: true })} (all ${entries.length})`
        : `Recent ${term(v, 'activity', { many: true })} (last 10)`)
      for (const entry of entries) {
        if (y > pageH - 20) { doc.addPage(); y = 18 }
        const dt = parseDbTimestamp(entry.created_at)
        const dateStr = shortDate(dt) +
          ' ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.text(`${dateStr}  [${activityLabel(entry.log_type).toUpperCase()}]`, marginL, y)
        y += 5
        addBodyText(entry.content)
        y += 1
      }
      y += 2
    }
  }

  // ── Linked Providers ──
  try {
    const linkedProviders = db.prepare(`
      SELECT p.name, p.org_name, p.title, p.phone_main, p.email,
             p.availability_status, pc.name AS category_name
      FROM provider_client_links pcl
      JOIN providers p ON pcl.provider_id = p.id
      LEFT JOIN provider_categories pc ON p.category_id = pc.id
      WHERE pcl.row_id = ?
      ORDER BY p.name
    `).all(rowId) as Array<{
      name: string; org_name: string | null; title: string | null;
      phone_main: string | null; email: string | null;
      availability_status: string | null; category_name: string | null
    }>
    if (linkedProviders && linkedProviders.length > 0) {
      addSection(`Linked ${term(v, 'contact', { many: true, cap: true })} (${linkedProviders.length})`)
      for (const prov of linkedProviders) {
        if (y > pageH - 20) { doc.addPage(); y = 18 }
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.text(prov.name, marginL, y)
        y += 5
        const details: string[] = []
        if (prov.org_name) details.push(prov.org_name)
        if (prov.title) details.push(prov.title)
        if (prov.category_name) details.push(prov.category_name)
        if (details.length > 0) {
          doc.setFontSize(9)
          doc.setFont('helvetica', 'italic')
          doc.text(details.join('  |  '), marginL + 4, y)
          y += 4
        }
        const contactParts: string[] = []
        if (prov.phone_main) contactParts.push(prov.phone_main)
        if (prov.email) contactParts.push(prov.email)
        if (prov.availability_status && prov.availability_status !== 'unknown') {
          contactParts.push('Status: ' + prov.availability_status.charAt(0).toUpperCase() + prov.availability_status.slice(1))
        }
        if (contactParts.length > 0) {
          doc.setFontSize(9)
          doc.text(contactParts.join('  \u2022  '), marginL + 4, y)
          y += 5
        }
        y += 1
      }
      y += 2
    }
  } catch (err) {
    logger.error('export', 'PDF linked providers section failed', { error: err instanceof Error ? err.message : String(err) })
  }

  // ── Scratch notes ──
  if (includeSections.scratchPad) {
    const noteContent = (db.prepare('SELECT content FROM scrap_notes WHERE row_id = ?').get(rowId) as { content: string } | undefined)?.content
    if (noteContent) {
      addSection('Scratch notes')
      addBodyText(noteContent)
      y += 4
    }
  }

  return y
}

export async function exportPdfProfile(options: PdfProfileOptions): Promise<void> {
  const { rowId, gridId, destPath, includeSections } = options

  // Yield to event loop before heavy PDF generation
  await new Promise(resolve => setImmediate(resolve))

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  renderProfileToDoc(doc, rowId, gridId, includeSections)

  // ── Footer on all pages ──
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const marginL = 16
  const marginR = pageW - 16
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(120)
    doc.text(`Printed ${new Date().toLocaleDateString()} — ${PRODUCT_NAME} — CONFIDENTIAL`, marginL, pageH - 8)
    doc.text(`Page ${p} of ${totalPages}`, marginR, pageH - 8, { align: 'right' })
    doc.setTextColor(0)
  }

  // Yield before file write
  await new Promise(resolve => setImmediate(resolve))
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
}

// ──────────────────────────────────────────────────────────────────────────────
// Contact / Provider PDF Export
// ──────────────────────────────────────────────────────────────────────────────

export async function exportContactPdf(providerId: number, destPath: string): Promise<void> {
  const db = getDb()

  const provider = getProvider(providerId)
  if (!provider) throw new Error(`That ${word('contact')} no longer exists.`)

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const marginL = 16
  const marginR = pageW - 16
  const contentW = marginR - marginL

  let y = 18

  // ── Header Band ──
  doc.setFillColor(71, 85, 105)
  doc.rect(0, 0, pageW, 36, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text(provider.name, marginL, 18)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  const subtitle = [provider.org_name, provider.title].filter(Boolean).join('  \u00b7  ')
  if (subtitle) doc.text(subtitle, marginL, 26)
  doc.text(`Printed ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, marginL, 32)
  doc.setTextColor(0, 0, 0)
  y = 44

  function sectionTitle(title: string): void {
    if (y > pageH - 30) { doc.addPage(); y = 18 }
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(71, 85, 105)
    doc.text(title, marginL, y)
    doc.setDrawColor(71, 85, 105)
    doc.setLineWidth(0.5)
    doc.line(marginL, y + 1.5, marginR, y + 1.5)
    doc.setTextColor(0, 0, 0)
    y += 8
  }

  function kv(label: string, value: string): void {
    if (y > pageH - 20) { doc.addPage(); y = 18 }
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(label + ':', marginL, y)
    doc.setFont('helvetica', 'normal')
    const labelW = doc.getStringUnitWidth(label + ':') * 9 / doc.internal.scaleFactor
    // Wrap long values (an address, notes, hours) instead of running off the page
    const valueX = marginL + labelW + 2
    const lines = doc.splitTextToSize(value || '\u2014', Math.max(20, marginR - valueX)) as string[]
    lines.forEach((line, i) => {
      if (i > 0) { y += 5; if (y > pageH - 15) { doc.addPage(); y = 18 } }
      doc.text(line, valueX, y)
    })
    y += 6
  }

  // ── Contact Info ──
  sectionTitle('Contact Information')
  const phones: Array<[string, string | null]> = [
    ['Main', provider.phone_main],
    ['Direct', provider.phone_direct],
    ['Cell', provider.phone_cell],
    ['Fax', provider.phone_fax],
    ['After Hours', provider.phone_after_hours],
  ]
  for (const [label, val] of phones) {
    if (val) kv(`Phone (${label})`, val)
  }
  if (provider.email) kv('Email', provider.email)
  if (provider.website) kv('Website', provider.website)
  if (provider.address) kv('Address', provider.address)
  if (provider.hours) kv('Hours', provider.hours)
  if (provider.languages) kv('Languages', provider.languages)
  y += 4

  // ── Availability ──
  sectionTitle('Availability')
  kv('Status', availabilityLabel(provider.availability_status))
  if (provider.availability_notes) kv('Notes', provider.availability_notes)
  y += 4

  // ── Referral Process ──
  if (provider.referral_process) {
    sectionTitle('Referral Process')
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(provider.referral_process, contentW)
    for (const line of lines) {
      if (y > pageH - 15) { doc.addPage(); y = 18 }
      doc.text(line, marginL, y)
      y += 5
    }
    y += 4
  }

  // ── Custom Fields ──
  if (provider.category_id) {
    const fields = getCustomFields(provider.category_id)
    const values = getCustomValues(provider.id)
    const valueMap = new Map(values.map(v => [v.custom_field_id, v.value]))
    const filledFields = fields.filter(f => valueMap.has(f.id))
    if (filledFields.length > 0) {
      sectionTitle('Extra details')
      for (const f of filledFields) {
        kv(f.field_name, valueMap.get(f.id) || '\u2014')
      }
      y += 4
    }
  }

  // ── Recent Interactions ──
  const interactions = getInteractions(provider.id, 10)
  if (interactions.length > 0) {
    sectionTitle('Recent Interactions')
    for (const ix of interactions) {
      if (y > pageH - 20) { doc.addPage(); y = 18 }
      const dateStr = shortDate(parseDbTimestamp(ix.created_at))
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text(`${dateStr}  [${ix.contact_type.toUpperCase()}]`, marginL, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      const lines = doc.splitTextToSize(stripHtml(ix.content), contentW)
      for (const line of lines) {
        if (y > pageH - 15) { doc.addPage(); y = 18 }
        doc.text(line, marginL, y)
        y += 5
      }
      y += 2
    }
    y += 2
  }

  // ── Linked Clients ──
  const clientLinks = getClientLinks({ providerId: provider.id })
  if (clientLinks.length > 0) {
    sectionTitle(`Linked ${word('record', { many: true, cap: true })}`)

    // Batch-fetch all client names and grid names to avoid N+1 queries
    const gridNameMap = new Map<number, string>()
    const clientNameMap = new Map<string, string>()

    // Group row IDs by grid for batchGetClientNames (one batch per grid)
    const rowsByGrid = new Map<number, number[]>()
    for (const link of clientLinks) {
      const arr = rowsByGrid.get(link.grid_id)
      if (arr) arr.push(link.row_id)
      else rowsByGrid.set(link.grid_id, [link.row_id])
    }
    for (const [gid, rowIds] of rowsByGrid) {
      const names = batchGetClientNames(db, rowIds, gid)
      for (const [rowId, name] of names) clientNameMap.set(`${rowId}:${gid}`, name)
    }

    // Batch grid names in one query
    const gridIds = [...rowsByGrid.keys()]
    if (gridIds.length > 0) {
      const placeholders = gridIds.map(() => '?').join(',')
      const gridRows = db.prepare(`SELECT id, name FROM grids WHERE id IN (${placeholders})`).all(...gridIds) as { id: number; name: string }[]
      for (const g of gridRows) gridNameMap.set(g.id, g.name)
    }

    for (const link of clientLinks) {
      if (y > pageH - 15) { doc.addPage(); y = 18 }
      const clientName = clientNameMap.get(`${link.row_id}:${link.grid_id}`) ?? `${word('record', { cap: true }, link.grid_id)} #${link.row_id}`
      const gridName = gridNameMap.get(link.grid_id)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text(`${clientName}${gridName ? ` (${gridName})` : ''}`, marginL, y)
      y += 5
    }
    y += 4
  }

  // ── Footer ──
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(120)
    doc.text(`Printed ${new Date().toLocaleDateString()} — ${PRODUCT_NAME} — CONFIDENTIAL`, marginL, pageH - 8)
    doc.text(`Page ${p} of ${totalPages}`, marginR, pageH - 8, { align: 'right' })
    doc.setTextColor(0)
  }

  await new Promise(resolve => setImmediate(resolve))
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
}

// ──────────────────────────────────────────────────────────────────────────────
// Provider Directory PDF Export
// ──────────────────────────────────────────────────────────────────────────────

export async function exportDirectoryPdf(filterParams: Record<string, unknown>, destPath: string): Promise<void> {
  const providers = getProviders(filterParams as ContactFilterParams, { all: true })
  const categories = getCategories()

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const marginL = 16
  const marginR = pageW - 16

  // ── Header Band ──
  doc.setFillColor(71, 85, 105)
  doc.rect(0, 0, pageW, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(`${word('contact', { cap: true })} directory`, marginL, 15)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(
    `Printed ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}  \u00b7  ${providers.length} ${word('contact', { count: providers.length })}`,
    marginL, 24
  )
  doc.setTextColor(0, 0, 0)

  // Group providers by category
  const catMap = new Map(categories.map(c => [c.id, c]))
  const grouped = new Map<number | null, typeof providers>()
  for (const p of providers) {
    const key = p.category_id
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(p)
  }

  // Sort category groups by position, uncategorized last
  const sortedKeys = [...grouped.keys()].sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1
    const posA = catMap.get(a)?.position ?? 999
    const posB = catMap.get(b)?.position ?? 999
    return posA - posB
  })

  let y = 38

  for (const catId of sortedKeys) {
    const cat = catId != null ? catMap.get(catId) : null
    const catProviders = grouped.get(catId) || []
    if (catProviders.length === 0) continue

    // Check space for header + at least one row
    if (y > pageH - 30) { doc.addPage(); y = 18 }

    // Category header with color stripe
    // A category saved before colors were checked can hold "red"; jsPDF throws on NaN.
    const catColor = normalizeHexColor(cat?.color) ?? '#64748b'
    const r = parseInt(catColor.slice(1, 3), 16)
    const g = parseInt(catColor.slice(3, 5), 16)
    const b = parseInt(catColor.slice(5, 7), 16)

    doc.setFillColor(r, g, b)
    doc.rect(marginL, y - 4, 3, 8, 'F')
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(r, g, b)
    doc.text(cat?.name || 'Uncategorized', marginL + 6, y + 1)
    doc.setTextColor(0, 0, 0)
    y += 8

    // Table for this category
    autoTable(doc, {
      startY: y,
      head: [['Name', 'Organization', 'Phone', 'Email', 'Status']],
      body: catProviders.map(p => [
        p.name,
        p.org_name || '',
        p.phone_main || p.phone_direct || '',
        p.email || '',
        availabilityLabel(p.availability_status),
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [r, g, b], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 40 },
        2: { cellWidth: 30 },
        3: { cellWidth: 40 },
        4: { cellWidth: 22 },
      },
      margin: { left: marginL, right: 16 },
      didDrawPage: () => { /* handled below */ },
    })
    y = lastTableY(doc) + 8
  }

  // ── Footer on all pages ──
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(120)
    doc.text(`Printed ${new Date().toLocaleDateString()} — ${PRODUCT_NAME} — CONFIDENTIAL`, marginL, pageH - 8)
    doc.text(`Page ${p} of ${totalPages}`, marginR, pageH - 8, { align: 'right' })
    doc.setTextColor(0)
  }

  await new Promise(resolve => setImmediate(resolve))
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
}
