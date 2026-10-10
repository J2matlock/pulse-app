/**
 * A believable past for starter sample data, so reports have something to
 * show: records "added" across the last year, everyday notes every few weeks,
 * and finished jobs copied into past months. Worked out from the starter's
 * own samples (no per-starter writing), seeded so it comes out the same each
 * time, and tracked as sample data so "Remove sample data" removes it.
 */
import { getDb } from './database'
import { assignAutoNumbers } from './auto-number'
import { hasDisplayFormat, refreshDisplayNames } from './display-names'
import { loadDeadlines } from './deadlines'
import { stageColumnOf, stageConfigOf } from '../shared/stages'
import { localDateString } from '../shared/dates'

/** A year back; notes stop 5 weeks short of today so the hand-written recent ones stay on top */
const HISTORY_DAYS = 365
const NOTES_UNTIL_DAYS_AGO = 35
const COPY_MONTHS = 11

/** Everyday note types and neutral words for them; anything else isn't used for made-up history */
const EVERYDAY: Array<{ keys: string[]; texts: string[] }> = [
  { keys: ['call', 'phone'], texts: ['Called to check in.', 'Left a message.', 'Returned their call.', 'Quick call about next steps.'] },
  { keys: ['email', 'text'], texts: ['Sent an update.', 'Replied to their message.', 'Sent a reminder.'] },
  { keys: ['visit', 'site_visit', 'home_visit', 'meeting'], texts: ['Visited; all on track.', 'Stopped by to check in.', 'Met to go over the plan.'] },
  { keys: ['note'], texts: ['Quick update.', 'All on track.', 'Followed up on the last visit.', 'Nothing new to report.'] },
]

/** Every sentence the made-up history uses (tests tell generated notes apart by these) */
export const SAMPLE_HISTORY_TEXTS: readonly string[] = EVERYDAY.flatMap(e => e.texts)

/** mulberry32 seeded from a string: repeatable "random" choices */
function seeded(seed: string): () => number {
  let a = 0
  for (let i = 0; i < seed.length; i++) a = (Math.imul(31, a) + seed.charCodeAt(i)) | 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Col { id: number; name: string; column_type: string; config: string | null }

const daysAgoText = (n: number) => `-${Math.round(n)} days`
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number]
  return localDateString(new Date(y, m - 1, d + days))
}
function daysAgoOf(ymd: string, now: Date): number {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number]
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((today.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000)
}

/**
 * Adds the history for sample records just loaded (list → its sample row ids).
 * Returns the ids of records it made (finished copies), to track as sample data.
 */
export function addSampleHistory(seed: string, rowsByGrid: Map<number, number[]>, now = new Date()): number[] {
  const db = getDb()
  const rand = seeded(seed)
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!

  // Note types this workspace has that read as everyday contact, minus any a quota counts (authorizations stay as written)
  const haveTypes = new Set((db.prepare('SELECT key FROM activity_types WHERE is_archived = 0').all() as Array<{ key: string }>).map(r => r.key))
  const quotaTypes = new Set<string>()
  for (const r of db.prepare("SELECT rule_config FROM alert_rules WHERE kind = 'quota'").all() as Array<{ rule_config: string | null }>) {
    try { for (const k of (JSON.parse(r.rule_config || '{}') as { activityTypes?: string[] }).activityTypes ?? []) quotaTypes.add(k) } catch { /* unreadable: ignore */ }
  }
  const pools = EVERYDAY.flatMap(e => e.keys.filter(k => (haveTypes.has(k) || k === 'note') && !quotaTypes.has(k)).map(k => ({ key: k, texts: e.texts })))
  const notePools = pools.length ? pools : []

  const setCreated = db.prepare("UPDATE rows SET created_at = datetime('now', ?) WHERE id = ?")
  const insNote = db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, ?, datetime('now', ?), datetime('now', ?))")
  const made: number[] = []

  for (const [gridId, rowIds] of rowsByGrid) {
    const kind = (db.prepare('SELECT record_kind FROM grids WHERE id = ?').get(gridId) as { record_kind: string | null } | undefined)?.record_kind ?? 'person'
    const isJob = kind === 'job'
    for (const rowId of rowIds) {
      // Jobs are current work (added in the last two months); people and things have been around up to a year
      const added = isJob ? 5 + rand() * 55 : 40 + rand() * (HISTORY_DAYS - 40)
      setCreated.run(daysAgoText(added), rowId)
      if (isJob || notePools.length === 0) continue
      // A note every 3–7 weeks from when it was added until five weeks ago
      for (let t = added - (7 + rand() * 20); t >= NOTES_UNTIL_DAYS_AGO; t -= 21 + rand() * 28) {
        const pool = pick(notePools)
        insNote.run(rowId, pick(pool.texts), pool.key, daysAgoText(t), daysAgoText(t))
      }
    }
    if (isJob) made.push(...copyFinishedJobs(gridId, rowIds, rand, now))
  }
  return made
}

/** Finished jobs in past months: copies of the sample's done ones, dated back, money varied */
function copyFinishedJobs(gridId: number, rowIds: number[], rand: () => number, now: Date): number[] {
  const db = getDb()
  const cols = db.prepare('SELECT id, name, column_type, config FROM columns WHERE grid_id = ?').all(gridId) as Col[]
  const stageCol = stageColumnOf(cols)
  const stage = stageCol ? stageConfigOf(stageCol) : null
  if (!stageCol || !stage) return []
  const doneStages = new Map(stage.options.filter(o => o.done && o.onEnter?.stampColumnId).map(o => [o.value, o.onEnter!.stampColumnId!]))
  if (doneStages.size === 0) return []
  const cellsOf = db.prepare('SELECT column_id, value FROM cells WHERE row_id = ?')
  const templates = rowIds.map(id => ({ id, cells: new Map((cellsOf.all(id) as Array<{ column_id: number; value: string | null }>).map(c => [c.column_id, c.value])) }))
    .filter(t => doneStages.has(t.cells.get(stageCol.id) ?? '') && /^\d{4}-\d{2}-\d{2}/.test(t.cells.get(doneStages.get(t.cells.get(stageCol.id)!)!) ?? ''))
  if (templates.length === 0) return []

  const byId = new Map(cols.map(c => [c.id, c]))
  const skip = new Set(cols.filter(c => c.column_type === 'auto_number' || c.column_type === 'link' || c.column_type === 'file_count').map(c => c.id))
  let pos = (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM rows WHERE grid_id = ?').get(gridId) as { p: number }).p
  const insRow = db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now', ?), datetime('now', ?))")
  const insCell = db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
  // Links where the job points at something many jobs can share (its customer, its vehicle)
  const links = db.prepare(`SELECT l.link_type_id, l.to_row_id FROM record_links l JOIN link_types t ON t.id = l.link_type_id
    WHERE l.from_row_id = ? AND t.cardinality IN ('many_to_one', 'many_to_many')`)
  const insLink = db.prepare('INSERT OR IGNORE INTO record_links (link_type_id, from_row_id, to_row_id) VALUES (?, ?, ?)')
  const made: number[] = []

  for (let month = 1; month <= COPY_MONTHS; month++) {
    const count = 1 + (rand() < 0.7 ? 1 : 0) + (rand() < 0.25 ? 1 : 0)
    for (let k = 0; k < count; k++) {
      const tpl = templates[Math.floor(rand() * templates.length)]!
      const stamp = doneStages.get(tpl.cells.get(stageCol.id)!)!
      const tplDone = tpl.cells.get(stamp)!.slice(0, 10)
      const doneAgo = month * 30 + Math.floor(rand() * 26)
      const shift = daysAgoOf(tplDone, now) - doneAgo // days to move every date by
      const createdAgo = doneAgo + 7 + Math.floor(rand() * 24)
      const rowId = Number(insRow.run(gridId, ++pos, daysAgoText(createdAgo), daysAgoText(doneAgo)).lastInsertRowid)
      made.push(rowId)
      for (const [colId, value] of tpl.cells) {
        if (value === null || skip.has(colId)) continue
        const c = byId.get(colId)
        if (!c) continue
        let v = value
        if ((c.column_type === 'date' || c.column_type === 'deadline') && /^\d{4}-\d{2}-\d{2}$/.test(value)) v = shiftYmd(value, shift)
        else if (c.column_type === 'currency') {
          const n = Number(value.replace(/[$,\s]/g, ''))
          if (Number.isFinite(n) && n > 0) v = String(Math.max(5, Math.round(n * (0.75 + rand() * 0.5) / 5) * 5))
        }
        insCell.run(rowId, colId, v)
      }
      for (const l of links.all(tpl.id) as Array<{ link_type_id: number; to_row_id: number }>) insLink.run(l.link_type_id, rowId, l.to_row_id)
    }
  }
  if (made.length) {
    assignAutoNumbers(gridId, made)
    if (hasDisplayFormat(gridId)) refreshDisplayNames(gridId, made)
    settleDeadlines(gridId, made)
  }
  return made
}

/**
 * Finished work from months ago shouldn't light up the dashboard: a deadline
 * that's done once its own date is filled in (a follow-up call) is filled in,
 * and any other date still due (a promised date) is cleared.
 */
function settleDeadlines(gridId: number, rowIds: number[]): void {
  const db = getDb()
  const fill = db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value")
  const clear = db.prepare('DELETE FROM cells WHERE row_id = ? AND column_id = ?')
  for (const d of loadDeadlines({ gridId, rowIds })) {
    if (d.state !== 'overdue' && d.state !== 'due' && d.state !== 'soon') continue
    if (d.rule_kind === 'relative' && d.due) fill.run(d.row_id, d.column_id, d.due)
    else clear.run(d.row_id, d.column_id)
  }
}
