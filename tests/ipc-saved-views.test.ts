/**
 * IPC Saved Views handler tests — ipc-saved-views.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3-multiple-ciphers'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture map ──────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-sv') },
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
  }
})

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`)
  return await handler(fakeEvent, ...args)
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerSavedViewHandlers } = await import('../src/main/ipc/ipc-saved-views')
  registerSavedViewHandlers()
})

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

describe('IPC Saved Views', () => {
  // ── SAVED_VIEW_GET_ALL ──────────────────────────────────────────────────────
  describe('SAVED_VIEW_GET_ALL', () => {
    it('returns empty array for grid with no views', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.SAVED_VIEW_GET_ALL, gridId) as any
      expect(result.ok).toBe(true)
      expect(result.data).toEqual([])
    })

    it('returns views sorted by name', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      testDb.db.prepare('INSERT INTO saved_views (grid_id, name, config) VALUES (?, ?, ?)').run(gridId, 'Zebra', '{}')
      testDb.db.prepare('INSERT INTO saved_views (grid_id, name, config) VALUES (?, ?, ?)').run(gridId, 'Alpha', '{}')
      const result = await invoke(IPC.SAVED_VIEW_GET_ALL, gridId) as any
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(result.data[0].name).toBe('Alpha')
      expect(result.data[1].name).toBe('Zebra')
    })

    it('fails with invalid grid ID', async () => {
      const result = await invoke(IPC.SAVED_VIEW_GET_ALL, -1) as any
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Invalid ID/)
    })

    it('fails with non-numeric ID', async () => {
      const result = await invoke(IPC.SAVED_VIEW_GET_ALL, 'abc') as any
      expect(result.ok).toBe(false)
    })
  })

  // ── SAVED_VIEW_CREATE ─────────────────────────────────────────────────────
  describe('SAVED_VIEW_CREATE', () => {
    it('creates a view and returns its ID', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.SAVED_VIEW_CREATE, gridId, 'My View', '{"sort":"asc"}') as any
      expect(result.ok).toBe(true)
      expect(typeof result.data).toBe('number')
      expect(result.data).toBeGreaterThan(0)
    })

    it('fails with empty name', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.SAVED_VIEW_CREATE, gridId, '', '{}') as any
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Invalid view name/)
    })

    it('fails with whitespace-only name', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.SAVED_VIEW_CREATE, gridId, '   ', '{}') as any
      expect(result.ok).toBe(false)
    })

    it('fails with name exceeding 200 chars', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.SAVED_VIEW_CREATE, gridId, 'x'.repeat(201), '{}') as any
      expect(result.ok).toBe(false)
    })

    it('fails with config exceeding 100k chars', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.SAVED_VIEW_CREATE, gridId, 'View', 'x'.repeat(100_001)) as any
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/too large/)
    })

    it('fails with invalid grid ID', async () => {
      const result = await invoke(IPC.SAVED_VIEW_CREATE, 0, 'View', '{}') as any
      expect(result.ok).toBe(false)
    })

    it('enforces 20-view maximum per grid', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      for (let i = 0; i < 20; i++) {
        testDb.db.prepare('INSERT INTO saved_views (grid_id, name, config) VALUES (?, ?, ?)').run(gridId, `View ${i}`, '{}')
      }
      const result = await invoke(IPC.SAVED_VIEW_CREATE, gridId, 'View 21', '{}') as any
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/up to 20 saved views/)
    })
  })

  // ── SAVED_VIEW_DELETE ─────────────────────────────────────────────────────
  describe('SAVED_VIEW_DELETE', () => {
    it('deletes an existing view', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const r = testDb.db.prepare('INSERT INTO saved_views (grid_id, name, config) VALUES (?, ?, ?)').run(gridId, 'View', '{}')
      const id = r.lastInsertRowid as number
      const result = await invoke(IPC.SAVED_VIEW_DELETE, id) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id)
      expect(row).toBeUndefined()
    })

    it('succeeds even if ID does not exist (DELETE is idempotent)', async () => {
      const result = await invoke(IPC.SAVED_VIEW_DELETE, 99999) as any
      expect(result.ok).toBe(true)
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.SAVED_VIEW_DELETE, 0) as any
      expect(result.ok).toBe(false)
    })
  })
})
