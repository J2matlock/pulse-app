import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => testDb.db }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))

import { getMissingInfo, exportMissingInfoCsv } from '../src/main/missing-info'
import { canBeRequired, isMissingValue } from '../src/shared/requiredFields'
import { isNotADate } from '../src/shared/ymd'

let gridId: number
let rowIds: number[]
let cols: number[]

beforeEach(() => {
  testDb = createTestDb()
  const g = seedGrid(testDb.db, { columnTypes: ['text', 'text', 'date', 'checkbox'], columnCount: 4, rowCount: 3 })
  gridId = g.gridId; rowIds = g.rowIds; cols = g.columnIds
  const setCfg = testDb.db.prepare('UPDATE columns SET config = ?, name = ? WHERE id = ?')
  setCfg.run(JSON.stringify({ required: true }), 'Medicaid ID', cols[1])
  setCfg.run(JSON.stringify({ required: true }), 'Date of Birth', cols[2])
  setCfg.run(JSON.stringify({ required: true }), 'Consent', cols[3])  // checkboxes can't be missing
  const put = testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
  testDb.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run('Ana', rowIds[0])
  testDb.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run('Ben', rowIds[1])
  testDb.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run('Cy', rowIds[2])
  put.run(rowIds[0], cols[1], 'AB123'); put.run(rowIds[0], cols[2], '1990-01-01')   // complete
  put.run(rowIds[1], cols[1], '   ')                                                  // blank counts as missing
  put.run(rowIds[2], cols[2], '1985-05-05')
})
afterEach(() => cleanupTestDb(testDb))

describe('missing information', () => {
  it('lists clients with empty required fields, in column order', () => {
    const [g] = getMissingInfo()
    expect(g!.requiredColumns).toEqual(['Medicaid ID', 'Date of Birth'])
    expect(g!.clients).toEqual([
      { rowId: rowIds[1], clientName: 'Ben', missing: ['Medicaid ID', 'Date of Birth'] },
      { rowId: rowIds[2], clientName: 'Cy', missing: ['Medicaid ID'] },
    ])
  })

  it('ignores archived clients and filters by caseload', () => {
    testDb.db.prepare('UPDATE rows SET is_active = 0 WHERE id = ?').run(rowIds[1])
    expect(getMissingInfo(gridId)[0]!.clients.map(c => c.clientName)).toEqual(['Cy'])
    expect(getMissingInfo(gridId + 99)).toEqual([])
  })

  it('exports a CSV', async () => {
    const dest = join(testDb.tmpDir, 'missing.csv')
    expect(await exportMissingInfoCsv(dest)).toBe(2)
    expect(readFileSync(dest, 'utf8')).toContain('Ben,"Medicaid ID, Date of Birth"')
  })

  it('knows which values and columns count', () => {
    expect(isMissingValue(' ')).toBe(true)
    expect(isMissingValue('x')).toBe(false)
    expect(canBeRequired('checkbox')).toBe(false)
    expect(canBeRequired('phone')).toBe(true)
  })

  describe('dates Pulse can\'t read in a column with a deadline rule (AUDIT-026)', () => {
    let reviewCol: number
    let ruleId: number
    beforeEach(() => {
      ruleId = Number(testDb.db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days, created_at) VALUES ('Every year', '[]', 365, datetime('now'))").run().lastInsertRowid)
      reviewCol = Number(testDb.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Annual review', 'date', 9, ?)")
        .run(gridId, JSON.stringify({ alert_rule_id: ruleId })).lastInsertRowid)
    })
    const put = (rowId: number, value: string) => testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(rowId, reviewCol, value)

    it('lists a record whose ruled date isn\'t a date, beside what else it is missing', () => {
      put(rowIds[0]!, 'TBD')         // otherwise complete: joins the list
      put(rowIds[1]!, '2/30/2026')   // already missing two required values
      put(rowIds[2]!, '2026-03-01')  // a real date: fine
      const [g] = getMissingInfo()
      expect(g!.clients).toEqual([
        { rowId: rowIds[0], clientName: 'Ana', missing: [], notADate: ['Annual review'] },
        { rowId: rowIds[1], clientName: 'Ben', missing: ['Medicaid ID', 'Date of Birth'], notADate: ['Annual review'] },
        { rowId: rowIds[2], clientName: 'Cy', missing: ['Medicaid ID'] },
      ])
    })

    it('says "<column>: not a date" in the CSV', async () => {
      put(rowIds[0]!, 'TBD')
      const dest = join(testDb.tmpDir, 'missing.csv')
      expect(await exportMissingInfoCsv(dest)).toBe(3)
      expect(readFileSync(dest, 'utf8')).toContain('Ana,Annual review: not a date')
    })

    it('lists a list with no required columns when one of its dates can\'t be read', () => {
      testDb.db.prepare("UPDATE columns SET config = '{}' WHERE id IN (?, ?, ?)").run(cols[1], cols[2], cols[3])
      expect(getMissingInfo()).toEqual([])
      put(rowIds[2]!, '20260-01-01')
      const [g] = getMissingInfo()
      expect(g!.requiredColumns).toEqual([])
      expect(g!.clients).toEqual([{ rowId: rowIds[2], clientName: 'Cy', missing: [], notADate: ['Annual review'] }])
    })

    it('leaves a date column without a rule, and deleted records, alone', () => {
      put(rowIds[0]!, 'TBD')
      testDb.db.prepare("UPDATE columns SET config = '{}' WHERE id = ?").run(reviewCol)
      expect(getMissingInfo()[0]!.clients.map(c => c.clientName)).toEqual(['Ben', 'Cy'])
      testDb.db.prepare("UPDATE columns SET config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: ruleId }), reviewCol)
      expect(getMissingInfo()[0]!.clients.map(c => c.clientName)).toEqual(['Ana', 'Ben', 'Cy'])
      testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(rowIds[0])
      expect(getMissingInfo()[0]!.clients.map(c => c.clientName)).toEqual(['Ben', 'Cy'])
    })

    it('knows what counts as not a date', () => {
      expect(isNotADate('TBD')).toBe(true)
      expect(isNotADate('2/30/2026')).toBe(true)
      expect(isNotADate('2026-02-30')).toBe(true)
      expect(isNotADate('20260-01-01')).toBe(true)
      expect(isNotADate('2026-03-01')).toBe(false)
      expect(isNotADate('2026-03-01T10:00:00')).toBe(false)
      expect(isNotADate('')).toBe(false)
      expect(isNotADate('  ')).toBe(false)
      expect(isNotADate(null)).toBe(false)
    })
  })
})
