/**
 * Contact requirements (brainstorm A2, generalized in W03 §4): "1 face-to-face
 * visit per month", "2 check-ins per week" for a list, counted from notes.
 * A note counts toward every requirement that lists its type, within that
 * requirement's own calendar period.
 */
import { getDb } from './database'
import type { ContactRequirement, ContactStatusGrid } from '../shared/types'
import { PERIOD_MAX, isPeriod, periodRange, type PeriodRange, type WeekStart } from '../shared/periods'
import { localDateString } from '../shared/dates'
import { ymdToDate } from '../shared/ymd'
import { userTypeKeys } from './activity-types'
import { word } from './vocab'
import { LIVE_ROW, liveGrid } from '../shared/liveRecords'

export const MAX_REQUIREMENTS = 10

interface ReqRow { id: number; grid_id: number; label: string; note_types: string; per_month: number; period: string | null }

function parseTypes(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []
  } catch { return [] }
}

function toRequirement(r: ReqRow): ContactRequirement {
  return { id: r.id, grid_id: r.grid_id, label: r.label, note_types: parseTypes(r.note_types), per_month: r.per_month, period: isPeriod(r.period) ? r.period : 'month' }
}

export function getRequirements(gridId?: number): ContactRequirement[] {
  const db = getDb()
  const rows = (gridId != null
    ? db.prepare('SELECT * FROM contact_requirements WHERE grid_id = ? ORDER BY position, id').all(gridId)
    : db.prepare('SELECT * FROM contact_requirements ORDER BY grid_id, position, id').all()) as ReqRow[]
  return rows.map(toRequirement)
}

/** Validate and normalize; returns an error message or the cleaned list. */
export function validateRequirements(input: unknown): ContactRequirement[] | string {
  if (!Array.isArray(input) || input.length > MAX_REQUIREMENTS) return 'Invalid requirements'
  const out: ContactRequirement[] = []
  for (const r of input as Array<Partial<ContactRequirement>>) {
    const label = typeof r?.label === 'string' ? r.label.trim() : ''
    if (!label || label.length > 100) return 'Each requirement needs a name (up to 100 characters)'
    // Archived types already on a requirement can stay when it's saved again
    const allowed = userTypeKeys(true)
    const types = Array.isArray(r.note_types) ? r.note_types.filter(t => typeof t === 'string' && allowed.has(t)) : []
    if (types.length === 0) return `Choose at least one kind of note for "${label}"`
    const period = r.period === undefined ? 'month' : r.period
    if (!isPeriod(period)) return `Choose how often "${label}" is needed`
    const perPeriod = Number(r.per_month)
    const max = PERIOD_MAX[period]
    if (!Number.isInteger(perPeriod) || perPeriod < 1 || perPeriod > max) return `How many per ${period} must be between 1 and ${max}`
    out.push({ label, note_types: [...new Set(types)], per_month: perPeriod, period })
  }
  return out
}

/** Replace a caseload's requirements. */
export function saveRequirements(gridId: number, reqs: ContactRequirement[]): void {
  const db = getDb()
  const insert = db.prepare('INSERT INTO contact_requirements (grid_id, label, note_types, per_month, period, position) VALUES (?, ?, ?, ?, ?, ?)')
  db.transaction(() => {
    db.prepare('DELETE FROM contact_requirements WHERE grid_id = ?').run(gridId)
    reqs.forEach((r, i) => insert.run(gridId, r.label, JSON.stringify(r.note_types), r.per_month, r.period ?? 'month', i))
  })()
}

function weekStart(): WeekStart {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'week_start'").get() as { value: string } | undefined
  return row?.value === 'monday' ? 'monday' : 'sunday'
}

/**
 * Who has (and hasn't) had their required contacts in the period of each
 * requirement that contains `ref` ('YYYY-MM-DD', local; today when omitted).
 * Only lists with requirements are returned.
 */
export function getRequirementStatus(ref: string = localDateString(), gridId?: number): ContactStatusGrid[] {
  const db = getDb()
  const reqs = getRequirements(gridId)
  if (reqs.length === 0) return []
  const refDate = ymdToDate(ref)
  const ws = weekStart()
  const byGrid = new Map<number, ContactRequirement[]>()
  for (const r of reqs) byGrid.set(r.grid_id!, [...(byGrid.get(r.grid_id!) ?? []), r])

  const clientsStmt = db.prepare(`
    SELECT r.id AS row_id, COALESCE(NULLIF(r.display_name, ''), ?) AS client_name
    FROM rows r WHERE r.grid_id = ? AND ${LIVE_ROW}
    ORDER BY client_name COLLATE NOCASE
  `)
  // Counted by the day it happened (occurred_at, stored in UTC); periods are the user's local calendar days
  const countsStmt = db.prepare(`
    SELECT cl.row_id, cl.log_type, COUNT(*) AS n
    FROM case_log cl JOIN rows r ON r.id = cl.row_id
    WHERE r.grid_id = ? AND cl.voided_at IS NULL
      AND date(cl.occurred_at, 'localtime') BETWEEN ? AND ?
    GROUP BY cl.row_id, cl.log_type
  `)
  const gridName = db.prepare(`SELECT name FROM grids WHERE id = ? AND ${liveGrid('')}`)

  const result: ContactStatusGrid[] = []
  for (const [gid, gridReqs] of byGrid) {
    const g = gridName.get(gid) as { name: string } | undefined
    if (!g) continue
    const ranges: PeriodRange[] = gridReqs.map(r => periodRange(r.period ?? 'month', refDate, ws))
    // One count per distinct period, shared by the requirements that use it
    const tallies = new Map<string, Map<number, Map<string, number>>>()
    for (const range of ranges) {
      if (tallies.has(range.key)) continue
      const tally = new Map<number, Map<string, number>>()
      for (const c of countsStmt.all(gid, range.start, range.end) as Array<{ row_id: number; log_type: string; n: number }>) {
        const m = tally.get(c.row_id) ?? new Map<string, number>()
        m.set(c.log_type, c.n)
        tally.set(c.row_id, m)
      }
      tallies.set(range.key, tally)
    }
    const clients = (clientsStmt.all(`Unnamed ${word('record', {}, gid)}`, gid) as Array<{ row_id: number; client_name: string }>).map(c => ({
      rowId: c.row_id,
      clientName: c.client_name,
      counts: gridReqs.map((req, i) => {
        const tally = tallies.get(ranges[i]!.key)!
        return req.note_types.reduce((sum, t) => sum + (tally.get(c.row_id)?.get(t) ?? 0), 0)
      }),
    }))
    result.push({ gridId: gid, gridName: g.name, requirements: gridReqs, ranges, clients })
  }
  return result
}
