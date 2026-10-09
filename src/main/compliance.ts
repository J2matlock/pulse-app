/**
 * compliance.ts — monthly compliance summary (brainstorm B3).
 *
 * For a calendar month and each caseload: the share of clients who met their
 * monthly contact requirements, the share of tracked deadlines that were on
 * time at month end, and the exceptions behind each number. Past months use
 * field history to recover what each date was at the time.
 */

import { getDb } from './database'
import { jsPDF, autoTable, lastTableY, atomicWriteFileAsync } from './export-shared'
import { getRequirementStatus } from './contact-requirements'
import { getMissingInfo } from './missing-info'
import { contactsComplete, contactsMissing } from '../shared/contactRequirements'
import { toRuleInterval } from '../shared/ruleInterval'
import { evaluate } from '../shared/deadlineEngine'
import { localDateString } from '../shared/dates'
import { vocabFor, word, featureOn } from './vocab'
import { term } from '../shared/vocab'

export interface ComplianceGrid {
  gridId: number
  gridName: string
  contacts: null | { total: number; met: number; requirementLabels: string[]; exceptions: Array<{ clientName: string; missing: string[] }> }
  /** extended: extensions given during the month (W05) */
  deadlines: { total: number; onTime: number; extended: number; exceptions: Array<{ clientName: string; column: string; due: string; daysOverdue: number }> }
  missingInfo: { clients: number; exceptions: Array<{ clientName: string; missing: string[] }> }
}

export interface ComplianceSummary {
  month: string
  /** The day the snapshot is taken: month end, or today for the current month */
  asOf: string
  /** Requirements are switched on (Settings → Features); when off the report leaves them out */
  requirementsOn: boolean
  grids: ComplianceGrid[]
}

function parseYmd(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b)!.getTime() - parseYmd(a)!.getTime()) / 86_400_000)
}

export function monthAsOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const end = localDateString(new Date(y!, m!, 0))
  const today = localDateString()
  return end < today ? end : today
}

export function getComplianceSummary(month: string, gridId?: number): ComplianceSummary {
  const db = getDb()
  const asOf = monthAsOf(month)
  // End of the as-of day in local time, as a stored (UTC) timestamp
  const cutoff = (db.prepare("SELECT datetime(? || ' 23:59:59', 'utc') AS t").get(asOf) as { t: string }).t

  const grids = db.prepare(`SELECT id, name FROM grids WHERE is_active = 1 AND (? IS NULL OR id = ?) ORDER BY position, name COLLATE NOCASE`)
    .all(gridId ?? null, gridId ?? null) as Array<{ id: number; name: string }>
  const requirementsOn = featureOn('requirements')
  // Each requirement is counted over its own period containing the as-of day
  const contactByGrid = new Map(requirementsOn ? getRequirementStatus(asOf, gridId).map(g => [g.gridId, g]) : [])
  const missingByGrid = new Map(getMissingInfo(gridId).map(g => [g.gridId, g]))

  // What each tracked date was at the cutoff: the old value of the first change after it, else today's value
  const deadlineStmt = db.prepare(`
    SELECT COALESCE(NULLIF(r.display_name, ''), @unnamed) AS client_name, col.name AS column_name,
           ar.interval_days, ar.interval_months, ar.end_of_month,
           CASE WHEN EXISTS (SELECT 1 FROM cell_history h WHERE h.row_id = r.id AND h.column_id = col.id AND h.changed_at > @cutoff)
                THEN (SELECT h.old_value FROM cell_history h WHERE h.row_id = r.id AND h.column_id = col.id AND h.changed_at > @cutoff
                      ORDER BY h.changed_at ASC, h.id ASC LIMIT 1)
                ELSE c.value END AS value_then
    FROM rows r
    JOIN columns col ON col.grid_id = r.grid_id AND col.column_type = 'date'
      AND json_extract(col.config, '$.alert_rule_id') IS NOT NULL
    JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    LEFT JOIN cells c ON c.row_id = r.id AND c.column_id = col.id
    WHERE r.grid_id = @gridId AND r.is_active = 1 AND r.deleted_at IS NULL AND r.created_at <= @cutoff
    ORDER BY client_name COLLATE NOCASE, col.position
  `)

  // Extensions given this month (still in effect or not), for "3 extended"
  const extendedStmt = db.prepare(`
    SELECT COUNT(*) AS n FROM deadline_extensions e JOIN rows r ON r.id = e.row_id
    WHERE r.grid_id = ? AND strftime('%Y-%m', e.created_at, 'localtime') = ?
  `)

  const result: ComplianceGrid[] = grids.map(g => {
    const contact = contactByGrid.get(g.id)
    const contacts = contact ? {
      total: contact.clients.length,
      met: contact.clients.filter(c => contactsComplete(c.counts, contact.requirements)).length,
      requirementLabels: contact.requirements.map((r, i) => `${r.per_month} ${r.label.toLowerCase()} per ${r.period ?? 'month'} (${contact.ranges[i]?.label ?? ''})`),
      exceptions: contact.clients
        .filter(c => !contactsComplete(c.counts, contact.requirements))
        .map(c => ({ clientName: c.clientName, missing: contactsMissing(c.counts, contact.requirements) })),
    } : null

    const deadlines: ComplianceGrid['deadlines'] = { total: 0, onTime: 0, extended: (extendedStmt.get(g.id, month) as { n: number }).n, exceptions: [] }
    for (const d of deadlineStmt.all({ cutoff, gridId: g.id, unnamed: `Unnamed ${word('record', {}, g.id)}` }) as Array<{ client_name: string; column_name: string; interval_days: number | null; interval_months: number | null; end_of_month: number; value_then: string | null }>) {
      // The shared engine works out the due date from what the date was at the time
      const res = evaluate({ id: 0, kind: 'interval', interval: toRuleInterval(d), config: null, condition: null, businessDays: false },
        { today: asOf, columnDate: d.value_then })
      if (!res.due) continue
      const due = res.due
      deadlines.total++
      if (due >= asOf) deadlines.onTime++
      else deadlines.exceptions.push({ clientName: d.client_name, column: d.column_name, due, daysOverdue: daysBetween(due, asOf) })
    }

    const missing = missingByGrid.get(g.id)
    return {
      gridId: g.id,
      gridName: g.name,
      contacts,
      deadlines,
      missingInfo: { clients: missing?.clients.length ?? 0, exceptions: (missing?.clients ?? []).map(c => ({ clientName: c.clientName, missing: c.missing })) },
    }
  })
  return { month, asOf, requirementsOn, grids: result }
}

const pct = (n: number, d: number) => d === 0 ? '—' : `${Math.round((n / d) * 100)}%`

function fmtDay(ymd: string): string {
  return parseYmd(ymd)!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export async function exportComplianceSummary(month: string, gridId: number | undefined, destPath: string, workerName?: string): Promise<void> {
  const s = getComplianceSummary(month, gridId)
  const [y, m] = month.split('-').map(Number)
  const monthName = new Date(y!, m! - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const marginL = 14
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(`${word('requirement', { many: true, cap: true })} summary: ${monthName}`, marginL, 18)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const wv = vocabFor()
  doc.text(`Deadlines as of ${fmtDay(s.asOf)}${workerName ? `  ·  ${workerName}` : ''}  ·  Contains ${term(wv, 'record')} information: keep secure`, marginL, 25)

  let y0 = 34
  const ensure = (needed: number) => { if (y0 > pageH - needed) { doc.addPage(); y0 = 18 } }
  const table = (head: string[], body: string[][]) => {
    autoTable(doc, { startY: y0, head: [head], body, styles: { fontSize: 9, cellPadding: 1.6 }, headStyles: { fillColor: [100, 116, 139] }, margin: { left: marginL + 4, right: marginL } })
    y0 = lastTableY(doc) + 9
  }
  const stat = (label: string, value: string) => {
    ensure(20)
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(label, marginL + 4, y0)
    doc.setFont('helvetica', 'normal'); doc.text(value, marginL + 60, y0)
    y0 += 6
  }

  for (const g of s.grids) {
    const gv = vocabFor(g.gridId)
    const Rec = term(gv, 'record', { cap: true })
    ensure(40)
    doc.setFontSize(14); doc.setFont('helvetica', 'bold')
    doc.text(g.gridName, marginL, y0)
    y0 += 7
    if (g.contacts) {
      stat(term(gv, 'requirement', { many: true, cap: true }), `${pct(g.contacts.met, g.contacts.total)}  (${g.contacts.met} of ${g.contacts.total} ${term(gv, 'record', { count: g.contacts.total })}; required: ${g.contacts.requirementLabels.join(', ')})`)
      if (g.contacts.exceptions.length > 0) table([Rec, 'Still needed'], g.contacts.exceptions.map(e => [e.clientName, e.missing.join(', ')]))
    } else if (s.requirementsOn) {
      stat(term(gv, 'requirement', { many: true, cap: true }), `Not set up for this ${term(gv, 'list')}`)
    }
    stat('Deadlines on time', g.deadlines.total === 0 ? 'No tracked deadlines' : `${pct(g.deadlines.onTime, g.deadlines.total)}  (${g.deadlines.onTime} of ${g.deadlines.total})${g.deadlines.extended ? `, ${g.deadlines.extended} extended` : ''}`)
    if (g.deadlines.exceptions.length > 0) {
      table([Rec, 'Deadline', 'Was due', 'Days overdue'], g.deadlines.exceptions.map(e => [e.clientName, e.column, fmtDay(e.due), String(e.daysOverdue)]))
    }
    if (g.missingInfo.clients > 0) {
      stat('Missing information', `${g.missingInfo.clients} ${term(gv, 'record', { count: g.missingInfo.clients })} (as of today)`)
      table([Rec, 'Missing'], g.missingInfo.exceptions.map(e => [e.clientName, e.missing.join(', ')]))
    }
    y0 += 6
  }
  if (s.grids.length === 0) doc.text(`No ${term(wv, 'list', { many: true })} to report on.`, marginL, y0)

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.text(`Page ${i} of ${pages}`, pageW - marginL, pageH - 8, { align: 'right' })
  }
  await atomicWriteFileAsync(destPath, Buffer.from(doc.output('arraybuffer')))
}
