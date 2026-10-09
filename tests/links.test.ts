/** Linked records (W04 commit 1): migration 039, link types, cardinality, history and change notes. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, createEmptyEncryptedDb, allMigrations, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { saveLinkType, deleteLinkType, addLink, removeLink, getLinksForRow, searchLinkTargets, listLinkTypes, countLinks, LinkError, createLinkedRecord, linkValuesForGrid, setupLink } from '../src/main/links'
import { loadAuditTrail } from '../src/main/export-audit'
import { parseLinkValue, holdsOne } from '../src/shared/links'
import { up as migration039 } from '../src/main/migrations/039_links'

let customers: { gridId: number; rowIds: number[] }
let vehicles: { gridId: number; rowIds: number[] }
const name = (rowId: number, n: string) => t.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run(n, rowId)
const notes = (rowId: number) => (t.db.prepare("SELECT content FROM case_log WHERE row_id = ? AND log_type = 'system' ORDER BY id").all(rowId) as Array<{ content: string }>).map(r => r.content)
const history = () => t.db.prepare('SELECT from_row_id, to_row_id, action FROM record_link_history ORDER BY id').all()
const owner = () => saveLinkType({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: ' Owner ', label_backward: 'Vehicles', cardinality: 'many_to_one' })
const showWithNotes = (gridId: number, typeId: number, direction: 'forward' | 'backward') =>
  t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Link', 'link', 9, ?)").run(gridId, JSON.stringify({ link_type_id: typeId, direction, log_changes: true }))

beforeEach(() => {
  t = createTestDb()
  customers = seedGrid(t.db, { name: 'Customers', rowCount: 3 })
  vehicles = seedGrid(t.db, { name: 'Vehicles', rowCount: 3 })
  ;['Jane Smith', 'Bob Lee', 'Ann Park'].forEach((n, i) => name(customers.rowIds[i]!, n))
  ;['2017 Civic', '2019 F-150', '2012 Prius'].forEach((n, i) => name(vehicles.rowIds[i]!, n))
})
afterEach(() => cleanupTestDb(t))

describe('migration 039', () => {
  it('adds the link tables and is safe to run twice', () => {
    const e = createEmptyEncryptedDb()
    e.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) if (m.version <= 38) m.up(e.db)
    migration039(e.db)
    expect(() => migration039(e.db)).not.toThrow()
    const tables = (e.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(r => r.name)
    expect(tables).toEqual(expect.arrayContaining(['link_types', 'record_links', 'record_link_history']))
    expect((e.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('39')
    cleanupTestDb(e)
  })
})

describe('link types', () => {
  it('are created with trimmed names and listed for both lists', () => {
    const type = owner()
    expect(type).toMatchObject({ label_forward: 'Owner', from_grid_name: 'Vehicles', to_grid_name: 'Customers', cardinality: 'many_to_one' })
    expect(listLinkTypes(customers.gridId).map(x => x.id)).toEqual([type.id])
    expect(() => saveLinkType({ ...type, id: undefined, label_forward: '  ' })).toThrow(LinkError)
  })

  it('refuse a change to "one" when records already have several', () => {
    const type = saveLinkType({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Drivers', label_backward: 'Cars', cardinality: 'many_to_many' })
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[1]!)
    expect(() => saveLinkType({ ...type, cardinality: 'many_to_one' })).toThrow(/more than one already/)
    removeLink(type.id, vehicles.rowIds[0]!, customers.rowIds[1]!)
    expect(saveLinkType({ ...type, cardinality: 'many_to_one', label_forward: 'Driver' })).toMatchObject({ cardinality: 'many_to_one', label_forward: 'Driver' })
  })

  it('delete with their links and columns, keeping the history', () => {
    const type = owner()
    showWithNotes(vehicles.gridId, type.id, 'forward')
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    expect(countLinks(type.id)).toBe(1)
    const res = deleteLinkType(type.id)
    expect(res).toMatchObject({ removedLinks: 1, removedColumns: [expect.any(Number)] })
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM columns WHERE column_type = 'link'").get()).toEqual({ n: 0 })
    expect(history()).toEqual([
      { from_row_id: vehicles.rowIds[0], to_row_id: customers.rowIds[0], action: 'add' },
      { from_row_id: vehicles.rowIds[0], to_row_id: customers.rowIds[0], action: 'remove' },
    ])
  })
})

describe('links', () => {
  it('many to one: a new owner replaces the old, and says so', () => {
    const type = owner()
    showWithNotes(vehicles.gridId, type.id, 'forward')
    showWithNotes(customers.gridId, type.id, 'backward')
    const [civic] = vehicles.rowIds as [number]
    const [jane, bob] = customers.rowIds as [number, number]
    addLink(type.id, civic, jane)
    const change = addLink(type.id, civic, bob)
    expect(change.removed).toEqual([{ typeId: type.id, fromRowId: civic, toRowId: jane }])
    expect(change.added).toEqual({ typeId: type.id, fromRowId: civic, toRowId: bob })
    expect(change.rowIds.sort()).toEqual([civic, jane, bob].sort())
    expect(notes(civic)).toEqual(['Owner set to Jane Smith', 'Owner set to Bob Lee (was Jane Smith)'])
    expect(notes(jane)).toEqual(['Vehicles: 2017 Civic linked', 'Vehicles: 2017 Civic unlinked'])
    expect(notes(bob)).toEqual(['Vehicles: 2017 Civic linked'])
    expect(change.sysLogIds).toHaveLength(3)
    // A customer can have several vehicles
    addLink(type.id, vehicles.rowIds[1]!, bob)
    expect(getLinksForRow(bob)).toEqual([expect.objectContaining({ direction: 'backward', label: 'Vehicles', single: false,
      records: [expect.objectContaining({ display_name: '2017 Civic' }), expect.objectContaining({ display_name: '2019 F-150' })] })])
  })

  it('one to one replaces on both sides', () => {
    const type = saveLinkType({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Parking spot holder', label_backward: 'Car', cardinality: 'one_to_one' })
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    const change = addLink(type.id, vehicles.rowIds[1]!, customers.rowIds[0]!)
    expect(change.removed).toEqual([{ typeId: type.id, fromRowId: vehicles.rowIds[0], toRowId: customers.rowIds[0] }])
  })

  it('many to many keeps both, and linking twice changes nothing', () => {
    const type = saveLinkType({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Drivers', label_backward: 'Cars', cardinality: 'many_to_many' })
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[1]!)
    expect(addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[1]!)).toEqual({ added: null, removed: [], sysLogIds: [], rowIds: [] })
    expect(countLinks(type.id)).toBe(2)
    expect(removeLink(type.id, vehicles.rowIds[2]!, customers.rowIds[1]!).removed).toEqual([])
  })

  it('reject records from the wrong lists, trashed records, and a record linked to itself', () => {
    const type = owner()
    expect(() => addLink(type.id, customers.rowIds[0]!, vehicles.rowIds[0]!)).toThrow(/can't be linked this way/)
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(customers.rowIds[2])
    expect(() => addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[2]!)).toThrow(/no longer available/)
    const household = saveLinkType({ from_grid_id: customers.gridId, to_grid_id: customers.gridId, label_forward: 'Lives with', label_backward: 'Lives with', cardinality: 'many_to_many' })
    expect(() => addLink(household.id, customers.rowIds[0]!, customers.rowIds[0]!)).toThrow(/itself/)
    expect(addLink(household.id, customers.rowIds[0]!, customers.rowIds[1]!).added).not.toBeNull()
    // A self-link shows both ways on the same list
    expect(getLinksForRow(customers.rowIds[0]!).filter(l => l.type.id === household.id).map(l => l.direction)).toEqual(['forward', 'backward'])
  })

  it('no change notes unless a column shows the link with notes on; history always', () => {
    const type = owner()
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    expect(notes(vehicles.rowIds[0]!)).toEqual([])
    expect(history()).toHaveLength(1)
  })

  it('hide trashed records from links and search; archived ones come last', () => {
    const type = owner()
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(customers.rowIds[0])
    expect(getLinksForRow(vehicles.rowIds[0]!)[0]!.records).toEqual([])
    t.db.prepare('UPDATE rows SET is_active = 0 WHERE id = ?').run(customers.rowIds[1])
    expect(searchLinkTargets(type.id, 'forward', '').map(r => r.display_name)).toEqual(['Ann Park', 'Bob Lee'])
    expect(searchLinkTargets(type.id, 'forward', 'an').map(r => r.display_name)).toEqual(['Ann Park'])
    expect(searchLinkTargets(type.id, 'forward', '%').map(r => r.display_name)).toEqual([])
    expect(searchLinkTargets(type.id, 'backward', 'civic').map(r => r.display_name)).toEqual(['2017 Civic'])
  })

  it('purging a record removes its links but not their history', () => {
    const type = owner()
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    t.db.prepare('DELETE FROM cells WHERE row_id = ?').run(customers.rowIds[0])
    t.db.prepare('DELETE FROM rows WHERE id = ?').run(customers.rowIds[0])
    expect(countLinks(type.id)).toBe(0)
    expect(history()).toHaveLength(1)
  })
})

describe('link values in the grid', () => {
  it('parse into chips', () => {
    expect(parseLinkValue('4\u001eJane Smith\u001f9\u001eBob')).toEqual([{ rowId: 4, name: 'Jane Smith' }, { rowId: 9, name: 'Bob' }])
    expect(parseLinkValue('')).toEqual([])
    expect(parseLinkValue('x\u001eNope\u001f5\u001e')).toEqual([{ rowId: 5, name: '' }])
  })

  it('know which side holds one', () => {
    expect(holdsOne('many_to_one', 'forward')).toBe(true)
    expect(holdsOne('many_to_one', 'backward')).toBe(false)
    expect(holdsOne('one_to_one', 'backward')).toBe(true)
    expect(holdsOne('many_to_many', 'forward')).toBe(false)
  })
})

describe('creating a record from the picker', () => {
  it('adds it to the other list with its name and links it', () => {
    const type = owner()
    const { rowId, change } = createLinkedRecord(type.id, 'forward', vehicles.rowIds[0]!, '  Dana Cole ')
    expect(t.db.prepare('SELECT grid_id, display_name FROM rows WHERE id = ?').get(rowId)).toEqual({ grid_id: customers.gridId, display_name: 'Dana Cole' })
    expect(change.added).toEqual({ typeId: type.id, fromRowId: vehicles.rowIds[0], toRowId: rowId })
    // From the other side, the new record is the "from" end
    const back = createLinkedRecord(type.id, 'backward', customers.rowIds[0]!, '2020 Kia')
    expect(t.db.prepare('SELECT grid_id FROM rows WHERE id = ?').get(back.rowId)).toEqual({ grid_id: vehicles.gridId })
    expect(back.change.added).toEqual({ typeId: type.id, fromRowId: back.rowId, toRowId: customers.rowIds[0] })
    expect(() => createLinkedRecord(type.id, 'forward', vehicles.rowIds[1]!, '  ')).toThrow(/name/)
  })
})

describe('link values for refreshing the grid', () => {
  it('cover only link columns, per record', () => {
    const type = owner()
    expect(linkValuesForGrid(vehicles.gridId)).toEqual([])
    const col = Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Owner', 'link', 9, ?)").run(vehicles.gridId, JSON.stringify({ link_type_id: type.id, direction: 'forward' })).lastInsertRowid)
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[1]!)
    const values = linkValuesForGrid(vehicles.gridId)
    expect(values).toHaveLength(3)
    expect(values.find(v => v.row_id === vehicles.rowIds[0])![`col_${col}`]).toBe(`${customers.rowIds[1]}\u001eBob Lee`)
  })
})

describe('the audit trail', () => {
  it('lists links and unlinks on both records, even after the type is gone', () => {
    const type = owner()
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    removeLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    const events = (rowId: number) => loadAuditTrail({ rowId })[0]!.events.filter(e => /linked/.test(e.what)).map(e => `${e.what} ${e.details}`)
    expect(events(vehicles.rowIds[0]!)).toEqual(['Owner: linked Jane Smith', 'Owner: unlinked Jane Smith'])
    expect(events(customers.rowIds[0]!)).toEqual(['Vehicles: linked 2017 Civic', 'Vehicles: unlinked 2017 Civic'])
    deleteLinkType(type.id)
    expect(events(customers.rowIds[0]!)).toEqual(['Vehicles: linked 2017 Civic', 'Vehicles: unlinked 2017 Civic'].map(s => s.replace('Vehicles', 'Link')))
  })
})

describe('linked records on the profile', () => {
  it('carry the other list\'s first two filled-in columns', () => {
    const type = owner()
    const cols = t.db.prepare('SELECT id FROM columns WHERE grid_id = ? ORDER BY position').all(customers.gridId) as Array<{ id: number }>
    // Column 1 is the name column; 2 and 3 are the first two others
    t.db.prepare("UPDATE columns SET name = 'Phone' WHERE id = ?").run(cols[1]!.id)
    t.db.prepare("UPDATE columns SET name = 'Since', column_type = 'date' WHERE id = ?").run(cols[2]!.id)
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)')
      .run(customers.rowIds[0], cols[1]!.id, '555-0100', customers.rowIds[0], cols[2]!.id, '2020-04-01', customers.rowIds[0], cols[3]!.id, 'not shown')
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    const [block] = getLinksForRow(vehicles.rowIds[0]!)
    expect(block!.records[0]!.details).toEqual([{ label: 'Phone', value: '555-0100', type: 'text' }, { label: 'Since', value: '2020-04-01', type: 'date' }])
  })
})

describe('setting up a link from the column menu', () => {
  it('adds the link type and a column on each list', () => {
    const { type, columnIds } = setupLink({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' }, { showOnOther: true, logChanges: true })
    const cols = t.db.prepare(`SELECT grid_id, name, column_type, config, position FROM columns WHERE id IN (${columnIds.join(',')}) ORDER BY id`).all() as Array<{ grid_id: number; name: string; column_type: string; config: string; position: number }>
    expect(cols.map(c => [c.grid_id, c.name, c.column_type, JSON.parse(c.config)])).toEqual([
      [vehicles.gridId, 'Owner', 'link', { link_type_id: type.id, direction: 'forward', log_changes: true }],
      [customers.gridId, 'Vehicles', 'link', { link_type_id: type.id, direction: 'backward', log_changes: true }],
    ])
    expect(cols[0]!.position).toBe(5)
    // Notes are on, so links now write them
    addLink(type.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    expect(notes(vehicles.rowIds[0]!)).toEqual(['Owner set to Jane Smith'])
  })

  it('can leave the other list alone', () => {
    const { columnIds } = setupLink({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' }, { showOnOther: false, logChanges: false })
    expect(columnIds).toHaveLength(1)
  })
})
