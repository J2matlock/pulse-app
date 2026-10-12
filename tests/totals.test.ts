import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => testDb.db }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))

import { getTotals, exportTotalsCsv, measureHeading, monthSearchRange, TOTALS_SQL } from '../src/main/totals'
import { unitsFor, formatMinutes, formatMiles } from '../src/shared/timeMileage'

let rows: number[]
const utc = (local: string) => (testDb.db.prepare("SELECT datetime(?, 'utc') AS t").get(local) as { t: string }).t
const note = (rowId: number, local: string, minutes: number | null, miles: number | null, voided = false) => testDb.db.prepare(`
  INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, minutes, miles, voided_at)
  VALUES (?, 'Visit', 'visit', ?, datetime('now'), ?, ?, ?)
`).run(rowId, utc(local), minutes, miles, voided ? utc(local) : null)

beforeEach(() => {
  testDb = createTestDb()
  const g = seedGrid(testDb.db, { rowCount: 2 })
  rows = g.rowIds
  note(rows[0]!, '2026-03-02 09:00:00', 23, 10.5)
  note(rows[0]!, '2026-03-20 09:00:00', 7, null)
  note(rows[1]!, '2026-03-31 23:30:00', 60, 4)
  note(rows[1]!, '2026-04-01 00:10:00', 60, 4)          // next month (local)
  note(rows[1]!, '2026-03-10 09:00:00', 90, 9, true)    // voided
  testDb.db.prepare("INSERT INTO settings (key, value) VALUES ('mileage_rate', '0.5')").run()
})
afterEach(() => cleanupTestDb(testDb))

describe('units and formatting', () => {
  it('counts a unit from half of it', () => {
    expect([7, 8, 22, 23, 60].map(m => unitsFor(m))).toEqual([0, 1, 1, 2, 4])
    expect(unitsFor(44, 30)).toBe(1)
    expect(unitsFor(null)).toBe(0)
  })
  it('formats time and miles', () => {
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(75)).toBe('1 hr 15 min')
    expect(formatMiles(4)).toBe('4 mi')
    expect(formatMiles(10.5)).toBe('10.5 mi')
  })
})

describe('totals report', () => {
  it('totals the month per client (local months, voided notes excluded)', () => {
    const r = getTotals('2026-03')
    expect(r.entries).toHaveLength(3)
    expect(r.byClient.map(c => [c.minutes, c.units, c.miles])).toEqual([[30, 2, 10.5], [60, 4, 4]])
    expect(r.totals).toEqual({ minutes: 90, units: 6, miles: 14.5, extra: {} })
    expect(r.mileageRate).toBe(0.5)
  })

  it('leaves out notes of records and lists in the Trash, but counts archived records (AUDIT-022)', () => {
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(rows[1])
    expect(getTotals('2026-03').totals.minutes).toBe(30)
    testDb.db.prepare('UPDATE rows SET deleted_at = NULL, is_active = 0 WHERE id = ?').run(rows[1])
    expect(getTotals('2026-03').totals.minutes).toBe(90)
    testDb.db.prepare('UPDATE grids SET is_active = 0').run()
    expect(getTotals('2026-03').entries).toEqual([])
  })

  it('counts notes stored with an ISO timestamp at the edges of the month', () => {
    testDb.db.prepare('DELETE FROM case_log').run()
    const iso = (local: string) => new Date(local).toISOString()
    for (const at of ['2026-03-01T00:05:00', '2026-03-31T23:55:00', '2026-02-28T23:55:00', '2026-04-01T00:05:00']) {
      testDb.db.prepare(`INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at, updated_at, minutes)
        VALUES (?, 'Visit', 'visit', ?, ?, datetime('now'), 10)`).run(rows[0], iso(at), iso(at))
    }
    expect(getTotals('2026-03').entries.map(e => e.date)).toEqual(['2026-03-01', '2026-03-31'])
  })

  it('searches only around the month in the note-date index (AUDIT-110)', () => {
    expect(monthSearchRange('2026-03')).toEqual(['2026-02-27', '2026-04-03'])
    expect(monthSearchRange('2026-12')).toEqual(['2026-11-29', '2027-01-03'])
    expect(monthSearchRange('2028-03')).toEqual(['2028-02-28', '2028-04-03'])
    const plan = testDb.db.prepare(`EXPLAIN QUERY PLAN ${TOTALS_SQL}`).all('x', '2026-02-27', '2026-04-03', '2026-03', null, null) as Array<{ detail: string }>
    expect(plan.map(p => p.detail).join('\n')).toMatch(/SEARCH cl USING INDEX idx_case_log_occurred \(occurred_at>\? AND occurred_at<\?\)/)
  })

  it('counts a late write-up in the month it happened (audit 1.22)', () => {
    testDb.db.prepare(`INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at, updated_at, minutes)
      VALUES (?, 'Visit', 'visit', ?, ?, datetime('now'), 30)`).run(rows[0], utc('2026-02-27 12:00:00'), utc('2026-03-02 09:00:00'))
    expect(getTotals('2026-03').totals.minutes).toBe(90)
    expect(getTotals('2026-02').entries).toEqual([expect.objectContaining({ date: '2026-02-27', minutes: 30 })])
  })

  it('shows note types as people see them, not as stored keys', async () => {
    testDb.db.prepare("UPDATE activity_types SET label = 'Home visit' WHERE key = 'visit'").run()
    const dest = join(testDb.tmpDir, 'tm-labels.csv')
    await exportTotalsCsv('2026-03', undefined, dest)
    expect(readFileSync(dest, 'utf8')).toContain(',Home visit,')
  })

  it('writes the day in the format chosen in Settings (Q-076)', async () => {
    const dest = join(testDb.tmpDir, 'tm-dates.csv')
    testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('date_format', 'us')").run()
    await exportTotalsCsv('2026-03', undefined, dest)
    expect(readFileSync(dest, 'utf8')).toMatch(/\n03\/02\/2026,/)
    testDb.db.prepare("UPDATE settings SET value = 'eu' WHERE key = 'date_format'").run()
    await exportTotalsCsv('2026-03', undefined, dest)
    expect(readFileSync(dest, 'utf8')).toMatch(/\n02\/03\/2026,/)
    testDb.db.prepare("UPDATE settings SET value = 'iso' WHERE key = 'date_format'").run()
    await exportTotalsCsv('2026-03', undefined, dest)
    expect(readFileSync(dest, 'utf8')).toMatch(/\n2026-03-02,/)
  })

  it('exports a CSV with amounts and a total row', async () => {
    const dest = join(testDb.tmpDir, 'tm.csv')
    expect(await exportTotalsCsv('2026-03', undefined, dest)).toBe(3)
    const csv = readFileSync(dest, 'utf8')
    expect(csv).toContain('Mileage amount')
    expect(csv.trim().split('\n').pop()).toBe('Total,,,,90,6,14.5,7.25,')
  })
})

describe('your own numbers in the totals', () => {
  beforeEach(() => {
    testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_measures', ?)").run(JSON.stringify([
      { key: 'labor', label: 'Labor', kind: 'hours', decimals: 2 },
      { key: 'parts', label: 'Parts', kind: 'currency', decimals: 2 },
      { key: 'boxes', label: 'Boxes', unit: 'boxes', kind: 'number', decimals: 0 },
    ]))
    const extra = (rowId: number, local: string, values: Record<string, number>) => testDb.db.prepare(`
      INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, extra_measures)
      VALUES (?, 'Job', 'note', ?, datetime('now'), ?)
    `).run(rowId, utc(local), JSON.stringify(values))
    extra(rows[0]!, '2026-03-05 10:00:00', { labor: 0.1, parts: 10.1, gone: 5 })
    extra(rows[0]!, '2026-03-06 10:00:00', { labor: 0.2, parts: 0.2 })
    extra(rows[1]!, '2026-03-07 10:00:00', { labor: 1.5 })
  })

  it('sums them per record and overall, listing only numbers used that month', () => {
    const r = getTotals('2026-03')
    expect(r.measures.map(m => m.key)).toEqual(['labor', 'parts'])
    expect(r.byClient.find(c => c.rowId === rows[0])!.extra).toEqual({ labor: 0.3, parts: 10.3 })
    expect(r.totals.extra).toEqual({ labor: 1.8, parts: 10.3 })
    // notes with only these numbers count too; a number whose definition is gone is left out
    expect(r.entries).toHaveLength(6)
    expect(JSON.stringify(r)).not.toContain('gone')
  })

  it('adds a column per number to the CSV, with totals', async () => {
    const dest = join(testDb.tmpDir, 'totals.csv')
    await exportTotalsCsv('2026-03', undefined, dest)
    const lines = readFileSync(dest, 'utf8').trim().split('\n')
    expect(lines[0]).toContain('Labor (hours),Parts ($),Note')
    expect(lines.pop()).toBe('Total,,,,90,6,14.5,7.25,1.8,10.3,')
  })

  it('guards a number label that looks like a formula in the CSV heading (AUDIT-122)', async () => {
    testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_measures', ?)").run(JSON.stringify([
      { key: 'labor', label: '=Labor', kind: 'hours', decimals: 2 },
    ]))
    const dest = join(testDb.tmpDir, 'guard.csv')
    await exportTotalsCsv('2026-03', undefined, dest)
    const [header] = readFileSync(dest, 'utf8').split('\n')
    expect(header).toContain(',\'=Labor (hours),')
  })

  it('names CSV columns by kind', () => {
    expect(measureHeading({ key: 'boxes', label: 'Boxes', unit: 'boxes', kind: 'number', decimals: 0 })).toBe('Boxes (boxes)')
    expect(measureHeading({ key: 'n', label: 'Count', kind: 'number', decimals: 0 })).toBe('Count')
  })
})
