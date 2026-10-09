import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => testDb.db }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))

import { getMissingInfo, exportMissingInfoCsv } from '../src/main/missing-info'
import { canBeRequired, isMissingValue } from '../src/shared/requiredFields'

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
})
