/**
 * IPC Saved Filter handler tests — tests SAVED_FILTER_* IPC handlers.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture map ──────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-filters') },
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
  const { registerSavedFilterHandlers } = await import('../src/main/ipc/ipc-saved-filters')
  registerSavedFilterHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
})

afterEach(() => { cleanupTestDb(testDb) })

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IPC Saved Filters — SAVED_FILTER_GET_ALL', () => {
  it('returns empty array when no filters exist', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.SAVED_FILTER_GET_ALL, gridId) as any
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([])
  })

  it('returns filters for a specific grid', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    testDb.db.prepare('INSERT INTO saved_filters (grid_id, name, filter_config) VALUES (?, ?, ?)').run(gridId, 'Active Only', '{"type":"active"}')
    testDb.db.prepare('INSERT INTO saved_filters (grid_id, name, filter_config) VALUES (?, ?, ?)').run(gridId, 'Overdue', '{"type":"overdue"}')
    const result = await invoke(IPC.SAVED_FILTER_GET_ALL, gridId) as any
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(2)
  })

  it('does not return filters from other grids', async () => {
    const grid1 = seedGrid(testDb.db, { name: 'Grid1', rowCount: 0, columnCount: 1 })
    const grid2 = seedGrid(testDb.db, { name: 'Grid2', rowCount: 0, columnCount: 1 })
    testDb.db.prepare('INSERT INTO saved_filters (grid_id, name, filter_config) VALUES (?, ?, ?)').run(grid1.gridId, 'Filter A', '{}')
    testDb.db.prepare('INSERT INTO saved_filters (grid_id, name, filter_config) VALUES (?, ?, ?)').run(grid2.gridId, 'Filter B', '{}')
    const result = await invoke(IPC.SAVED_FILTER_GET_ALL, grid1.gridId) as any
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].name).toBe('Filter A')
  })

  it('returns filters sorted by name', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    testDb.db.prepare('INSERT INTO saved_filters (grid_id, name, filter_config) VALUES (?, ?, ?)').run(gridId, 'Zebra', '{}')
    testDb.db.prepare('INSERT INTO saved_filters (grid_id, name, filter_config) VALUES (?, ?, ?)').run(gridId, 'Apple', '{}')
    const result = await invoke(IPC.SAVED_FILTER_GET_ALL, gridId) as any
    expect(result.ok).toBe(true)
    expect(result.data[0].name).toBe('Apple')
    expect(result.data[1].name).toBe('Zebra')
  })

  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.SAVED_FILTER_GET_ALL, -1) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Invalid ID/i)
  })
})

describe('IPC Saved Filters — SAVED_FILTER_CREATE', () => {
  it('creates a saved filter', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.SAVED_FILTER_CREATE, gridId, 'My Filter', '{"column":"status","op":"eq","value":"active"}') as any
    expect(result.ok).toBe(true)
    expect(typeof result.data).toBe('number')

    const filter = testDb.db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(result.data) as any
    expect(filter.name).toBe('My Filter')
    expect(filter.grid_id).toBe(gridId)
  })

  it('enforces maximum of 20 filters per grid', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    for (let i = 0; i < 20; i++) {
      testDb.db.prepare('INSERT INTO saved_filters (grid_id, name, filter_config) VALUES (?, ?, ?)').run(gridId, `Filter ${i}`, '{}')
    }
    const result = await invoke(IPC.SAVED_FILTER_CREATE, gridId, 'One Too Many', '{}') as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Maximum.*20/i)
  })

  it('rejects empty filter name', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.SAVED_FILTER_CREATE, gridId, '', '{}') as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Invalid filter name/i)
  })

  it('rejects whitespace-only filter name', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.SAVED_FILTER_CREATE, gridId, '   ', '{}') as any
    expect(result.ok).toBe(false)
  })

  it('rejects filter name over 200 chars', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.SAVED_FILTER_CREATE, gridId, 'x'.repeat(201), '{}') as any
    expect(result.ok).toBe(false)
  })

  it('rejects definition over 50KB', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.SAVED_FILTER_CREATE, gridId, 'Big Filter', 'x'.repeat(50_001)) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/too large/i)
  })

  it('rejects non-string name', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.SAVED_FILTER_CREATE, gridId, 123, '{}') as any
    expect(result.ok).toBe(false)
  })

  it('rejects non-string definition', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const result = await invoke(IPC.SAVED_FILTER_CREATE, gridId, 'Filter', { bad: true }) as any
    expect(result.ok).toBe(false)
  })

  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.SAVED_FILTER_CREATE, 0, 'Filter', '{}') as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Saved Filters — SAVED_FILTER_DELETE', () => {
  it('deletes a saved filter', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 1 })
    const createResult = await invoke(IPC.SAVED_FILTER_CREATE, gridId, 'Temp', '{}') as any
    const filterId = createResult.data

    const result = await invoke(IPC.SAVED_FILTER_DELETE, filterId) as any
    expect(result.ok).toBe(true)
    const check = testDb.db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(filterId)
    expect(check).toBeUndefined()
  })

  it('succeeds even if filter does not exist (idempotent)', async () => {
    const result = await invoke(IPC.SAVED_FILTER_DELETE, 999999) as any
    expect(result.ok).toBe(true)
  })

  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.SAVED_FILTER_DELETE, -1) as any
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Invalid ID/i)
  })

  it('rejects non-integer ID', async () => {
    const result = await invoke(IPC.SAVED_FILTER_DELETE, 'abc') as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Saved Filters — handler registration', () => {
  it('registers all 3 saved filter channels', () => {
    expect(handlers.has(IPC.SAVED_FILTER_GET_ALL)).toBe(true)
    expect(handlers.has(IPC.SAVED_FILTER_CREATE)).toBe(true)
    expect(handlers.has(IPC.SAVED_FILTER_DELETE)).toBe(true)
  })
})
