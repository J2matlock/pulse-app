/**
 * IPC Acuity Handler Tests — ACUITY_* channels
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture ──────────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pulse-test-acuity',
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
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: () => {},
  },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '', openExternal: async () => {} },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  clipboard: { writeText: () => {} },
}))

vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return {
    default: class {
      get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d }
      set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'object') { for (const [key, val] of Object.entries(k)) map.set(key, val) } else { map.set(k, v) } }
      has(k: string) { return map.has(k) }
      delete(k: string) { map.delete(k) }
      clear() { map.clear() }
    },
  }
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
    checkCloudSyncPath: () => null,
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  }
})

vi.mock('../src/main/index', () => ({
  startScheduledBackup: () => {},
  stopScheduledBackup: () => {},
}))

// ── Setup ────────────────────────────────────────────────────────────────────
const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerAcuityHandlers } = await import('../src/main/ipc/ipc-acuity')
  registerAcuityHandlers()
})

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ACUITY_GET_LEVELS', () => {
  it('returns empty array for grid with no levels', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_GET_LEVELS, gridId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toEqual([])
  })

  it('returns levels ordered by position', async () => {
    const { gridId } = seedGrid(testDb.db)
    testDb.db.prepare('INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position) VALUES (?,?,?,?,?,?)').run(gridId, 'High', 'H', 10, 'red', 1)
    testDb.db.prepare('INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position) VALUES (?,?,?,?,?,?)').run(gridId, 'Low', 'L', 2, 'green', 0)
    const r = await invoke(IPC.ACUITY_GET_LEVELS, gridId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveLength(2)
    expect(r.data[0].name).toBe('Low')
    expect(r.data[1].name).toBe('High')
  })

  it('rejects invalid gridId', async () => {
    const r = await invoke(IPC.ACUITY_GET_LEVELS, -1) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Invalid/)
  })

  it('rejects non-numeric gridId', async () => {
    const r = await invoke(IPC.ACUITY_GET_LEVELS, 'abc') as any
    expect(r.ok).toBe(false)
  })
})

describe('ACUITY_CREATE_LEVEL', () => {
  it('creates a level and returns it', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'High', abbreviation: 'H', points: 10, color: 'red' }) as any
    expect(r.ok).toBe(true)
    expect(r.data.name).toBe('High')
    expect(r.data.abbreviation).toBe('H')
    expect(r.data.points).toBe(10)
    expect(r.data.position).toBe(0)
  })

  it('auto-increments position', async () => {
    const { gridId } = seedGrid(testDb.db)
    await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Low', abbreviation: 'L', points: 1, color: 'green' })
    const r = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'High', abbreviation: 'H', points: 10, color: 'red' }) as any
    expect(r.data.position).toBe(1)
  })

  it('truncates abbreviation to 4 chars', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Test', abbreviation: 'ABCDEFG', points: 5, color: 'blue' }) as any
    expect(r.ok).toBe(true)
    expect(r.data.abbreviation).toBe('ABCD')
  })

  it('rejects empty name', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: '', abbreviation: 'X', points: 1, color: 'red' }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects name over 100 chars', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'x'.repeat(101), abbreviation: 'X', points: 1, color: 'red' }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects negative points', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Bad', abbreviation: 'B', points: -5, color: 'red' }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-finite points', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Bad', abbreviation: 'B', points: Infinity, color: 'red' }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects color over 50 chars', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'X', abbreviation: 'X', points: 1, color: 'c'.repeat(51) }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-string abbreviation', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'X', abbreviation: 123, points: 1, color: 'red' }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects invalid gridId', async () => {
    const r = await invoke(IPC.ACUITY_CREATE_LEVEL, 0, { name: 'X', abbreviation: 'X', points: 1, color: 'red' }) as any
    expect(r.ok).toBe(false)
  })
})

describe('ACUITY_UPDATE_LEVEL', () => {
  it('updates name', async () => {
    const { gridId } = seedGrid(testDb.db)
    const cr = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Old', abbreviation: 'O', points: 1, color: 'red' }) as any
    const r = await invoke(IPC.ACUITY_UPDATE_LEVEL, cr.data.id, { name: 'New' }) as any
    expect(r.ok).toBe(true)
  })

  it('rejects name over 100 chars', async () => {
    const { gridId } = seedGrid(testDb.db)
    const cr = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Old', abbreviation: 'O', points: 1, color: 'red' }) as any
    const r = await invoke(IPC.ACUITY_UPDATE_LEVEL, cr.data.id, { name: 'x'.repeat(101) }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects points over 1000', async () => {
    const { gridId } = seedGrid(testDb.db)
    const cr = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'X', abbreviation: 'X', points: 1, color: 'red' }) as any
    const r = await invoke(IPC.ACUITY_UPDATE_LEVEL, cr.data.id, { points: 1001 }) as any
    expect(r.ok).toBe(false)
  })

  it('rejects abbreviation over 10 chars', async () => {
    const { gridId } = seedGrid(testDb.db)
    const cr = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'X', abbreviation: 'X', points: 1, color: 'red' }) as any
    const r = await invoke(IPC.ACUITY_UPDATE_LEVEL, cr.data.id, { abbreviation: 'a'.repeat(11) }) as any
    expect(r.ok).toBe(false)
  })

  it('returns ok for empty updates (no-op)', async () => {
    const { gridId } = seedGrid(testDb.db)
    const cr = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'X', abbreviation: 'X', points: 1, color: 'red' }) as any
    const r = await invoke(IPC.ACUITY_UPDATE_LEVEL, cr.data.id, {}) as any
    expect(r.ok).toBe(true)
  })

  it('rejects invalid levelId', async () => {
    const r = await invoke(IPC.ACUITY_UPDATE_LEVEL, -1, { name: 'X' }) as any
    expect(r.ok).toBe(false)
  })
})

describe('ACUITY_DELETE_LEVEL', () => {
  it('deletes a level and nulls rows', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db)
    const cr = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Hi', abbreviation: 'H', points: 5, color: 'red' }) as any
    testDb.db.prepare('UPDATE rows SET acuity_level_id = ? WHERE id = ?').run(cr.data.id, rowIds[0])
    const r = await invoke(IPC.ACUITY_DELETE_LEVEL, cr.data.id) as any
    expect(r.ok).toBe(true)
    const row = testDb.db.prepare('SELECT acuity_level_id FROM rows WHERE id = ?').get(rowIds[0]) as any
    expect(row.acuity_level_id).toBeNull()
    const remaining = testDb.db.prepare('SELECT * FROM acuity_levels WHERE id = ?').get(cr.data.id)
    expect(remaining).toBeUndefined()
  })

  it('rejects invalid id', async () => {
    const r = await invoke(IPC.ACUITY_DELETE_LEVEL, 0) as any
    expect(r.ok).toBe(false)
  })
})

describe('ACUITY_REORDER_LEVELS', () => {
  it('reorders levels by position', async () => {
    const { gridId } = seedGrid(testDb.db)
    const a = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'A', abbreviation: 'A', points: 1, color: 'red' }) as any
    const b = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'B', abbreviation: 'B', points: 2, color: 'blue' }) as any
    const r = await invoke(IPC.ACUITY_REORDER_LEVELS, gridId, [b.data.id, a.data.id]) as any
    expect(r.ok).toBe(true)
    const levels = await invoke(IPC.ACUITY_GET_LEVELS, gridId) as any
    expect(levels.data[0].name).toBe('B')
    expect(levels.data[1].name).toBe('A')
  })

  it('rejects non-array orderedIds', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_REORDER_LEVELS, gridId, 'not-array') as any
    expect(r.ok).toBe(false)
  })

  it('rejects array with over 100 items', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_REORDER_LEVELS, gridId, Array.from({ length: 101 }, (_, i) => i + 1)) as any
    expect(r.ok).toBe(false)
  })

  it('rejects array with non-integer ids', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_REORDER_LEVELS, gridId, [1.5, 2]) as any
    expect(r.ok).toBe(false)
  })

  it('rejects array with negative ids', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_REORDER_LEVELS, gridId, [-1, 2]) as any
    expect(r.ok).toBe(false)
  })

  it('rejects invalid gridId', async () => {
    const r = await invoke(IPC.ACUITY_REORDER_LEVELS, 0, [1, 2]) as any
    expect(r.ok).toBe(false)
  })
})

describe('ACUITY_SET_ROW_LEVEL', () => {
  it('sets a row level', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db)
    const cr = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Hi', abbreviation: 'H', points: 5, color: 'red' }) as any
    const r = await invoke(IPC.ACUITY_SET_ROW_LEVEL, rowIds[0], cr.data.id) as any
    expect(r.ok).toBe(true)
    const row = testDb.db.prepare('SELECT acuity_level_id FROM rows WHERE id = ?').get(rowIds[0]) as any
    expect(row.acuity_level_id).toBe(cr.data.id)
  })

  it('clears level with null', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db)
    const cr = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Hi', abbreviation: 'H', points: 5, color: 'red' }) as any
    await invoke(IPC.ACUITY_SET_ROW_LEVEL, rowIds[0], cr.data.id)
    const r = await invoke(IPC.ACUITY_SET_ROW_LEVEL, rowIds[0], null) as any
    expect(r.ok).toBe(true)
    const row = testDb.db.prepare('SELECT acuity_level_id FROM rows WHERE id = ?').get(rowIds[0]) as any
    expect(row.acuity_level_id).toBeNull()
  })

  it('rejects invalid rowId', async () => {
    const r = await invoke(IPC.ACUITY_SET_ROW_LEVEL, 0, null) as any
    expect(r.ok).toBe(false)
  })

  it('rejects invalid non-null levelId', async () => {
    const { rowIds } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_SET_ROW_LEVEL, rowIds[0], -5) as any
    expect(r.ok).toBe(false)
  })
})

describe('ACUITY_BULK_SET_LEVEL', () => {
  it('sets level for multiple rows', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db)
    const cr = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Hi', abbreviation: 'H', points: 5, color: 'red' }) as any
    const r = await invoke(IPC.ACUITY_BULK_SET_LEVEL, [rowIds[0], rowIds[1]], cr.data.id) as any
    expect(r.ok).toBe(true)
    for (const rid of [rowIds[0], rowIds[1]]) {
      const row = testDb.db.prepare('SELECT acuity_level_id FROM rows WHERE id = ?').get(rid) as any
      expect(row.acuity_level_id).toBe(cr.data.id)
    }
  })

  it('clears level for multiple rows with null', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db)
    const cr = await invoke(IPC.ACUITY_CREATE_LEVEL, gridId, { name: 'Hi', abbreviation: 'H', points: 5, color: 'red' }) as any
    await invoke(IPC.ACUITY_BULK_SET_LEVEL, [rowIds[0], rowIds[1]], cr.data.id)
    const r = await invoke(IPC.ACUITY_BULK_SET_LEVEL, [rowIds[0], rowIds[1]], null) as any
    expect(r.ok).toBe(true)
  })

  it('rejects empty array', async () => {
    const r = await invoke(IPC.ACUITY_BULK_SET_LEVEL, [], null) as any
    expect(r.ok).toBe(false)
  })

  it('rejects array over 5000', async () => {
    const r = await invoke(IPC.ACUITY_BULK_SET_LEVEL, Array.from({ length: 5001 }, (_, i) => i + 1), null) as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-integer ids in array', async () => {
    const r = await invoke(IPC.ACUITY_BULK_SET_LEVEL, [1.5, 2], null) as any
    expect(r.ok).toBe(false)
  })

  it('rejects invalid levelId', async () => {
    const { rowIds } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_BULK_SET_LEVEL, [rowIds[0]], -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('ACUITY_TOGGLE', () => {
  it('enables acuity on a grid', async () => {
    const { gridId } = seedGrid(testDb.db)
    const r = await invoke(IPC.ACUITY_TOGGLE, gridId, true) as any
    expect(r.ok).toBe(true)
    const grid = testDb.db.prepare('SELECT acuity_enabled FROM grids WHERE id = ?').get(gridId) as any
    expect(grid.acuity_enabled).toBe(1)
  })

  it('disables acuity on a grid', async () => {
    const { gridId } = seedGrid(testDb.db)
    await invoke(IPC.ACUITY_TOGGLE, gridId, true)
    const r = await invoke(IPC.ACUITY_TOGGLE, gridId, false) as any
    expect(r.ok).toBe(true)
    const grid = testDb.db.prepare('SELECT acuity_enabled FROM grids WHERE id = ?').get(gridId) as any
    expect(grid.acuity_enabled).toBe(0)
  })

  it('rejects invalid gridId', async () => {
    const r = await invoke(IPC.ACUITY_TOGGLE, -1, true) as any
    expect(r.ok).toBe(false)
  })
})
