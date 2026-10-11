/**
 * ROW_LOCATE (1.24): where a record lives, so it can be opened from any screen.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture map ──────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-row-locate') },
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

describe('IPC Row — ROW_LOCATE', () => {
  it('finds an active record and its list', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const res = await invoke(IPC.ROW_LOCATE, rowIds[0]) as any
    expect(res).toEqual({ ok: true, data: { gridId, status: 'active', archivedReason: null } })
  })

  it('reports archived records with their reason', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    testDb.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now'), archived_reason = 'Discharged' WHERE id = ?").run(rowIds[0])
    const res = await invoke(IPC.ROW_LOCATE, rowIds[0]) as any
    expect(res.data).toEqual({ gridId, status: 'archived', archivedReason: 'Discharged' })
  })

  it('reports records in the Trash and on deleted lists', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 2, columnCount: 1 })
    testDb.db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").run(rowIds[0])
    expect(((await invoke(IPC.ROW_LOCATE, rowIds[0])) as any).data.status).toBe('trash')
    testDb.db.prepare('UPDATE grids SET is_active = 0 WHERE id = ?').run(gridId)
    expect(((await invoke(IPC.ROW_LOCATE, rowIds[1])) as any).data.status).toBe('list-deleted')
  })

  it('returns nothing for an unknown record and rejects bad ids', async () => {
    expect(await invoke(IPC.ROW_LOCATE, 99999)).toEqual({ ok: true, data: null })
    expect(((await invoke(IPC.ROW_LOCATE, -1)) as any).ok).toBe(false)
  })
})
