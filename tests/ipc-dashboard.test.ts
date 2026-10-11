/**
 * ipc-dashboard.test.ts — Tests for DASHBOARD_* IPC handlers.
 * Captures handlers from registerDashboardHandlers() and tests them against a real DB.
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
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-dash') },
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

// ── Setup ────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  testDb = createTestDb()
  const { registerDashboardHandlers } = await import('../src/main/ipc/ipc-dashboard')
  registerDashboardHandlers()
})

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DASHBOARD_GET_ALL', () => {
  it('returns ok with stats, deadlines, followUps, archived', async () => {
    const result = await invoke(IPC.DASHBOARD_GET_ALL) as { ok: boolean; data: Record<string, unknown> }
    expect(result.ok).toBe(true)
    expect(result.data).toHaveProperty('stats')
    expect(result.data).toHaveProperty('deadlines')
    expect(result.data).toHaveProperty('followUps')
    expect(result.data).toHaveProperty('archived')
  })

  it('stats show 0 active clients on empty DB', async () => {
    const result = await invoke(IPC.DASHBOARD_GET_ALL) as { ok: true; data: { stats: { totalActive: number; followUpsPending: number } } }
    expect(result.data.stats.totalActive).toBe(0)
    expect(result.data.stats.followUpsPending).toBe(0)
  })

  it('counts active rows across multiple grids', async () => {
    seedGrid(testDb.db, { name: 'Grid A', rowCount: 3 })
    seedGrid(testDb.db, { name: 'Grid B', rowCount: 5 })
    const result = await invoke(IPC.DASHBOARD_GET_ALL) as { ok: true; data: { stats: { totalActive: number; activeByList: Array<{ n: number }> } } }
    expect(result.data.stats.totalActive).toBe(8)
    expect(result.data.stats.activeByList.map(l => l.n).sort()).toEqual([3, 5])
  })

  it('excludes soft-deleted rows from totalActive', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 3 })
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowIds[0])
    const result = await invoke(IPC.DASHBOARD_GET_ALL) as { ok: true; data: { stats: { totalActive: number } } }
    expect(result.data.stats.totalActive).toBe(2)
  })

  it('excludes rows in inactive grids', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 5 })
    testDb.db.prepare("UPDATE grids SET is_active = 0 WHERE id = ?").run(gridId)
    const result = await invoke(IPC.DASHBOARD_GET_ALL) as { ok: true; data: { stats: { totalActive: number } } }
    expect(result.data.stats.totalActive).toBe(0)
  })
})

describe('DASHBOARD_GET_DEADLINES', () => {
  it('returns ok with array', async () => {
    const result = await invoke(IPC.DASHBOARD_GET_DEADLINES) as { ok: boolean; data: unknown[] }
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('returns empty array when no date columns have alert rules', async () => {
    seedGrid(testDb.db, { columnTypes: ['text', 'date', 'number'] })
    const result = await invoke(IPC.DASHBOARD_GET_DEADLINES) as { ok: true; data: unknown[] }
    expect(result.data).toHaveLength(0)
  })

  it('returns deadlines for date columns with alert rules', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { columnTypes: ['text', 'date'], rowCount: 2 })
    const dateColId = columnIds[1]
    // Create alert rule
    const arResult = testDb.db.prepare(
      "INSERT INTO alert_rules (name, interval_days, thresholds, created_at) VALUES ('30-day', 30, '[]', datetime('now'))"
    ).run()
    const arId = arResult.lastInsertRowid
    // Attach alert rule to date column
    testDb.db.prepare("UPDATE columns SET config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: arId }), dateColId)
    // Set date values
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(rowIds[0], dateColId, '2026-04-01')
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(rowIds[1], dateColId, '2026-05-01')

    const result = await invoke(IPC.DASHBOARD_GET_DEADLINES) as { ok: true; data: Array<{ row_id: number; date_value: string }> }
    expect(result.data.length).toBe(2)
    // Should be sorted ASC by date
    expect(result.data[0].date_value).toBe('2026-04-01')
    expect(result.data[1].date_value).toBe('2026-05-01')
  })

  it('orders by effective due date (date + rule interval), not the stored date', async () => {
    const { columnIds, rowIds } = seedGrid(testDb.db, { columnTypes: ['text', 'date', 'date'], rowCount: 1 })
    const annual = testDb.db.prepare("INSERT INTO alert_rules (name, interval_days, thresholds, created_at) VALUES ('Annual', 365, '[]', datetime('now'))").run().lastInsertRowid
    const weekly = testDb.db.prepare("INSERT INTO alert_rules (name, interval_days, thresholds, created_at) VALUES ('Weekly', 7, '[]', datetime('now'))").run().lastInsertRowid
    testDb.db.prepare("UPDATE columns SET config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: annual }), columnIds[1])
    testDb.db.prepare("UPDATE columns SET config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: weekly }), columnIds[2])
    // Annual review done Mar 1 -> due next Mar 1; weekly contact Jun 1 -> due Jun 8
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, '2026-03-01', datetime('now'))").run(rowIds[0], columnIds[1])
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, '2026-06-01', datetime('now'))").run(rowIds[0], columnIds[2])

    const result = await invoke(IPC.DASHBOARD_GET_DEADLINES) as { ok: true; data: Array<{ date_value: string; effective_date: string }> }
    expect(result.data.map(d => d.effective_date)).toEqual(['2026-06-08', '2027-03-01'])
  })

  it('counts pending follow-ups only for active clients (matches the follow-up list)', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 2 })
    for (const id of rowIds) {
      testDb.db.prepare(
        "INSERT INTO case_log (row_id, content, log_type, follow_up_date, follow_up_completed, created_at, updated_at) VALUES (?, 'Call', 'note', date('now', 'localtime', '-1 day'), 0, datetime('now'), datetime('now'))"
      ).run(id)
    }
    testDb.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now') WHERE id = ?").run(rowIds[1])
    const result = await allPart('stats') as { ok: true; data: { followUpsPending: number } }
    expect(result.data.followUpsPending).toBe(1)
  })

  it('excludes deadlines from soft-deleted rows', async () => {
    const { columnIds, rowIds } = seedGrid(testDb.db, { columnTypes: ['text', 'date'], rowCount: 2 })
    const dateColId = columnIds[1]
    const arResult = testDb.db.prepare(
      "INSERT INTO alert_rules (name, interval_days, thresholds, created_at) VALUES ('test', 30, '[]', datetime('now'))"
    ).run()
    testDb.db.prepare("UPDATE columns SET config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: arResult.lastInsertRowid }), dateColId)
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(rowIds[0], dateColId, '2026-04-01')
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(rowIds[1], dateColId, '2026-05-01')
    // Soft-delete one row
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowIds[0])

    const result = await invoke(IPC.DASHBOARD_GET_DEADLINES) as { ok: true; data: unknown[] }
    expect(result.data.length).toBe(1)
  })
})

describe('DASHBOARD_GET_ALL stats', () => {
  it('returns ok with totalActive and followUpsPending', async () => {
    const result = await allPart('stats') as { ok: true; data: { totalActive: number; followUpsPending: number } }
    expect(result.ok).toBe(true)
    expect(typeof result.data.totalActive).toBe('number')
    expect(typeof result.data.followUpsPending).toBe('number')
  })

  it('counts pending follow-ups correctly', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 2 })
    // Insert follow-up that is due today
    testDb.db.prepare(
      "INSERT INTO case_log (row_id, content, log_type, follow_up_date, follow_up_completed, created_at, updated_at) VALUES (?, 'Follow up call', 'note', date('now', 'localtime'), 0, datetime('now'), datetime('now'))"
    ).run(rowIds[0])
    // Insert follow-up that is completed
    testDb.db.prepare(
      "INSERT INTO case_log (row_id, content, log_type, follow_up_date, follow_up_completed, created_at, updated_at) VALUES (?, 'Done', 'note', date('now'), 1, datetime('now'), datetime('now'))"
    ).run(rowIds[1])

    const result = await allPart('stats') as { ok: true; data: { followUpsPending: number } }
    expect(result.data.followUpsPending).toBe(1)
  })

  it('excludes voided follow-ups', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    testDb.db.prepare(
      "INSERT INTO case_log (row_id, content, log_type, follow_up_date, follow_up_completed, voided_at, created_at, updated_at) VALUES (?, 'Voided', 'note', date('now'), 0, datetime('now'), datetime('now'), datetime('now'))"
    ).run(rowIds[0])

    const result = await allPart('stats') as { ok: true; data: { followUpsPending: number } }
    expect(result.data.followUpsPending).toBe(0)
  })
})

describe('DASHBOARD_GET_FOLLOWUPS', () => {
  it('returns ok with array', async () => {
    const result = await invoke(IPC.DASHBOARD_GET_FOLLOWUPS) as { ok: boolean; data: unknown[] }
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('returns pending follow-ups sorted by date ASC', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 2 })
    testDb.db.prepare(
      "INSERT INTO case_log (row_id, content, log_type, follow_up_date, follow_up_completed, created_at, updated_at) VALUES (?, 'Later', 'note', '2026-06-01', 0, datetime('now'), datetime('now'))"
    ).run(rowIds[0])
    testDb.db.prepare(
      "INSERT INTO case_log (row_id, content, log_type, follow_up_date, follow_up_completed, created_at, updated_at) VALUES (?, 'Earlier', 'note', '2026-03-01', 0, datetime('now'), datetime('now'))"
    ).run(rowIds[1])

    const result = await invoke(IPC.DASHBOARD_GET_FOLLOWUPS) as { ok: true; data: Array<{ follow_up_date: string }> }
    expect(result.data.length).toBe(2)
    expect(result.data[0].follow_up_date).toBe('2026-03-01')
  })

  it('excludes completed follow-ups', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    testDb.db.prepare(
      "INSERT INTO case_log (row_id, content, log_type, follow_up_date, follow_up_completed, created_at, updated_at) VALUES (?, 'Done', 'note', date('now'), 1, datetime('now'), datetime('now'))"
    ).run(rowIds[0])

    const result = await invoke(IPC.DASHBOARD_GET_FOLLOWUPS) as { ok: true; data: unknown[] }
    expect(result.data).toHaveLength(0)
  })

  it('excludes follow-ups from inactive rows', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    testDb.db.prepare(
      "INSERT INTO case_log (row_id, content, log_type, follow_up_date, follow_up_completed, created_at, updated_at) VALUES (?, 'Pending', 'note', date('now'), 0, datetime('now'), datetime('now'))"
    ).run(rowIds[0])
    testDb.db.prepare("UPDATE rows SET is_active = 0 WHERE id = ?").run(rowIds[0])

    const result = await invoke(IPC.DASHBOARD_GET_FOLLOWUPS) as { ok: true; data: unknown[] }
    expect(result.data).toHaveLength(0)
  })
})

describe('DASHBOARD_GET_ALL archived', () => {
  it('returns ok with array', async () => {
    const result = await allPart('archived') as { ok: boolean; data: unknown[] }
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('returns archived rows', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 2 })
    testDb.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now'), archived_reason = 'Completed' WHERE id = ?").run(rowIds[0])

    const result = await allPart('archived') as { ok: true; data: Array<{ id: number; archived_reason: string }> }
    expect(result.data.length).toBe(1)
    expect(result.data[0].archived_reason).toBe('Completed')
  })

  it('leaves out archived records of a deleted list (L-13)', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    testDb.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now') WHERE id = ?").run(rowIds[0])
    testDb.db.prepare('UPDATE grids SET is_active = 0 WHERE id = ?').run(gridId)
    const result = await allPart('archived') as { ok: true; data: unknown[] }
    expect(result.data).toHaveLength(0)
  })

  it('excludes soft-deleted rows from archived list', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    testDb.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now'), deleted_at = datetime('now') WHERE id = ?").run(rowIds[0])

    const result = await allPart('archived') as { ok: true; data: unknown[] }
    expect(result.data).toHaveLength(0)
  })

  it('sorted by archived_at DESC', async () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 2 })
    testDb.db.prepare("UPDATE rows SET is_active = 0, archived_at = '2026-01-01 10:00:00' WHERE id = ?").run(rowIds[0])
    testDb.db.prepare("UPDATE rows SET is_active = 0, archived_at = '2026-02-01 10:00:00' WHERE id = ?").run(rowIds[1])

    const result = await allPart('archived') as { ok: true; data: Array<{ id: number; archived_at: string }> }
    expect(result.data.length).toBe(2)
    expect(result.data[0].archived_at > result.data[1].archived_at).toBe(true)
  })
})

describe('DASHBOARD_GET_BRIEFING', () => {
  it('counts overdue, due-today, and this-week deadlines by effective date, plus follow-ups and tasks', async () => {
    const { columnIds, rowIds } = seedGrid(testDb.db, { columnTypes: ['text', 'date'], rowCount: 3 })
    const rule = testDb.db.prepare("INSERT INTO alert_rules (name, interval_days, thresholds, created_at) VALUES ('Weekly', 7, '[]', datetime('now'))").run().lastInsertRowid
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: rule }), columnIds[1])
    const ins = testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, date('now', 'localtime', ?), datetime('now'))")
    ins.run(rowIds[0], columnIds[1], '-10 days') // due 3 days ago → overdue
    ins.run(rowIds[1], columnIds[1], '-7 days')  // due today
    ins.run(rowIds[2], columnIds[1], '-4 days')  // due in 3 days → this week
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, follow_up_date, follow_up_completed, created_at, updated_at) VALUES (?, 'Call back', 'note', date('now', 'localtime'), 0, datetime('now'), datetime('now'))").run(rowIds[0])
    testDb.db.prepare("INSERT INTO caseload_tasks (title, due_date, is_completed, position, created_at, updated_at) VALUES ('Report', date('now', 'localtime', '-1 day'), 0, 0, datetime('now'), datetime('now'))").run()

    const r = await invoke(IPC.DASHBOARD_GET_BRIEFING) as { ok: true; data: Record<string, number> }
    expect(r.data).toMatchObject({ overdue: 1, dueToday: 1, dueThisWeek: 1, followUpsDue: 1, tasksDue: 1 })
  })
})

describe('DASHBOARD_RECENT_ACTIVITY', () => {
  it('lists the latest notes across active lists, without Pulse\'s own or voided ones, as short plain text', async () => {
    const g = seedGrid(testDb.db, { name: 'Recent', rowCount: 2, columnCount: 1 })
    testDb.db.prepare("UPDATE rows SET display_name = 'Ada' WHERE id = ?").run(g.rowIds[0])
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(g.rowIds[1])
    const note = testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, voided_at) VALUES (?, ?, ?, ?, ?, ?)")
    note.run(g.rowIds[0], '<p>Called <b>Ada</b> about the visit</p>', 'phone', '2026-10-01 10:00:00', '2026-10-01 10:00:00', null)
    note.run(g.rowIds[0], 'Status changed', 'system', '2026-10-01 11:00:00', '2026-10-01 11:00:00', null)
    note.run(g.rowIds[0], 'Wrong record', 'note', '2026-10-01 12:00:00', '2026-10-01 12:00:00', '2026-10-01 12:05:00')
    note.run(g.rowIds[1], 'In the trash', 'note', '2026-10-01 13:00:00', '2026-10-01 13:00:00', null)
    note.run(g.rowIds[0], 'x'.repeat(300), 'note', '2026-10-01 09:00:00', '2026-10-01 09:00:00', null)
    const res = await invoke(IPC.DASHBOARD_RECENT_ACTIVITY) as { ok: true; data: Array<{ name: string; log_type: string; text: string; grid_name: string }> }
    const mine = res.data.filter(r => r.grid_name === 'Recent')
    expect(mine.map(r => [r.name, r.log_type, r.text.length > 100 ? `${r.text.length}` : r.text])).toEqual([['Ada', 'phone', 'Called Ada about the visit'], ['Ada', 'note', '158']])
    expect(res.data.length).toBeLessThanOrEqual(10)
  })
})
