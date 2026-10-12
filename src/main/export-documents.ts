/**
 * Batch documents, postcards and address labels (generalization W10 §3.1–3.2).
 * One PDF: a document per record (or two postcards per sheet), in name order.
 */
import { getDb } from './database'
import { jsPDF } from './export-shared'
import { resolvePlaceholders } from './placeholders'
import { loadDeadlines } from './deadlines'

export class DocumentError extends Error {}

export type DocPage = 'letter' | 'postcard'
export type LabelLayout = 'avery-5160' | 'avery-5163'

export interface DocTarget {
  gridId: number
  /** These records; otherwise everyone active in the list */
  rowIds?: number[]
  /** Everyone with this column's deadline due in the range (local dates) */
  deadline?: { columnId: number; from: string; to: string }
}

export const MAX_BATCH = 1000
const IN = 25.4

/** The records a batch covers, in name order */
export function batchRowIds(t: DocTarget): number[] {
  const db = getDb()
  let ids: number[] | null = t.rowIds?.length ? t.rowIds : null
  if (t.deadline) {
    const due = loadDeadlines({ gridId: t.gridId, from: t.deadline.from, to: t.deadline.to }).filter(d => d.column_id === t.deadline!.columnId).map(d => d.row_id)
    ids = ids ? ids.filter(id => due.includes(id)) : due
  }
  // Nothing from a list in the Trash, even when its records are named (Q-082)
  const rows = db.prepare(`SELECT id FROM rows WHERE grid_id = ? AND deleted_at IS NULL ${ids ? '' : 'AND is_active = 1'}
    AND EXISTS (SELECT 1 FROM grids g WHERE g.id = rows.grid_id AND g.is_active = 1)
    ORDER BY COALESCE(NULLIF(display_name, ''), '~') COLLATE NOCASE, id`).all(t.gridId) as Array<{ id: number }>
  const wanted = ids ? new Set(ids) : null
  const out = rows.map(r => r.id).filter(id => !wanted || wanted.has(id))
  if (out.length > MAX_BATCH) throw new DocumentError(`That's more than ${MAX_BATCH} at once. Choose fewer and try again.`)
  return out
}

/** Text in a box; lines that don't fit are dropped and the last one ends in "…" */
function textInBox(doc: InstanceType<typeof jsPDF>, text: string, x: number, y: number, w: number, h: number, lineH: number): void {
  const lines = doc.splitTextToSize(text, w) as string[]
  const max = Math.max(1, Math.floor(h / lineH))
  const shown = lines.length > max ? [...lines.slice(0, max - 1), `${lines[max - 1]!.replace(/\s+\S*$/, '')}…`] : lines
  shown.forEach((line, i) => doc.text(line, x, y + i * lineH))
}

/** Where each postcard goes on a letter sheet: two 6×4 in cards, centered */
export function postcardPositions(): Array<{ x: number; y: number; w: number; h: number }> {
  const w = 6 * IN, h = 4 * IN
  const x = (8.5 * IN - w) / 2
  const gap = (11 * IN - 2 * h) / 3
  return [{ x, y: gap, w, h }, { x, y: gap * 2 + h, w, h }]
}

function cutMarks(doc: InstanceType<typeof jsPDF>, b: { x: number; y: number; w: number; h: number }): void {
  const m = 5, off = 2
  doc.setLineWidth(0.2)
  for (const [cx, cy] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as const) {
    const dx = cx === b.x ? -1 : 1, dy = cy === b.y ? -1 : 1
    doc.line(cx + dx * off, cy, cx + dx * (off + m), cy)
    doc.line(cx, cy + dy * off, cx, cy + dy * (off + m))
  }
}

/**
 * Before saving: how many documents a batch makes, and which {{tags}} in the
 * template won't fill in. Tags are the template's, so one record shows them.
 */
export function previewBatch(templateId: number | null, target: DocTarget): { count: number; unknown: string[]; error?: string } {
  let rowIds: number[]
  try { rowIds = batchRowIds(target) } catch (err) {
    if (err instanceof DocumentError) return { count: 0, unknown: [], error: err.message }
    throw err
  }
  if (templateId === null || rowIds.length === 0) return { count: rowIds.length, unknown: [] }
  const template = getDb().prepare('SELECT content FROM letter_templates WHERE id = ?').get(templateId) as { content: string } | undefined
  if (!template) return { count: rowIds.length, unknown: [], error: 'That document template no longer exists.' }
  return { count: rowIds.length, unknown: resolvePlaceholders(template.content, rowIds[0]!, target.gridId).unknown }
}

/** One PDF of a document for each record */
export function buildBatchPdf(templateId: number, target: DocTarget, page: DocPage): { pdf: InstanceType<typeof jsPDF>; count: number; unknown: string[] } {
  const template = getDb().prepare('SELECT content FROM letter_templates WHERE id = ?').get(templateId) as { content: string } | undefined
  if (!template) throw new DocumentError('That document template no longer exists.')
  const rowIds = batchRowIds(target)
  if (rowIds.length === 0) throw new DocumentError('There is nobody to make documents for.')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const unknown = new Set<string>()
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight()
  doc.setFont('helvetica', 'normal')
  rowIds.forEach((rowId, i) => {
    const filled = resolvePlaceholders(template.content, rowId, target.gridId)
    filled.unknown.forEach(u => unknown.add(u))
    if (page === 'letter') {
      if (i > 0) doc.addPage()
      const margin = IN, lineH = 6
      doc.setFontSize(12)
      let y = margin
      for (const line of doc.splitTextToSize(filled.text, pageW - margin * 2) as string[]) {
        // A long document continues on more pages; the next one starts fresh
        if (y + lineH > pageH - margin) { doc.addPage(); y = margin }
        doc.text(line, margin, y)
        y += lineH
      }
    } else {
      const slot = i % 2
      if (i > 0 && slot === 0) doc.addPage()
      const b = postcardPositions()[slot]!
      cutMarks(doc, b)
      doc.setFontSize(11)
      textInBox(doc, filled.text, b.x + 8, b.y + 12, b.w - 16, b.h - 18, 5)
    }
  })
  return { pdf: doc, count: rowIds.length, unknown: [...unknown] }
}

/** Avery label geometry, in mm from the top-left of a letter sheet */
export function labelPositions(layout: LabelLayout): Array<{ x: number; y: number; w: number; h: number }> {
  const g = layout === 'avery-5160'
    ? { cols: 3, rows: 10, w: 2.625 * IN, h: 1 * IN, left: 0.1875 * IN, top: 0.5 * IN, pitchX: 2.75 * IN, pitchY: 1 * IN }
    : { cols: 2, rows: 5, w: 4 * IN, h: 2 * IN, left: 0.15625 * IN, top: 0.5 * IN, pitchX: 4.1875 * IN, pitchY: 2 * IN }
  const out: Array<{ x: number; y: number; w: number; h: number }> = []
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) out.push({ x: g.left + c * g.pitchX, y: g.top + r * g.pitchY, w: g.w, h: g.h })
  return out
}

/** Address labels: the name, then the address as entered (line breaks kept) */
export function buildLabelsPdf(target: DocTarget, addressColumnId: number, layout: LabelLayout): { pdf: InstanceType<typeof jsPDF>; count: number; skipped: number } {
  const db = getDb()
  const col = db.prepare('SELECT id FROM columns WHERE id = ? AND grid_id = ?').get(addressColumnId, target.gridId)
  if (!col) throw new DocumentError('Choose the column with the address.')
  const rowIds = batchRowIds(target)
  const get = db.prepare("SELECT COALESCE(NULLIF(r.display_name, '(unnamed)'), '') AS name, c.value AS address FROM rows r LEFT JOIN cells c ON c.row_id = r.id AND c.column_id = ? WHERE r.id = ?")
  const entries = rowIds.map(id => get.get(addressColumnId, id) as { name: string; address: string | null }).filter(e => e.address && e.address.trim())
  if (entries.length === 0) throw new DocumentError('None of them has an address in that column.')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const slots = labelPositions(layout)
  const fontSize = layout === 'avery-5160' ? 9 : 12
  const lineH = fontSize * 0.42
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(fontSize)
  entries.forEach((e, i) => {
    if (i > 0 && i % slots.length === 0) doc.addPage()
    const b = slots[i % slots.length]!
    const text = [e.name, ...e.address!.split(/\r?\n/).map(l => l.trim()).filter(Boolean)].filter(Boolean).join('\n')
    textInBox(doc, text, b.x + 3, b.y + 3 + lineH, b.w - 6, b.h - 4, lineH)
  })
  return { pdf: doc, count: entries.length, skipped: rowIds.length - entries.length }
}
