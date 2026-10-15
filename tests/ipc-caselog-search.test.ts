/**
 * 1.31: note search, "oldest first" and paging run in the database, so they
 * cover every note on a record, not just the loaded page.
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
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-caselog-search') },
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
  const add = testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
  // 300 notes over 300 days; the oldest mentions the hospital
  for (let i = 0; i < 300; i++) {
    const day = new Date(2024, 0, 1 + i).toISOString().slice(0, 10) + ' 10:00:00'
    add.run(rowId, i === 0 ? 'Went to the hospital with Maria' : `Routine call ${i}`, i % 2 ? 'phone' : 'visit', day, day)
  }
  add.run(rowId, 'Stage changed to Active', 'system', '2024-12-31 10:00:00', '2024-12-31 10:00:00')
  add.run(rowId, 'Rent is 50% of income', 'note', '2024-12-30 10:00:00', '2024-12-30 10:00:00')
})

afterEach(() => { cleanupTestDb(testDb) })

describe('CASE_LOG_GET search and sort', () => {
  it('finds an old note that is far past the first page', async () => {
    const res = await invoke(IPC.CASE_LOG_GET, rowId, false, false, 51, 0, { query: 'hospital' })
    expect(res.data.map((e: { content: string }) => e.content)).toEqual(['Went to the hospital with Maria'])
    expect((await invoke(IPC.CASE_LOG_COUNT, rowId, false, false, { query: 'hospital' })).data).toBe(1)
  })

  it('treats % and _ in a search as ordinary characters', async () => {
    const res = await invoke(IPC.CASE_LOG_GET, rowId, false, false, 51, 0, { query: '50%' })
    expect(res.data.map((e: { content: string }) => e.content)).toEqual(['Rent is 50% of income'])
    expect((await invoke(IPC.CASE_LOG_GET, rowId, false, false, 51, 0, { query: '_' })).data).toEqual([])
  })

  it('sorts oldest first across all notes', async () => {
    const res = await invoke(IPC.CASE_LOG_GET, rowId, false, false, 3, 0, { oldestFirst: true })
    expect(res.data[0].content).toBe('Went to the hospital with Maria')
  })

  it('counts all notes, with or without system entries, and filters by kind', async () => {
    expect((await invoke(IPC.CASE_LOG_COUNT, rowId, false, false)).data).toBe(301)
    expect((await invoke(IPC.CASE_LOG_COUNT, rowId, true, false)).data).toBe(302)
    expect((await invoke(IPC.CASE_LOG_COUNT, rowId, true, false, { logType: 'phone' })).data).toBe(150)
    const page = await invoke(IPC.CASE_LOG_GET, rowId, true, false, 1000, 250, { logType: 'visit' })
    expect(page.data.every((e: { log_type: string }) => e.log_type === 'visit')).toBe(true)
  })

  it('CASE_LOG_COUNTS answers what the four CASE_LOG_COUNT calls did, voided and change entries included', async () => {
    testDb.db.prepare("UPDATE case_log SET voided_at = datetime('now'), voided_reason = 'Wrong record' WHERE row_id = ? AND content = 'Rent is 50% of income'").run(rowId)
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, voided_at) VALUES (?, 'Old change', 'system', '2024-01-01 10:00:00', '2024-01-01 10:00:00', '2024-01-02 10:00:00')").run(rowId)
    const count = async (...args: unknown[]) => (await invoke(IPC.CASE_LOG_COUNT, rowId, ...args)).data as number
    const filters: Array<[boolean, boolean, Record<string, unknown>?]> = [
      [false, false], [true, false], [true, true], [false, true], [true, false, { logType: 'phone' }], [false, false, { query: 'hospital' }],
    ]
    for (const [includeSystem, includeVoided, opts] of filters) {
      const res = await invoke(IPC.CASE_LOG_COUNTS, rowId, includeSystem, includeVoided, opts)
      expect(res.ok).toBe(true)
      expect(res.data).toEqual({
        total: await count(includeSystem, includeVoided, opts),
        changes: await count(true, false, { logType: 'system' }),
        voided: await count(true, true) - await count(true, false),
      })
    }
    expect((await invoke(IPC.CASE_LOG_COUNTS, rowId)).data).toEqual({ total: 300, changes: 1, voided: 2 })
    expect((await invoke(IPC.CASE_LOG_COUNTS, -1)).ok).toBe(false)
  })

  it('sorts by the day a note happened, not when it was written', async () => {
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, occurred_at) VALUES (?, 'Written today about 2023', 'note', '2025-01-01 10:00:00', '2025-01-01 10:00:00', '2023-06-01 10:00:00')").run(rowId)
    const oldest = await invoke(IPC.CASE_LOG_GET, rowId, false, false, 1, 0, { oldestFirst: true })
    expect(oldest.data[0].content).toBe('Written today about 2023')
  })
})
