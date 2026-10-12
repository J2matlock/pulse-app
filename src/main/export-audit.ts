/**
 * export-audit.ts — audit trail report (brainstorm B1).
 *
 * "Show me the record": for one client, a caseload, or everything, over a
 * date range, list every recorded change in time order. That covers field
 * changes, all notes (including voided ones and every earlier version of an
 * edited note), checklist completions, and when a client was added,
 * archived, or moved to the trash.
 */

import { getDb } from './database'
import { activityLabel } from './activity-types'
import { jsPDF, autoTable, lastTableY, atomicWriteFileAsync, stripHtml } from './export-shared'
import { parseDbTimestamp } from '../shared/dates'
import { CASE_NOTE_DELETE_WINDOW_MINUTES } from '../shared/constants'
import { word } from './vocab'

export interface AuditScope {
  rowId?: number
  gridId?: number
  /** Local calendar dates, inclusive ('YYYY-MM-DD'); omit for all time */
  from?: string
  to?: string
}

export interface AuditEvent {
  at: string  // UTC 'YYYY-MM-DD HH:MM:SS' as stored
  what: string
  details: string
}

export interface AuditClient {
  rowId: number
  clientName: string
  gridName: string
  events: AuditEvent[]
}

const SYSTEM_NOTE_LABEL: Record<string, string> = {
  system: 'Recorded by Pulse', import: 'Imported', followup: 'Follow-up',
}

/**
 * "Phone note", "Session note", or with other workspace words "Phone jot"
 * (A28-02). Words ending in "note" ("note", "case note") keep the short
 * "… note"; a type already called "… note" / "… jot" isn't doubled.
 */
function noteEventLabel(key: string, gridId: number): string {
  if (SYSTEM_NOTE_LABEL[key]) return SYSTEM_NOTE_LABEL[key]
  const act = word('activity', {}, gridId)
  const suffix = /\bnote$/i.test(act) ? 'note' : act
  if (key === 'manual') return suffix.charAt(0).toUpperCase() + suffix.slice(1)
  const label = activityLabel(key)
  return label.toLowerCase().endsWith(suffix.toLowerCase()) ? label : `${label} ${suffix}`
}

function fmtDate(ymd: string | null): string {
  if (!ymd) return 'blank'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtValue(v: string | null, type: string): string {
  if (v == null || v === '') return 'blank'
  if (type === 'date') return fmtDate(v.slice(0, 10))
  if (type === 'checkbox') return v === '1' || v === 'true' ? 'checked' : 'unchecked'
  return `"${v}"`
}

export function loadAuditTrail(scope: AuditScope): AuditClient[] {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []
  if (scope.rowId != null) { where.push('r.id = ?'); params.push(scope.rowId) }
  if (scope.gridId != null) { where.push('r.grid_id = ?'); params.push(scope.gridId) }
  const clients = db.prepare(`
    SELECT r.id, r.grid_id, COALESCE(NULLIF(r.display_name, ''), ?) AS name, g.name AS grid_name,
           r.created_at, r.archived_at, r.archived_reason, r.deleted_at
    FROM rows r JOIN grids g ON g.id = r.grid_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY g.name COLLATE NOCASE, name COLLATE NOCASE
  `).all(`Unnamed ${word('record')}`, ...params) as Array<{ id: number; grid_id: number; name: string; grid_name: string; created_at: string; archived_at: string | null; archived_reason: string | null; deleted_at: string | null }>

  // Stored timestamps are UTC; the range is the user's local calendar days
  const inRange = (col: string) => `(? IS NULL OR date(${col}, 'localtime') >= ?) AND (? IS NULL OR date(${col}, 'localtime') <= ?)`
  const range = [scope.from ?? null, scope.from ?? null, scope.to ?? null, scope.to ?? null]

  const cellStmt = db.prepare(`
    SELECT h.changed_at AS at, col.name, col.column_type, h.old_value, h.new_value
    FROM cell_history h JOIN columns col ON col.id = h.column_id
    WHERE h.row_id = ? AND ${inRange('h.changed_at')}
  `)
  const noteStmt = db.prepare(`
    SELECT id, created_at, occurred_at, log_type, content, follow_up_date, voided_at, voided_reason
    FROM case_log WHERE row_id = ?
  `)
  const editStmt = db.prepare(`
    SELECT e.case_log_id, e.content, e.occurred_at, e.replaced_at FROM case_log_edits e
    JOIN case_log cl ON cl.id = e.case_log_id
    WHERE cl.row_id = ? AND ${inRange('e.replaced_at')}
    ORDER BY e.replaced_at
  `)
  const checklistStmt = db.prepare(`
    SELECT title, completed_at FROM checklist_items
    WHERE row_id = ? AND is_completed = 1 AND completed_at IS NOT NULL AND ${inRange('completed_at')}
  `)
  // Link history (W04) outlives deleted link types and purged records
  const linkStmt = db.prepare(`
    SELECT h.at, h.action, h.from_row_id = ? AS forward, lt.label_forward, lt.label_backward,
           COALESCE(NULLIF(o.display_name, ''), '(deleted)') AS other
    FROM record_link_history h
    LEFT JOIN link_types lt ON lt.id = h.link_type_id
    LEFT JOIN rows o ON o.id = CASE WHEN h.from_row_id = ? THEN h.to_row_id ELSE h.from_row_id END
    WHERE (h.from_row_id = ? OR h.to_row_id = ?) AND ${inRange('h.at')}
  `)
  const dayOf = db.prepare("SELECT date(?, 'localtime') AS d")
  const within = (ts: string | null): boolean => {
    if (!ts) return false
    const d = (dayOf.get(ts) as { d: string | null }).d
    if (!d) return false
    return (!scope.from || d >= scope.from) && (!scope.to || d <= scope.to)
  }

  return clients.map(c => {
    const Note = word('activity', { cap: true }, c.grid_id)
    const events: AuditEvent[] = []
    if (within(c.created_at)) events.push({ at: c.created_at, what: `${word('record', { cap: true }, c.grid_id)} added`, details: c.grid_name })
    if (within(c.archived_at)) events.push({ at: c.archived_at!, what: `${word('record', { cap: true }, c.grid_id)} archived`, details: c.archived_reason || '' })
    if (within(c.deleted_at)) events.push({ at: c.deleted_at!, what: 'Moved to the Trash', details: '' })

    for (const h of cellStmt.all(c.id, ...range) as Array<{ at: string; name: string; column_type: string; old_value: string | null; new_value: string | null }>) {
      events.push({ at: h.at, what: `${h.name} changed`, details: `From ${fmtValue(h.old_value, h.column_type)} to ${fmtValue(h.new_value, h.column_type)}` })
    }

    const edits = editStmt.all(c.id, ...range) as Array<{ case_log_id: number; content: string; occurred_at: string | null; replaced_at: string }>
    const localDay = (ts: string | null): string | null => ts ? (dayOf.get(ts) as { d: string | null }).d : null
    for (const n of noteStmt.all(c.id) as Array<{ id: number; created_at: string; occurred_at: string | null; log_type: string; content: string; follow_up_date: string | null; voided_at: string | null; voided_reason: string | null }>) {
      const text = stripHtml(n.content)
      const happened = localDay(n.occurred_at)
      if (within(n.created_at)) {
        // Events are listed when written; a note written up later says when it happened
        const backdated = happened && happened !== localDay(n.created_at) ? `Happened ${fmtDate(happened)}\n` : ''
        const followUp = n.follow_up_date ? `\nFollow-up: ${fmtDate(n.follow_up_date)}` : ''
        const voided = n.voided_at ? '\n(Later voided; see below)' : ''
        events.push({ at: n.created_at, what: noteEventLabel(n.log_type, c.grid_id), details: backdated + text + followUp + voided })
      }
      if (within(n.voided_at)) {
        events.push({ at: n.voided_at!, what: `${Note} voided`, details: `${n.voided_reason ? `Reason: ${n.voided_reason}\n` : ''}${Note}: ${text}` })
      }
      for (const e of edits.filter(x => x.case_log_id === n.id)) {
        const before = localDay(e.occurred_at)
        const dated = before && before !== happened ? `\nDated before the edit: ${fmtDate(before)}` : ''
        events.push({ at: e.replaced_at, what: `${Note} edited`, details: `Before the edit: ${stripHtml(e.content)}${dated}` })
      }
    }

    for (const l of linkStmt.all(c.id, c.id, c.id, c.id, ...range) as Array<{ at: string; action: string; forward: number; label_forward: string | null; label_backward: string | null; other: string }>) {
      const label = (l.forward ? l.label_forward : l.label_backward) ?? 'Link'
      events.push({ at: l.at, what: `${label}: ${l.action === 'add' ? 'linked' : 'unlinked'}`, details: l.other })
    }

    for (const ci of checklistStmt.all(c.id, ...range) as Array<{ title: string; completed_at: string }>) {
      events.push({ at: ci.completed_at, what: 'Checklist item done', details: ci.title })
    }

    // Checklist ticks are stored as ISO ("…T13:00:00.000Z"), the rest as datetime('now') ("… 15:00:00"); compare instants, not text
    const instant = (at: string) => { const t = parseDbTimestamp(at).getTime(); return Number.isNaN(t) ? 0 : t }
    events.sort((a, b) => instant(a.at) - instant(b.at) || a.at.localeCompare(b.at))
    return { rowId: c.id, clientName: c.name, gridName: c.grid_name, events }
  })
}

/** Draw each client's audit table starting at `y`. Returns the number of entries drawn. */
export function drawAuditClients(doc: InstanceType<typeof jsPDF>, shown: AuditClient[], y: number, marginL: number): number {
  if (shown.length === 0) {
    doc.setFontSize(12)
    doc.text('Nothing was recorded in this period.', marginL, y)
  }
  let total = 0
  for (const c of shown) {
    total += c.events.length
    if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 18 }
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text(c.clientName, marginL, y)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    // The count is of events, not records: "12 records" under a record's name reads as something else
    doc.text(`${c.gridName}  ·  ${c.events.length} entr${c.events.length === 1 ? 'y' : 'ies'}`, marginL, y + 5)
    autoTable(doc, {
      startY: y + 8,
      head: [['When', 'What', 'Details']],
      body: c.events.length > 0 ? c.events.map(e => [fmtWhen(e.at), e.what, e.details]) : [['', '', 'Nothing recorded in this period']],
      styles: { fontSize: 9, cellPadding: 1.8, overflow: 'linebreak' },
      headStyles: { fillColor: [51, 65, 85] },
      columnStyles: { 0: { cellWidth: 36 }, 1: { cellWidth: 34 } },
      margin: { left: marginL, right: marginL },
    })
    y = lastTableY(doc) + 10
  }
  return total
}

/** What the audit trail does and doesn't keep, in the workspace's word for notes */
export function auditFootnote(gridId?: number | null): string {
  const notes = word('activity', { many: true }, gridId), Notes = word('activity', { many: true, cap: true }, gridId)
  return `Times are local. Edited ${notes} keep every earlier version, and undone ${notes} are voided rather than erased. ${Notes} deleted within ${CASE_NOTE_DELETE_WINDOW_MINUTES} minutes of being written (to fix a mistake) are not kept.`
}

function fmtWhen(ts: string): string {
  return parseDbTimestamp(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export async function exportAuditReport(scope: AuditScope, destPath: string, scopeLabel: string, workerName?: string): Promise<{ clients: number; events: number }> {
  const clients = loadAuditTrail(scope)
  const shown = scope.rowId != null ? clients : clients.filter(c => c.events.length > 0)

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const marginL = 14
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(`Audit trail: ${scopeLabel}`, marginL, 18)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const range = scope.from || scope.to ? `${scope.from ? fmtDate(scope.from) : 'Beginning'} to ${scope.to ? fmtDate(scope.to) : 'today'}` : 'All dates'
  const generated = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  doc.text(`${range}  ·  Generated ${generated}${workerName ? `  ·  ${workerName}` : ''}`, marginL, 25)
  doc.setFontSize(9)
  const note = `${auditFootnote(scope.gridId)} Contains ${word('record')} information: keep secure.`
  doc.text(doc.splitTextToSize(note, pageW - marginL * 2), marginL, 31)

  const total = drawAuditClients(doc, shown, 42, marginL)
  // Page numbers, so a printed copy can be checked for missing pages
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.text(`Page ${i} of ${pages}`, pageW - marginL, doc.internal.pageSize.getHeight() - 8, { align: 'right' })
  }
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
  return { clients: shown.length, events: total }
}
