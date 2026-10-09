/** Linked records through a record's life (W04 commit 7): duplicate, move, list delete, and import into link columns. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))
vi.mock('../src/main/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }))

import { saveLinkType, addLink, copyForwardLinks, linksThatWontFit, dropLinksThatWontFit, linkCountsForGrid, deleteLinksForGrid, countLinks, setupLink } from '../src/main/links'
import { parseImportFile, executeImport } from '../src/main/import'

let customers: { gridId: number; rowIds: number[] }
let vehicles: { gridId: number; rowIds: number[] }
let jobs: { gridId: number; rowIds: number[] }
const name = (rowId: number, n: string) => t.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run(n, rowId)
const links = () => t.db.prepare('SELECT link_type_id, from_row_id, to_row_id FROM record_links ORDER BY id').all()
const owner = () => saveLinkType({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' })

let dir: string
beforeEach(() => {
  t = createTestDb()
  dir = mkdtempSync(join(tmpdir(), 'pulse-links-'))
  customers = seedGrid(t.db, { name: 'Customers', rowCount: 2, columnCount: 2 })
  vehicles = seedGrid(t.db, { name: 'Vehicles', rowCount: 2, columnCount: 2 })
  jobs = seedGrid(t.db, { name: 'Jobs', rowCount: 1, columnCount: 2 })
  ;['Jane Smith', 'Bob Lee'].forEach((n, i) => name(customers.rowIds[i]!, n))
  ;['2017 Civic', '2019 F-150'].forEach((n, i) => name(vehicles.rowIds[i]!, n))
})
afterEach(() => { cleanupTestDb(t); rmSync(dir, { recursive: true, force: true }) })

describe('duplicating a record', () => {
  it('copies forward links but not backward or one-to-one ones', () => {
    const o = owner()
    const spot = saveLinkType({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Spot holder', label_backward: 'Spot car', cardinality: 'one_to_one' })
    addLink(o.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    addLink(spot.id, vehicles.rowIds[0]!, customers.rowIds[1]!)
    const copy = Number(t.db.prepare("INSERT INTO rows (grid_id, position) VALUES (?, 9)").run(vehicles.gridId).lastInsertRowid)
    expect(copyForwardLinks(vehicles.rowIds[0]!, copy)).toBe(1)
    expect(links()).toContainEqual({ link_type_id: o.id, from_row_id: copy, to_row_id: customers.rowIds[0] })
    // Duplicating a customer doesn't take vehicles from the original
    const custCopy = Number(t.db.prepare("INSERT INTO rows (grid_id, position) VALUES (?, 9)").run(customers.gridId).lastInsertRowid)
    expect(copyForwardLinks(customers.rowIds[0]!, custCopy)).toBe(0)
  })
})

describe('moving a record to another list', () => {
  it('warns about and removes links that do not apply there', () => {
    const o = owner()
    addLink(o.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    expect(linksThatWontFit(vehicles.rowIds[0]!, jobs.gridId)).toEqual(['Owner: Jane Smith'])
    expect(linksThatWontFit(vehicles.rowIds[0]!, vehicles.gridId)).toEqual([])
    expect(linksThatWontFit(customers.rowIds[0]!, jobs.gridId)).toEqual(['Vehicles: 2017 Civic'])
    expect(dropLinksThatWontFit(vehicles.rowIds[0]!, jobs.gridId)).toBe(1)
    expect(countLinks(o.id)).toBe(0)
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM record_link_history WHERE action = 'remove'").get()).toEqual({ n: 1 })
  })
})

describe('deleting a list', () => {
  it('says how many links go, then removes its link types and their columns elsewhere', () => {
    const { type } = setupLink({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' }, { showOnOther: true, logChanges: false })
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    addLink(type.id, vehicles.rowIds[1]!, customers.rowIds[0]!)
    expect(linkCountsForGrid(customers.gridId)).toEqual({ types: 1, links: 2 })
    expect(linkCountsForGrid(jobs.gridId)).toEqual({ types: 0, links: 0 })
    expect(deleteLinksForGrid(customers.gridId)).toBe(1)
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM columns WHERE column_type = 'link'").get()).toEqual({ n: 0 })
    expect(links()).toEqual([])
  })
})

describe('importing into a link column', () => {
  async function run(csv: string, createMissingLinks = false) {
    const { type, columnIds } = setupLink({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' }, { showOnOther: false, logChanges: true })
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(vehicles.gridId) as { id: number }).id
    const filePath = join(dir, `v-${Math.random()}.csv`)
    writeFileSync(filePath, csv)
    const preview = await parseImportFile(filePath)
    const result = await executeImport({ gridId: vehicles.gridId, filePath, duplicateStrategy: 'none', cleanData: true, createMissingLinks,
      columnMappings: [{ sourceIndex: 0, action: nameCol }, { sourceIndex: 1, action: columnIds[0]! }] }, preview)
    return { type, result }
  }
  const linkedTo = (vehicle: string) => (t.db.prepare(`SELECT c.display_name FROM record_links l JOIN rows v ON v.id = l.from_row_id JOIN rows c ON c.id = l.to_row_id WHERE v.display_name = ?`).all(vehicle) as Array<{ display_name: string }>).map(r => r.display_name)

  it('matches names ignoring case, quietly, and lists the ones that match no one', async () => {
    const { result } = await run('Vehicle,Owner\n2020 Kia,jane smith\n2021 Ford,Nobody Known\n')
    expect(result.imported).toBe(2)
    expect(linkedTo('2020 Kia')).toEqual(['Jane Smith'])
    expect(linkedTo('2021 Ford')).toEqual([])
    expect(result.warnings).toEqual([expect.stringMatching(/1 name in "Owner" didn't match anyone, so it wasn't linked: "Nobody Known"/)])
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM case_log WHERE log_type = 'system'").get()).toEqual({ n: 0 })
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM cells WHERE column_id IN (SELECT id FROM columns WHERE column_type = 'link')").get()).toEqual({ n: 0 })
  })

  it('can add the missing ones to the other list, once each, within the limit', async () => {
    const { result } = await run('Vehicle,Owner\n2020 Kia,Dana Cole\n2021 Ford,dana cole\n', true)
    expect(result.warnings).toEqual([])
    expect(linkedTo('2020 Kia')).toEqual(['Dana Cole'])
    expect(linkedTo('2021 Ford')).toEqual(['Dana Cole'])
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM rows WHERE grid_id = ? AND display_name = 'Dana Cole'").get(customers.gridId)).toEqual({ n: 1 })
  })
})
