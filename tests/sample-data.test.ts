import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => testDb.db }))

import { createSampleCaseload, removeSampleCaseload, getSampleGridId, SAMPLE_GRID_NAME } from '../src/main/sample-data'

const count = (sql: string, ...args: unknown[]) => (testDb.db.prepare(sql).get(...args) as { n: number }).n

beforeEach(() => { testDb = createTestDb() })
afterEach(() => cleanupTestDb(testDb))

describe('sample caseload', () => {
  it('creates a labelled caseload with clients, notes, tasks, and providers', () => {
    const gridId = createSampleCaseload()
    expect(getSampleGridId()).toBe(gridId)
    expect(count('SELECT COUNT(*) AS n FROM grids WHERE id = ? AND name = ?', gridId, SAMPLE_GRID_NAME)).toBe(1)
    expect(count('SELECT COUNT(*) AS n FROM rows WHERE grid_id = ?', gridId)).toBe(25)
    expect(count('SELECT COUNT(*) AS n FROM case_log cl JOIN rows r ON r.id = cl.row_id WHERE r.grid_id = ?', gridId)).toBeGreaterThan(25)
    expect(count('SELECT COUNT(*) AS n FROM caseload_tasks WHERE grid_id = ?', gridId)).toBe(3)
    expect(count("SELECT COUNT(*) AS n FROM providers WHERE notes = 'Sample provider'")).toBe(3)
    // Display names come from the name column (trigger)
    expect(count("SELECT COUNT(*) AS n FROM rows WHERE grid_id = ? AND display_name = '(unnamed)'", gridId)).toBe(0)
  })

  it('creating twice reuses the same caseload', () => {
    expect(createSampleCaseload()).toBe(createSampleCaseload())
    expect(count('SELECT COUNT(*) AS n FROM grids')).toBe(1)
  })

  it('removal deletes only sample data', () => {
    const real = seedGrid(testDb.db, { rowCount: 3 })
    testDb.db.prepare("INSERT INTO providers (name) VALUES ('Real Provider')").run()
    createSampleCaseload()
    expect(removeSampleCaseload()).toBe(true)
    expect(getSampleGridId()).toBeNull()
    expect(count('SELECT COUNT(*) AS n FROM rows WHERE grid_id = ?', real.gridId)).toBe(3)
    expect(count('SELECT COUNT(*) AS n FROM providers')).toBe(1)
    expect(count("SELECT COUNT(*) AS n FROM alert_rules WHERE name LIKE 'Sample:%'")).toBe(0)
    expect(removeSampleCaseload()).toBe(false)
  })
})
