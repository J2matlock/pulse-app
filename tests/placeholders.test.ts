/** Document placeholders (W10 commit 2): new names, every old alias, links, deadlines, unknown ones reported. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { resolvePlaceholders, placeholderFields } from '../src/main/placeholders'
import { saveLinkType, addLink } from '../src/main/links'

let vehicles: { gridId: number; rowIds: number[]; columnIds: number[] }
let customers: { gridId: number; rowIds: number[]; columnIds: number[] }
const today = new Date(2026, 9, 2)
const set = (rowId: number, columnId: number, value: string) => t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, columnId, value)
const col = (id: number, name: string, type: string, config = '{}') => t.db.prepare('UPDATE columns SET name = ?, column_type = ?, config = ? WHERE id = ?').run(name, type, config, id)

beforeEach(() => {
  t = createTestDb()
  vehicles = seedGrid(t.db, { name: 'Vehicles', rowCount: 1, columnCount: 6 })
  customers = seedGrid(t.db, { name: 'Customers', rowCount: 1, columnCount: 2 })
  const [nameC, dob, price, washed, lastService, medicaid] = vehicles.columnIds as [number, number, number, number, number, number]
  const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days) VALUES ('Service', '[]', 30)").run().lastInsertRowid)
  col(nameC, 'Vehicle', 'text'); col(dob, 'Date of Birth', 'date'); col(price, 'Price', 'currency'); col(washed, 'Washed', 'checkbox')
  col(lastService, 'Last service', 'date', JSON.stringify({ alert_rule_id: rule })); col(medicaid, 'Medicaid CIN', 'text')
  const v = vehicles.rowIds[0]!
  set(v, nameC, '2017 Civic'); set(v, dob, '2000-10-05'); set(v, price, '1234.5'); set(v, washed, 'true'); set(v, lastService, '2026-09-20'); set(v, medicaid, 'AB12345C')
  t.db.prepare("UPDATE rows SET display_name = '2017 Civic' WHERE id = ?").run(v)
  col(customers.columnIds[1]!, 'Phone', 'phone')
  set(customers.rowIds[0]!, customers.columnIds[1]!, '555-0100')
  t.db.prepare("UPDATE rows SET display_name = 'Jane Smith' WHERE id = ?").run(customers.rowIds[0])
  t.db.prepare("INSERT INTO settings (key, value) VALUES ('profile_name', 'Dana Cole'), ('profile_org', 'Acme Auto')").run()
})
afterEach(() => cleanupTestDb(t))

const fill = (content: string) => resolvePlaceholders(content, vehicles.rowIds[0]!, vehicles.gridId, today)

describe('placeholders', () => {
  it('fill names, fields by column name, profile and dates', () => {
    expect(fill('{{name}} / {{field:price}} / {{field:Washed}} / {{field: Date of Birth }} / {{my_name}} at {{my_org}} / {{today}} / {{today:long}}').text)
      .toBe('2017 Civic / $1,234.50 / Yes / October 5, 2000 / Dana Cole at Acme Auto / Oct 2, 2026 / October 2, 2026')
  })

  it('keep every older placeholder working', () => {
    expect(fill('{{client_name}}|{{case_manager_name}}|{{case_manager_org}}|{{today_date}}|{{dob}}|{{age}}|{{medicaid_cin}}|{{last_service}}').text)
      .toBe('2017 Civic|Dana Cole|Acme Auto|October 2, 2026|October 5, 2000|25|AB12345C|September 20, 2026')
  })

  it('give a deadline\'s due date from the engine', () => {
    expect(fill('Due {{deadline:Last service}}').text).toBe('Due October 20, 2026')
  })

  it('reach into a linked record', () => {
    const owner = saveLinkType({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' })
    expect(fill('{{linked:Owner.name}} {{linked:Owner.Phone}}').text).toBe(' ')
    addLink(owner.id, vehicles.rowIds[0]!, customers.rowIds[0]!)
    expect(fill('{{linked:Owner.name}} {{linked:owner.phone}}')).toEqual({ text: 'Jane Smith 555-0100', unknown: [] })
    expect(fill('{{linked:Owner.Fax}}').unknown).toEqual(['{{linked:Owner.Fax}}'])
  })

  it('leave unknown placeholders as typed and list them once', () => {
    expect(fill('Hi {{nope}}, {{field:Missing}} and {{nope}}')).toEqual({ text: 'Hi {{nope}}, {{field:Missing}} and {{nope}}', unknown: ['{{nope}}', '{{field:Missing}}'] })
  })

  it('offer the list\'s columns, deadlines and links to insert', () => {
    saveLinkType({ from_grid_id: vehicles.gridId, to_grid_id: customers.gridId, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' })
    const groups = placeholderFields(vehicles.gridId)
    expect(groups.map(g => g.label)).toEqual(['Columns', 'Deadlines', 'Linked'])
    expect(groups[0]!.items[0]).toEqual({ key: '{{field:Vehicle}}', desc: 'Vehicle' })
    expect(groups[1]!.items).toEqual([{ key: '{{deadline:Last service}}', desc: 'When Last service is due' }])
    expect(groups[2]!.items.map(i => i.key)).toEqual(['{{linked:Owner.name}}', '{{linked:Owner.Phone}}'])
    // The customers' side holds many vehicles, so it has nothing single to reach into
    expect(placeholderFields(customers.gridId).map(g => g.label)).toEqual(['Columns'])
  })
})

describe('next appointment placeholders (W07 §7)', () => {
  it('fill from the record\'s next scheduled appointment, or blank', () => {
    expect(fill('[{{appointment.date}}|{{appointment.time}}]').text).toBe('[|]')
    t.db.prepare("INSERT INTO appointments (row_id, title, start_at, location) VALUES (?, 'Service', '2026-10-09T14:30', 'Main St shop')").run(vehicles.rowIds[0])
    t.db.prepare("INSERT INTO appointments (row_id, title, start_at) VALUES (?, 'Old', '2026-09-01T09:00')").run(vehicles.rowIds[0])
    expect(fill('{{appointment.date}} at {{appointment.time}}, {{appointment.location}}')).toEqual({ text: 'October 9, 2026 at 2:30 pm, Main St shop', unknown: [] })
  })
})
