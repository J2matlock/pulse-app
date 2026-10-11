/** Batch documents, postcards and labels (W10 commit 3). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))
vi.mock('../src/main/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }))

import { batchRowIds, buildBatchPdf, buildLabelsPdf, labelPositions, postcardPositions, previewBatch, DocumentError } from '../src/main/export-documents'
import { localDateFromToday } from '../src/shared/dates'

let g: { gridId: number; rowIds: number[]; columnIds: number[] }
let template: number
const names = ['Cole', 'adams', 'Baker', 'Diaz']

beforeEach(() => {
  t = createTestDb()
  g = seedGrid(t.db, { name: 'Vehicles', rowCount: 4, columnCount: 3 })
  template = Number(t.db.prepare("INSERT INTO letter_templates (name, content) VALUES ('Reminder', 'Dear {{name}}, {{unknown_thing}}')").run().lastInsertRowid)
  // Column changes recompute display names (a trigger), so names go in after
  t.db.prepare("UPDATE columns SET name = 'Address', column_type = 'address' WHERE id = ?").run(g.columnIds[1])
  names.forEach((n, i) => t.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run(n, g.rowIds[i]))
})
afterEach(() => cleanupTestDb(t))

describe('who a batch covers', () => {
  it('everyone active, the chosen ones, or those with a deadline in range, in name order', () => {
    const order = (ids: number[]) => ids.map(id => names[g.rowIds.indexOf(id)])
    expect(order(batchRowIds({ gridId: g.gridId }))).toEqual(['adams', 'Baker', 'Cole', 'Diaz'])
    expect(order(batchRowIds({ gridId: g.gridId, rowIds: [g.rowIds[3]!, g.rowIds[0]!] }))).toEqual(['Cole', 'Diaz'])
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds) VALUES ('Due', '[]')").run().lastInsertRowid)
    t.db.prepare("UPDATE columns SET column_type = 'date', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rule }), g.columnIds[2])
    names.forEach((n, i) => t.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run(n, g.rowIds[i]))
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?), (?, ?, ?)').run(g.rowIds[2], g.columnIds[2], localDateFromToday(40), g.rowIds[1], g.columnIds[2], localDateFromToday(3))
    expect(order(batchRowIds({ gridId: g.gridId, deadline: { columnId: g.columnIds[2]!, from: localDateFromToday(30), to: localDateFromToday(60) } }))).toEqual(['Baker'])
  })
})

describe('batch documents', () => {
  it('one page per record as letters, two per sheet as postcards, with unknown placeholders listed once', () => {
    const letters = buildBatchPdf(template, { gridId: g.gridId }, 'letter')
    expect(letters.count).toBe(4)
    expect(letters.pdf.getNumberOfPages()).toBe(4)
    expect(letters.unknown).toEqual(['{{unknown_thing}}'])
    expect(buildBatchPdf(template, { gridId: g.gridId, rowIds: g.rowIds.slice(0, 3) }, 'postcard').pdf.getNumberOfPages()).toBe(2)
    const [a, b] = postcardPositions()
    expect(a!.w).toBeCloseTo(152.4)
    expect(a!.h).toBeCloseTo(101.6)
    expect(b!.y).toBeGreaterThan(a!.y + a!.h)
  })

  it('say how many they make and which tags won\'t fill in, before saving (audit X-37)', () => {
    expect(previewBatch(template, { gridId: g.gridId })).toEqual({ count: 4, unknown: ['{{unknown_thing}}'] })
    expect(previewBatch(null, { gridId: g.gridId, rowIds: g.rowIds.slice(0, 2) })).toEqual({ count: 2, unknown: [] })
    expect(previewBatch(template, { gridId: g.gridId, rowIds: [999999] })).toEqual({ count: 0, unknown: [] })
    expect(previewBatch(9999, { gridId: g.gridId }).error).toMatch(/no longer exists/)
  })

  it('explain when there is nothing to make', () => {
    expect(() => buildBatchPdf(9999, { gridId: g.gridId }, 'letter')).toThrow(DocumentError)
    expect(() => buildBatchPdf(template, { gridId: g.gridId, rowIds: [999999] }, 'letter')).toThrow(/nobody/)
  })
})

describe('address labels', () => {
  it('match Avery 5160 and 5163 sheets', () => {
    const l5160 = labelPositions('avery-5160')
    expect(l5160).toHaveLength(30)
    const first = l5160[0]!
    for (const [k, v] of Object.entries({ x: 4.7625, y: 12.7, w: 66.675, h: 25.4 })) expect(first[k as keyof typeof first]).toBeCloseTo(v)
    expect(l5160[1]!.x).toBeCloseTo(74.6125)
    expect(l5160[29]!.y).toBeCloseTo(241.3)
    const l5163 = labelPositions('avery-5163')
    expect(l5163).toHaveLength(10)
    expect(l5163[1]!.w).toBeCloseTo(101.6)
    expect(l5163[1]!.h).toBeCloseTo(50.8)
  })

  it('leave out records without an address and add sheets as needed', () => {
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?), (?, ?, ?)').run(g.rowIds[0], g.columnIds[1], '1 Main St\nSpringfield', g.rowIds[1], g.columnIds[1], '  ')
    const res = buildLabelsPdf({ gridId: g.gridId }, g.columnIds[1]!, 'avery-5163')
    expect(res).toMatchObject({ count: 1, skipped: 3 })
    expect(() => buildLabelsPdf({ gridId: g.gridId, rowIds: [g.rowIds[2]!] }, g.columnIds[1]!, 'avery-5160')).toThrow(/address/)
  })
})
