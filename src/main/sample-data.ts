/**
 * sample-data.ts — "Try it with sample clients" (demo mode).
 *
 * Creates a clearly labelled sample caseload with fake clients, deadlines,
 * case notes, checklist items, tasks, and providers, so people can evaluate
 * Pulse without putting real client data into a tool their employer hasn't
 * approved yet. Everything created is recorded in app_meta so it can be
 * removed in one step, and it never counts toward the free-tier limit.
 */

import { getDb } from './database'
import { localDateString } from '../shared/dates'

export const SAMPLE_GRID_NAME = 'Sample Caseload (not real clients)'
const META_KEY = 'sample_data'
/** Sample rows a starter template added to real lists (see starters.ts) */
export const STARTER_SAMPLE_META_KEY = 'starter_sample'

/** Ids of rows added as starter sample data, so they can be removed together */
export function getStarterSampleRowIds(): number[] {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(STARTER_SAMPLE_META_KEY) as { value: string } | undefined
  try {
    const v = JSON.parse(row?.value ?? '{}') as { rowIds?: unknown }
    return Array.isArray(v.rowIds) ? v.rowIds.filter((x): x is number => typeof x === 'number') : []
  } catch { return [] }
}

interface SampleRecord {
  gridId: number
  alertRuleIds: number[]
  providerIds: number[]
  taskIds: number[]
}

function readRecord(): SampleRecord | null {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(META_KEY) as { value: string } | undefined
  if (!row) return null
  try { return JSON.parse(row.value) as SampleRecord } catch { return null }
}

/** The sample caseload's grid id, if it still exists. */
export function getSampleGridId(): number | null {
  const rec = readRecord()
  if (!rec) return null
  const exists = getDb().prepare('SELECT 1 FROM grids WHERE id = ?').get(rec.gridId)
  return exists ? rec.gridId : null
}

const FIRST = ['Maria', 'James', 'Aisha', 'Robert', 'Linh', 'Dorothy', 'Carlos', 'Priya', 'Frank', 'Keisha', 'Samuel', 'Grace', 'Omar', 'Ruth', 'Diego', 'Hannah', 'Tyrone', 'Mei', 'Walter', 'Yolanda', 'Ahmed', 'Beatrice', 'Kevin', 'Lucia', 'Marcus']
const LAST = ['Garcia', 'Johnson', 'Okafor', 'Smith', 'Nguyen', 'Walker', 'Rivera', 'Patel', 'Miller', 'Brown', 'Kowalski', 'Chen', 'Haddad', 'Thompson', 'Morales', 'Fischer', 'Jackson', 'Wong', 'Davis', 'Ortiz', 'Rahman', 'Dubois', "O'Brien", 'Ferreira', 'Bell']
const PROGRAMS = ['Waiver', 'Case Management', 'Housing', 'Behavioral Health', 'Employment']
const NOTES: Array<[string, string]> = [
  ['visit', 'Home visit. Client doing well; reviewed goals and medication list. No new concerns.'],
  ['phone', 'Phone check-in with client and guardian. Confirmed upcoming appointment.'],
  ['meeting', 'Team meeting to review service plan. Agreed to add weekly day program.'],
  ['email', 'Emailed provider for updated progress report.'],
  ['note', 'Received updated benefits letter; copied to file.'],
]

/** How many starter sample rows still exist (the user may have deleted some). */
export function countStarterSampleRows(): number {
  const ids = getStarterSampleRowIds()
  if (ids.length === 0) return 0
  return (getDb().prepare('SELECT COUNT(*) AS n FROM rows WHERE id IN (SELECT value FROM json_each(?))').get(JSON.stringify(ids)) as { n: number }).n
}

/** Remove all starter sample rows (with their notes and checklist items). Lists stay. */
export function removeStarterSampleData(): number {
  const db = getDb()
  const ids = getStarterSampleRowIds()
  db.transaction(() => {
    const del = db.prepare('DELETE FROM rows WHERE id = ?')
    for (const id of ids) del.run(id)
    // Their appointments went with the records; the series they came from go too
    const delSeries = db.prepare("DELETE FROM appointment_series WHERE json_extract(template, '$.row_id') = ?")
    for (const id of ids) delSeries.run(id)
    db.prepare('DELETE FROM app_meta WHERE key = ?').run(STARTER_SAMPLE_META_KEY)
  })()
  return ids.length
}

/** Create the sample caseload. Returns its grid id (existing one if already present). */
export function createSampleCaseload(): number {
  const existing = getSampleGridId()
  if (existing) return existing
  const db = getDb()
  let seed = 11
  const rand = (n: number) => { seed = (seed * 16807) % 2147483647; return seed % n }
  const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDateString(d) }

  const record = db.transaction((): SampleRecord => {
    const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM grids').get() as { p: number }).p
    const gridId = Number(db.prepare("INSERT INTO grids (name, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(SAMPLE_GRID_NAME, maxPos + 1).lastInsertRowid)

    const rule = (name: string, interval: number, thresholds: unknown) =>
      Number(db.prepare("INSERT INTO alert_rules (name, description, is_system, thresholds, interval_days, created_at) VALUES (?, 'Sample rule', 0, ?, ?, datetime('now'))").run(name, JSON.stringify(thresholds), interval).lastInsertRowid)
    const monthly = rule('Sample: monthly contact', 30, [
      { daysBefore: 7, bgClass: '#facc15', label: 'Due Soon' },
      { daysBefore: 0, bgClass: '#dc2626', label: 'Due Today' },
      { daysBefore: -1, bgClass: 'alert-pulse-dark', label: 'Overdue' },
    ])
    const annual = rule('Sample: annual review', 365, [
      { daysBefore: 60, bgClass: '#bbf7d0', label: 'Upcoming' },
      { daysBefore: 30, bgClass: '#facc15', label: 'Due Soon' },
      { daysBefore: 0, bgClass: '#dc2626', label: 'Due Today' },
      { daysBefore: -1, bgClass: 'alert-pulse-dark', label: 'Overdue' },
    ])

    const col = (name: string, type: string, position: number, extra: { nameCol?: boolean; config?: unknown; width?: number } = {}) =>
      Number(db.prepare(`INSERT INTO columns (grid_id, name, column_type, position, width, is_name_column, is_identifier, config, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
        .run(gridId, name, type, position, extra.width ?? 150, extra.nameCol ? 1 : 0, extra.nameCol ? 1 : 0, JSON.stringify(extra.config ?? {})).lastInsertRowid)
    const cName = col('Client Name', 'text', 0, { nameCol: true, width: 190 })
    const cProgram = col('Program', 'text', 1)
    const cLast = col('Last Contact', 'date', 2, { config: { alert_rule_id: monthly, log_changes: true } })
    const cReview = col('Annual Review', 'date', 3, { config: { alert_rule_id: annual, log_changes: true } })
    const cDob = col('Date of Birth', 'date', 4)
    const cPhone = col('Phone', 'phone', 5, { width: 140 })

    const insRow = db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))")
    const insCell = db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
    const insNote = db.prepare("INSERT INTO case_log (row_id, content, log_type, follow_up_date, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now', ?), datetime('now', ?))")
    const insItem = db.prepare("INSERT INTO checklist_items (row_id, title, due_date, position, created_at) VALUES (?, ?, ?, ?, datetime('now'))")
    const rowIds: number[] = []
    for (let i = 0; i < 25; i++) {
      const rowId = Number(insRow.run(gridId, i).lastInsertRowid)
      rowIds.push(rowId)
      insCell.run(rowId, cName, `${FIRST[i]} ${LAST[(i * 7) % LAST.length]}`)
      insCell.run(rowId, cProgram, PROGRAMS[rand(PROGRAMS.length)]!)
      insCell.run(rowId, cLast, day(-rand(45)))
      insCell.run(rowId, cReview, day(-rand(400)))
      insCell.run(rowId, cDob, day(-(365 * (19 + rand(60)))))
      insCell.run(rowId, cPhone, `(555) 01${rand(10)}-${String(1000 + rand(9000))}`)
      for (let n = 0; n < 1 + rand(3); n++) {
        const [type, text] = NOTES[rand(NOTES.length)]!
        const ago = `-${1 + rand(40)} days`
        insNote.run(rowId, text, type, n === 0 && rand(3) === 0 ? day(rand(10) - 3) : null, ago, ago)
      }
    }
    const first = rowIds[0]!
    ;[['Send annual review packet', 3], ['Confirm transportation for appointment', 0], ['Update emergency contacts', -2]].forEach(([title, due], i) => {
      insItem.run(first, title, day(due as number), i)
    })

    const insTask = db.prepare(`INSERT INTO caseload_tasks (grid_id, title, priority, due_date, is_completed, position, created_at, updated_at)
                                VALUES (?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))`)
    const taskIds = ([['Monthly caseload report', 'high', 2], ['Call county about waiver slots', 'normal', 0], ['Quarterly audit prep', 'high', -3]] as const)
      .map(([title, priority, due], i) => Number(insTask.run(gridId, title, priority, day(due), i).lastInsertRowid))

    const insProvider = db.prepare("INSERT INTO providers (name, org_name, phone_main, notes, created_at, updated_at) VALUES (?, ?, ?, 'Sample provider', datetime('now'), datetime('now'))")
    const providerIds = ([['Dr. Ellen Park (sample)', 'Riverside Behavioral Health', '(555) 010-3344'], ['Tom Alvarez (sample)', 'County Housing Authority', '(555) 010-1200'], ['Sarah Kim (sample)', 'Meals on Wheels', '(555) 010-7788']] as const)
      .map(([name, org, phone]) => Number(insProvider.run(name, org, phone).lastInsertRowid))

    const rec: SampleRecord = { gridId, alertRuleIds: [monthly, annual], providerIds, taskIds }
    db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(META_KEY, JSON.stringify(rec))
    return rec
  })()
  return record.gridId
}

/** Remove everything the sample caseload created. Real data is never touched. */
export function removeSampleCaseload(): boolean {
  const rec = readRecord()
  if (!rec) return false
  const db = getDb()
  db.transaction(() => {
    // Grid delete cascades to columns, rows, cells, case notes, checklist items, tasks, links
    db.prepare('DELETE FROM grids WHERE id = ?').run(rec.gridId)
    const delTask = db.prepare('DELETE FROM caseload_tasks WHERE id = ?')
    for (const id of rec.taskIds) delTask.run(id)
    const delProvider = db.prepare('DELETE FROM providers WHERE id = ?')
    for (const id of rec.providerIds) delProvider.run(id)
    // Only delete sample rules no remaining column still uses
    const inUse = db.prepare("SELECT 1 FROM columns WHERE CAST(json_extract(config, '$.alert_rule_id') AS INTEGER) = ? LIMIT 1")
    const delRule = db.prepare('DELETE FROM alert_rules WHERE id = ?')
    for (const id of rec.alertRuleIds) if (!inUse.get(id)) delRule.run(id)
    db.prepare('DELETE FROM app_meta WHERE key = ?').run(META_KEY)
  })()
  return true
}
