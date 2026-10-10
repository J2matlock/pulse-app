import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => testDb.db }))

import { createSampleCaseload, removeSampleData, planSampleRemoval, getSampleGridId, getSampleRowIds, countSampleRows, SAMPLE_GRID_NAME } from '../src/main/sample-data'

const count = (sql: string, ...args: unknown[]) => (testDb.db.prepare(sql).get(...args) as { n: number }).n
const live = (gridId: number) => count('SELECT COUNT(*) AS n FROM rows WHERE grid_id = ? AND deleted_at IS NULL', gridId)

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
    // Every entry is tracked as a sample
    expect(getSampleRowIds()).toHaveLength(25)
    expect(countSampleRows()).toBe(25)
  })

  it('creating twice reuses the same caseload', () => {
    expect(createSampleCaseload()).toBe(createSampleCaseload())
    expect(count('SELECT COUNT(*) AS n FROM grids')).toBe(1)
  })

  it('removal of an untouched sample list deletes only sample data', () => {
    const real = seedGrid(testDb.db, { rowCount: 3 })
    testDb.db.prepare("INSERT INTO providers (name) VALUES ('Real Provider')").run()
    createSampleCaseload()
    expect(planSampleRemoval()).toMatchObject({ keep: [], ownInSampleList: 0 })
    expect(removeSampleData()).toEqual({ removed: 25, kept: 0, keptListName: null })
    expect(getSampleGridId()).toBeNull()
    expect(count('SELECT COUNT(*) AS n FROM rows WHERE grid_id = ?', real.gridId)).toBe(3)
    expect(count('SELECT COUNT(*) AS n FROM providers')).toBe(1)
    expect(count("SELECT COUNT(*) AS n FROM alert_rules WHERE name LIKE 'Sample:%'")).toBe(0)
    expect(removeSampleData()).toEqual({ removed: 0, kept: 0, keptListName: null })
  })

  it('keeps entries the user added to the sample list, and the list with them', () => {
    const gridId = createSampleCaseload()
    const mine = Number(testDb.db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, 99)').run(gridId).lastInsertRowid)
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Real visit', 'visit')").run(mine)
    expect(planSampleRemoval().ownInSampleList).toBe(1)
    const res = removeSampleData()
    expect(res.removed).toBe(25)
    expect(res.keptListName).toMatch(/^My /)
    expect(count('SELECT COUNT(*) AS n FROM grids WHERE id = ? AND name = ?', gridId, res.keptListName)).toBe(1)
    expect(live(gridId)).toBe(1)
    expect(count("SELECT COUNT(*) AS n FROM case_log WHERE content = 'Real visit'")).toBe(1)
    // The sample entries are in the Trash, not gone
    expect(count('SELECT COUNT(*) AS n FROM rows WHERE grid_id = ? AND deleted_at IS NOT NULL', gridId)).toBe(25)
    // The sample's rules stay while its columns use them
    expect(count("SELECT COUNT(*) AS n FROM alert_rules WHERE name LIKE 'Sample:%'")).toBe(2)
  })

  it('keeps sample entries the user changed, added a note to, or moved, as real entries', () => {
    const gridId = createSampleCaseload()
    const other = seedGrid(testDb.db, { rowCount: 0 })
    const [edited, noted, moved, untouched] = getSampleRowIds() as [number, number, number, number]
    testDb.db.prepare("UPDATE cells SET value = 'Real Person' WHERE row_id = ? AND column_id = (SELECT id FROM columns WHERE grid_id = ? AND name = 'Client Name')").run(edited, gridId)
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Called about housing', 'phone')").run(noted)
    testDb.db.prepare('UPDATE rows SET grid_id = ? WHERE id = ?').run(other.gridId, moved)
    // A system line ("moved to trash") isn't the user's own work
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Restored from trash', 'system')").run(untouched)

    const plan = planSampleRemoval()
    expect(plan.keep.sort()).toEqual([edited, noted, moved].sort())
    expect(plan.remove).toContain(untouched)
    const res = removeSampleData()
    expect(res).toMatchObject({ removed: 22, kept: 3 })
    expect(count('SELECT COUNT(*) AS n FROM rows WHERE id IN (?, ?, ?) AND deleted_at IS NULL', edited, noted, moved)).toBe(3)
    expect(count('SELECT COUNT(*) AS n FROM rows WHERE id = ? AND deleted_at IS NOT NULL', untouched)).toBe(1)
    // Kept ones aren't samples any more; the list stays for them under a plain name
    expect(getSampleRowIds()).not.toContain(edited)
    expect(res.keptListName).toMatch(/^My /)
    expect(live(other.gridId)).toBe(1)
  })

  it('removes an edited entry the user said was just a sample', () => {
    createSampleCaseload()
    const [first] = getSampleRowIds() as [number]
    testDb.db.prepare("UPDATE cells SET value = 'Practice' WHERE row_id = ? AND value LIKE '(555)%'").run(first)
    expect(planSampleRemoval().keep).toEqual([first])
    testDb.db.prepare('UPDATE sample_rows SET asked = 1 WHERE row_id = ?').run(first)
    expect(planSampleRemoval().keep).toEqual([])
    // Dismissing the question (2) leaves edits as the user's
    testDb.db.prepare('UPDATE sample_rows SET asked = 2 WHERE row_id = ?').run(first)
    expect(planSampleRemoval().keep).toEqual([first])
  })

  it('keeps contacts the user linked to a real entry', () => {
    createSampleCaseload()
    const real = seedGrid(testDb.db, { rowCount: 1 })
    const provider = (testDb.db.prepare("SELECT id FROM providers WHERE name LIKE 'Dr. Ellen Park%'").get() as { id: number }).id
    testDb.db.prepare('INSERT INTO provider_client_links (provider_id, row_id, grid_id) VALUES (?, ?, ?)').run(provider, real.rowIds[0], real.gridId)
    removeSampleData()
    expect(count('SELECT COUNT(*) AS n FROM providers')).toBe(1)
  })

  it('a sample entry restored from the Trash is still a sample', () => {
    createSampleCaseload()
    const real = seedGrid(testDb.db, { rowCount: 1 })
    const [first] = getSampleRowIds() as [number]
    // Something of the user's in the sample list keeps the list, so the Trash can restore into it
    const gridId = getSampleGridId()!
    testDb.db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, 99)').run(gridId)
    removeSampleData()
    testDb.db.prepare('UPDATE rows SET is_active = 1, deleted_at = NULL WHERE id = ?').run(first)
    expect(countSampleRows()).toBe(1)
    expect(planSampleRemoval().remove).toEqual([first])
    expect(live(real.gridId)).toBe(1)
  })
})
