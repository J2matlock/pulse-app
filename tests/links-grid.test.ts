/** Link columns in the grid (W04 commit 2): one query, names in order, trash hidden, archived marked, fast. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }
})

import { buildGridQuery } from '../src/main/database'
import { saveLinkType, addLink } from '../src/main/links'
import { loadGridData } from '../src/main/export-shared'
import { parseLinkValue, linkColumnSpecs, linkSpecKey } from '../src/shared/links'
import type { Column, GridRow } from '../src/shared/types'

let customers: { gridId: number; rowIds: number[] }
let vehicles: { gridId: number; rowIds: number[]; columnIds: number[] }
let typeId: number
let ownerCol: number, vehiclesCol: number

const name = (rowId: number, n: string) => t.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run(n, rowId)
const linkCol = (gridId: number, label: string, direction: 'forward' | 'backward', show?: 'count') =>
  Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, ?, 'link', 50, ?)").run(gridId, label, JSON.stringify({ link_type_id: typeId, direction, ...(show ? { show } : {}) })).lastInsertRowid)
const load = (gridId: number) => {
  const cols = t.db.prepare('SELECT * FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Column[]
  const links = linkColumnSpecs(cols)
  return t.db.prepare(buildGridQuery(cols.map(c => c.id), true, links)).all(gridId) as GridRow[]
}

beforeEach(() => {
  t = createTestDb()
  customers = seedGrid(t.db, { name: 'Customers', rowCount: 3, columnCount: 2 })
  vehicles = seedGrid(t.db, { name: 'Vehicles', rowCount: 3, columnCount: 2 })
  ;['Jane Smith', 'bob Lee', 'Ann Park'].forEach((n, i) => name(customers.rowIds[i]!, n))
  ;['2017 Civic', '2019 F-150', '2012 Prius'].forEach((n, i) => name(vehicles.rowIds[i]!, n))
  typeId = saveLinkType({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' }).id
  ownerCol = linkCol(vehicles.gridId, 'Owner', 'forward')
  vehiclesCol = linkCol(customers.gridId, 'Vehicles', 'backward')
})
afterEach(() => cleanupTestDb(t))

describe('link columns in the grid query', () => {
  it('read their settings', () => {
    const cols = t.db.prepare('SELECT * FROM columns WHERE id IN (?, ?)').all(ownerCol, vehiclesCol) as Column[]
    const specs = linkColumnSpecs([...cols, { id: 99, column_type: 'link', config: 'nope' }, { id: 98, column_type: 'text', config: null }])
    expect(specs).toEqual([{ columnId: ownerCol, typeId, direction: 'forward' }, { columnId: vehiclesCol, typeId, direction: 'backward' }])
    expect(linkSpecKey(specs)).toBe(`${ownerCol}:${typeId}f,${vehiclesCol}:${typeId}b`)
  })

  it('show linked names both ways, in name order, with trash hidden and archived marked', () => {
    const [jane, bob, ann] = customers.rowIds as [number, number, number]
    const [civic, f150, prius] = vehicles.rowIds as [number, number, number]
    addLink(typeId, civic, bob)
    addLink(typeId, f150, bob)
    addLink(typeId, prius, ann)
    t.db.prepare('UPDATE rows SET is_active = 0 WHERE id = ?').run(f150)
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(prius)

    const byId = new Map(load(customers.gridId).map(r => [r.row_id, r]))
    expect(parseLinkValue(byId.get(bob)![`col_${vehiclesCol}`])).toEqual([
      { rowId: civic, name: '2017 Civic' }, { rowId: f150, name: '2019 F-150', archived: true },
    ])
    expect(byId.get(ann)![`col_${vehiclesCol}`]).toBeNull()
    expect(byId.get(jane)![`col_${vehiclesCol}`]).toBeNull()

    const vehicleRows = new Map(load(vehicles.gridId).map(r => [r.row_id, r]))
    expect(parseLinkValue(vehicleRows.get(civic)![`col_${ownerCol}`])).toEqual([{ rowId: bob, name: 'bob Lee' }])
    // Cells in other columns still load
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(civic, vehicles.columnIds[1], 'Blue')
    expect(load(vehicles.gridId).find(r => r.row_id === civic)![`col_${vehicles.columnIds[1]}`]).toBe('Blue')
  })

  it('exports show names', () => {
    addLink(typeId, vehicles.rowIds[0]!, customers.rowIds[0]!)
    addLink(typeId, vehicles.rowIds[1]!, customers.rowIds[0]!)
    const { rows } = loadGridData(customers.gridId)
    expect(rows.find(r => r.row_id === customers.rowIds[0])![`col_${vehiclesCol}`]).toBe('2017 Civic, 2019 F-150')
  })

  it('500 records with 3 link columns load in one query, quickly', () => {
    const big = seedGrid(t.db, { name: 'Jobs', rowCount: 500, columnCount: 3 })
    const types = [0, 1, 2].map(i => saveLinkType({ from_grid_id: big.gridId, to_grid_id: customers.gridId, label_forward: `L${i}`, label_backward: `B${i}`, cardinality: 'many_to_many' }).id)
    const insertCol = t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, ?, 'link', 60, ?)")
    types.forEach((id, i) => insertCol.run(big.gridId, `Link ${i}`, JSON.stringify({ link_type_id: id, direction: 'forward' })))
    const ins = t.db.prepare('INSERT INTO record_links (link_type_id, from_row_id, to_row_id) VALUES (?, ?, ?)')
    t.db.transaction(() => { for (const r of big.rowIds) for (const id of types) for (const c of customers.rowIds.slice(0, 2)) ins.run(id, r, c) })()
    let best = Infinity
    let rows: GridRow[] = []
    for (let i = 0; i < 3; i++) {
      const start = performance.now()
      rows = load(big.gridId)
      best = Math.min(best, performance.now() - start)
    }
    expect(rows).toHaveLength(500)
    expect(parseLinkValue(rows[0]![`col_${(t.db.prepare("SELECT id FROM columns WHERE grid_id = ? AND name = 'Link 2'").get(big.gridId) as { id: number }).id}`])).toHaveLength(2)
    expect(best).toBeLessThan(300)
  })
})
