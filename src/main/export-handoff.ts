/**
 * export-handoff.ts — client handoff packet (brainstorm C3).
 *
 * One PDF for a transfer or discharge: a cover page (who's handing off to
 * whom, notes for the next worker), the client's full profile, and the
 * complete audit trail. Files on the record are listed, and pictures can
 * be added as pages (jsPDF can't merge PDFs, so those are listed only).
 */

import { getDb } from './database'
import { jsPDF, atomicWriteFileAsync, getClientName } from './export-shared'
import { renderProfileToDoc } from './export-pdf'
import { loadAuditTrail, drawAuditClients, auditFootnote } from './export-audit'
import { listAttachments, attachmentBytes } from './attachments'
import { formatBytes } from '../shared/attachments'
import { parseDbTimestamp } from '../shared/dates'
import { vocabFor } from './vocab'
import { term } from '../shared/vocab'

export interface HandoffOptions {
  rowId: number
  gridId: number
  /** Who is taking over (optional) */
  receiving?: string
  /** Notes for the next worker (optional) */
  summary?: string
  /** Put PNG and JPEG files on their own pages, scaled to fit */
  includePictures?: boolean
  /** Add the scrap notes. Off unless asked for: they're private jottings, and the packet leaves the app */
  includeScratchPad?: boolean
}

/** Pictures jsPDF can draw without a canvas */
const PAGE_IMAGE: Record<string, 'PNG' | 'JPEG'> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG' }

/** The record's files as a list, then (optionally) each picture on a page. Returns how many pictures were added. */
export function drawFiles(doc: InstanceType<typeof jsPDF>, rowId: number, opts: { includePictures?: boolean }): number {
  const files = listAttachments(rowId)
  if (files.length === 0) return 0
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height
  const marginL = 16
  const width = pageW - marginL * 2
  doc.addPage()
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Files', marginL, 20)
  doc.setFontSize(10)
  let y = 30
  for (const f of files) {
    if (y > pageH - 24) { doc.addPage(); y = 20 }
    doc.setFont('helvetica', 'bold')
    doc.text(doc.splitTextToSize(f.file_name, width) as string[], marginL, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    const added = parseDbTimestamp(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const meta = doc.splitTextToSize([formatBytes(f.size_bytes), `added ${added}`, f.description].filter(Boolean).join('  ·  '), width) as string[]
    doc.text(meta, marginL, y)
    y += meta.length * 5 + 3
  }
  if (!opts.includePictures) {
    doc.setFontSize(9)
    doc.text('The files themselves are kept in Pulse and are not part of this PDF.', marginL, Math.min(y + 4, pageH - 14))
    return 0
  }
  let pictures = 0
  for (const f of files) {
    const format = PAGE_IMAGE[f.mime_type]
    if (!format) continue
    try {
      const data = new Uint8Array(attachmentBytes(f.id))
      const props = doc.getImageProperties(data)
      const maxW = width, maxH = pageH - 50
      const scale = Math.min(maxW / props.width, maxH / props.height)
      doc.addPage()
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text(doc.splitTextToSize(f.file_name, width) as string[], marginL, 18)
      doc.addImage(data, format, marginL, 26, props.width * scale, props.height * scale)
      pictures++
    } catch {
      // A picture jsPDF can't read stays in the list only
    }
  }
  return pictures
}

export async function exportHandoffPacket(opts: HandoffOptions, destPath: string): Promise<{ pages: number }> {
  const db = getDb()
  const clientName = getClientName(db, opts.rowId, opts.gridId)
  const grid = db.prepare('SELECT name FROM grids WHERE id = ?').get(opts.gridId) as { name: string } | undefined
  const v = vocabFor(opts.gridId)
  const worker = (db.prepare("SELECT value FROM settings WHERE key = 'profile_name'").get() as { value: string } | undefined)?.value

  await new Promise(resolve => setImmediate(resolve))
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const marginL = 16
  const width = pageW - marginL * 2
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  // ── Cover page ──
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text(`${term(v, 'record', { cap: true })} handoff packet`, marginL, 28)
  doc.setFontSize(16)
  doc.text(clientName, marginL, 40)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  let y = 52
  const line = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold'); doc.text(`${label}:`, marginL, y)
    doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(value, width - 40), marginL + 40, y)
    y += 8
  }
  line('Date', today)
  if (grid) line(term(v, 'list', { cap: true }), grid.name)
  if (worker) line('From', worker)
  if (opts.receiving?.trim()) line('To', opts.receiving.trim())
  if (opts.summary?.trim()) {
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.text(`Notes for the next ${term(v, 'worker')}`, marginL, y)
    y += 7
    doc.setFont('helvetica', 'normal')
    const lines = doc.splitTextToSize(opts.summary.trim(), width) as string[]
    for (const l of lines) {
      if (y > doc.internal.pageSize.height - 20) { doc.addPage(); y = 20 }
      doc.text(l, marginL, y)
      y += 6
    }
  }
  y += 6
  doc.setFontSize(10)
  const hasFiles = listAttachments(opts.rowId).length > 0
  const files = hasFiles ? `  3. the files on this ${term(v, 'record')}${opts.includePictures ? ' (pictures as pages)' : ''}` : ''
  doc.text(doc.splitTextToSize(`Contents: 1. this cover page  2. the ${term(v, 'record')} profile (details, deadlines, checklist, notes, contacts)${files}  ${hasFiles ? 4 : 3}. the complete audit trail.`, width), marginL, y)

  // ── Profile ──
  doc.addPage()
  renderProfileToDoc(doc, opts.rowId, opts.gridId, { deadlines: true, checklist: true, caseLog: true, scratchPad: opts.includeScratchPad === true, contactInfo: true, gridData: true })

  // ── Files ──
  drawFiles(doc, opts.rowId, { includePictures: opts.includePictures })

  // ── Audit trail ──
  doc.addPage()
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Audit trail', marginL, 20)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(doc.splitTextToSize(auditFootnote(opts.gridId), width), marginL, 27)
  drawAuditClients(doc, loadAuditTrail({ rowId: opts.rowId }), 38, marginL)

  const pages = doc.getNumberOfPages()
  const pageH = doc.internal.pageSize.height
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(120)
    doc.text(`Handoff packet: ${clientName}  ·  ${today}  ·  CONFIDENTIAL`, marginL, pageH - 8)
    doc.text(`Page ${p} of ${pages}`, pageW - marginL, pageH - 8, { align: 'right' })
    doc.setTextColor(0)
  }

  await new Promise(resolve => setImmediate(resolve))
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
  return { pages }
}
