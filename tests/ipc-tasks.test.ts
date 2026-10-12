/**
 * IPC Tasks handler tests — ipc-tasks.ts
 * Covers TASK_*, SNIPPET_* handlers.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, type TestDb } from './helpers'
import { GENERIC_VOCAB } from '../src/shared/vocab'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      const { tmpdir } = require('os')
      const { join } = require('path')
      const base = join(tmpdir(), 'pulse-test-tasks')
      if (name === 'home') return base
      if (name === 'userData') return join(base, '.config')
      if (name === 'documents') return join(base, 'Documents')
      if (name === 'desktop') return join(base, 'Desktop')
      if (name === 'downloads') return join(base, 'Downloads')
      if (name === 'temp') return join(base, 'tmp')
      return base
    },
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
  const { registerTaskHandlers } = await import('../src/main/ipc/ipc-tasks')
  registerTaskHandlers()
})

beforeEach(() => { testDb = createTestDb(); setDbWords(testDb.db) })
afterEach(() => { cleanupTestDb(testDb) })

/** Helper: insert a task directly */
function insertTask(gridId: number | null, title: string, opts?: { due_date?: string; is_completed?: number; recurrence_rule?: string }) {
  return testDb.db.prepare(`
    INSERT INTO caseload_tasks (grid_id, title, priority, position, is_completed, due_date, recurrence_rule, created_at, updated_at)
    VALUES (?, ?, 'normal', 0, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(gridId, title, opts?.is_completed ?? 0, opts?.due_date ?? null, opts?.recurrence_rule ?? null)
}

describe('IPC Tasks', () => {
  // ── TASK_GET_ALL ──────────────────────────────────────────────────────────
  describe('TASK_GET_ALL', () => {
    it('returns all tasks when no gridId given', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      insertTask(gridId, 'Task 1')
      insertTask(gridId, 'Task 2')
      const result = await invoke(IPC.TASK_GET_ALL) as any
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(2)
    })

    it('leaves out tasks of a list in the Trash, as the Dashboard does (bug sweep S2/S4)', async () => {
      const { gridId: kept } = seedGrid(testDb.db, { name: 'Kept', columnCount: 1, rowCount: 0 })
      const { gridId: trashed } = seedGrid(testDb.db, { name: 'Trashed', columnCount: 1, rowCount: 0 })
      insertTask(kept, 'Kept task')
      insertTask(null, 'No list')
      insertTask(trashed, 'Gone task')
      insertTask(trashed, 'Gone done', { is_completed: 1 })
      testDb.db.prepare("UPDATE grids SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").run(trashed)
      const result = await invoke(IPC.TASK_GET_ALL) as any
      expect(result.data.map((t: any) => t.title).sort()).toEqual(['Kept task', 'No list'])
    })

    it('filters by gridId when provided', async () => {
      const { gridId: g1 } = seedGrid(testDb.db, { name: 'G1', columnCount: 1, rowCount: 0 })
      const { gridId: g2 } = seedGrid(testDb.db, { name: 'G2', columnCount: 1, rowCount: 0 })
      insertTask(g1, 'Task A')
      insertTask(g2, 'Task B')
      const result = await invoke(IPC.TASK_GET_ALL, g1) as any
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].title).toBe('Task A')
    })

    it('returns empty array when no tasks', async () => {
      const result = await invoke(IPC.TASK_GET_ALL) as any
      expect(result.ok).toBe(true)
      expect(result.data).toEqual([])
    })

    it('fails with invalid gridId', async () => {
      const result = await invoke(IPC.TASK_GET_ALL, -1) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TASK_GET_DUE ──────────────────────────────────────────────────────────
  describe('TASK_GET_DUE', () => {
    it('returns only tasks with a due date', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      insertTask(gridId, 'Overdue', { due_date: '2020-01-01' })
      insertTask(gridId, 'Future', { due_date: '2099-12-31' })
      insertTask(gridId, 'No date', {})
      const result = await invoke(IPC.TASK_GET_DUE) as any
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(result.data[0].title).toBe('Overdue')
      expect(result.data[1].title).toBe('Future')
    })

    it('excludes completed tasks', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      insertTask(gridId, 'Done', { due_date: '2020-01-01', is_completed: 1 })
      const result = await invoke(IPC.TASK_GET_DUE) as any
      expect(result.ok).toBe(true)
      expect(result.data).toHaveLength(0)
    })
  })

  // ── TASK_CREATE ──────────────────────────────────────────────────────────
  describe('TASK_CREATE', () => {
    it('creates a task and returns it', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.TASK_CREATE, { grid_id: gridId, title: 'New Task' }) as any
      expect(result.ok).toBe(true)
      expect(result.data.title).toBe('New Task')
      expect(result.data.priority).toBe('normal')
      expect(result.data.id).toBeGreaterThan(0)
    })

    it('creates task with all fields', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const result = await invoke(IPC.TASK_CREATE, {
        grid_id: gridId, title: 'Full Task', priority: 'high',
        description: 'Desc', category: 'Admin', due_date: '2026-03-15',
        recurrence_rule: '{"type":"weekly","interval":1}',
      }) as any
      expect(result.ok).toBe(true)
      expect(result.data.priority).toBe('high')
      expect(result.data.description).toBe('Desc')
    })

    it('fails with empty title', async () => {
      const result = await invoke(IPC.TASK_CREATE, { title: '' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with title over 500 chars', async () => {
      const result = await invoke(IPC.TASK_CREATE, { title: 'x'.repeat(501) }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid priority', async () => {
      const result = await invoke(IPC.TASK_CREATE, { title: 'Task', priority: 'critical' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid recurrence type', async () => {
      const result = await invoke(IPC.TASK_CREATE, { title: 'Task', recurrence_rule: '{"type":"biweekly"}' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with malformed recurrence JSON', async () => {
      const result = await invoke(IPC.TASK_CREATE, { title: 'Task', recurrence_rule: 'not json' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with recurrence_rule over 2000 chars', async () => {
      const result = await invoke(IPC.TASK_CREATE, { title: 'Task', recurrence_rule: 'x'.repeat(2001) }) as any
      expect(result.ok).toBe(false)
    })

    it('assigns incrementing position', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      await invoke(IPC.TASK_CREATE, { grid_id: gridId, title: 'First' })
      const r2 = await invoke(IPC.TASK_CREATE, { grid_id: gridId, title: 'Second' }) as any
      expect(r2.data.position).toBe(1)
    })
  })

  // ── Task dates (AUDIT-120) ───────────────────────────────────────────────
  describe('task dates are plain calendar days', () => {
    type Res = { ok: boolean; data?: { id: number; due_date: string | null } }
    const dueOf = (id: number) => (testDb.db.prepare('SELECT due_date, snoozed_until FROM caseload_tasks WHERE id = ?').get(id) as { due_date: string | null; snoozed_until: string | null })

    it.each([
      ['2026-10-11', '2026-10-11'], ['2026-10-11T09:00', '2026-10-11'], [null, null], ['', null],
    ])('TASK_CREATE keeps %j as %j', async (given, stored) => {
      const r = await invoke(IPC.TASK_CREATE, { title: 'Task', due_date: given }) as Res
      expect(r.ok).toBe(true)
      expect(dueOf(r.data!.id).due_date).toBe(stored)
    })

    it.each(['tomorrow', '2026-02-30', '0026-10-11', '20266-01-01', 42])('TASK_CREATE and TASK_UPDATE refuse %j', async (bad) => {
      expect((await invoke(IPC.TASK_CREATE, { title: 'Task', due_date: bad }) as Res).ok).toBe(false)
      const created = await invoke(IPC.TASK_CREATE, { title: 'Task', due_date: '2026-10-11' }) as Res
      expect((await invoke(IPC.TASK_UPDATE, created.data!.id, { due_date: bad }) as Res).ok).toBe(false)
      expect((await invoke(IPC.TASK_UPDATE, created.data!.id, { snoozed_until: bad }) as Res).ok).toBe(false)
      expect(dueOf(created.data!.id).due_date).toBe('2026-10-11')
    })

    it('TASK_UPDATE stores the day without a time', async () => {
      const created = await invoke(IPC.TASK_CREATE, { title: 'Task' }) as Res
      const id = created.data!.id
      expect((await invoke(IPC.TASK_UPDATE, id, { due_date: '2026-10-11T09:00', snoozed_until: '2026-10-05T08:00' }) as Res).ok).toBe(true)
      expect(dueOf(id)).toEqual({ due_date: '2026-10-11', snoozed_until: '2026-10-05' })
      expect((await invoke(IPC.TASK_UPDATE, id, { due_date: null }) as Res).ok).toBe(true)
      expect(dueOf(id).due_date).toBeNull()
    })
  })

  // ── TASK_UPDATE ──────────────────────────────────────────────────────────
  describe('TASK_UPDATE', () => {
    it('updates title', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Old')
      const id = t.lastInsertRowid as number
      const result = await invoke(IPC.TASK_UPDATE, id, { title: 'New' }) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT title FROM caseload_tasks WHERE id = ?').get(id) as any
      expect(row.title).toBe('New')
    })

    it('fails with invalid priority', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Task')
      const result = await invoke(IPC.TASK_UPDATE, t.lastInsertRowid, { priority: 'mega' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with empty title', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Task')
      const result = await invoke(IPC.TASK_UPDATE, t.lastInsertRowid, { title: '' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with description too long', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Task')
      const result = await invoke(IPC.TASK_UPDATE, t.lastInsertRowid, { description: 'x'.repeat(100_001) }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with no valid fields', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Task')
      const result = await invoke(IPC.TASK_UPDATE, t.lastInsertRowid, { bogus: 'field' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.TASK_UPDATE, 0, { title: 'X' }) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TASK_DELETE ──────────────────────────────────────────────────────────
  describe('TASK_DELETE', () => {
    it('deletes a task', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Doomed')
      const id = t.lastInsertRowid as number
      const result = await invoke(IPC.TASK_DELETE, id) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT * FROM caseload_tasks WHERE id = ?').get(id)
      expect(row).toBeUndefined()
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.TASK_DELETE, -1) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TASK_COMPLETE ─────────────────────────────────────────────────────────
  describe('TASK_COMPLETE', () => {
    it('marks a non-recurring task as completed', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Task')
      const id = t.lastInsertRowid as number
      const result = await invoke(IPC.TASK_COMPLETE, id) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT is_completed, completed_at FROM caseload_tasks WHERE id = ?').get(id) as any
      expect(row.is_completed).toBe(1)
      expect(row.completed_at).toBeTruthy()
    })

    it('creates a history entry', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Task')
      const id = t.lastInsertRowid as number
      await invoke(IPC.TASK_COMPLETE, id)
      const hist = testDb.db.prepare('SELECT * FROM caseload_task_history WHERE task_id = ?').all(id) as any[]
      expect(hist).toHaveLength(1)
      expect(hist[0].cycle_number).toBe(1)
    })

    it('advances due_date for recurring task (weekly)', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Recurring', { due_date: '2030-03-01', recurrence_rule: '{"type":"weekly","interval":1}' })
      const id = t.lastInsertRowid as number
      const result = await invoke(IPC.TASK_COMPLETE, id) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT is_completed, due_date FROM caseload_tasks WHERE id = ?').get(id) as any
      expect(row.is_completed).toBe(0)
      expect(row.due_date).toBe('2030-03-08')
    })

    it('advances due_date for recurring task (daily)', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Daily', { due_date: '2030-03-10', recurrence_rule: '{"type":"daily","interval":2}' })
      const id = t.lastInsertRowid as number
      await invoke(IPC.TASK_COMPLETE, id)
      const row = testDb.db.prepare('SELECT due_date FROM caseload_tasks WHERE id = ?').get(id) as any
      expect(row.due_date).toBe('2030-03-12')
    })

    it('a monthly task due on the 31st comes back on the 31st after February (bug sweep S2)', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Monthly', { due_date: '2030-01-31', recurrence_rule: '{"type":"monthly","interval":1}' })
      const id = t.lastInsertRowid as number
      await invoke(IPC.TASK_COMPLETE, id)
      expect((testDb.db.prepare('SELECT due_date FROM caseload_tasks WHERE id = ?').get(id) as any).due_date).toBe('2030-02-28')
      await invoke(IPC.TASK_COMPLETE, id)
      expect((testDb.db.prepare('SELECT due_date FROM caseload_tasks WHERE id = ?').get(id) as any).due_date).toBe('2030-03-31')
    })

    it('marks complete when recurrence end_date is reached', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Ending', { due_date: '2026-03-01', recurrence_rule: '{"type":"weekly","interval":1,"end_date":"2026-03-05"}' })
      const id = t.lastInsertRowid as number
      await invoke(IPC.TASK_COMPLETE, id)
      const row = testDb.db.prepare('SELECT is_completed FROM caseload_tasks WHERE id = ?').get(id) as any
      expect(row.is_completed).toBe(1)
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.TASK_COMPLETE, 0) as any
      expect(result.ok).toBe(false)
    })

    it('fails when task not found', async () => {
      const result = await invoke(IPC.TASK_COMPLETE, 99999) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TASK_SNOOZE ──────────────────────────────────────────────────────────
  describe('TASK_SNOOZE', () => {
    it('sets snoozed_until', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Task')
      const id = t.lastInsertRowid as number
      const result = await invoke(IPC.TASK_SNOOZE, id, '2026-03-15') as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT snoozed_until FROM caseload_tasks WHERE id = ?').get(id) as any
      expect(row.snoozed_until).toBe('2026-03-15')
    })

    it('fails with invalid date format', async () => {
      const result = await invoke(IPC.TASK_SNOOZE, 1, 'March 15th') as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.TASK_SNOOZE, 0, '2026-03-15') as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TASK_REORDER ──────────────────────────────────────────────────────────
  describe('TASK_REORDER', () => {
    it('reorders tasks by position', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t1 = insertTask(gridId, 'A')
      const t2 = insertTask(gridId, 'B')
      const id1 = t1.lastInsertRowid as number
      const id2 = t2.lastInsertRowid as number
      const result = await invoke(IPC.TASK_REORDER, [id2, id1]) as any
      expect(result.ok).toBe(true)
      const r1 = testDb.db.prepare('SELECT position FROM caseload_tasks WHERE id = ?').get(id1) as any
      const r2 = testDb.db.prepare('SELECT position FROM caseload_tasks WHERE id = ?').get(id2) as any
      expect(r2.position).toBe(0)
      expect(r1.position).toBe(1)
    })

    it('fails with non-array', async () => {
      const result = await invoke(IPC.TASK_REORDER, 'not array') as any
      expect(result.ok).toBe(false)
    })

    it('fails with too many IDs (>500)', async () => {
      const result = await invoke(IPC.TASK_REORDER, Array.from({ length: 501 }, (_, i) => i + 1)) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid IDs in array', async () => {
      const result = await invoke(IPC.TASK_REORDER, [1, -1, 3]) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TASK_RESTORE ──────────────────────────────────────────────────────────
  describe('TASK_RESTORE', () => {
    it('restores a task from undo data', async () => {
      const result = await invoke(IPC.TASK_RESTORE, {
        id: 9999, grid_id: null, title: 'Restored', description: null,
        priority: 'normal', category: null, due_date: null,
        recurrence_rule: null, position: 0, is_completed: 0,
        completed_at: null, snoozed_until: null, created_at: '2026-03-01T00:00:00.000Z',
      }) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT title FROM caseload_tasks WHERE id = ?').get(9999) as any
      expect(row.title).toBe('Restored')
    })

    it('puts a task back ungrouped when its group is gone, and keeps a group that is there (bug sweep S2)', async () => {
      const g = testDb.db.prepare("INSERT INTO task_groups (name, position) VALUES ('Kept', 0)").run().lastInsertRowid as number
      const base = { grid_id: null, title: 'Restored', description: null, priority: 'normal', category: null, due_date: null,
        recurrence_rule: null, position: 0, is_completed: 0, completed_at: null, snoozed_until: null, created_at: '2026-03-01T00:00:00.000Z' }
      expect((await invoke(IPC.TASK_RESTORE, { ...base, id: 9001, group_id: 424242 }) as any).ok).toBe(true)
      expect((await invoke(IPC.TASK_RESTORE, { ...base, id: 9002, group_id: g }) as any).ok).toBe(true)
      expect((testDb.db.prepare('SELECT group_id FROM caseload_tasks WHERE id = 9001').get() as any).group_id).toBeNull()
      expect((testDb.db.prepare('SELECT group_id FROM caseload_tasks WHERE id = 9002').get() as any).group_id).toBe(g)
    })

    it('fails if task ID already exists', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Existing')
      const id = t.lastInsertRowid as number
      const result = await invoke(IPC.TASK_RESTORE, {
        id, grid_id: gridId, title: 'Dup', description: null,
        priority: 'normal', category: null, due_date: null,
        recurrence_rule: null, position: 0, is_completed: 0,
        completed_at: null, snoozed_until: null, created_at: '2026-03-01T00:00:00.000Z',
      }) as any
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/already exists/)
    })

    it('fails with invalid priority', async () => {
      const result = await invoke(IPC.TASK_RESTORE, {
        id: 8888, title: 'Bad', priority: 'mega', created_at: '2026-03-01T00:00:00.000Z',
      }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with missing title', async () => {
      const result = await invoke(IPC.TASK_RESTORE, {
        id: 8888, title: '', priority: 'normal', created_at: '2026-03-01T00:00:00.000Z',
      }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with created_at out of range', async () => {
      const result = await invoke(IPC.TASK_RESTORE, {
        id: 8888, title: 'Task', priority: 'normal', created_at: '2019-01-01T00:00:00.000Z',
      }) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── TASK_APPLY_TEMPLATE ───────────────────────────────────────────────────
  describe('TASK_APPLY_TEMPLATE', () => {
    function addTemplate(items: unknown[], recurringDays: number | null) {
      return testDb.db.prepare(`INSERT INTO checklist_templates (name, items, is_recurring, recurrence_days, is_system, created_at)
        VALUES ('Monthly', ?, ?, ?, 0, datetime('now'))`).run(JSON.stringify(items), recurringDays ? 1 : 0, recurringDays).lastInsertRowid as number
    }

    it('a template that repeats makes repeating tasks, due today (bug sweep S2)', async () => {
      const tid = addTemplate(['Home visit', { title: 'Call', priority: 'high' }], 30)
      const r = await invoke(IPC.TASK_APPLY_TEMPLATE, tid, null) as any
      expect(r.ok).toBe(true)
      const rows = testDb.db.prepare('SELECT title, priority, due_date, recurrence_rule FROM caseload_tasks ORDER BY position').all() as any[]
      const { localDateString } = await import('../src/shared/dates')
      expect(rows).toEqual([
        { title: 'Home visit', priority: 'normal', due_date: localDateString(), recurrence_rule: '{"type":"daily","interval":30}' },
        { title: 'Call', priority: 'high', due_date: localDateString(), recurrence_rule: '{"type":"daily","interval":30}' },
      ])
    })

    it('refuses a group that is not a real id, or is gone, and adds nothing (Q-056)', async () => {
      const tid = addTemplate(['Intake'], null)
      for (const g of ['3', -1, 1.5, 999]) {
        const r = await invoke(IPC.TASK_APPLY_TEMPLATE, tid, g) as any
        expect(r.ok).toBe(false)
        expect(r.error).toMatch(/^(Invalid group ID|Task group not found)$/)
      }
      expect((testDb.db.prepare('SELECT COUNT(*) AS n FROM caseload_tasks').get() as { n: number }).n).toBe(0)
    })

    it('one that does not repeat makes plain tasks, and an unknown priority becomes normal', async () => {
      const tid = addTemplate([{ title: 'Intake', priority: 'mega' }], null)
      await invoke(IPC.TASK_APPLY_TEMPLATE, tid, null)
      expect(testDb.db.prepare('SELECT priority, due_date, recurrence_rule FROM caseload_tasks').get()).toEqual({ priority: 'normal', due_date: null, recurrence_rule: null })
    })
  })

  // ── TASK_UNCOMPLETE ───────────────────────────────────────────────────────
  describe('TASK_UNCOMPLETE', () => {
    it('reverts a completed task to original state', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Task', { due_date: '2026-03-01' })
      const id = t.lastInsertRowid as number
      await invoke(IPC.TASK_COMPLETE, id)
      const result = await invoke(IPC.TASK_UNCOMPLETE, id, { is_completed: 0, completed_at: null, due_date: '2026-03-01' }) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT is_completed, due_date FROM caseload_tasks WHERE id = ?').get(id) as any
      expect(row.is_completed).toBe(0)
      expect(row.due_date).toBe('2026-03-01')
    })

    it('puts back the snooze that ticking off a repeating task cleared (bug sweep S2)', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const id = insertTask(gridId, 'Weekly', { due_date: '2030-03-01', recurrence_rule: '{"type":"weekly","interval":1}' }).lastInsertRowid as number
      testDb.db.prepare("UPDATE caseload_tasks SET snoozed_until = '2030-02-27' WHERE id = ?").run(id)
      await invoke(IPC.TASK_COMPLETE, id)
      expect((testDb.db.prepare('SELECT snoozed_until FROM caseload_tasks WHERE id = ?').get(id) as any).snoozed_until).toBeNull()
      const r = await invoke(IPC.TASK_UNCOMPLETE, id, { is_completed: 0, completed_at: null, due_date: '2030-03-01', snoozed_until: '2030-02-27' }) as any
      expect(r.ok).toBe(true)
      expect(testDb.db.prepare('SELECT due_date, snoozed_until FROM caseload_tasks WHERE id = ?').get(id)).toEqual({ due_date: '2030-03-01', snoozed_until: '2030-02-27' })
      expect((await invoke(IPC.TASK_UNCOMPLETE, id, { is_completed: 0, completed_at: null, due_date: null, snoozed_until: 'soon' }) as any).ok).toBe(false)
    })

    it('removes latest history entry', async () => {
      const { gridId } = seedGrid(testDb.db, { columnCount: 1, rowCount: 0 })
      const t = insertTask(gridId, 'Task')
      const id = t.lastInsertRowid as number
      await invoke(IPC.TASK_COMPLETE, id)
      expect((testDb.db.prepare('SELECT COUNT(*) as c FROM caseload_task_history WHERE task_id = ?').get(id) as any).c).toBe(1)
      await invoke(IPC.TASK_UNCOMPLETE, id, { is_completed: 0, completed_at: null, due_date: null })
      expect((testDb.db.prepare('SELECT COUNT(*) as c FROM caseload_task_history WHERE task_id = ?').get(id) as any).c).toBe(0)
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.TASK_UNCOMPLETE, 0, { is_completed: 0, completed_at: null, due_date: null }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid is_completed value', async () => {
      const result = await invoke(IPC.TASK_UNCOMPLETE, 1, { is_completed: 2, completed_at: null, due_date: null }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid completed_at format', async () => {
      const result = await invoke(IPC.TASK_UNCOMPLETE, 1, { is_completed: 0, completed_at: 'bad-date', due_date: null }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid original object', async () => {
      const result = await invoke(IPC.TASK_UNCOMPLETE, 1, null) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── SNIPPET_CREATE ───────────────────────────────────────────────────────
  describe('SNIPPET_CREATE category (Q-056)', () => {
    it('takes a short text category or none, and refuses anything else', async () => {
      expect((await invoke(IPC.SNIPPET_CREATE, '/a1', 'x', 'Visits') as any).ok).toBe(true)
      expect((await invoke(IPC.SNIPPET_CREATE, '/a2', 'x', null) as any).ok).toBe(true)
      for (const bad of [42, { evil: true }, 'c'.repeat(101)]) {
        expect(await invoke(IPC.SNIPPET_CREATE, '/a3', 'x', bad)).toEqual({ ok: false, error: 'Invalid snippet category' })
      }
    })
  })

  // ── SNIPPET_GET_ALL ──────────────────────────────────────────────────────
  describe('SNIPPET_GET_ALL', () => {
    it('seeds pre-built snippets on first call', async () => {
      const result = await invoke(IPC.SNIPPET_GET_ALL) as any
      expect(result.ok).toBe(true)
      expect(result.data.length).toBeGreaterThan(0)
      expect(result.data.some((s: any) => s.trigger_text === 'nm')).toBe(true)
    })

    it('does not seed them in a workspace with other words', async () => {
      setDbWords(testDb.db, GENERIC_VOCAB)
      const result = await invoke(IPC.SNIPPET_GET_ALL) as any
      expect(result.ok).toBe(true)
      expect(result.data).toEqual([])
    })

    it('deleting every snippet does not bring the built-ins back', async () => {
      await invoke(IPC.SNIPPET_GET_ALL)
      testDb.db.prepare('DELETE FROM snippets').run()
      const result = await invoke(IPC.SNIPPET_GET_ALL) as any
      expect(result.data).toEqual([])
    })

    it('does not re-seed on subsequent calls', async () => {
      await invoke(IPC.SNIPPET_GET_ALL)
      const count1 = (testDb.db.prepare('SELECT COUNT(*) as c FROM snippets').get() as any).c
      await invoke(IPC.SNIPPET_GET_ALL)
      const count2 = (testDb.db.prepare('SELECT COUNT(*) as c FROM snippets').get() as any).c
      expect(count1).toBe(count2)
    })
  })

  // ── SNIPPET_CREATE ────────────────────────────────────────────────────────
  describe('SNIPPET_CREATE', () => {
    it('creates a snippet', async () => {
      const result = await invoke(IPC.SNIPPET_CREATE, 'hw', 'Hello world', 'Greetings') as any
      expect(result.ok).toBe(true)
      expect(result.data.trigger_text).toBe('hw')
      expect(result.data.expansion).toBe('Hello world')
    })

    it('allows null category', async () => {
      const result = await invoke(IPC.SNIPPET_CREATE, 'hw', 'Hello', null) as any
      expect(result.ok).toBe(true)
      expect(result.data.category).toBeNull()
    })

    it('fails with empty trigger', async () => {
      const result = await invoke(IPC.SNIPPET_CREATE, '', 'Hello', null) as any
      expect(result.ok).toBe(false)
    })

    it('fails with trigger over 50 chars', async () => {
      const result = await invoke(IPC.SNIPPET_CREATE, 'x'.repeat(51), 'Hello', null) as any
      expect(result.ok).toBe(false)
    })

    it('fails with expansion over 50k chars', async () => {
      const result = await invoke(IPC.SNIPPET_CREATE, 'hw', 'x'.repeat(50_001), null) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── SNIPPET_UPDATE ────────────────────────────────────────────────────────
  describe('SNIPPET_UPDATE', () => {
    it('updates trigger_text', async () => {
      const r = testDb.db.prepare("INSERT INTO snippets (trigger_text, expansion, created_at) VALUES (?, ?, datetime('now'))").run('old', 'text')
      const id = r.lastInsertRowid as number
      const result = await invoke(IPC.SNIPPET_UPDATE, id, { trigger_text: 'new' }) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT trigger_text FROM snippets WHERE id = ?').get(id) as any
      expect(row.trigger_text).toBe('new')
    })

    it('fails with empty trigger', async () => {
      const r = testDb.db.prepare("INSERT INTO snippets (trigger_text, expansion, created_at) VALUES (?, ?, datetime('now'))").run('old', 'text')
      const result = await invoke(IPC.SNIPPET_UPDATE, r.lastInsertRowid, { trigger_text: '' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with no valid fields', async () => {
      const r = testDb.db.prepare("INSERT INTO snippets (trigger_text, expansion, created_at) VALUES (?, ?, datetime('now'))").run('old', 'text')
      const result = await invoke(IPC.SNIPPET_UPDATE, r.lastInsertRowid, { bogus: 'x' }) as any
      expect(result.ok).toBe(false)
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.SNIPPET_UPDATE, -1, { trigger_text: 'x' }) as any
      expect(result.ok).toBe(false)
    })
  })

  // ── SNIPPET_DELETE ────────────────────────────────────────────────────────
  describe('SNIPPET_DELETE', () => {
    it('deletes a snippet', async () => {
      const r = testDb.db.prepare("INSERT INTO snippets (trigger_text, expansion, created_at) VALUES (?, ?, datetime('now'))").run('hw', 'Hello')
      const id = r.lastInsertRowid as number
      const result = await invoke(IPC.SNIPPET_DELETE, id) as any
      expect(result.ok).toBe(true)
      const row = testDb.db.prepare('SELECT * FROM snippets WHERE id = ?').get(id)
      expect(row).toBeUndefined()
    })

    it('fails with invalid ID', async () => {
      const result = await invoke(IPC.SNIPPET_DELETE, 0) as any
      expect(result.ok).toBe(false)
    })
  })

})
