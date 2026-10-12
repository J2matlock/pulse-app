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
import { getMissingInfo, missingInfoText } from './missing-info'
import { contactsComplete, contactsMissing } from '../shared/contactRequirements'
import { evaluate, engineRuleFrom, referencedColumns, meterHistoryColumn, extensionAnchor, buildRecordContext, matchExtension, applyExtension, type QuotaConfig, type StoredExtension } from '../shared/deadlineEngine'
import { loadWorkCalendar, meterHistories, quotaCounts, progressEntries, finishedDates, previousValues } from './deadlines'
import { localDateString, shortDate } from '../shared/dates'
import { vocabFor, word, featureOn } from './vocab'
import { term } from '../shared/vocab'
import { LIVE_ROW, liveGrid } from '../shared/liveRecords'

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

  const grids = db.prepare(`SELECT id, name FROM grids WHERE ${liveGrid('')} AND (? IS NULL OR id = ?) ORDER BY position, name COLLATE NOCASE`)
    .all(gridId ?? null, gridId ?? null) as Array<{ id: number; name: string }>
  const requirementsOn = featureOn('requirements')
  // Each requirement is counted over its own period containing the as-of day
  const contactByGrid = new Map(requirementsOn ? getRequirementStatus(asOf, gridId).map(g => [g.gridId, g]) : [])
  const missingByGrid = new Map(getMissingInfo(gridId).map(g => [g.gridId, g]))

  const cal = loadWorkCalendar()
  // Rule columns of either kind (dates and Deadline columns), with their rules
  const ruleColsStmt = db.prepare(`
    SELECT col.id AS column_id, col.name AS column_name, col.position, ar.id, ar.interval_days, ar.interval_months, ar.end_of_month,
           ar.kind, ar.rule_config, ar.rule_condition, ar.business_days
    FROM columns col JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE col.grid_id = ? AND col.column_type IN ('date', 'deadline')
  `)
  const recordsStmt = db.prepare(`
    SELECT r.id, COALESCE(NULLIF(r.display_name, ''), @unnamed) AS client_name FROM rows r
    WHERE r.grid_id = @gridId AND ${LIVE_ROW} AND r.created_at <= @cutoff
  `)
  // What each cell was at the cutoff: the old value of the first change after it, else today's value
  const cellsStmt = db.prepare('SELECT c.row_id, c.column_id, c.value FROM cells c JOIN rows r ON r.id = c.row_id WHERE r.grid_id = ?')
  const laterStmt = db.prepare(`SELECT h.row_id, h.column_id, h.old_value FROM cell_history h JOIN rows r ON r.id = h.row_id
    WHERE r.grid_id = ? AND h.changed_at > ? ORDER BY h.changed_at ASC, h.id ASC`)
  // Extensions in force at the cutoff
  const extStmt = db.prepare(`SELECT e.id, e.row_id, e.column_id, e.step, e.new_due, e.reason, e.anchor_value FROM deadline_extensions e JOIN rows r ON r.id = e.row_id
    WHERE r.grid_id = ? AND e.created_at <= ? AND (e.revoked_at IS NULL OR e.revoked_at > ?) ORDER BY e.id DESC`)

  // Extensions given this month (still in effect or not), for "3 extended": on the same
  // records as the rest of the card, so not ones in the Trash or archived (A16-03)
  const extendedStmt = db.prepare(`
    SELECT COUNT(*) AS n FROM deadline_extensions e JOIN rows r ON r.id = e.row_id
    WHERE r.grid_id = ? AND ${LIVE_ROW} AND strftime('%Y-%m', e.created_at, 'localtime') = ?
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
    const thenValues = new Map<string, string | null>()
    for (const c of cellsStmt.all(g.id) as Array<{ row_id: number; column_id: number; value: string | null }>) thenValues.set(`${c.row_id}:${c.column_id}`, c.value)
    const changed = new Set<string>()
    for (const h of laterStmt.all(g.id, cutoff) as Array<{ row_id: number; column_id: number; old_value: string | null }>) {
      const key = `${h.row_id}:${h.column_id}`
      if (changed.has(key)) continue
      changed.add(key)
      thenValues.set(key, h.old_value)
    }
    const valueThen = (rowId: number, colId: number) => thenValues.get(`${rowId}:${colId}`) ?? null
    const extensions = new Map<string, StoredExtension[]>()
    for (const e of extStmt.all(g.id, cutoff, cutoff) as Array<{ id: number; row_id: number; column_id: number; step: number | null; new_due: string; reason: string; anchor_value: string | null }>) {
      const key = `${e.row_id}:${e.column_id}`
      extensions.set(key, [...(extensions.get(key) ?? []), { id: e.id, newDue: e.new_due, reason: e.reason, anchor: e.anchor_value, step: e.step }])
    }
    const records = recordsStmt.all({ cutoff, gridId: g.id, unnamed: `Unnamed ${word('record', {}, g.id)}` }) as Array<{ id: number; client_name: string }>
    const found: Array<{ clientName: string; position: number; column: string; due: string; daysOverdue: number }> = []
    for (const rc of ruleColsStmt.all(g.id) as Array<Parameters<typeof engineRuleFrom>[0] & { column_id: number; column_name: string; position: number }>) {
      // The real rule, as of the cutoff: the same engine every other screen uses
      const rule = engineRuleFrom(rc)
      const refs = referencedColumns(rule)
      const meterCol = meterHistoryColumn(rule)
      const history = meterHistories(meterCol)
      const counts = rule.kind === 'quota' && rule.config ? quotaCounts(g.id, rule.config as QuotaConfig, cutoff) : new Map<number, number>()
      const finished = rule.kind === 'interval' ? finishedDates(rc.column_id) : null
      const progress = rule.kind === 'sequence' ? progressEntries(rc.column_id, asOf) : new Map<number, Array<{ step: number; anchor: string | null }>>()
      // The done date before the latest change made by the cutoff, as the dashboard uses (AUDIT-074)
      const previous = rule.kind === 'calendar' ? previousValues(rc.column_id, cutoff) : null
      for (const rec of records) {
        const own = valueThen(rec.id, rc.column_id)
        const values: Record<number, string | null> = {}
        for (const id of refs) values[id] = valueThen(rec.id, id)
        let res = evaluate(rule, buildRecordContext(rule, {
          today: asOf, columnDate: own, values, holidays: cal.holidays, weekend: cal.weekend,
          meterHistory: history.get(rec.id)?.filter(h => h.at <= asOf), activityCount: counts.get(rec.id) ?? 0,
          progress: progress.get(rec.id) ?? [],
          previousDone: previous?.has(rec.id) ? previous.get(rec.id) ?? null : undefined,
          finishedFor: finished?.get(rec.id),
        }))
        const ext = matchExtension(extensions.get(`${rec.id}:${rc.column_id}`), extensionAnchor(rule, own, values), res.step)
        if (ext) res = applyExtension(res, ext, asOf)
        // Nothing due, hidden or paused by "only when…": not a tracked deadline that month
        if (!res.due || res.state === 'none' || res.state === 'paused') continue
        deadlines.total++
        if (res.state !== 'overdue') deadlines.onTime++
        else found.push({ clientName: rec.client_name, position: rc.position, column: rc.column_name, due: res.due, daysOverdue: Math.max(0, -(res.daysUntil ?? 0)) })
      }
    }
    found.sort((a, b) => a.clientName.localeCompare(b.clientName, undefined, { sensitivity: 'base' }) || a.position - b.position)
    deadlines.exceptions = found.map(({ clientName, column, due, daysOverdue }) => ({ clientName, column, due, daysOverdue }))

    const missing = missingByGrid.get(g.id)
    return {
      gridId: g.id,
      gridName: g.name,
      contacts,
      deadlines,
      missingInfo: { clients: missing?.clients.length ?? 0, exceptions: (missing?.clients ?? []).map(c => ({ clientName: c.clientName, missing: missingInfoText(c) })) },
    }
  })
  return { month, asOf, requirementsOn, grids: result }
}

const pct = (n: number, d: number) => d === 0 ? '—' : `${Math.round((n / d) * 100)}%`

function fmtDay(ymd: string): string {
  return shortDate(parseYmd(ymd)!)
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
