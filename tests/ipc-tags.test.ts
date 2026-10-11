/**
 * IPC Tags handler tests — ipc-tags.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-tags') },
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
  const { registerTagHandlers } = await import('../src/main/ipc/ipc-tags')
  registerTagHandlers()
})

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

/** Helper: create a tag in the DB directly */
function insertTag(gridId: number, name: string, color = 'blue') {
  return testDb.db.prepare('INSERT INTO tags (grid_id, name, color) VALUES (?, ?, ?)').run(gridId, name, color)
}

describe('IPC Tags', () => {
  // ── TAG_GET_ALL ──────────────────────────────────────────────────────────
  describe('TAG_GET_ALL', () => {
    it('returns empty array when no tags', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.TAG_GET_ALL, gridId) as any
      expect(result.ok).toBe(true)
      expect(result.data).toEqual([])
    })

    it('returns tags sorted by name', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      insertTag(gridId, 'Zebra')
      insertTag(gridId, 'Alpha')
      const result = await invoke(IPC.TAG_GET_ALL, gridId) as any
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(result.data[0].name).toBe('Alpha')
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.TAG_GET_ALL, -1) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TAG_GET_FOR_ROW ─────────────────────────────────────────────────────
  describe('TAG_GET_FOR_ROW', () => {
    it('returns empty array for row with no tags', async () => {
      const { rowIds } = seedGrid(testDb.db, { columnCount: 1, rowCount: 1 })
      const result = await invoke(IPC.TAG_GET_FOR_ROW, rowIds[0]) as any
      expect(result.ok).toBe(true)
      expect(result.data).toEqual([])
    })

    it('returns tag IDs assigned to a row', async () => {
      const { gridId, rowIds } = seedGrid(testDb.db, { columnCount: 1, rowCount: 1 })
      const t = insertTag(gridId, 'Priority')
      const tagId = t.lastInsertRowid as number
      testDb.db.prepare('INSERT INTO row_tags (row_id, tag_id) VALUES (?, ?)').run(rowIds[0], tagId)
      const result = await invoke(IPC.TAG_GET_FOR_ROW, rowIds[0]) as any
      expect(result.ok).toBe(true)
      expect(result.data).toEqual([tagId])
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.TAG_GET_FOR_ROW, 0) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TAG_CREATE ──────────────────────────────────────────────────────────
  describe('TAG_CREATE', () => {
    it('creates a tag and returns it', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.TAG_CREATE, gridId, 'Urgent', 'red') as any
      expect(result.ok).toBe(true)
      expect(result.data.name).toBe('Urgent')
      expect(result.data.color).toBe('red')
      expect(result.data.id).toBeGreaterThan(0)
    })

    it('fails with empty name', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.TAG_CREATE, gridId, '', 'blue') as any
      expect(result.ok).toBe(false)
    })

    it('fails with name over 100 chars', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.TAG_CREATE, gridId, 'x'.repeat(101), 'blue') as any
      expect(result.ok).toBe(false)
    })

    it('fails with color over 30 chars', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.TAG_CREATE, gridId, 'Tag', 'x'.repeat(31)) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid grid ID', async () => {
      const result = await invoke(IPC.TAG_CREATE, 0, 'Tag', 'blue') as any
      expect(result.ok).toBe(false)
    })

    it('fails with non-string name', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.TAG_CREATE, gridId, 123, 'blue') as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TAG_UPDATE ──────────────────────────────────────────────────────────
  describe('TAG_UPDATE', () => {
    it('updates name', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTag(gridId, 'Old')
      const tagId = t.lastInsertRowid as number
      const result = await invoke(IPC.TAG_UPDATE, tagId, { name: 'New' }) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT name FROM tags WHERE id = ?').get(tagId) as any
      expect(row.name).toBe('New')
    })

    it('updates color', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTag(gridId, 'Tag')
      const tagId = t.lastInsertRowid as number
      const result = await invoke(IPC.TAG_UPDATE, tagId, { color: 'green' }) as any
      expect(result.ok).toBe(true)
    })

    it('fails with empty name', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTag(gridId, 'Tag')
      const result = await invoke(IPC.TAG_UPDATE, t.lastInsertRowid, { name: '' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with name over 100 chars', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTag(gridId, 'Tag')
      const result = await invoke(IPC.TAG_UPDATE, t.lastInsertRowid, { name: 'x'.repeat(101) }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with color over 50 chars', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTag(gridId, 'Tag')
      const result = await invoke(IPC.TAG_UPDATE, t.lastInsertRowid, { color: 'x'.repeat(51) }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with no valid fields', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTag(gridId, 'Tag')
      const result = await invoke(IPC.TAG_UPDATE, t.lastInsertRowid, { invalid: 'field' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.TAG_UPDATE, -1, { name: 'X' }) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TAG_DELETE ──────────────────────────────────────────────────────────
  describe('TAG_DELETE', () => {
    it('deletes a tag', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTag(gridId, 'Tag')
      const tagId = t.lastInsertRowid as number
      const result = await invoke(IPC.TAG_DELETE, tagId) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT * FROM tags WHERE id = ?').get(tagId)
      expect(row).toBeUndefined()
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.TAG_DELETE, 0) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TAG_ASSIGN ──────────────────────────────────────────────────────────
  describe('TAG_ASSIGN', () => {
    it('assigns a tag to a row', async () => {
      const { gridId, rowIds } = seedGrid(testDb.db, { columnCount: 1, rowCount: 1 })
      const t = insertTag(gridId, 'Priority')
      const tagId = t.lastInsertRowid as number
      const result = await invoke(IPC.TAG_ASSIGN, rowIds[0], tagId) as any
      expect(result.ok).toBe(true)
      const link = testDb.db.prepare('SELECT * FROM row_tags WHERE row_id = ? AND tag_id = ?').get(rowIds[0], tagId)
      expect(link).toBeDefined()
    })

    it('is idempotent (INSERT OR IGNORE)', async () => {
      const { gridId, rowIds } = seedGrid(testDb.db, { columnCount: 1, rowCount: 1 })
      const t = insertTag(gridId, 'Priority')
      const tagId = t.lastInsertRowid as number
      await invoke(IPC.TAG_ASSIGN, rowIds[0], tagId)
      const result = await invoke(IPC.TAG_ASSIGN, rowIds[0], tagId) as any
      expect(result.ok).toBe(true)
      const count = (testDb.db.prepare('SELECT COUNT(*) as c FROM row_tags WHERE row_id = ? AND tag_id = ?').get(rowIds[0], tagId) as any).c
      expect(count).toBe(1)
    })

    it('fails with invalid row ID', async () => {
      const result = await invoke(IPC.TAG_ASSIGN, 0, 1) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid tag ID', async () => {
      const result = await invoke(IPC.TAG_ASSIGN, 1, -1) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TAG_UNASSIGN ────────────────────────────────────────────────────────
  describe('TAG_UNASSIGN', () => {
    it('removes a tag from a row', async () => {
      const { gridId, rowIds } = seedGrid(testDb.db, { columnCount: 1, rowCount: 1 })
      const t = insertTag(gridId, 'Priority')
      const tagId = t.lastInsertRowid as number
      testDb.db.prepare('INSERT INTO row_tags (row_id, tag_id) VALUES (?, ?)').run(rowIds[0], tagId)
      const result = await invoke(IPC.TAG_UNASSIGN, rowIds[0], tagId) as any
      expect(result.ok).toBe(true)
      const link = testDb.db.prepare('SELECT * FROM row_tags WHERE row_id = ? AND tag_id = ?').get(rowIds[0], tagId)
      expect(link).toBeUndefined()
    })

    it('succeeds even if not assigned (DELETE is idempotent)', async () => {
      const result = await invoke(IPC.TAG_UNASSIGN, 1, 1) as any
      expect(result.ok).toBe(true)
    })

    it('fails with invalid IDs', async () => {
      const result = await invoke(IPC.TAG_UNASSIGN, 0, 0) as any
      expect(result.ok).toBe(false)
    })
  })
})
