/**
 * IPC Row handler tests — tests ROW_* IPC handlers.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture map ──────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-row') },
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {},
    exit: () => {},
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
    on: () => {},
  },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '' },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

let testDb: TestDb

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    openDatabase: () => {},
    closeDatabase: () => {},
    cachedStmt: (key: string, sql: string) => testDb.db.prepare(sql),
    getRow: (gridId: number, rowId: number) => {
      const cols = testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Array<{ id: number }>
      if (cols.length === 0) return null
      const query = actual.buildGridQuery(cols.map(c => c.id), true)
      const rows = testDb.db.prepare(query).all(gridId) as Record<string, unknown>[]
      // buildGridQuery aliases r.id as row_id
      return rows.find(r => r.row_id === rowId) ?? null
    },
  }
})

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`)
  return await handler(fakeEvent, ...args)
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerRowHandlers } = await import('../src/main/ipc/ipc-row')
  registerRowHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
})

afterEach(() => { cleanupTestDb(testDb) })

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IPC Row — ROW_CREATE', () => {
  it('creates a new row in a grid', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 2 })
    const result = await invoke(IPC.ROW_CREATE, gridId) as any
    expect(result.ok).toBe(true)
    expect(typeof result.data).toBe('number')
    const row = testDb.db.prepare('SELECT * FROM rows WHERE id = ?').get(result.data) as any
    expect(row.grid_id).toBe(gridId)
    expect(row.position).toBe(0)
  })

  it('appends new row after existing rows', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 3, columnCount: 1 })
    const result = await invoke(IPC.ROW_CREATE, gridId) as any
    expect(result.ok).toBe(true)
    const row = testDb.db.prepare('SELECT position FROM rows WHERE id = ?').get(result.data) as any
    expect(row.position).toBe(3)
  })

  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.ROW_CREATE, -1) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Invalid ID/i)
  })

  it('rejects non-integer grid ID', async () => {
    const result = await invoke(IPC.ROW_CREATE, 'abc') as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_GET', () => {
  it('returns a row with cell data', async () => {
    const { gridId, rowIds, columnIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 2 })
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(rowIds[0], columnIds[0], 'Hello')
    const result = await invoke(IPC.ROW_GET, gridId, rowIds[0]) as any
    expect(result.ok).toBe(true)
    expect(result.data).toBeDefined()
    // buildGridQuery aliases r.id as row_id
    expect(result.data.row_id).toBe(rowIds[0])
  })

  it('returns fail for non-existent row', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.ROW_GET, gridId, 999999) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('rejects invalid IDs', async () => {
    const result = await invoke(IPC.ROW_GET, -1, -1) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_DELETE (soft delete)', () => {
  it('soft-deletes a row', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_DELETE, rowIds[0]) as any
    expect(result.ok).toBe(true)
    const row = testDb.db.prepare('SELECT is_active, deleted_at FROM rows WHERE id = ?').get(rowIds[0]) as any
    expect(row.is_active).toBe(0)
    expect(row.deleted_at).not.toBeNull()
  })

  it('creates a system log entry', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    await invoke(IPC.ROW_DELETE, rowIds[0])
    const log = testDb.db.prepare("SELECT * FROM case_log WHERE row_id = ? AND log_type = 'system'").get(rowIds[0]) as any
    expect(log).toBeDefined()
    expect(log.content).toMatch(/trash/i)
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.ROW_DELETE, 0) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_HARD_DELETE', () => {
  it('hard-deletes a recently-created row', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const createResult = await invoke(IPC.ROW_CREATE, gridId) as any
    const rowId = createResult.data
    const result = await invoke(IPC.ROW_HARD_DELETE, rowId) as any
    expect(result.ok).toBe(true)
    const row = testDb.db.prepare('SELECT * FROM rows WHERE id = ?').get(rowId) as any
    expect(row).toBeUndefined()
  })

  it('rejects hard-delete of old rows', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    // Backdate the created_at
    testDb.db.prepare("UPDATE rows SET created_at = datetime('now', '-2 minutes') WHERE id = ?").run(rowIds[0])
    const result = await invoke(IPC.ROW_HARD_DELETE, rowIds[0]) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/recently-created/i)
  })

  it('rejects non-existent row', async () => {
    const result = await invoke(IPC.ROW_HARD_DELETE, 999999) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.ROW_HARD_DELETE, -1) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_RESTORE_DELETED', () => {
  it('restores a soft-deleted row', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    await invoke(IPC.ROW_DELETE, rowIds[0])
    const result = await invoke(IPC.ROW_RESTORE_DELETED, rowIds[0]) as any
    expect(result.ok).toBe(true)
    const row = testDb.db.prepare('SELECT is_active, deleted_at FROM rows WHERE id = ?').get(rowIds[0]) as any
    expect(row.is_active).toBe(1)
    expect(row.deleted_at).toBeNull()
  })

  it('brings an archived record back archived, not active', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    await invoke(IPC.ROW_ARCHIVE, rowIds[0], 'Case closed')
    await invoke(IPC.ROW_DELETE, rowIds[0])
    await invoke(IPC.ROW_RESTORE_DELETED, rowIds[0])
    const row = testDb.db.prepare('SELECT is_active, deleted_at, archived_at FROM rows WHERE id = ?').get(rowIds[0]) as any
    expect(row.is_active).toBe(0)
    expect(row.deleted_at).toBeNull()
    expect(row.archived_at).not.toBeNull()
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.ROW_RESTORE_DELETED, 0) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_PURGE', () => {
  it('permanently deletes a soft-deleted row', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    await invoke(IPC.ROW_DELETE, rowIds[0])
    const result = await invoke(IPC.ROW_PURGE, rowIds[0]) as any
    expect(result.ok).toBe(true)
    const row = testDb.db.prepare('SELECT * FROM rows WHERE id = ?').get(rowIds[0])
    expect(row).toBeUndefined()
  })

  it('does nothing for non-deleted rows (no deleted_at)', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_PURGE, rowIds[0]) as any
    expect(result.ok).toBe(true)
    // Row should still exist
    const row = testDb.db.prepare('SELECT * FROM rows WHERE id = ?').get(rowIds[0])
    expect(row).toBeDefined()
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.ROW_PURGE, -1) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_GET_DELETED', () => {
  it('returns empty array when no deleted rows', async () => {
    const result = await invoke(IPC.ROW_GET_DELETED) as any
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })

  it('returns soft-deleted rows', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 2, columnCount: 1 })
    await invoke(IPC.ROW_DELETE, rowIds[0])
    const result = await invoke(IPC.ROW_GET_DELETED) as any
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].id).toBe(rowIds[0])
    expect(result.data[0]).toHaveProperty('grid_name')
  })
})

describe('IPC Row — ROW_ARCHIVE / ROW_UNARCHIVE', () => {
  it('archives a row with reason', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_ARCHIVE, rowIds[0], 'Case closed') as any
    expect(result.ok).toBe(true)
    const row = testDb.db.prepare('SELECT is_active, archived_at, archived_reason FROM rows WHERE id = ?').get(rowIds[0]) as any
    expect(row.is_active).toBe(0)
    expect(row.archived_at).not.toBeNull()
    expect(row.archived_reason).toBe('Case closed')
  })

  it('archives without reason', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_ARCHIVE, rowIds[0]) as any
    expect(result.ok).toBe(true)
  })

  it('rejects reason over 1000 chars', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_ARCHIVE, rowIds[0], 'x'.repeat(1001)) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Reason too long/i)
  })

  it('unarchives a row', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    await invoke(IPC.ROW_ARCHIVE, rowIds[0], 'test')
    const result = await invoke(IPC.ROW_UNARCHIVE, rowIds[0]) as any
    expect(result.ok).toBe(true)
    const row = testDb.db.prepare('SELECT is_active, archived_at, archived_reason FROM rows WHERE id = ?').get(rowIds[0]) as any
    expect(row.is_active).toBe(1)
    expect(row.archived_at).toBeNull()
    expect(row.archived_reason).toBeNull()
  })

  it('rejects invalid ID for archive', async () => {
    const result = await invoke(IPC.ROW_ARCHIVE, -1) as any
    expect(result.ok).toBe(false)
  })

  it('rejects invalid ID for unarchive', async () => {
    const result = await invoke(IPC.ROW_UNARCHIVE, 0) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_DUPLICATE', () => {
  it('duplicates a row, copying cells', async () => {
    const { gridId, rowIds, columnIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 2 })
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(rowIds[0], columnIds[1], 'test-value')
    const result = await invoke(IPC.ROW_DUPLICATE, rowIds[0]) as any
    expect(result.ok).toBe(true)
    const newRowId = result.data
    expect(typeof newRowId).toBe('number')
    expect(newRowId).not.toBe(rowIds[0])

    // Check the cell was copied (non-name column)
    const cells = testDb.db.prepare('SELECT * FROM cells WHERE row_id = ?').all(newRowId) as any[]
    const copiedCell = cells.find(c => c.column_id === columnIds[1])
    expect(copiedCell?.value).toBe('test-value')
  })

  it('copies the name column too', async () => {
    const { gridId, rowIds, columnIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 2 })
    // columnIds[0] is the name column (is_name_column=1 in seedGrid)
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(rowIds[0], columnIds[0], 'John Doe')
    const result = await invoke(IPC.ROW_DUPLICATE, rowIds[0]) as any
    expect(result.ok).toBe(true)
    const cells = testDb.db.prepare('SELECT * FROM cells WHERE row_id = ? AND column_id = ?').all(result.data, columnIds[0]) as any[]
    expect(cells).toHaveLength(1)
    expect(cells[0].value).toBe('John Doe')
  })

  it('returns fail for non-existent row', async () => {
    const result = await invoke(IPC.ROW_DUPLICATE, 999999) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.ROW_DUPLICATE, -1) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_MOVE_TO_GRID', () => {
  it('moves a row to another grid', async () => {
    const src = seedGrid(testDb.db, { name: 'Source', rowCount: 1, columnCount: 2 })
    const tgt = seedGrid(testDb.db, { name: 'Target', rowCount: 0, columnCount: 2 })
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(src.rowIds[0], src.columnIds[0], 'Alice')

    const result = await invoke(IPC.ROW_MOVE_TO_GRID, src.rowIds[0], tgt.gridId) as any
    expect(result.ok).toBe(true)
    expect(result.data).toBe(src.rowIds[0]) // Same row ID preserved

    const row = testDb.db.prepare('SELECT grid_id FROM rows WHERE id = ?').get(src.rowIds[0]) as any
    expect(row.grid_id).toBe(tgt.gridId)
  })

  it('parks values for columns the target lacks and brings them back on a move back (G-18)', async () => {
    const src = seedGrid(testDb.db, { name: 'Waitlist', rowCount: 1, columnCount: 2 })
    const tgt = seedGrid(testDb.db, { name: 'Active', rowCount: 0, columnCount: 1 })
    testDb.db.prepare("UPDATE columns SET name = 'Name' WHERE id IN (?, ?)").run(src.columnIds[0], tgt.columnIds[0])
    testDb.db.prepare("UPDATE columns SET name = 'Gate code' WHERE id = ?").run(src.columnIds[1])
    const rowId = src.rowIds[0]!
    const put = testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
    put.run(rowId, src.columnIds[0], 'Alice')
    const gate = Number(put.run(rowId, src.columnIds[1], '4321').lastInsertRowid)
    testDb.db.prepare("INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, '1111', '4321', '2026-01-02 10:00:00')").run(gate, rowId, src.columnIds[1])

    await invoke(IPC.ROW_MOVE_TO_GRID, rowId, tgt.gridId)
    expect(testDb.db.prepare('SELECT COUNT(*) AS n FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, src.columnIds[1])).toEqual({ n: 0 })
    expect(testDb.db.prepare('SELECT value FROM parked_cells WHERE row_id = ?').get(rowId)).toEqual({ value: '4321' })

    await invoke(IPC.ROW_MOVE_TO_GRID, rowId, src.gridId)
    expect(testDb.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, src.columnIds[1])).toEqual({ value: '4321' })
    expect(testDb.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, src.columnIds[0])).toEqual({ value: 'Alice' })
    expect(testDb.db.prepare('SELECT old_value, new_value, changed_at FROM cell_history WHERE row_id = ? AND column_id = ?').all(rowId, src.columnIds[1]))
      .toEqual([{ old_value: '1111', new_value: '4321', changed_at: '2026-01-02 10:00:00' }])
    expect(testDb.db.prepare('SELECT COUNT(*) AS n FROM parked_cells').get()).toEqual({ n: 0 })
  })

  it('returns same rowId when moving to same grid', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_MOVE_TO_GRID, rowIds[0], gridId) as any
    expect(result.ok).toBe(true)
    expect(result.data).toBe(rowIds[0])
  })

  it('rejects non-existent row', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.ROW_MOVE_TO_GRID, 999999, gridId) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('rejects invalid IDs', async () => {
    const result = await invoke(IPC.ROW_MOVE_TO_GRID, -1, -1) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_COPY_TO_GRID', () => {
  it('copies a row to another grid (source row preserved)', async () => {
    const src = seedGrid(testDb.db, { name: 'Source', rowCount: 1, columnCount: 2 })
    const tgt = seedGrid(testDb.db, { name: 'Target', rowCount: 0, columnCount: 2 })
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(src.rowIds[0], src.columnIds[0], 'Bob')

    const result = await invoke(IPC.ROW_COPY_TO_GRID, src.rowIds[0], tgt.gridId) as any
    expect(result.ok).toBe(true)
    const newRowId = result.data
    expect(newRowId).not.toBe(src.rowIds[0])

    // Source row still exists in source grid
    const srcRow = testDb.db.prepare('SELECT grid_id FROM rows WHERE id = ?').get(src.rowIds[0]) as any
    expect(srcRow.grid_id).toBe(src.gridId)

    // New row exists in target grid
    const tgtRow = testDb.db.prepare('SELECT grid_id FROM rows WHERE id = ?').get(newRowId) as any
    expect(tgtRow.grid_id).toBe(tgt.gridId)
  })

  it('rejects non-existent row', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.ROW_COPY_TO_GRID, 999999, gridId) as any
    expect(result.ok).toBe(false)
  })

  it('rejects invalid IDs', async () => {
    const result = await invoke(IPC.ROW_COPY_TO_GRID, 0, 0) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_REORDER', () => {
  it('reorders rows in a grid', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 3, columnCount: 1 })
    // Reverse order
    const reversed = [...rowIds].reverse()
    const result = await invoke(IPC.ROW_REORDER, gridId, reversed) as any
    expect(result.ok).toBe(true)

    const rows = testDb.db.prepare('SELECT id, position FROM rows WHERE grid_id = ? ORDER BY position').all(gridId) as any[]
    expect(rows[0].id).toBe(reversed[0])
    expect(rows[1].id).toBe(reversed[1])
    expect(rows[2].id).toBe(reversed[2])
  })

  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.ROW_REORDER, -1, [1, 2, 3]) as any
    expect(result.ok).toBe(false)
  })

  it('rejects non-array', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_REORDER, gridId, 'not-array') as any
    expect(result.ok).toBe(false)
  })

  it('rejects too many IDs (>5000)', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const bigArray = Array.from({ length: 5001 }, (_, i) => i + 1)
    const result = await invoke(IPC.ROW_REORDER, gridId, bigArray) as any
    expect(result.ok).toBe(false)
  })

  it('rejects non-integer IDs in array', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_REORDER, gridId, [1, 'abc', 3]) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_UPDATE', () => {
  it('updates star status', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_UPDATE, rowIds[0], { is_starred: 1 }) as any
    expect(result.ok).toBe(true)
    const row = testDb.db.prepare('SELECT is_starred FROM rows WHERE id = ?').get(rowIds[0]) as any
    expect(row.is_starred).toBe(1)
  })

  it('rejects empty updates', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_UPDATE, rowIds[0], { bogus_field: 42 }) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/No valid fields/i)
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.ROW_UPDATE, -1, { is_starred: 1 }) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_BULK_ACTION', () => {
  it('bulk archives rows', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 3, columnCount: 1 })
    const result = await invoke(IPC.ROW_BULK_ACTION, 'archive', [rowIds[0], rowIds[1]]) as any
    expect(result.ok).toBe(true)
    expect(result.data).toBe(2)
    const archived = testDb.db.prepare('SELECT COUNT(*) as cnt FROM rows WHERE is_active = 0 AND archived_at IS NOT NULL').get() as any
    expect(archived.cnt).toBe(2)
  })

  it('bulk unarchives rows', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 2, columnCount: 1 })
    await invoke(IPC.ROW_BULK_ACTION, 'archive', rowIds)
    const result = await invoke(IPC.ROW_BULK_ACTION, 'unarchive', rowIds) as any
    expect(result.ok).toBe(true)
    const active = testDb.db.prepare('SELECT COUNT(*) as cnt FROM rows WHERE is_active = 1').get() as any
    expect(active.cnt).toBe(2)
  })

  it('bulk deletes (soft-delete) rows', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 2, columnCount: 1 })
    const result = await invoke(IPC.ROW_BULK_ACTION, 'delete', rowIds) as any
    expect(result.ok).toBe(true)
    const deleted = testDb.db.prepare('SELECT COUNT(*) as cnt FROM rows WHERE deleted_at IS NOT NULL').get() as any
    expect(deleted.cnt).toBe(2)
  })

  it('bulk restores trashed rows, keeping archived ones archived (undo of G-34)', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 3, columnCount: 1 })
    await invoke(IPC.ROW_BULK_ACTION, 'archive', [rowIds[0]])
    await invoke(IPC.ROW_BULK_ACTION, 'delete', [rowIds[0], rowIds[1]])
    const result = await invoke(IPC.ROW_BULK_ACTION, 'restore', [rowIds[0], rowIds[1], rowIds[2]]) as any
    expect(result.ok).toBe(true)
    const rows = testDb.db.prepare('SELECT id, is_active, deleted_at FROM rows ORDER BY id').all() as Array<{ id: number; is_active: number; deleted_at: string | null }>
    expect(rows.map(r => [r.is_active, r.deleted_at])).toEqual([[0, null], [1, null], [1, null]])
    // Only the two that were in the trash get a "restored" note
    const logs = testDb.db.prepare("SELECT COUNT(*) AS n FROM case_log WHERE content LIKE '%restored from trash'").get() as { n: number }
    expect(logs.n).toBe(2)
  })

  it('rejects invalid action', async () => {
    const result = await invoke(IPC.ROW_BULK_ACTION, 'nuke', [1]) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Invalid bulk action/i)
  })

  it('rejects empty array', async () => {
    const result = await invoke(IPC.ROW_BULK_ACTION, 'archive', []) as any
    expect(result.ok).toBe(false)
  })

  it('rejects too many rows (>1000)', async () => {
    const bigArray = Array.from({ length: 1001 }, (_, i) => i + 1)
    const result = await invoke(IPC.ROW_BULK_ACTION, 'archive', bigArray) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/limited to/i)
  })

  it('rejects non-integer IDs', async () => {
    const result = await invoke(IPC.ROW_BULK_ACTION, 'archive', [1, 'abc', 3]) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Invalid row IDs/i)
  })

  it('rejects negative IDs', async () => {
    const result = await invoke(IPC.ROW_BULK_ACTION, 'archive', [-1, 2]) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_GET_MANUAL_CONTACTS', () => {
  it('returns empty array when no manual contacts', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_GET_MANUAL_CONTACTS, rowIds[0]) as any
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })

  it('returns stored contacts', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const contacts = [{ type: 'phone', label: 'Home', value: '555-1234' }]
    testDb.db.prepare('UPDATE rows SET manual_contacts = ? WHERE id = ?').run(JSON.stringify(contacts), rowIds[0])
    const result = await invoke(IPC.ROW_GET_MANUAL_CONTACTS, rowIds[0]) as any
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].value).toBe('555-1234')
  })

  it('returns fail for non-existent row', async () => {
    const result = await invoke(IPC.ROW_GET_MANUAL_CONTACTS, 999999) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('returns empty array for corrupted JSON', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    testDb.db.prepare('UPDATE rows SET manual_contacts = ? WHERE id = ?').run('not-json', rowIds[0])
    const result = await invoke(IPC.ROW_GET_MANUAL_CONTACTS, rowIds[0]) as any
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.ROW_GET_MANUAL_CONTACTS, -1) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — ROW_SET_MANUAL_CONTACTS', () => {
  it('sets manual contacts', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const contacts = [{ type: 'email', label: 'Work', value: 'a@b.com' }]
    const result = await invoke(IPC.ROW_SET_MANUAL_CONTACTS, rowIds[0], contacts) as any
    expect(result.ok).toBe(true)
    const row = testDb.db.prepare('SELECT manual_contacts FROM rows WHERE id = ?').get(rowIds[0]) as any
    expect(JSON.parse(row.manual_contacts)).toEqual(contacts)
  })

  it('rejects more than 50 contacts', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const contacts = Array.from({ length: 51 }, (_, i) => ({ type: 'phone', label: `L${i}`, value: '123' }))
    const result = await invoke(IPC.ROW_SET_MANUAL_CONTACTS, rowIds[0], contacts) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/at most 50/i)
  })

  it('rejects contacts with missing fields', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_SET_MANUAL_CONTACTS, rowIds[0], [{ type: 'phone' }]) as any
    expect(result.ok).toBe(false)
  })

  it('rejects contacts with fields exceeding max lengths', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.ROW_SET_MANUAL_CONTACTS, rowIds[0], [{ type: 'x'.repeat(51), label: 'ok', value: 'ok' }]) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/exceed maximum/i)
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.ROW_SET_MANUAL_CONTACTS, 0, []) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Row — SEARCH_CLIENTS_CROSS_GRID', () => {
  it('returns empty for search under 2 chars', async () => {
    const result = await invoke(IPC.SEARCH_CLIENTS_CROSS_GRID, 'a') as any
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })

  it('supports offset parameter', async () => {
    const result = await invoke(IPC.SEARCH_CLIENTS_CROSS_GRID, 'test', 0) as any
    expect(result.ok).toBe(true)
  })

  it('returns empty for non-string search', async () => {
    const result = await invoke(IPC.SEARCH_CLIENTS_CROSS_GRID, 123) as any
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })

  // The ESCAPE clause used to reach SQL as ESCAPE '' (the template literal ate the backslash), so every search failed
  it('finds records by name, including a literal %', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 2, columnCount: 1 })
    testDb.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run('Alice Johnson', rowIds[0])
    testDb.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run('100% Alice', rowIds[1])
    const result = await invoke(IPC.SEARCH_CLIENTS_CROSS_GRID, 'Alice') as any
    expect(result.ok).toBe(true)
    expect(result.data.map((r: { rowId: number }) => r.rowId).sort()).toEqual([rowIds[0], rowIds[1]].sort())
    expect(result.data[0].gridId).toBe(gridId)
    const pct = await invoke(IPC.SEARCH_CLIENTS_CROSS_GRID, '0% A') as any
    expect(pct.data.map((r: { rowId: number }) => r.rowId)).toEqual([rowIds[1]])
  })

  it('leaves out archived records and records in a deleted list (L-13)', async () => {
    const a = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const b = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    testDb.db.prepare('UPDATE rows SET display_name = ?, is_active = 0 WHERE id = ?').run('Bob Inactive', a.rowIds[0])
    testDb.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run('Bob Gone', b.rowIds[0])
    testDb.db.prepare('UPDATE grids SET is_active = 0 WHERE id = ?').run(b.gridId)
    const result = await invoke(IPC.SEARCH_CLIENTS_CROSS_GRID, 'Bob') as any
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(0)
  })
})

describe('IPC Row — ROW_PURGE_ALL', () => {
  it('empties the Trash in one call and leaves everything else (X-38)', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 3, columnCount: 1 })
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id IN (?, ?)").run(rowIds[0], rowIds[1])
    const result = await invoke(IPC.ROW_PURGE_ALL) as any
    expect(result).toEqual({ ok: true, data: 2 })
    expect(testDb.db.prepare('SELECT id FROM rows').all()).toEqual([{ id: rowIds[2] }])
  })
})

describe('IPC Row — handler registration', () => {
  it('registers all row channels', () => {
    const channels = [
      IPC.ROW_CREATE, IPC.ROW_GET, IPC.ROW_DELETE, IPC.ROW_HARD_DELETE,
      IPC.ROW_RESTORE_DELETED, IPC.ROW_PURGE, IPC.ROW_GET_DELETED,
      IPC.ROW_ARCHIVE, IPC.ROW_UNARCHIVE, IPC.ROW_DUPLICATE,
      IPC.ROW_MOVE_TO_GRID, IPC.ROW_COPY_TO_GRID, IPC.ROW_REORDER,
      IPC.ROW_UPDATE, IPC.ROW_BULK_ACTION,
      IPC.ROW_GET_MANUAL_CONTACTS, IPC.ROW_SET_MANUAL_CONTACTS,
      IPC.SEARCH_CLIENTS_CROSS_GRID,
    ]
    for (const ch of channels) {
      expect(handlers.has(ch), `Handler for ${ch} should be registered`).toBe(true)
    }
  })
})
