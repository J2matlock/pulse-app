/**
 * 3.7: a note can't be edited down to nothing; restoring a voided note leaves a trace.
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
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-caselog-notes') },
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

let rowId: number

beforeAll(async () => {
  testDb = createTestDb()
  const { registerCaseLogHandlers } = await import('../src/main/ipc/ipc-caselog')
  registerCaseLogHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
  rowId = seedGrid(testDb.db, { rowCount: 1 }).rowIds[0]!
})
afterEach(() => { cleanupTestDb(testDb) })

const addNote = () => Number(testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Home visit', 'visit')").run(rowId).lastInsertRowid)

describe('note edits and restore', () => {
  it('refuses to save an emptied note', async () => {
    const id = addNote()
    const res = await invoke(IPC.CASE_LOG_UPDATE, id, '   ')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/use Void/)
    expect((testDb.db.prepare('SELECT content FROM case_log WHERE id = ?').get(id) as { content: string }).content).toBe('Home visit')
  })

  it('restores a voided note and notes it on the timeline', async () => {
    const id = addNote()
    testDb.db.prepare("UPDATE case_log SET voided_at = datetime('now'), voided_reason = 'Wrong person' WHERE id = ?").run(id)
    expect((await invoke(IPC.CASE_LOG_UNVOID, id, { logRestore: true })).ok).toBe(true)
    expect(testDb.db.prepare('SELECT voided_at FROM case_log WHERE id = ?').get(id)).toEqual({ voided_at: null })
    const sys = testDb.db.prepare("SELECT content FROM case_log WHERE row_id = ? AND log_type = 'system'").all(rowId) as Array<{ content: string }>
    expect(sys.map(r => r.content)).toEqual([expect.stringMatching(/restored \(it was voided: Wrong person\)/)])
  })

  it('undo of a void puts it back without a trace', async () => {
    const id = addNote()
    testDb.db.prepare("UPDATE case_log SET voided_at = datetime('now') WHERE id = ?").run(id)
    await invoke(IPC.CASE_LOG_UNVOID, id)
    expect(testDb.db.prepare("SELECT COUNT(*) AS n FROM case_log WHERE log_type = 'system'").get()).toEqual({ n: 0 })
  })
})
