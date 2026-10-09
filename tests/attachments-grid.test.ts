/** Files count column (W09 commit 4): counted in the one grid query, trash excluded, in exports too. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }
})

import { buildGridQuery } from '../src/main/database'
import { loadGridData } from '../src/main/export-shared'
import { fileCountColumnIds } from '../src/shared/attachments'
import type { Column, GridRow } from '../src/shared/types'

let g: { gridId: number; rowIds: number[]; columnIds: number[] }
let filesCol: number
const attach = (rowId: number, deleted = false) =>
  t.db.prepare(`INSERT INTO attachments (row_id, file_name, mime_type, size_bytes, sha256, deleted_at) VALUES (?, 'a.pdf', 'application/pdf', 10, 'x', ${deleted ? "datetime('now')" : 'NULL'})`).run(rowId)

beforeEach(() => {
  t = createTestDb()
  g = seedGrid(t.db, { rowCount: 3, columnCount: 1 })
  filesCol = Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position) VALUES (?, 'Files', 'file_count', 9)").run(g.gridId).lastInsertRowid)
  attach(g.rowIds[0]!); attach(g.rowIds[0]!); attach(g.rowIds[0]!, true)
  attach(g.rowIds[1]!)
})
afterEach(() => cleanupTestDb(t))

describe('files count column', () => {
  it('counts each record’s files in the grid query, leaving out the trash', () => {
    const cols = t.db.prepare('SELECT * FROM columns WHERE grid_id = ? ORDER BY position').all(g.gridId) as Column[]
    expect(fileCountColumnIds(cols)).toEqual([filesCol])
    const rows = t.db.prepare(buildGridQuery(cols.map(c => c.id), true, [], fileCountColumnIds(cols))).all(g.gridId) as GridRow[]
    const byId = new Map(rows.map(r => [r.row_id, r]))
    expect(byId.get(g.rowIds[0]!)![`col_${filesCol}`]).toBe(3 - 1)
    expect(byId.get(g.rowIds[1]!)![`col_${filesCol}`]).toBe(1)
    expect(byId.get(g.rowIds[2]!)![`col_${filesCol}`]).toBe(0)
  })

  it('ignores stray cells stored under the column', () => {
    t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, '99')").run(g.rowIds[2], filesCol)
    const cols = t.db.prepare('SELECT * FROM columns WHERE grid_id = ?').all(g.gridId) as Column[]
    const rows = t.db.prepare(buildGridQuery(cols.map(c => c.id), true, [], [filesCol])).all(g.gridId) as GridRow[]
    expect(rows.find(r => r.row_id === g.rowIds[2])![`col_${filesCol}`]).toBe(0)
  })

  it('exports carry the count', () => {
    const { rows } = loadGridData(g.gridId)
    expect(rows.find(r => r.row_id === g.rowIds[0])![`col_${filesCol}`]).toBe(2)
  })
})
