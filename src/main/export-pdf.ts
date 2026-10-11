/**
 * export-pdf.ts — PDF export: letter, grid, profile, batch, contact, directory.
 */

import type { Column, Grid, ContactFilterParams } from '../shared/types'
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
  formatCellValue,
  loadGridData,
  getClientName,
  batchGetClientNames,
} from './export-shared'
import type { PdfProfileOptions, PdfGridOptions, PdfBatchOptions } from './export-shared'
import { parseDbTimestamp } from '../shared/dates'
import { vocabFor, word } from './vocab'
import { term } from '../shared/vocab'
import { hasDisplayFormat } from './display-names'
import { activityLabel } from './activity-types'
import { loadDeadlines, type DeadlineItem } from './deadlines'
import { deadlineSummary } from '../shared/deadlineSummary'

// ──────────────────────────────────────────────────────────────────────────────
// Letter Template PDF Export
// ──────────────────────────────────────────────────────────────────────────────

export async function exportLetterPdf(text: string, destPath: string): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
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

export async function exportPdfGrid(options: PdfGridOptions): Promise<void> {
  const { gridId, columnIds, activeRowIds, destPath, title } = options
  const { grid, columns, rows } = loadGridData(gridId)
  const v = vocabFor(gridId)
  logger.info('export', 'PDF grid export started', { rowCount: rows.length })

  const selectedColumns = columnIds.length > 0
    ? columns.filter(c => columnIds.includes(c.id))
    : columns

  const filteredRows = activeRowIds.length > 0
    ? rows.filter(r => activeRowIds.includes(r.row_id))
    : rows

  // Yield to event loop before heavy PDF generation
  await new Promise(resolve => setImmediate(resolve))

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Header
  const exportTitle = title || grid.name
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(exportTitle, 14, 18)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  doc.text(`Exported ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}  ·  ${filteredRows.length} ${term(v, 'record', { count: filteredRows.length })}`, 14, 24)
  doc.setTextColor(0)

  const head = [selectedColumns.map(c => c.name)]
  const body = filteredRows.map(row =>
    selectedColumns.map(col => formatCellValue(row[`col_${col.id}`] as string | null, col.column_type))
  )

  // Compute column widths: Name gets more space
  const gridColCount = selectedColumns.length
  const gridUsable = 297 - 28 // A4 landscape minus margins
  const gridColStyles: Record<number, { cellWidth?: number }> = {}
  if (gridColCount > 1) {
    const nameW = Math.min(gridUsable * 0.25, 60)
    const otherW = (gridUsable - nameW) / (gridColCount - 1)
    gridColStyles[0] = { cellWidth: nameW }
    for (let i = 1; i < gridColCount; i++) {
      gridColStyles[i] = { cellWidth: otherW }
    }
  }
  const gridFontSize = gridColCount > 16 ? 6 : gridColCount > 10 ? 7 : 8

  autoTable(doc, {
    head,
    body,
    startY: 28,
    styles: { fontSize: gridFontSize, cellPadding: 2 },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: gridColStyles,
    margin: { left: 14, right: 14 },
    didDrawPage: () => {
      // Footer
      const pageNum = doc.getNumberOfPages()
      doc.setFontSize(7)
      doc.setTextColor(120)
      doc.text('CONFIDENTIAL', 14, doc.internal.pageSize.height - 8)
      doc.text(`Page ${pageNum}`, doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 8, { align: 'right' })
      doc.setTextColor(0)
    }
  })

  // Yield before file write
  await new Promise(resolve => setImmediate(resolve))
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.6 — PDF Profile Export (single client)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Render a single client profile into an existing jsPDF document.
 * Does NOT write the file — the caller handles that.
 * Returns the final Y position on the last page.
 */
/** Shared grid metadata that can be hoisted outside a batch loop */
interface ProfileDocContext {
  grid: Grid
  columns: Column[]
  nameColId: number | undefined
  cellsByRow?: Map<number, Map<number, string | null>>
  /** Pre-fetched checklist items grouped by row_id */
  checklistByRow?: Map<number, Array<{ title: string; due_date: string | null; priority: string }>>
  /** Pre-fetched case log entries grouped by row_id (already limited to 10 most recent per row) */
  caseLogByRow?: Map<number, Array<{ content: string; log_type: string; created_at: string }>>
  /** Pre-fetched scrap notes keyed by row_id */
  scrapNotesByRow?: Map<number, string>
  /** Pre-fetched deadlines (from the deadline engine) grouped by row_id */
  deadlinesByRow?: Map<number, DeadlineItem[]>
  /** Pre-fetched linked providers grouped by row_id */
  providersByRow?: Map<number, Array<{
    name: string; org_name: string | null; title: string | null;
    phone_main: string | null; email: string | null;
    availability_status: string | null; category_name: string | null
  }>>
}

/**
 * Execute a query with IN-clause placeholders, chunking into groups of 200
 * to stay within SQLite's variable limit. Returns all results concatenated.
 */
function chunkedInQuery<T>(db: ReturnType<typeof getDb>, sql: string, ids: number[], extraParamsBefore: unknown[] = []): T[] {
  const CHUNK = 200
  const results: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    const query = sql.replace('__PLACEHOLDERS__', placeholders)
    const rows = db.prepare(query).all(...extraParamsBefore, ...chunk) as T[]
    results.push(...rows)
  }
  return results
}

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

export function renderProfileToDoc(
  doc: InstanceType<typeof jsPDF>,
  rowId: number,
  gridId: number,
  includeSections: PdfProfileOptions['includeSections'],
  sharedCtx?: ProfileDocContext
): number {
  const db = getDb()
  const clientName = getClientName(db, rowId, gridId)
  const v = vocabFor(gridId)
  const grid = sharedCtx?.grid ?? db.prepare('SELECT * FROM grids WHERE id = ?').get(gridId) as Grid
  const columns = sharedCtx?.columns ?? db.prepare('SELECT * FROM columns WHERE grid_id = ? AND is_visible = 1 ORDER BY position').all(gridId) as Column[]
  const nameColId = sharedCtx ? sharedCtx.nameColId : (db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1 LIMIT 1').get(gridId) as { id: number } | undefined)?.id

  let cellMap: Map<number, string | null>
  if (sharedCtx?.cellsByRow?.has(rowId)) {
    cellMap = sharedCtx.cellsByRow.get(rowId)!
  } else {
    const cells = db.prepare('SELECT column_id, value FROM cells WHERE row_id = ?').all(rowId) as Array<{ column_id: number; value: string | null }>
    cellMap = new Map(cells.map(c => [c.column_id, c.value]))
  }

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

  // ── Grid Data ──
  if (includeSections.gridData) {
    addSection(`${term(v, 'record', { cap: true })} information`)
    for (const col of columns) {
      if (col.id === nameColId) continue
      const val = formatCellValue(cellMap.get(col.id) ?? null, col.column_type)
      addKeyValue(col.name, val)
    }
    y += 4
  }

  // ── Deadlines: the same engine as the dashboard, so the PDF never disagrees with the app ──
  if (includeSections.deadlines) {
    const items = sharedCtx?.deadlinesByRow
      ? (sharedCtx.deadlinesByRow.get(rowId) ?? [])
      : loadDeadlines({ gridId, rowIds: [rowId] })
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
    const items = (sharedCtx?.checklistByRow?.get(rowId) ?? db.prepare(`
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
        if (y > pageH - 15) { doc.addPage(); y = 18 }
        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        const dueStr = item.due_date ? `  (due ${formatDate(item.due_date, 'us')})` : ''
        doc.text(`\u2610  ${item.title}${dueStr}`, marginL, y)
        y += 5
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
          if (y > pageH - 15) { doc.addPage(); y = 18 }
          const dueStr = item.due_date ? `  (due ${formatDate(item.due_date, 'us')})` : ''
          doc.text(`\u2610  ${item.title}${dueStr}`, marginL + 4, y)
          y += 5
        }
      }
      y += 4
    }
  }

  // ── Case Log ──
  if (includeSections.caseLog) {
    const entries = sharedCtx?.caseLogByRow?.get(rowId) ?? db.prepare(`
      SELECT content, log_type, created_at FROM case_log
      WHERE row_id = ? AND voided_at IS NULL AND log_type != 'system'
      ORDER BY created_at DESC LIMIT 10
    `).all(rowId) as Array<{ content: string; log_type: string; created_at: string }>
    if (entries.length > 0) {
      addSection(`Recent ${term(v, 'activity', { many: true })} (last 10)`)
      for (const entry of entries) {
        if (y > pageH - 20) { doc.addPage(); y = 18 }
        const dt = parseDbTimestamp(entry.created_at)
        const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
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
    const linkedProviders = sharedCtx?.providersByRow?.get(rowId) ?? db.prepare(`
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

  // ── Scrap Notes ──
  if (includeSections.scratchPad) {
    const prefetchedContent = sharedCtx?.scrapNotesByRow?.get(rowId)
    const noteContent = prefetchedContent !== undefined
      ? prefetchedContent
      : (db.prepare('SELECT content FROM scrap_notes WHERE row_id = ?').get(rowId) as { content: string } | undefined)?.content
    if (noteContent) {
      addSection('Scrap notes')
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
// 4.6 — Batch Print (multi-client PDF)
// ──────────────────────────────────────────────────────────────────────────────

const MAX_BATCH_PDF = 200

export async function exportPdfBatch(options: PdfBatchOptions): Promise<void> {
  const { rowIds, gridId, destPath, includeSections } = options
  const v = vocabFor(gridId)
  if (rowIds.length > MAX_BATCH_PDF) {
    throw new Error(`Batch PDF limited to ${MAX_BATCH_PDF} ${term(v, 'record', { many: true })}. You selected ${rowIds.length}.`)
  }
  logger.info('export', 'PDF batch export started', { rowCount: rowIds.length })
  const db = getDb()

  // Sort rowIds if needed
  let orderedRowIds = [...rowIds]
  if (options.sortOrder === 'alpha' && hasDisplayFormat(gridId)) {
    const names = batchGetClientNames(db, orderedRowIds, gridId)
    orderedRowIds.sort((a, b) => (names.get(a) || '').localeCompare(names.get(b) || ''))
  } else if (options.sortOrder === 'alpha') {
    const nameColId = (db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1 LIMIT 1').get(gridId) as { id: number } | undefined)?.id
    if (nameColId) {
      // Only fetch names for selected rowIds (not the whole grid)
      const placeholders = orderedRowIds.map(() => '?').join(',')
      const names = new Map(
        (db.prepare(`SELECT row_id, value FROM cells WHERE column_id = ? AND row_id IN (${placeholders})`).all(nameColId, ...orderedRowIds) as Array<{ row_id: number; value: string }>)
          .map(r => [r.row_id, r.value])
      )
      orderedRowIds.sort((a, b) => (names.get(a) || '').localeCompare(names.get(b) || ''))
    }
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const marginL = 16
  const marginR = pageW - 16

  // ── Cover Page ──
  const grid = db.prepare('SELECT * FROM grids WHERE id = ?').get(gridId) as Grid
  doc.setFillColor(71, 85, 105)
  doc.rect(0, 0, pageW, 50, 'F')
  doc.setTextColor(255)
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text(`${term(v, 'record', { cap: true })} batch report`, marginL, 22)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.text(grid.name, marginL, 32)
  doc.setFontSize(9)
  doc.text(`Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}  ·  ${orderedRowIds.length} ${term(v, 'record', { count: orderedRowIds.length })}`, marginL, 42)
  doc.setTextColor(0)

  // Table of Contents
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('Contents', marginL, 62)
  doc.setLineWidth(0.3)
  doc.setDrawColor(200)
  doc.line(marginL, 64, marginR, 64)

  const clientNames = batchGetClientNames(db, orderedRowIds, gridId)

  let tocY = 70
  const clientPages: number[] = []
  for (let i = 0; i < orderedRowIds.length; i++) {
    const name = clientNames.get(orderedRowIds[i]!) || `${term(v, 'record', { cap: true })} #${orderedRowIds[i]}`
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`${i + 1}.  ${name}`, marginL, tocY)
    clientPages.push(i + 2) // cover = page 1, clients start page 2
    tocY += 6
    if (tocY > pageH - 20) break // truncate TOC if too many clients
  }

  // ── Pre-fetch shared grid metadata once (instead of per-client) ──
  const columns = db.prepare('SELECT * FROM columns WHERE grid_id = ? AND is_visible = 1 ORDER BY position').all(gridId) as Column[]
  const nameColId = (db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1 LIMIT 1').get(gridId) as { id: number } | undefined)?.id

  // ── Process clients in batches of 10 to limit memory usage ──
  const BATCH_SIZE = 10
  for (let batchStart = 0; batchStart < orderedRowIds.length; batchStart += BATCH_SIZE) {
    const batchIds = orderedRowIds.slice(batchStart, batchStart + BATCH_SIZE)

    // Pre-fetch cells for this batch
    const batchCellRows = chunkedInQuery<{row_id: number; column_id: number; value: string | null}>(
      db,
      'SELECT row_id, column_id, value FROM cells WHERE row_id IN (__PLACEHOLDERS__)',
      batchIds
    )
    const cellsByRow = new Map<number, Map<number, string | null>>()
    for (const c of batchCellRows) {
      if (!cellsByRow.has(c.row_id)) cellsByRow.set(c.row_id, new Map())
      cellsByRow.get(c.row_id)!.set(c.column_id, c.value)
    }

    // Pre-fetch checklist items for this batch
    const checklistByRow = new Map<number, Array<{ title: string; due_date: string | null; priority: string }>>()
    if (includeSections.checklist) {
      const batchChecklist = chunkedInQuery<{ row_id: number; title: string; due_date: string | null; priority: string }>(
        db,
        `SELECT row_id, title, due_date, priority FROM checklist_items
         WHERE row_id IN (__PLACEHOLDERS__) AND is_archived = 0 AND is_completed = 0
         ORDER BY position`,
        batchIds
      )
      for (const item of batchChecklist) {
        if (!checklistByRow.has(item.row_id)) checklistByRow.set(item.row_id, [])
        checklistByRow.get(item.row_id)!.push(item)
      }
    }

    // Pre-fetch case log entries for this batch
    const caseLogByRow = new Map<number, Array<{ content: string; log_type: string; created_at: string }>>()
    if (includeSections.caseLog) {
      const batchCaseLog = chunkedInQuery<{ row_id: number; content: string; log_type: string; created_at: string }>(
        db,
        `SELECT row_id, content, log_type, created_at FROM case_log
         WHERE row_id IN (__PLACEHOLDERS__) AND voided_at IS NULL AND log_type != 'system'
         ORDER BY created_at DESC`,
        batchIds
      )
      for (const entry of batchCaseLog) {
        if (!caseLogByRow.has(entry.row_id)) caseLogByRow.set(entry.row_id, [])
        const arr = caseLogByRow.get(entry.row_id)!
        if (arr.length < 10) arr.push(entry) // limit 10 per row
      }
    }

    // Pre-fetch scrap notes for this batch
    const scrapNotesByRow = new Map<number, string>()
    if (includeSections.scratchPad) {
      const batchNotes = chunkedInQuery<{ row_id: number; content: string }>(
        db,
        'SELECT row_id, content FROM scrap_notes WHERE row_id IN (__PLACEHOLDERS__)',
        batchIds
      )
      for (const note of batchNotes) {
        if (note.content) scrapNotesByRow.set(note.row_id, note.content)
      }
    }

    // Pre-fetch linked providers for this batch
    const providersByRow = new Map<number, Array<{
      name: string; org_name: string | null; title: string | null;
      phone_main: string | null; email: string | null;
      availability_status: string | null; category_name: string | null
    }>>()
    {
      const batchLinked = chunkedInQuery<{
        row_id: number; name: string; org_name: string | null; title: string | null;
        phone_main: string | null; email: string | null;
        availability_status: string | null; category_name: string | null
      }>(
        db,
        `SELECT pcl.row_id, p.name, p.org_name, p.title, p.phone_main, p.email,
                p.availability_status, pc.name AS category_name
         FROM provider_client_links pcl
         JOIN providers p ON pcl.provider_id = p.id
         LEFT JOIN provider_categories pc ON p.category_id = pc.id
         WHERE pcl.row_id IN (__PLACEHOLDERS__)
         ORDER BY p.name`,
        batchIds
      )
      for (const prov of batchLinked) {
        if (!providersByRow.has(prov.row_id)) providersByRow.set(prov.row_id, [])
        providersByRow.get(prov.row_id)!.push(prov)
      }
    }

    // Deadlines for the whole batch in one pass of the engine
    const deadlinesByRow = new Map<number, DeadlineItem[]>()
    if (includeSections.deadlines) {
      for (const d of loadDeadlines({ gridId, rowIds: batchIds })) {
        if (!deadlinesByRow.has(d.row_id)) deadlinesByRow.set(d.row_id, [])
        deadlinesByRow.get(d.row_id)!.push(d)
      }
    }

    const sharedCtx: ProfileDocContext = {
      grid, columns, nameColId, cellsByRow,
      checklistByRow, caseLogByRow, scrapNotesByRow, providersByRow, deadlinesByRow
    }

    // Render pages for this batch
    for (const rowId of batchIds) {
      doc.addPage()
      renderProfileToDoc(doc, rowId, gridId, includeSections, sharedCtx)
    }

    // Yield to event loop between batches to avoid blocking UI
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  // ── Footer on all pages ──
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(120)
    doc.text(`CONFIDENTIAL — ${PRODUCT_NAME}`, marginL, pageH - 8)
    doc.text(`Page ${p} of ${totalPages}`, marginR, pageH - 8, { align: 'right' })
    doc.setTextColor(0)
  }

  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
}

// ──────────────────────────────────────────────────────────────────────────────
// Contact / Provider PDF Export
// ──────────────────────────────────────────────────────────────────────────────

export async function exportContactPdf(providerId: number, destPath: string): Promise<void> {
  const db = getDb()

  const provider = getProvider(providerId)
  if (!provider) throw new Error('Provider not found')

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
    doc.text(value || '\u2014', marginL + labelW + 2, y)
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
  kv('Status', provider.availability_status || 'Unknown')
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
      sectionTitle('Custom Fields')
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
      const dateStr = parseDbTimestamp(ix.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
  const providers = getProviders(filterParams as ContactFilterParams)
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

  function availabilityLabel(status: string | null): string {
    if (!status) return 'Unknown'
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  for (const catId of sortedKeys) {
    const cat = catId != null ? catMap.get(catId) : null
    const catProviders = grouped.get(catId) || []
    if (catProviders.length === 0) continue

    // Check space for header + at least one row
    if (y > pageH - 30) { doc.addPage(); y = 18 }

    // Category header with color stripe
    const catColor = cat?.color || '#64748b'
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
