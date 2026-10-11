/**
 * Printable forms (generalization W08 §5): a blank to fill on paper, or a
 * filled one to sign. Labels with writing lines, date boxes, checkbox
 * squares, dropdown options with squares, section headings, and a footer
 * with the list name and page numbers.
 */
import { getDb } from './database'
import { jsPDF } from './export-shared'
import { getForm } from './forms'
import { formatDue } from '../shared/deadlineEngine'

export class FormPrintError extends Error {}

interface Col { id: number; name: string; column_type: string; config: string | null }

const optionsOf = (c: Col): string[] => {
  try {
    const opts = (JSON.parse(c.config || '{}') as { options?: Array<string | { label?: string }> }).options ?? []
    return opts.map(o => (typeof o === 'string' ? o : o.label ?? '')).filter(Boolean)
  } catch { return [] }
}

/** The form as a PDF; with a record, its saved values are printed on the lines */
export function buildFormPdf(formId: number, rowId: number | null): { pdf: InstanceType<typeof jsPDF>; name: string } {
  const db = getDb()
  const form = getForm(formId)
  if (!form) throw new FormPrintError('That form no longer exists.')
  const grid = db.prepare('SELECT name FROM grids WHERE id = ?').get(form.grid_id) as { name: string } | undefined
  const cols = new Map((db.prepare('SELECT id, name, column_type, config FROM columns WHERE grid_id = ?').all(form.grid_id) as Col[]).map(c => [c.id, c]))
  let value: (c: Col) => string = () => ''
  if (rowId !== null) {
    if (!db.prepare('SELECT 1 FROM rows WHERE id = ? AND grid_id = ? AND deleted_at IS NULL').get(rowId, form.grid_id)) throw new FormPrintError('That record is no longer available.')
    const cells = new Map((db.prepare('SELECT column_id, value FROM cells WHERE row_id = ?').all(rowId) as Array<{ column_id: number; value: string | null }>).map(c => [c.column_id, c.value ?? '']))
    const links = (c: Col) => {
      try {
        const cfg = JSON.parse(c.config || '{}') as { link_type_id?: number; direction?: string }
        const [mine, other] = cfg.direction === 'backward' ? ['to_row_id', 'from_row_id'] : ['from_row_id', 'to_row_id']
        return (db.prepare(`SELECT GROUP_CONCAT(t.display_name, ', ') AS names FROM record_links l JOIN rows t ON t.id = l.${other} WHERE l.link_type_id = ? AND l.${mine} = ? AND t.deleted_at IS NULL`)
          .get(cfg.link_type_id ?? 0, rowId) as { names: string | null }).names ?? ''
      } catch { return '' }
    }
    value = (c: Col) => {
      if (c.column_type === 'link') return links(c)
      const v = cells.get(c.id) ?? ''
      if ((c.column_type === 'date' || c.column_type === 'deadline') && /^\d{4}-\d{2}-\d{2}/.test(v)) return formatDue(v.slice(0, 10))
      if (c.column_type === 'checkbox') return v === 'true' || v === '1' ? 'Yes' : ''
      return v
    }
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight()
  const margin = 18, bottom = pageH - 20, width = pageW - margin * 2
  let y = margin + 4
  const need = (h: number) => { if (y + h > bottom) { doc.addPage(); y = margin } }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
  doc.text(form.name, margin, y); y += 8
  if (form.intro) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
    for (const line of doc.splitTextToSize(form.intro, width) as string[]) { need(6); doc.text(line, margin, y); y += 5.5 }
    y += 2
  }

  const writeLine = (x: number, w: number, text: string) => {
    doc.setDrawColor(120); doc.setLineWidth(0.3)
    doc.line(x, y + 1.5, x + w, y + 1.5)
    if (text) { doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text(doc.splitTextToSize(text, w)[0] as string, x + 1, y) }
  }
  const box = (x: number, checked: boolean) => {
    doc.setDrawColor(60); doc.setLineWidth(0.4); doc.rect(x, y - 3.5, 4, 4)
    if (checked) { doc.line(x + 0.8, y - 1.5, x + 1.8, y - 0.2); doc.line(x + 1.8, y - 0.2, x + 3.4, y - 3) }
  }

  // Half-width fields sit side by side in pairs
  let halfOpen = false
  for (const f of form.fields) {
    if (f.kind === 'section') {
      if (halfOpen) { y += 12; halfOpen = false }
      need(14); y += 3
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(f.title, margin, y)
      doc.setDrawColor(150); doc.setLineWidth(0.5); doc.line(margin, y + 1.5, margin + width, y + 1.5); y += 7
      if (f.text) { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); for (const line of doc.splitTextToSize(f.text, width) as string[]) { need(5); doc.text(line, margin, y); y += 5 } }
      continue
    }
    if (f.kind === 'note') {
      if (halfOpen) { y += 12; halfOpen = false }
      need(26)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(`${f.label}${f.required ? ' *' : ''}`, margin, y); y += 7
      for (let i = 0; i < 3; i++) { writeLine(margin, width, ''); y += 7 }
      y += 1
      continue
    }
    const c = cols.get(f.columnId)
    if (!c) continue
    const labelText = `${f.label || c.name}${f.required ? ' *' : ''}`
    const v = value(c)
    const half = f.width === 'half' && !['dropdown', 'status', 'notes', 'address'].includes(c.column_type)
    const x = half && halfOpen ? margin + width / 2 + 4 : margin
    const w = half ? width / 2 - 4 : width
    if (!(half && halfOpen)) need(c.column_type === 'notes' || c.column_type === 'address' ? 30 : 14)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(labelText, x, y)
    const yLabel = y
    y += 6
    if (c.column_type === 'checkbox') {
      box(x, v === 'Yes'); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text('Yes', x + 6, y)
    } else if ((c.column_type === 'dropdown' || c.column_type === 'status') && optionsOf(c).length) {
      let ox = x
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
      for (const o of optionsOf(c)) {
        const tw = doc.getTextWidth(o) + 12
        if (ox + tw > margin + width) { ox = x; y += 6; need(6) }
        box(ox, v === o); doc.text(o, ox + 6, y); ox += tw
      }
    } else if ((c.column_type === 'date' || c.column_type === 'deadline') && !v) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.text('____ / ____ / ________', x, y)
    } else if (c.column_type === 'notes' || c.column_type === 'address') {
      const lines = v ? doc.splitTextToSize(v, w) as string[] : []
      for (let i = 0; i < Math.max(3, lines.length); i++) { writeLine(x, w, lines[i] ?? ''); y += 7 }
      y -= 7
    } else {
      writeLine(x, w, v)
    }
    if (half && !halfOpen) { halfOpen = true; y = yLabel; continue }
    halfOpen = false
    y += 9
  }

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110)
    doc.text(grid?.name ?? '', margin, pageH - 10)
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 10, { align: 'right' })
    doc.setTextColor(0)
  }
  return { pdf: doc, name: form.name }
}
