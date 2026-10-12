/**
 * F-024: the dashboard sends at most DASHBOARD_PRIORITY deadlines; its tiles must
 * still count every deadline, the same as the morning briefing. Caps made small here.
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
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-dash-caps') },
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
  }
})

vi.mock('../src/shared/query-limits', async () => {
  const actual = await vi.importActual<typeof import('../src/shared/query-limits')>('../src/shared/query-limits')
  return { QUERY_LIMITS: { ...actual.QUERY_LIMITS, DASHBOARD_PRIORITY: 3, DASHBOARD_FOLLOWUPS: 2 } }
})

vi.mock('../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

/** One part of DASHBOARD_GET_ALL, shaped like a single-part result */
async function allPart(part: 'stats' | 'archived'): Promise<unknown> {
  const res = await invoke(IPC.DASHBOARD_GET_ALL) as { ok: boolean; data: Record<string, unknown> }
  return { ok: res.ok, data: res.data?.[part] }
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerDashboardHandlers } = await import('../src/main/ipc/ipc-dashboard')
  registerDashboardHandlers()
})

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

describe('Dashboard tiles past the list cap (F-024)', () => {
  it('count every deadline, as the briefing does, while the list stays capped', async () => {
    const { columnIds, rowIds } = seedGrid(testDb.db, { columnTypes: ['text', 'date'], rowCount: 8 })
    const rule = testDb.db.prepare("INSERT INTO alert_rules (name, interval_days, thresholds, created_at) VALUES ('Weekly', 7, '[]', datetime('now'))").run().lastInsertRowid
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: rule }), columnIds[1])
    const ins = testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, date('now', 'localtime', ?), datetime('now'))")
    // 4 overdue (more than the list holds), 1 due today, 2 in the next week, 1 in three weeks
    const offsets = ['-20 days', '-15 days', '-12 days', '-10 days', '-7 days', '-4 days', '-2 days', '+14 days']
    offsets.forEach((o, i) => ins.run(rowIds[i], columnIds[1], o))
    for (let i = 0; i < 3; i++) {
      testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, follow_up_date, follow_up_completed, created_at, updated_at) VALUES (?, 'Call back', 'note', date('now', 'localtime', ?), 0, datetime('now'), datetime('now'))").run(rowIds[i], `-${i} days`)
    }

    const all = await invoke(IPC.DASHBOARD_GET_ALL) as { ok: true; data: { deadlines: unknown[]; followUps: unknown[]; stats: { deadlineTiles: Record<string, number>; followUpsPending: number } } }
    const brief = await invoke(IPC.DASHBOARD_GET_BRIEFING) as { ok: true; data: { overdue: number; dueToday: number; dueThisWeek: number; followUpsDue: number } }
    expect(all.data.deadlines).toHaveLength(3)
    expect(all.data.followUps).toHaveLength(2)
    expect(all.data.stats.deadlineTiles).toEqual({ overdue: 4, dueThisWeek: 3, dueThisMonth: 4 })
    expect(all.data.stats.deadlineTiles.overdue).toBe(brief.data.overdue)
    expect(all.data.stats.deadlineTiles.dueThisWeek).toBe(brief.data.dueToday + brief.data.dueThisWeek)
    expect(all.data.stats.followUpsPending).toBe(3)
    expect(all.data.stats.followUpsPending).toBe(brief.data.followUpsDue)
  })
})
