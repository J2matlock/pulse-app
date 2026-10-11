/**
 * ipc-grid.test.ts — Tests for GRID_*, COLUMN_*, SORT_* IPC handlers.
 * Tests registerGridHandlers() in isolation with a real DB.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture ──────────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()
let testDb: TestDb

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-grid') },
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {}, exit: () => {}, on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
    on: () => {},
  },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  shell: { openPath: async () => '', openExternal: async () => {} },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return { default: class { get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d } set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'object') { for (const [key, val] of Object.entries(k)) map.set(key, val) } else { map.set(k, v) } } has(k: string) { return map.has(k) } delete(k: string) { map.delete(k) } clear() { map.clear() } } }
})

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    cachedStmt: (key: string, sql: string) => testDb.db.prepare(sql),
    invalidateGridStmtCache: () => {},
  }
})

vi.mock('../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))

vi.mock('../src/main/ipc/ipc-cell', () => ({
  invalidateColumnCache: () => {},
}))

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

// ── Setup ────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  testDb = createTestDb()
  const { registerGridHandlers } = await import('../src/main/ipc/ipc-grid')
  registerGridHandlers()
})

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

// ── GRID_GET_ALL ─────────────────────────────────────────────────────────────

describe('GRID_GET_ALL', () => {
  it('returns ok with empty array on fresh DB', async () => {
    const result = await invoke(IPC.GRID_GET_ALL) as { ok: true; data: unknown[] }
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(0)
  })

  it('returns only active grids', async () => {
    seedGrid(testDb.db, { name: 'Active Grid' })
    const { gridId } = seedGrid(testDb.db, { name: 'Inactive Grid' })
    testDb.db.prepare("UPDATE grids SET is_active = 0 WHERE id = ?").run(gridId)

    const result = await invoke(IPC.GRID_GET_ALL) as { ok: true; data: Array<{ name: string }> }
    expect(result.data).toHaveLength(1)
    expect(result.data[0].name).toBe('Active Grid')
  })

  it('returns grids ordered by position', async () => {
    seedGrid(testDb.db, { name: 'Second' })
    seedGrid(testDb.db, { name: 'First' })
    // Set positions
    const grids = testDb.db.prepare('SELECT id, name FROM grids ORDER BY id').all() as Array<{ id: number; name: string }>
    testDb.db.prepare("UPDATE grids SET position = ? WHERE id = ?").run(1, grids[0].id)
    testDb.db.prepare("UPDATE grids SET position = ? WHERE id = ?").run(0, grids[1].id)

    const result = await invoke(IPC.GRID_GET_ALL) as { ok: true; data: Array<{ name: string }> }
    expect(result.data[0].name).toBe('First')
    expect(result.data[1].name).toBe('Second')
  })
})

// ── GRID_GET ─────────────────────────────────────────────────────────────────

describe('GRID_GET', () => {
  it('returns grid with columns and rows', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { columnCount: 3, rowCount: 5 })
    const result = await invoke(IPC.GRID_GET, gridId) as { ok: true; data: { grid: { id: number }; columns: unknown[]; rows: unknown[]; acuityLevels: unknown[] } }
    expect(result.ok).toBe(true)
    expect(result.data.grid.id).toBe(gridId)
    expect(result.data.columns.length).toBe(3)
    expect(result.data.rows.length).toBe(5)
    expect(result.data).toHaveProperty('acuityLevels')
  })

  it('returns fail for non-existent grid', async () => {
    const result = await invoke(IPC.GRID_GET, 999999) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe('That list no longer exists. It may have been deleted.')
  })

  it('returns fail for invalid ID (negative)', async () => {
    const result = await invoke(IPC.GRID_GET, -1) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('returns fail for invalid ID (zero)', async () => {
    const result = await invoke(IPC.GRID_GET, 0) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('returns fail for non-integer ID', async () => {
    const result = await invoke(IPC.GRID_GET, 1.5) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('returns fail for string ID', async () => {
    const result = await invoke(IPC.GRID_GET, 'abc') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('excludes hidden columns from columns but includes in rows', async () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnCount: 3, rowCount: 1 })
    testDb.db.prepare("UPDATE columns SET is_visible = 0 WHERE id = ?").run(columnIds[1])

    const result = await invoke(IPC.GRID_GET, gridId) as { ok: true; data: { columns: Array<{ id: number }>; hiddenColumns: Array<{ id: number }> } }
    expect(result.data.columns.length).toBe(2)
    expect(result.data.hiddenColumns.length).toBe(1)
    expect(result.data.hiddenColumns[0].id).toBe(columnIds[1])
  })

  it('excludes archived rows when showArchived=false', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 3 })
    testDb.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now') WHERE id = ?").run(rowIds[0])

    const result = await invoke(IPC.GRID_GET, gridId, false) as { ok: true; data: { rows: unknown[] } }
    expect(result.data.rows.length).toBe(2)
  })

  it('includes archived rows when showArchived=true', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 3 })
    testDb.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now') WHERE id = ?").run(rowIds[0])

    const result = await invoke(IPC.GRID_GET, gridId, true) as { ok: true; data: { rows: unknown[] } }
    expect(result.data.rows.length).toBe(3)
  })
})

// ── GRID_GET_FULL ────────────────────────────────────────────────────────────

describe('GRID_GET_FULL', () => {
  it('returns extended data including cellFormats, rowTagsMap, savedViews', async () => {
    const { gridId } = seedGrid(testDb.db, { columnCount: 2, rowCount: 2 })
    const result = await invoke(IPC.GRID_GET_FULL, gridId) as { ok: true; data: Record<string, unknown> }
    expect(result.ok).toBe(true)
    expect(result.data).toHaveProperty('grid')
    expect(result.data).toHaveProperty('columns')
    expect(result.data).toHaveProperty('rows')
    expect(result.data).toHaveProperty('cellFormats')
    expect(result.data).toHaveProperty('rowTagsMap')
    expect(result.data).toHaveProperty('savedViews')
    expect(result.data).toHaveProperty('customGroups')
    expect(result.data.sampleRows).toEqual({})
  })

  it('says which entries are made-up samples (audit 2.6)', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { columnCount: 2, rowCount: 3 })
    testDb.db.prepare("INSERT INTO sample_rows (row_id, grid_id, fingerprint, asked) VALUES (?, ?, '', 0), (?, ?, '', 1)").run(rowIds[0], gridId, rowIds[2], gridId)
    const result = await invoke(IPC.GRID_GET_FULL, gridId) as { ok: true; data: { sampleRows: Record<number, number> } }
    expect(result.data.sampleRows).toEqual({ [rowIds[0]!]: 0, [rowIds[2]!]: 1 })
  })

  it('returns fail for invalid grid ID', async () => {
    const result = await invoke(IPC.GRID_GET_FULL, -1) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('returns fail for non-existent grid', async () => {
    const result = await invoke(IPC.GRID_GET_FULL, 999999) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

// ── GRID_CREATE ──────────────────────────────────────────────────────────────

describe('GRID_CREATE', () => {
  it('creates grid with default Name column', async () => {
    const result = await invoke(IPC.GRID_CREATE, 'My Caseload') as { ok: true; data: number }
    expect(result.ok).toBe(true)
    expect(typeof result.data).toBe('number')

    // Verify default column exists
    const cols = testDb.db.prepare('SELECT * FROM columns WHERE grid_id = ?').all(result.data) as Array<{ name: string; is_name_column: number }>
    expect(cols.length).toBe(1)
    expect(cols[0].name).toBe('Name')
    expect(cols[0].is_name_column).toBe(1)
  })

  it('rejects empty name', async () => {
    const result = await invoke(IPC.GRID_CREATE, '') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects whitespace-only name', async () => {
    const result = await invoke(IPC.GRID_CREATE, '   ') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects name > 200 chars', async () => {
    const result = await invoke(IPC.GRID_CREATE, 'x'.repeat(201)) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('accepts Unicode name', async () => {
    const result = await invoke(IPC.GRID_CREATE, '案件管理') as { ok: true }
    expect(result.ok).toBe(true)
  })

  it('accepts name exactly 200 chars', async () => {
    const result = await invoke(IPC.GRID_CREATE, 'x'.repeat(200)) as { ok: true }
    expect(result.ok).toBe(true)
  })
})

// ── GRID_UPDATE ──────────────────────────────────────────────────────────────

describe('GRID_UPDATE', () => {
  it('updates grid name', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.GRID_UPDATE, gridId, { name: 'Updated Name' }) as { ok: boolean }
    expect(result.ok).toBe(true)

    const grid = testDb.db.prepare('SELECT name FROM grids WHERE id = ?').get(gridId) as { name: string }
    expect(grid.name).toBe('Updated Name')
  })

  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.GRID_UPDATE, -1, { name: 'Test' }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects no valid fields', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.GRID_UPDATE, gridId, { invalid_field: 'value' }) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No valid fields')
  })

  it('rejects oversized sort_config', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.GRID_UPDATE, gridId, { sort_config: 'x'.repeat(500_001) }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('updates description', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.GRID_UPDATE, gridId, { description: 'A test grid' }) as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('updates multiple fields at once', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.GRID_UPDATE, gridId, { name: 'New Name', description: 'New desc' }) as { ok: boolean }
    expect(result.ok).toBe(true)
    const grid = testDb.db.prepare('SELECT name, description FROM grids WHERE id = ?').get(gridId) as { name: string; description: string }
    expect(grid.name).toBe('New Name')
    expect(grid.description).toBe('New desc')
  })
})

// ── GRID_DELETE ──────────────────────────────────────────────────────────────

describe('GRID_DELETE', () => {
  it('soft-deletes grid (sets is_active=0)', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.GRID_DELETE, gridId) as { ok: boolean }
    expect(result.ok).toBe(true)

    const grid = testDb.db.prepare('SELECT is_active FROM grids WHERE id = ?').get(gridId) as { is_active: number }
    expect(grid.is_active).toBe(0)
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.GRID_DELETE, -1) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

// ── GRID_REORDER ─────────────────────────────────────────────────────────────

describe('GRID_REORDER', () => {
  it('reorders grids by position', async () => {
    const { gridId: g1 } = seedGrid(testDb.db, { name: 'Grid A' })
    const { gridId: g2 } = seedGrid(testDb.db, { name: 'Grid B' })
    const result = await invoke(IPC.GRID_REORDER, [g2, g1]) as { ok: boolean }
    expect(result.ok).toBe(true)

    const pos1 = (testDb.db.prepare('SELECT position FROM grids WHERE id = ?').get(g1) as { position: number }).position
    const pos2 = (testDb.db.prepare('SELECT position FROM grids WHERE id = ?').get(g2) as { position: number }).position
    expect(pos2).toBeLessThan(pos1)
  })

  it('rejects non-array', async () => {
    const result = await invoke(IPC.GRID_REORDER, 'not-array') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects array with non-integer IDs', async () => {
    const result = await invoke(IPC.GRID_REORDER, [1, 'two', 3]) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects array with negative IDs', async () => {
    const result = await invoke(IPC.GRID_REORDER, [1, -2, 3]) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects payload exceeding 500 items', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1)
    const result = await invoke(IPC.GRID_REORDER, ids) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

// ── COLUMN_CREATE ────────────────────────────────────────────────────────────

describe('COLUMN_CREATE', () => {
  it('creates column at next position', async () => {
    const { gridId } = seedGrid(testDb.db, { columnCount: 2 })
    const result = await invoke(IPC.COLUMN_CREATE, gridId, 'New Col', 'text') as { ok: true; data: number }
    expect(result.ok).toBe(true)

    const col = testDb.db.prepare('SELECT position FROM columns WHERE id = ?').get(result.data) as { position: number }
    expect(col.position).toBe(2)
  })

  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.COLUMN_CREATE, 0, 'Col', 'text') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects empty name', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.COLUMN_CREATE, gridId, '', 'text') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects name > 200 chars', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.COLUMN_CREATE, gridId, 'x'.repeat(201), 'text') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects invalid column type', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.COLUMN_CREATE, gridId, 'Bad Col', 'invalid_type') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('accepts all valid column types', async () => {
    const { gridId } = seedGrid(testDb.db)
    for (const type of ['text', 'date', 'number', 'checkbox', 'dropdown', 'phone', 'email']) {
      const r = await invoke(IPC.COLUMN_CREATE, gridId, `Col_${type}`, type) as { ok: boolean }
      expect(r.ok).toBe(true)
    }
  })
})

// ── COLUMN_UPDATE ────────────────────────────────────────────────────────────

describe('COLUMN_UPDATE', () => {
  it('updates column name', async () => {
    const { columnIds } = seedGrid(testDb.db)
    const result = await invoke(IPC.COLUMN_UPDATE, columnIds[1], { name: 'Renamed' }) as { ok: boolean }
    expect(result.ok).toBe(true)
    const col = testDb.db.prepare('SELECT name FROM columns WHERE id = ?').get(columnIds[1]) as { name: string }
    expect(col.name).toBe('Renamed')
  })

  it('rejects invalid column ID', async () => {
    const result = await invoke(IPC.COLUMN_UPDATE, 0, { name: 'Test' }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects no valid fields', async () => {
    const { columnIds } = seedGrid(testDb.db)
    const result = await invoke(IPC.COLUMN_UPDATE, columnIds[0], { bogus: 'value' }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects invalid column_type update', async () => {
    const { columnIds } = seedGrid(testDb.db)
    const result = await invoke(IPC.COLUMN_UPDATE, columnIds[0], { column_type: 'nonexistent' }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects oversized config', async () => {
    const { columnIds } = seedGrid(testDb.db)
    const result = await invoke(IPC.COLUMN_UPDATE, columnIds[0], { config: 'x'.repeat(100_001) }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects oversized conditional_format', async () => {
    const { columnIds } = seedGrid(testDb.db)
    const result = await invoke(IPC.COLUMN_UPDATE, columnIds[0], { conditional_format: 'x'.repeat(100_001) }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('updates width', async () => {
    const { columnIds } = seedGrid(testDb.db)
    const result = await invoke(IPC.COLUMN_UPDATE, columnIds[0], { width: 300 }) as { ok: boolean }
    expect(result.ok).toBe(true)
  })
})

// ── COLUMN_BATCH_UPDATE_VISIBILITY ───────────────────────────────────────────

describe('COLUMN_BATCH_UPDATE_VISIBILITY', () => {
  it('updates visibility for multiple columns', async () => {
    const { columnIds } = seedGrid(testDb.db, { columnCount: 3 })
    const updates = [
      { columnId: columnIds[1], isVisible: 0 as const },
      { columnId: columnIds[2], isVisible: 0 as const },
    ]
    const result = await invoke(IPC.COLUMN_BATCH_UPDATE_VISIBILITY, updates) as { ok: boolean }
    expect(result.ok).toBe(true)

    const hidden = testDb.db.prepare('SELECT COUNT(*) as c FROM columns WHERE is_visible = 0 AND id IN (?, ?)').get(columnIds[1], columnIds[2]) as { c: number }
    expect(hidden.c).toBe(2)
  })

  it('rejects empty array', async () => {
    const result = await invoke(IPC.COLUMN_BATCH_UPDATE_VISIBILITY, []) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects > 500 entries', async () => {
    const updates = Array.from({ length: 501 }, (_, i) => ({ columnId: i + 1, isVisible: 1 }))
    const result = await invoke(IPC.COLUMN_BATCH_UPDATE_VISIBILITY, updates) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects invalid isVisible value', async () => {
    const result = await invoke(IPC.COLUMN_BATCH_UPDATE_VISIBILITY, [{ columnId: 1, isVisible: 2 }]) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

// ── COLUMN_BATCH_UPDATE_WIDTHS ───────────────────────────────────────────────

describe('COLUMN_BATCH_UPDATE_WIDTHS', () => {
  it('updates widths for multiple columns', async () => {
    const { columnIds } = seedGrid(testDb.db, { columnCount: 3 })
    const updates = [
      { columnId: columnIds[0], width: 150 },
      { columnId: columnIds[1], width: 200 },
    ]
    const result = await invoke(IPC.COLUMN_BATCH_UPDATE_WIDTHS, updates) as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('rejects empty array', async () => {
    const result = await invoke(IPC.COLUMN_BATCH_UPDATE_WIDTHS, []) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects width > 2000', async () => {
    const result = await invoke(IPC.COLUMN_BATCH_UPDATE_WIDTHS, [{ columnId: 1, width: 2001 }]) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects negative width', async () => {
    const result = await invoke(IPC.COLUMN_BATCH_UPDATE_WIDTHS, [{ columnId: 1, width: -10 }]) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects zero width', async () => {
    const result = await invoke(IPC.COLUMN_BATCH_UPDATE_WIDTHS, [{ columnId: 1, width: 0 }]) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

// ── COLUMN_DELETE ────────────────────────────────────────────────────────────

describe('COLUMN_DELETE', () => {
  it('deletes column and cascades cells', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { columnCount: 3, rowCount: 2 })
    // Insert cells for column 1
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, 'test', datetime('now'))").run(rowIds[0], columnIds[1])

    const result = await invoke(IPC.COLUMN_DELETE, columnIds[1]) as { ok: boolean }
    expect(result.ok).toBe(true)

    const cellCount = (testDb.db.prepare('SELECT COUNT(*) as c FROM cells WHERE column_id = ?').get(columnIds[1]) as { c: number }).c
    expect(cellCount).toBe(0)
  })

  it('keeps the column and its values in the Trash, and COLUMN_RESTORE brings them back (5.2)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { columnCount: 2, rowCount: 1 })
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, 'kept', datetime('now'))").run(rowIds[0], columnIds[1])
    const res = await invoke(IPC.COLUMN_DELETE, columnIds[1]) as { ok: true; data: { deletedId: number } }
    expect(res.data.deletedId).toBeGreaterThan(0)
    const list = await invoke(IPC.COLUMN_DELETED_LIST, gridId) as { ok: true; data: Array<{ id: number }> }
    expect(list.data.map(d => d.id)).toEqual([res.data.deletedId])
    expect(await invoke(IPC.COLUMN_RESTORE, res.data.deletedId)).toEqual({ ok: true, data: { columnId: columnIds[1], gridId } })
    expect(testDb.db.prepare('SELECT value FROM cells WHERE column_id = ?').get(columnIds[1])).toEqual({ value: 'kept' })
  })

  it('a deleted list goes to the Trash and comes back with GRID_RESTORE (5.2)', async () => {
    const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 2 })
    expect((await invoke(IPC.GRID_DELETE, gridId) as { ok: boolean }).ok).toBe(true)
    const lists = await invoke(IPC.GRID_DELETED_LIST) as { ok: true; data: Array<{ id: number; records: number }> }
    expect(lists.data).toEqual([expect.objectContaining({ id: gridId, records: 2 })])
    expect((await invoke(IPC.GRID_RESTORE, gridId) as { ok: boolean }).ok).toBe(true)
    expect(testDb.db.prepare('SELECT is_active FROM grids WHERE id = ?').get(gridId)).toEqual({ is_active: 1 })
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.COLUMN_DELETE, -1) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('returns fail for non-existent column', async () => {
    const result = await invoke(IPC.COLUMN_DELETE, 999999) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('prevents deleting the only column in a grid', async () => {
    const { columnIds } = seedGrid(testDb.db, { columnCount: 1 })
    const result = await invoke(IPC.COLUMN_DELETE, columnIds[0]) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('at least one column')
  })

  it('transfers name column status when deleting the name column', async () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnCount: 3 })
    // Column 0 is the name column
    const result = await invoke(IPC.COLUMN_DELETE, columnIds[0]) as { ok: boolean }
    expect(result.ok).toBe(true)

    // Another column should now be the name column
    const nameCol = testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as { id: number } | undefined
    expect(nameCol).toBeDefined()
    expect(nameCol!.id).not.toBe(columnIds[0])
  })

  it('hiding, showing or deleting a "Last name" column renames every record (bug sweep S4)', async () => {
    const { columnIds, rowIds } = seedGrid(testDb.db, { columnCount: 2, rowCount: 1 })
    const [first, last] = columnIds as [number, number]
    testDb.db.prepare("UPDATE columns SET name = 'Last name' WHERE id = ?").run(last)
    const put = testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
    put.run(rowIds[0], first, 'Jane'); put.run(rowIds[0], last, 'Smith')
    const name = () => (testDb.db.prepare('SELECT display_name FROM rows WHERE id = ?').get(rowIds[0]) as { display_name: string }).display_name
    expect(name()).toBe('Jane Smith')
    await invoke(IPC.COLUMN_UPDATE, last, { is_visible: 0 })
    expect(name()).toBe('Jane')
    await invoke(IPC.COLUMN_BATCH_UPDATE_VISIBILITY, [{ columnId: last, isVisible: 1 }])
    expect(name()).toBe('Jane Smith')
    const res = await invoke(IPC.COLUMN_DELETE, last) as { ok: true; data: { deletedId: number } }
    expect(name()).toBe('Jane')
    await invoke(IPC.COLUMN_RESTORE, res.data.deletedId)
    expect(name()).toBe('Jane Smith')
  })

  it('Undo of deleting the name column gives it the name back from its stand-in (bug sweep S3)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { columnCount: 2, rowCount: 1, columnTypes: ['text', 'phone'] })
    const put = testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
    put.run(rowIds[0], columnIds[0], 'Ana Diaz')
    put.run(rowIds[0], columnIds[1], '555-0100')
    const name = () => (testDb.db.prepare('SELECT display_name FROM rows WHERE id = ?').get(rowIds[0]) as { display_name: string }).display_name
    const res = await invoke(IPC.COLUMN_DELETE, columnIds[0]) as { ok: true; data: { deletedId: number } }
    expect(name()).toBe('555-0100')
    expect((await invoke(IPC.COLUMN_RESTORE, res.data.deletedId) as { ok: boolean }).ok).toBe(true)
    expect(testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').all(gridId)).toEqual([{ id: columnIds[0] }])
    expect(name()).toBe('Ana Diaz')
  })

  it('a name column chosen after the delete stays the name when the old one comes back', async () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnCount: 3, columnTypes: ['text', 'text', 'text'] })
    const res = await invoke(IPC.COLUMN_DELETE, columnIds[0]) as { ok: true; data: { deletedId: number } }
    await invoke(IPC.COLUMN_SET_NAME, columnIds[2])
    await invoke(IPC.COLUMN_RESTORE, res.data.deletedId)
    expect(testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').all(gridId)).toEqual([{ id: columnIds[2] }])
  })

  it('never hands the name to a column that cannot name records', async () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnCount: 3, columnTypes: ['text', 'checkbox', 'notes'] })
    expect((await invoke(IPC.COLUMN_DELETE, columnIds[0]) as { ok: boolean }).ok).toBe(true)
    expect(testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').all(gridId)).toEqual([])
  })

  it('renames records everywhere when the name column goes, preferring a text column (L-10)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { columnCount: 3, rowCount: 1, columnTypes: ['text', 'date', 'text'] })
    const put = testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
    put.run(rowIds[0], columnIds[0], 'Old Name')
    put.run(rowIds[0], columnIds[1], '2026-01-01')
    put.run(rowIds[0], columnIds[2], 'New Name')
    expect((testDb.db.prepare('SELECT display_name FROM rows WHERE id = ?').get(rowIds[0]) as { display_name: string }).display_name).toBe('Old Name')

    expect((await invoke(IPC.COLUMN_DELETE, columnIds[0]) as { ok: boolean }).ok).toBe(true)
    const nameCol = testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as { id: number }
    expect(nameCol.id).toBe(columnIds[2])
    expect((testDb.db.prepare('SELECT display_name FROM rows WHERE id = ?').get(rowIds[0]) as { display_name: string }).display_name).toBe('New Name')
  })
})

// ── COLUMN_DEPENDENTS / COLUMN_SET_NAME (audit 1.8) ─────────────────────────

describe('COLUMN_DEPENDENTS', () => {
  it('lists the rules, columns, sort, views, reports and forms that use a column', async () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnCount: 3, rowCount: 0, columnTypes: ['text', 'date', 'calculated_days'] })
    const dateCol = columnIds[1]!
    testDb.db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Within 30 days', '[]', 'relative', ?)")
      .run(JSON.stringify({ anchorColumnId: dateCol, offset: 30, unit: 'days', direction: 'after' }))
    testDb.db.prepare("INSERT INTO alert_rules (name, thresholds, rule_condition) VALUES ('Only open', '[]', ?)")
      .run(JSON.stringify({ columnId: dateCol, op: 'is_not_empty' }))
    testDb.db.prepare("INSERT INTO alert_rules (name, thresholds) VALUES ('Unrelated', '[]')").run()
    testDb.db.prepare('UPDATE columns SET name = ?, config = ? WHERE id = ?').run('Days left', JSON.stringify({ source_column_id: dateCol }), columnIds[2])
    testDb.db.prepare('UPDATE grids SET sort_config = ? WHERE id = ?').run(JSON.stringify([{ columnId: dateCol, direction: 'asc', priority: 1 }]), gridId)
    testDb.db.prepare("INSERT INTO saved_views (grid_id, name, config) VALUES (?, 'By date', ?)").run(gridId, JSON.stringify({ sortConfig: [{ columnId: dateCol }] }))
    testDb.db.prepare("INSERT INTO report_definitions (grid_id, name, config) VALUES (?, 'Monthly', ?)").run(gridId, JSON.stringify({ source: 'records', groupBy: [{ field: `col:${dateCol}`, bucket: 'month' }] }))
    testDb.db.prepare("INSERT INTO forms (grid_id, name, fields) VALUES (?, 'Intake', ?)").run(gridId, JSON.stringify([{ kind: 'column', columnId: dateCol }]))

    const res = await invoke(IPC.COLUMN_DEPENDENTS, dateCol) as { ok: true; data: string[] }
    expect(res.ok).toBe(true)
    expect(res.data).toEqual(expect.arrayContaining([
      'Deadline rule "Within 30 days"', 'Deadline rule "Only open"', 'Column "Days left" (its settings use this column)',
      'Saved view "By date"', 'Report "Monthly"', 'Form "Intake"',
    ]))
    expect(res.data.some(d => d.includes('sort order'))).toBe(true)
    expect(res.data.join('|')).not.toContain('Unrelated')

    const none = await invoke(IPC.COLUMN_DEPENDENTS, columnIds[0]) as { ok: true; data: string[] }
    expect(none.data).toEqual([])
  })

  it('does not count a column id that only appears as a number elsewhere', async () => {
    const { columnIds } = seedGrid(testDb.db, { columnCount: 2, rowCount: 0 })
    testDb.db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Fixed', '[]', 'calendar', ?)")
      .run(JSON.stringify({ day: columnIds[1], months: [columnIds[1]] }))
    const res = await invoke(IPC.COLUMN_DEPENDENTS, columnIds[1]) as { ok: true; data: string[] }
    expect(res.data).toEqual([])
  })
})

describe('COLUMN_SET_NAME', () => {
  it('makes a column the name and refreshes every record name', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { columnCount: 2, rowCount: 1 })
    const put = testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
    put.run(rowIds[0], columnIds[0], 'Program A')
    put.run(rowIds[0], columnIds[1], 'Jane Doe')
    const res = await invoke(IPC.COLUMN_SET_NAME, columnIds[1]) as { ok: true; data: { previousId: number | null } }
    expect(res.ok).toBe(true)
    expect(res.data.previousId).toBe(columnIds[0])
    const names = testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').all(gridId) as Array<{ id: number }>
    expect(names.map(n => n.id)).toEqual([columnIds[1]])
    expect((testDb.db.prepare('SELECT display_name FROM rows WHERE id = ?').get(rowIds[0]) as { display_name: string }).display_name).toBe('Jane Doe')
  })

  it('refuses a column that cannot name records', async () => {
    const { columnIds } = seedGrid(testDb.db, { columnCount: 2, rowCount: 0, columnTypes: ['text', 'checkbox'] })
    const res = await invoke(IPC.COLUMN_SET_NAME, columnIds[1]) as { ok: false; error: string }
    expect(res.ok).toBe(false)
  })
})

// ── COLUMN_REORDER ───────────────────────────────────────────────────────────

describe('COLUMN_REORDER', () => {
  it('reorders columns by position', async () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnCount: 3 })
    const reversed = [...columnIds].reverse()
    const result = await invoke(IPC.COLUMN_REORDER, gridId, reversed) as { ok: boolean }
    expect(result.ok).toBe(true)

    const first = testDb.db.prepare('SELECT position FROM columns WHERE id = ?').get(reversed[0]) as { position: number }
    expect(first.position).toBe(0)
  })

  it('gives hidden columns their own place, so no two columns share a position (bug sweep S3)', async () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnCount: 4 })
    const [a, b, hidden, d] = columnIds as [number, number, number, number]
    testDb.db.prepare('UPDATE columns SET is_visible = 0 WHERE id = ?').run(hidden)
    // The table sends only what it shows: D moved to the front
    expect((await invoke(IPC.COLUMN_REORDER, gridId, [d, a, b]) as { ok: boolean }).ok).toBe(true)
    const order = testDb.db.prepare('SELECT id, position FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Array<{ id: number; position: number }>
    expect(order.map(o => o.position)).toEqual([0, 1, 2, 3])
    expect(order.map(o => o.id)).toEqual([d, a, hidden, b])
  })

  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.COLUMN_REORDER, -1, [1, 2]) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects non-array', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.COLUMN_REORDER, gridId, 'not-array') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects > 500 entries', async () => {
    const { gridId } = seedGrid(testDb.db)
    const ids = Array.from({ length: 501 }, (_, i) => i + 1)
    const result = await invoke(IPC.COLUMN_REORDER, gridId, ids) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

// ── SORT_UPDATE ──────────────────────────────────────────────────────────────

describe('SORT_UPDATE', () => {
  it('sets sort config as JSON', async () => {
    const { gridId, columnIds } = seedGrid(testDb.db)
    const sortConfig = [{ columnId: columnIds[0], direction: 'asc' }]
    const result = await invoke(IPC.SORT_UPDATE, gridId, sortConfig) as { ok: boolean }
    expect(result.ok).toBe(true)

    const grid = testDb.db.prepare('SELECT sort_config FROM grids WHERE id = ?').get(gridId) as { sort_config: string }
    expect(JSON.parse(grid.sort_config)).toEqual(sortConfig)
  })

  it('accepts null sort config', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.SORT_UPDATE, gridId, null) as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.SORT_UPDATE, -1, []) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects non-array, non-null sort config', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.SORT_UPDATE, gridId, 'invalid') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects sort config with invalid direction', async () => {
    const { gridId, columnIds } = seedGrid(testDb.db)
    const result = await invoke(IPC.SORT_UPDATE, gridId, [{ columnId: columnIds[0], direction: 'up' }]) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects sort config with invalid columnId', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.SORT_UPDATE, gridId, [{ columnId: -1, direction: 'asc' }]) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects sort config item that is not an object', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.SORT_UPDATE, gridId, ['not-an-object']) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('accepts multi-column sort', async () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnCount: 3 })
    const sortConfig = [
      { columnId: columnIds[0], direction: 'asc' },
      { columnId: columnIds[1], direction: 'desc' },
    ]
    const result = await invoke(IPC.SORT_UPDATE, gridId, sortConfig) as { ok: boolean }
    expect(result.ok).toBe(true)
  })
})

// ── Handler registration check ───────────────────────────────────────────────

describe('Handler registration', () => {
  it('all GRID_*, COLUMN_*, SORT_* channels are registered', () => {
    const expectedChannels = [
      IPC.GRID_GET_ALL, IPC.GRID_GET, IPC.GRID_GET_FULL,
      IPC.GRID_CREATE, IPC.GRID_UPDATE, IPC.GRID_DELETE, IPC.GRID_REORDER,
      IPC.COLUMN_CREATE, IPC.COLUMN_UPDATE, IPC.COLUMN_DELETE, IPC.COLUMN_REORDER,
      IPC.COLUMN_BATCH_UPDATE_VISIBILITY, IPC.COLUMN_BATCH_UPDATE_WIDTHS,
      IPC.SORT_UPDATE,
    ]
    for (const ch of expectedChannels) {
      expect(handlers.has(ch), `Handler missing for ${ch}`).toBe(true)
    }
  })
})
