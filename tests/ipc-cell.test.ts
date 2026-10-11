/**
 * IPC Cell Handler Tests — tests all CELL_*, CELL_FORMAT_* handlers.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-cell') },
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
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: undefined }) },
  shell: { openPath: async () => '', openExternal: async () => {} },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

vi.mock('../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))

vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return { default: class { get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d } set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'object') { for (const [key, val] of Object.entries(k)) map.set(key, val) } else { map.set(k, v) } } has(k: string) { return map.has(k) } delete(k: string) { map.delete(k) } clear() { map.clear() } } }
})

let testDb: TestDb

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    cachedStmt: (key: string, sql: string) => testDb.db.prepare(sql),
    upsertCell: (rowId: number, columnId: number, value: string | null) => {
      testDb.db.prepare(`INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(rowId, columnId, value)
    },
  }
})

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

let gridId: number
let rowId: number
let columnId: number

beforeAll(async () => {
  testDb = createTestDb()
  const { registerCellHandlers } = await import('../src/main/ipc/ipc-cell')
  registerCellHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
  const seed = seedGrid(testDb.db, { rowCount: 2, columnCount: 3 })
  gridId = seed.gridId
  rowId = seed.rowIds[0]
  columnId = seed.columnIds[0]
})

afterEach(() => { cleanupTestDb(testDb) })

describe('CELL_UPDATE', () => {
  it('updates a cell value', async () => {
    const r = await invoke(IPC.CELL_UPDATE, rowId, columnId, 'Hello') as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveProperty('sysLogId')
  })

  it('sets null value (clear cell)', async () => {
    await invoke(IPC.CELL_UPDATE, rowId, columnId, 'Hello')
    const r = await invoke(IPC.CELL_UPDATE, rowId, columnId, null) as any
    expect(r.ok).toBe(true)
  })

  it('strips null bytes from value', async () => {
    const r = await invoke(IPC.CELL_UPDATE, rowId, columnId, 'Hello\0World') as any
    expect(r.ok).toBe(true)
    // Verify the stored value has no null bytes
    const cell = testDb.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, columnId) as any
    expect(cell.value).toBe('HelloWorld')
  })

  it('records cell history on update', async () => {
    await invoke(IPC.CELL_UPDATE, rowId, columnId, 'First')
    await invoke(IPC.CELL_UPDATE, rowId, columnId, 'Second')
    const history = (await invoke(IPC.CELL_GET_HISTORY, rowId, columnId) as any).data
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(history[0].old_value).toBe('First')
    expect(history[0].new_value).toBe('Second')
  })

  it('creates system log when column has log_changes enabled', async () => {
    // Enable log_changes on the column
    testDb.db.prepare("UPDATE columns SET config = ? WHERE id = ?").run(JSON.stringify({ log_changes: true }), columnId)
    // Invalidate the column metadata cache so getColMeta picks up the new config
    const { invalidateColumnCache } = await import('../src/main/ipc/ipc-cell')
    invalidateColumnCache(columnId)
    const r = await invoke(IPC.CELL_UPDATE, rowId, columnId, 'Logged value') as any
    expect(r.ok).toBe(true)
    expect(r.data.sysLogId).toBeTypeOf('number')
  })

  it('logs a cleared date as cleared, and a Mark done as a tagged completion (G-16, L-22)', async () => {
    testDb.db.prepare("UPDATE columns SET name = 'Review', column_type = 'date', config = ? WHERE id = ?").run(JSON.stringify({ log_changes: true }), columnId)
    const { invalidateColumnCache } = await import('../src/main/ipc/ipc-cell')
    invalidateColumnCache(columnId)
    await invoke(IPC.CELL_UPDATE, rowId, columnId, '2026-10-06')
    await invoke(IPC.CELL_UPDATE, rowId, columnId, null)
    const last = () => testDb.db.prepare('SELECT content, source_action_id FROM case_log WHERE row_id = ? ORDER BY id DESC LIMIT 1').get(rowId) as { content: string; source_action_id: string | null }
    expect(last()).toEqual({ content: 'Review cleared (was Oct 6, 2026)', source_action_id: null })
    await invoke(IPC.CELL_UPDATE, rowId, columnId, '2026-10-06')
    const r = await invoke(IPC.CELL_UPDATE, rowId, columnId, null, { doneNote: 'Review completed (was Oct 6, 2026)' })
    expect(r.data.sysLogId).toBeTypeOf('number')
    expect(last()).toEqual({ content: 'Review completed (was Oct 6, 2026)', source_action_id: `deadline_done:${columnId}` })
    // One note for the done, not a second "changed" note
    const n = testDb.db.prepare("SELECT COUNT(*) AS n FROM case_log WHERE row_id = ? AND content LIKE 'Review%'").get(rowId) as { n: number }
    expect(n.n).toBe(4)
  })

  it('fails for invalid row ID', async () => {
    const r = await invoke(IPC.CELL_UPDATE, -1, columnId, 'value') as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid column ID', async () => {
    const r = await invoke(IPC.CELL_UPDATE, rowId, 0, 'value') as any
    expect(r.ok).toBe(false)
  })

  it('fails for non-string, non-null value', async () => {
    const r = await invoke(IPC.CELL_UPDATE, rowId, columnId, 123) as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('string')
  })

  it('fails for value over 100k chars', async () => {
    const r = await invoke(IPC.CELL_UPDATE, rowId, columnId, 'x'.repeat(100_001)) as any
    expect(r.ok).toBe(false)
  })

  it('updates row timestamp', async () => {
    const before = testDb.db.prepare('SELECT updated_at FROM rows WHERE id = ?').get(rowId) as any
    await invoke(IPC.CELL_UPDATE, rowId, columnId, 'new value')
    const after = testDb.db.prepare('SELECT updated_at FROM rows WHERE id = ?').get(rowId) as any
    expect(after.updated_at).toBeTruthy()
  })
})

describe('CELL_GET_HISTORY', () => {
  it('returns empty array when no history', async () => {
    const r = await invoke(IPC.CELL_GET_HISTORY, rowId, columnId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toEqual([])
  })

  it('returns history entries after multiple updates', async () => {
    await invoke(IPC.CELL_UPDATE, rowId, columnId, 'v1')
    await invoke(IPC.CELL_UPDATE, rowId, columnId, 'v2')
    await invoke(IPC.CELL_UPDATE, rowId, columnId, 'v3')
    const r = await invoke(IPC.CELL_GET_HISTORY, rowId, columnId) as any
    expect(r.ok).toBe(true)
    expect(r.data.length).toBeGreaterThanOrEqual(2)
    // Verify history contains the transitions
    const newValues = r.data.map((h: any) => h.new_value)
    expect(newValues).toContain('v2')
    expect(newValues).toContain('v3')
  })

  it('fails for invalid IDs', async () => {
    const r = await invoke(IPC.CELL_GET_HISTORY, -1, columnId) as any
    expect(r.ok).toBe(false)
  })
})

describe('CELL_HISTORY_COMPACT', () => {
  it('deletes old history entries', async () => {
    // Insert history with old timestamps
    testDb.db.prepare(`INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, 'v', datetime('now'))`).run(rowId, columnId)
    const cellId = testDb.db.prepare('SELECT id FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, columnId) as any
    testDb.db.prepare(`INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, 'a', 'b', '2020-01-01 00:00:00')`).run(cellId.id, rowId, columnId)
    const r = await invoke(IPC.CELL_HISTORY_COMPACT, 1) as any
    expect(r.ok).toBe(true)
    expect(typeof r.data).toBe('number')
  })

  it('fails for non-integer retention', async () => {
    const r = await invoke(IPC.CELL_HISTORY_COMPACT, 1.5) as any
    expect(r.ok).toBe(false)
  })

  it('fails for zero retention', async () => {
    const r = await invoke(IPC.CELL_HISTORY_COMPACT, 0) as any
    expect(r.ok).toBe(false)
  })

  it('fails for negative retention', async () => {
    const r = await invoke(IPC.CELL_HISTORY_COMPACT, -1) as any
    expect(r.ok).toBe(false)
  })

  it('fails for non-number retention', async () => {
    const r = await invoke(IPC.CELL_HISTORY_COMPACT, 'six') as any
    expect(r.ok).toBe(false)
  })
})

describe('CELL_FORMAT_GET_FOR_GRID', () => {
  it('returns empty array for grid with no formats', async () => {
    const r = await invoke(IPC.CELL_FORMAT_GET_FOR_GRID, gridId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toEqual([])
  })

  it('fails for invalid grid ID', async () => {
    const r = await invoke(IPC.CELL_FORMAT_GET_FOR_GRID, -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('CELL_FORMAT_SET', () => {
  it('sets format rules on a cell', async () => {
    const rules = JSON.stringify([{ bold: true }])
    const r = await invoke(IPC.CELL_FORMAT_SET, rowId, columnId, rules) as any
    expect(r.ok).toBe(true)

    const formats = (await invoke(IPC.CELL_FORMAT_GET_FOR_GRID, gridId) as any).data
    expect(formats).toHaveLength(1)
    expect(formats[0].rules).toBe(rules)
  })

  it('deletes format when rules is empty array', async () => {
    const rules = JSON.stringify([{ bold: true }])
    await invoke(IPC.CELL_FORMAT_SET, rowId, columnId, rules)
    const r = await invoke(IPC.CELL_FORMAT_SET, rowId, columnId, '[]') as any
    expect(r.ok).toBe(true)

    const formats = (await invoke(IPC.CELL_FORMAT_GET_FOR_GRID, gridId) as any).data
    expect(formats).toHaveLength(0)
  })

  it('fails for invalid IDs', async () => {
    const r = await invoke(IPC.CELL_FORMAT_SET, -1, columnId, '[]') as any
    expect(r.ok).toBe(false)
  })

  it('fails for non-string rules', async () => {
    const r = await invoke(IPC.CELL_FORMAT_SET, rowId, columnId, 123) as any
    expect(r.ok).toBe(false)
  })

  it('fails for rules over 50k', async () => {
    const r = await invoke(IPC.CELL_FORMAT_SET, rowId, columnId, 'x'.repeat(50_001)) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid JSON', async () => {
    const r = await invoke(IPC.CELL_FORMAT_SET, rowId, columnId, '{bad json}') as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Invalid rules JSON')
  })
})

describe('CELL_FORMAT_BATCH_SET', () => {
  it('sets multiple formats in one call', async () => {
    const entries = [
      { rowId, columnId, rules: JSON.stringify([{ bold: true }]) },
      { rowId, columnId: columnId + 1, rules: JSON.stringify([{ italic: true }]) },
    ]
    // Need a second column in the same grid
    const seed = seedGrid(testDb.db, { rowCount: 1, columnCount: 2 })
    const r = await invoke(IPC.CELL_FORMAT_BATCH_SET, [
      { rowId: seed.rowIds[0], columnId: seed.columnIds[0], rules: JSON.stringify([{ bold: true }]) },
      { rowId: seed.rowIds[0], columnId: seed.columnIds[1], rules: JSON.stringify([{ italic: true }]) },
    ]) as any
    expect(r.ok).toBe(true)
  })

  it('deletes formats with empty rules in batch', async () => {
    await invoke(IPC.CELL_FORMAT_SET, rowId, columnId, JSON.stringify([{ bold: true }]))
    const r = await invoke(IPC.CELL_FORMAT_BATCH_SET, [
      { rowId, columnId, rules: '[]' },
    ]) as any
    expect(r.ok).toBe(true)
  })

  it('fails for non-array input', async () => {
    const r = await invoke(IPC.CELL_FORMAT_BATCH_SET, 'not-array') as any
    expect(r.ok).toBe(false)
  })

  it('fails for batch over 2000 entries', async () => {
    const entries = Array.from({ length: 2001 }, (_, i) => ({ rowId: 1, columnId: i + 1, rules: '[]' }))
    const r = await invoke(IPC.CELL_FORMAT_BATCH_SET, entries) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid ID in batch entry', async () => {
    const r = await invoke(IPC.CELL_FORMAT_BATCH_SET, [{ rowId: -1, columnId: 1, rules: '[]' }]) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid JSON in batch entry', async () => {
    const r = await invoke(IPC.CELL_FORMAT_BATCH_SET, [{ rowId, columnId, rules: '{bad}' }]) as any
    expect(r.ok).toBe(false)
  })
})

describe('CELL_UPDATE grid consistency', () => {
  it('rejects a column that belongs to a different grid than the row', async () => {
    const a = seedGrid(testDb.db, { rowCount: 1 })
    const b = seedGrid(testDb.db, { rowCount: 1 })
    const r = await invoke(IPC.CELL_UPDATE, a.rowIds[0], b.columnIds[0], 'x') as { ok: boolean; error?: string }
    expect(r.ok).toBe(false)
    const n = (testDb.db.prepare('SELECT COUNT(*) AS n FROM cells WHERE row_id = ? AND column_id = ?').get(a.rowIds[0], b.columnIds[0]) as { n: number }).n
    expect(n).toBe(0)
  })
})

describe('number history (W10 §5)', () => {
  it('keeps the first value too when the column records every change, and charts number columns only', async () => {
    const { invalidateColumnCache } = await import('../src/main/ipc/ipc-cell')
    const [, scoreCol, textCol] = (testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Array<{ id: number }>).map(c => c.id) as [number, number, number]
    testDb.db.prepare("UPDATE columns SET name = 'PHQ-9', column_type = 'number', config = '{\"log_changes\":true}' WHERE id = ?").run(scoreCol)
    invalidateColumnCache()
    for (const v of ['14', '11', 'n/a', '7']) await invoke(IPC.CELL_UPDATE, rowId, scoreCol, v)
    await invoke(IPC.CELL_UPDATE, rowId, textCol, 'first')
    await invoke(IPC.CELL_UPDATE, rowId, textCol, 'second')
    const r = await invoke(IPC.CELL_HISTORY_SERIES, rowId, [scoreCol, textCol]) as { ok: true; data: Record<number, Array<{ value: number }>> }
    expect(Object.keys(r.data)).toEqual([String(scoreCol)])
    expect(r.data[scoreCol]!.map(p => p.value)).toEqual([14, 11, 7])
    // A column without "Log changes" has no history for its first value
    expect(testDb.db.prepare('SELECT COUNT(*) AS n FROM cell_history WHERE row_id = ? AND column_id = ?').get(rowId, textCol)).toEqual({ n: 1 })
    expect((await invoke(IPC.CELL_HISTORY_SERIES, rowId, ['x']) as { ok: boolean }).ok).toBe(false)
  })
})
