/** Changing a column's type (audit 3.12 / G-19): values that fit are converted, the rest are kept, undo restores. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { previewTypeChange, changeColumnType, undoColumnTypeChange, convertValue, ColumnTypeError } from '../src/main/column-type'

let g: { gridId: number; columnIds: number[]; rowIds: number[] }
const col = (id: number) => t.db.prepare('SELECT column_type, config FROM columns WHERE id = ?').get(id) as { column_type: string; config: string }
const cell = (r: number, c: number) => (t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(r, c) as { value: string }).value

beforeEach(() => {
  t = createTestDb()
  g = seedGrid(t.db, { rowCount: 3, columnCount: 2 })
  const put = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
  put.run(g.rowIds[0], g.columnIds[1], '10/6/2026'); put.run(g.rowIds[1], g.columnIds[1], 'soon'); put.run(g.rowIds[2], g.columnIds[1], 'Feb 19, 2026')
})
afterEach(() => cleanupTestDb(t))

describe('changing a column type', () => {
  it('previews how many values fit', () => {
    expect(previewTypeChange(g.columnIds[1]!, 'date')).toEqual({ total: 3, clean: 2, examples: ['soon'] })
  })

  it('converts what fits, keeps the rest, and undo puts it all back', () => {
    const snap = changeColumnType(g.columnIds[1]!, 'date')
    expect(col(g.columnIds[1]!).column_type).toBe('date')
    expect([0, 1, 2].map(i => cell(g.rowIds[i]!, g.columnIds[1]!))).toEqual(['2026-10-06', 'soon', '2026-02-19'])
    undoColumnTypeChange(g.columnIds[1]!, snap)
    expect(col(g.columnIds[1]!).column_type).toBe('text')
    expect([0, 1, 2].map(i => cell(g.rowIds[i]!, g.columnIds[1]!))).toEqual(['10/6/2026', 'soon', 'Feb 19, 2026'])
  })

  it('reads numeric dates day first with the DD/MM/YYYY date format (AUDIT-117)', () => {
    t.db.prepare("INSERT INTO settings (key, value) VALUES ('date_format', 'eu')").run()
    expect(previewTypeChange(g.columnIds[1]!, 'date')).toEqual({ total: 3, clean: 2, examples: ['soon'] })
    changeColumnType(g.columnIds[1]!, 'date')
    expect([0, 1, 2].map(i => cell(g.rowIds[i]!, g.columnIds[1]!))).toEqual(['2026-06-10', 'soon', '2026-02-19'])
  })

  it('turns the values into the choices of a status column', () => {
    changeColumnType(g.columnIds[1]!, 'status')
    expect((JSON.parse(col(g.columnIds[1]!).config).options as Array<{ label: string }>).map(o => o.label)).toEqual(['10/6/2026', 'soon', 'Feb 19, 2026'])
  })

  it('reads tags and checkboxes as the text they show first (bug sweep S3)', () => {
    const c = g.columnIds[1]!
    t.db.prepare("UPDATE columns SET column_type = 'tag' WHERE id = ?").run(c)
    t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('["urgent","new"]', g.rowIds[0], c)
    t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('["urgent"]', g.rowIds[1], c)
    t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('["new"]', g.rowIds[2], c)
    changeColumnType(c, 'dropdown')
    expect(JSON.parse(col(c).config).options).toEqual(['urgent, new', 'urgent', 'new'])
    expect(cell(g.rowIds[1]!, c)).toBe('urgent')
    expect(convertValue('["urgent","new"]', 'text', 'tag')).toBe('urgent, new')
    expect(convertValue('true', 'text', 'checkbox')).toBe('Yes')
    expect(convertValue('false', 'dropdown', 'checkbox')).toBe('No')
  })

  it('keeps the name column a type that can name records', () => {
    t.db.prepare('UPDATE columns SET is_name_column = 1 WHERE id = ?').run(g.columnIds[1])
    t.db.prepare('UPDATE columns SET is_name_column = 0 WHERE id = ?').run(g.columnIds[0])
    expect(() => changeColumnType(g.columnIds[1]!, 'checkbox')).toThrow(/names the records/)
    expect(() => changeColumnType(g.columnIds[1]!, 'notes')).toThrow(ColumnTypeError)
    expect(() => changeColumnType(g.columnIds[1]!, 'phone')).not.toThrow()
  })

  it('refuses worked-out types', () => {
    expect(() => changeColumnType(g.columnIds[1]!, 'auto_number')).toThrow(ColumnTypeError)
  })

  it('converts single values sensibly', () => {
    expect(convertValue('$1,200.50', 'currency')).toBe('1200.5')
    expect(convertValue('Yes', 'checkbox')).toBe('true')
    expect(convertValue('maybe', 'checkbox')).toBeNull()
    expect(convertValue('a, b', 'tag')).toBe('["a","b"]')
  })
})
