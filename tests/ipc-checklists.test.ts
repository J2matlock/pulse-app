/**
 * IPC Checklist Handler Tests — tests all CHECKLIST_*, CL_TEMPLATE_* handlers.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'
import { localDateString } from '../src/shared/dates'
import { addRepeats } from '../src/shared/recurrence'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-checklists') },
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

vi.mock('../src/main/templates', () => ({
  seedChecklistTemplates: () => {},
}))

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

let gridId: number
let rowId: number

beforeAll(async () => {
  testDb = createTestDb()
  const { registerChecklistHandlers } = await import('../src/main/ipc/ipc-checklists')
  registerChecklistHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
  const seed = seedGrid(testDb.db, { rowCount: 2 })
  gridId = seed.gridId
  rowId = seed.rowIds[0]
})

afterEach(() => { cleanupTestDb(testDb) })

async function createItem(title = 'Test item', extra?: Record<string, unknown>) {
  return await invoke(IPC.CHECKLIST_CREATE_ITEM, rowId, title, extra) as any
}

describe('CHECKLIST_GET', () => {
  it('returns empty array for row with no items', async () => {
    const r = await invoke(IPC.CHECKLIST_GET, rowId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toEqual([])
  })

  it('returns items for valid row', async () => {
    await createItem('Item 1')
    await createItem('Item 2')
    const r = await invoke(IPC.CHECKLIST_GET, rowId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveLength(2)
  })

  it('excludes archived items', async () => {
    const item = await createItem('Will archive')
    await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { is_archived: 1 })
    const r = await invoke(IPC.CHECKLIST_GET, rowId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveLength(0)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CHECKLIST_GET, -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('CHECKLIST_CREATE_ITEM', () => {
  it('creates an item with defaults', async () => {
    const r = await createItem('New task')
    expect(r.ok).toBe(true)
    expect(r.data.title).toBe('New task')
    expect(r.data.priority).toBe('normal')
    expect(r.data.is_completed).toBe(0)
    expect(r.data.position).toBe(0)
  })

  it('creates with extra fields', async () => {
    const r = await createItem('With extras', { description: 'Details', priority: 'high', due_date: '2026-04-01' })
    expect(r.ok).toBe(true)
    expect(r.data.description).toBe('Details')
    expect(r.data.priority).toBe('high')
  })

  it('auto-increments position', async () => {
    await createItem('First')
    const r = await createItem('Second')
    expect(r.data.position).toBe(1)
  })

  it('fails for empty title', async () => {
    const r = await invoke(IPC.CHECKLIST_CREATE_ITEM, rowId, '', {}) as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Title')
  })

  it('fails for title over 1000 chars', async () => {
    const r = await invoke(IPC.CHECKLIST_CREATE_ITEM, rowId, 'x'.repeat(1001), {}) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid priority', async () => {
    const r = await invoke(IPC.CHECKLIST_CREATE_ITEM, rowId, 'Test', { priority: 'extreme' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid row ID', async () => {
    const r = await invoke(IPC.CHECKLIST_CREATE_ITEM, 0, 'Test') as any
    expect(r.ok).toBe(false)
  })

  it('fails for non-string description', async () => {
    const r = await invoke(IPC.CHECKLIST_CREATE_ITEM, rowId, 'Test', { description: 123 }) as any
    expect(r.ok).toBe(false)
  })
})

describe('CHECKLIST_UPDATE_ITEM', () => {
  it('updates title', async () => {
    const item = await createItem('Original')
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { title: 'Updated' }) as any
    expect(r.ok).toBe(true)
  })

  it('logs completion in case log', async () => {
    const item = await createItem('Task to complete')
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { is_completed: 1 }) as any
    expect(r.ok).toBe(true)
    expect(r.data.sysLogId).toBeTypeOf('number')
  })

  it('a repeating item ticked off logs it and comes back with its next due date (audit 1.26)', async () => {
    const today = localDateString()
    const item = await createItem('Monthly home safety check', { due_date: today, recurrence_rule: JSON.stringify({ type: 'monthly', interval: 1 }) })
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { is_completed: 1, completed_at: new Date().toISOString() }) as any
    const next = addRepeats(today, { type: 'monthly', interval: 1 })
    expect(r.data.repeat).toEqual({ previousDue: today, nextDue: next })
    expect(r.data.sysLogId).toBeTypeOf('number')
    const row = testDb.db.prepare('SELECT is_completed, completed_at, due_date FROM checklist_items WHERE id = ?').get(item.data.id) as any
    expect(row).toEqual({ is_completed: 0, completed_at: null, due_date: next })
    // Undo puts the old date back without another log entry
    const u = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { is_completed: 0, completed_at: null, due_date: today }) as any
    expect(u.data.sysLogId).toBeNull()
    expect((testDb.db.prepare('SELECT due_date FROM checklist_items WHERE id = ?').get(item.data.id) as any).due_date).toBe(today)
  })

  it('a monthly item due on the 31st comes back on the 31st after February (bug sweep S2)', async () => {
    const item = await createItem('Monthly visit', { due_date: '2099-01-31', recurrence_rule: JSON.stringify({ type: 'monthly', interval: 1 }) })
    const tick = () => invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { is_completed: 1, completed_at: new Date().toISOString() }) as any
    expect((await tick()).data.repeat.nextDue).toBe('2099-02-28')
    expect((await tick()).data.repeat.nextDue).toBe('2099-03-31')
  })

  it('a late repeating item comes back due this cycle, not still overdue; one without a date counts from today', async () => {
    const today = localDateString()
    const weekly = { type: 'weekly', interval: 1 } as const
    const late = await createItem('Weekly call', { due_date: addRepeats(today, weekly, -3), recurrence_rule: JSON.stringify(weekly) })
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, late.data.id, { is_completed: 1 }) as any
    expect(r.data.repeat.nextDue).toBe(today)
    const undated = await createItem('Check in', { recurrence_rule: JSON.stringify(weekly) })
    const r2 = await invoke(IPC.CHECKLIST_UPDATE_ITEM, undated.data.id, { is_completed: 1 }) as any
    expect(r2.data.repeat.nextDue).toBe(addRepeats(today, weekly))
  })

  it('a repeating item past its end date, or one that doesn\'t repeat, stays done', async () => {
    const today = localDateString()
    const ended = await createItem('Last one', { due_date: today, recurrence_rule: JSON.stringify({ type: 'weekly', interval: 1, end_date: today }) })
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, ended.data.id, { is_completed: 1 }) as any
    expect(r.data.repeat).toBeNull()
    expect((testDb.db.prepare('SELECT is_completed FROM checklist_items WHERE id = ?').get(ended.data.id) as any).is_completed).toBe(1)
    const once = await createItem('Once', { due_date: today })
    const r2 = await invoke(IPC.CHECKLIST_UPDATE_ITEM, once.data.id, { is_completed: 1 }) as any
    expect(r2.data.repeat).toBeNull()
  })

  it('undo and redo put an item back quietly: no new log entry and no repeat (audit S-23)', async () => {
    const item = await createItem('Monthly', { due_date: '2030-01-15', recurrence_rule: JSON.stringify({ type: 'monthly', interval: 1 }) })
    const logs = () => (testDb.db.prepare('SELECT COUNT(*) AS n FROM case_log WHERE row_id = ?').get(rowId) as { n: number }).n
    const before = logs()
    const done = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { is_completed: 1, completed_at: '2030-01-15T10:00:00Z' }, { silent: true }) as any
    expect(done.data).toEqual({ sysLogId: null, repeat: null })
    expect((testDb.db.prepare('SELECT is_completed, due_date FROM checklist_items WHERE id = ?').get(item.data.id) as any)).toEqual({ is_completed: 1, due_date: '2030-01-15' })
    await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { is_completed: 0, completed_at: null }, { silent: true })
    expect(logs()).toBe(before)
  })

  it('logs un-completion in case log', async () => {
    const item = await createItem('Task')
    await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { is_completed: 1 })
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { is_completed: 0 }) as any
    expect(r.ok).toBe(true)
    expect(r.data.sysLogId).toBeTypeOf('number')
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, -1, { title: 'X' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for empty title', async () => {
    const item = await createItem('Original')
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { title: '' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for title over 500 chars', async () => {
    const item = await createItem('Original')
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { title: 'x'.repeat(501) }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for description over 5000 chars', async () => {
    const item = await createItem('Original')
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { description: 'x'.repeat(5001) }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid due_date format', async () => {
    const item = await createItem('Original')
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { due_date: 'not-a-date' }) as any
    expect(r.ok).toBe(false)
  })

  it('accepts valid due_date', async () => {
    const item = await createItem('Original')
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { due_date: '2026-04-01' }) as any
    expect(r.ok).toBe(true)
  })

  it('fails for no valid fields', async () => {
    const item = await createItem('Original')
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { nonexistent_field: 'x' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for recurrence_rule over 1000 chars', async () => {
    const item = await createItem('Original')
    const r = await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { recurrence_rule: 'x'.repeat(1001) }) as any
    expect(r.ok).toBe(false)
  })
})

describe('CHECKLIST_DELETE_ITEM', () => {
  it('deletes an item', async () => {
    const item = await createItem('To delete')
    const r = await invoke(IPC.CHECKLIST_DELETE_ITEM, item.data.id) as any
    expect(r.ok).toBe(true)
    const items = (await invoke(IPC.CHECKLIST_GET, rowId) as any).data
    expect(items).toHaveLength(0)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CHECKLIST_DELETE_ITEM, 0) as any
    expect(r.ok).toBe(false)
  })
})

describe('CHECKLIST_REORDER', () => {
  it('reorders items', async () => {
    const a = await createItem('A')
    const b = await createItem('B')
    const c = await createItem('C')
    const r = await invoke(IPC.CHECKLIST_REORDER, rowId, [c.data.id, a.data.id, b.data.id]) as any
    expect(r.ok).toBe(true)
    const items = (await invoke(IPC.CHECKLIST_GET, rowId) as any).data
    expect(items[0].id).toBe(c.data.id)
  })

  it('fails for invalid row ID', async () => {
    const r = await invoke(IPC.CHECKLIST_REORDER, -1, [1, 2]) as any
    expect(r.ok).toBe(false)
  })

  it('fails for non-array', async () => {
    const r = await invoke(IPC.CHECKLIST_REORDER, rowId, 'not-array') as any
    expect(r.ok).toBe(false)
  })

  it('fails for array over 500 items', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1)
    const r = await invoke(IPC.CHECKLIST_REORDER, rowId, ids) as any
    expect(r.ok).toBe(false)
  })

  it('fails for non-integer IDs', async () => {
    const r = await invoke(IPC.CHECKLIST_REORDER, rowId, [1, -1, 3]) as any
    expect(r.ok).toBe(false)
  })
})

describe('CHECKLIST_GET_URGENT', () => {
  it('returns urgent items across all grids', async () => {
    await createItem('Urgent task', { priority: 'urgent' })
    const r = await invoke(IPC.CHECKLIST_GET_URGENT) as any
    expect(r.ok).toBe(true)
    expect(r.data.length).toBeGreaterThanOrEqual(1)
    expect(r.data[0].priority).toBe('urgent')
  })

  it('leaves out items of records in a list in the Trash (bug sweep S2)', async () => {
    await createItem('Urgent task', { priority: 'urgent' })
    testDb.db.prepare("UPDATE grids SET is_active = 0, deleted_at = datetime('now')").run()
    const r = await invoke(IPC.CHECKLIST_GET_URGENT) as any
    expect(r.data).toHaveLength(0)
  })

  it('excludes completed urgent items', async () => {
    const item = await createItem('Done urgent', { priority: 'urgent' })
    await invoke(IPC.CHECKLIST_UPDATE_ITEM, item.data.id, { is_completed: 1 })
    const r = await invoke(IPC.CHECKLIST_GET_URGENT) as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveLength(0)
  })
})

describe('CHECKLIST_RESET_CYCLE', () => {
  it('uncompletes all completed items for a row', async () => {
    const a = await createItem('A')
    const b = await createItem('B')
    await invoke(IPC.CHECKLIST_UPDATE_ITEM, a.data.id, { is_completed: 1 })
    await invoke(IPC.CHECKLIST_UPDATE_ITEM, b.data.id, { is_completed: 1 })

    const r = await invoke(IPC.CHECKLIST_RESET_CYCLE, rowId) as any
    expect(r.ok).toBe(true)

    const items = (await invoke(IPC.CHECKLIST_GET, rowId) as any).data
    expect(items.every((i: any) => i.is_completed === 0)).toBe(true)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CHECKLIST_RESET_CYCLE, -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('CHECKLIST_RESTORE_ITEM', () => {
  it('restores a deleted item', async () => {
    const item = {
      id: 99999, row_id: rowId, title: 'Restored', description: null,
      is_completed: 0, due_date: null, completed_at: null, completed_by: null,
      position: 0, category: null, priority: 'normal', is_archived: 0,
      created_at: '2026-03-01 12:00:00', template_source_id: null, recurrence_rule: null,
    }
    const r = await invoke(IPC.CHECKLIST_RESTORE_ITEM, item) as any
    // L-01: the INSERT used to name an updated_at column the table doesn't have, so every undo failed
    expect(r.ok).toBe(true)
    const back = testDb.db.prepare('SELECT title, created_at FROM checklist_items WHERE id = 99999').get() as { title: string; created_at: string }
    expect(back).toEqual({ title: 'Restored', created_at: '2026-03-01 12:00:00' })
  })

  it('fails for duplicate ID', async () => {
    const existing = await createItem('Existing')
    const item = {
      id: existing.data.id, row_id: rowId, title: 'Dup', description: null,
      is_completed: 0, due_date: null, completed_at: null, completed_by: null,
      position: 0, category: null, priority: 'normal', is_archived: 0,
      created_at: '2026-03-01 12:00:00', template_source_id: null, recurrence_rule: null,
    }
    const r = await invoke(IPC.CHECKLIST_RESTORE_ITEM, item) as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('already exists')
  })

  it('fails for missing title', async () => {
    const r = await invoke(IPC.CHECKLIST_RESTORE_ITEM, { id: 88888, row_id: rowId, title: '', created_at: '2026-03-01' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for created_at out of range', async () => {
    const item = {
      id: 77777, row_id: rowId, title: 'Future', description: null,
      is_completed: 0, due_date: null, completed_at: null, completed_by: null,
      position: 0, category: null, priority: 'normal', is_archived: 0,
      created_at: '2030-01-01 00:00:00', template_source_id: null, recurrence_rule: null,
    }
    const r = await invoke(IPC.CHECKLIST_RESTORE_ITEM, item) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid format', async () => {
    const r = await invoke(IPC.CHECKLIST_RESTORE_ITEM, { id: 'bad' }) as any
    expect(r.ok).toBe(false)
  })
})

describe('CHECKLIST_APPLY_TEMPLATE', () => {
  it('applies a template to a row', async () => {
    // Create a template
    testDb.db.prepare(`INSERT INTO checklist_templates (name, items, is_recurring, is_system, created_at) VALUES (?, ?, 0, 0, datetime('now'))`)
      .run('Test Template', JSON.stringify([{ title: 'Step 1' }, { title: 'Step 2', priority: 'high' }]))
    const templateId = testDb.db.prepare('SELECT id FROM checklist_templates ORDER BY id DESC LIMIT 1').get() as any

    const r = await invoke(IPC.CHECKLIST_APPLY_TEMPLATE, rowId, templateId.id) as any
    expect(r.ok).toBe(true)
    expect(r.data.createdIds).toHaveLength(2)
  })

  it('a repeating template makes items that come back N days after they\'re ticked off', async () => {
    testDb.db.prepare(`INSERT INTO checklist_templates (name, items, is_recurring, recurrence_days, is_system, created_at) VALUES (?, ?, 1, 30, 0, datetime('now'))`)
      .run('Monthly', JSON.stringify(['Smoke alarms', 'Medications']))
    const templateId = testDb.db.prepare('SELECT id FROM checklist_templates ORDER BY id DESC LIMIT 1').get() as any
    const r = await invoke(IPC.CHECKLIST_APPLY_TEMPLATE, rowId, templateId.id) as any
    const rules = testDb.db.prepare(`SELECT recurrence_rule FROM checklist_items WHERE id IN (${r.data.createdIds.join(',')})`).all() as any[]
    expect(rules.map(x => JSON.parse(x.recurrence_rule))).toEqual([{ type: 'daily', interval: 30 }, { type: 'daily', interval: 30 }])
    const done = await invoke(IPC.CHECKLIST_UPDATE_ITEM, r.data.createdIds[0], { is_completed: 1 }) as any
    expect(done.data.repeat.nextDue).toBe(addRepeats(localDateString(), { type: 'daily', interval: 30 }))
  })

  it('fails for non-existent template', async () => {
    const r = await invoke(IPC.CHECKLIST_APPLY_TEMPLATE, rowId, 99999) as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not found')
  })

  it('fails for invalid IDs', async () => {
    const r = await invoke(IPC.CHECKLIST_APPLY_TEMPLATE, -1, 1) as any
    expect(r.ok).toBe(false)
  })
})

describe('CL_TEMPLATE_GET_ALL', () => {
  it('returns templates', async () => {
    const r = await invoke(IPC.CL_TEMPLATE_GET_ALL) as any
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.data)).toBe(true)
  })
})

describe('CL_TEMPLATE_CREATE', () => {
  it('creates a user template', async () => {
    const template = { name: 'My Template', description: 'Desc', items: JSON.stringify([{ title: 'Item' }]), is_recurring: 0, recurrence_days: null }
    const r = await invoke(IPC.CL_TEMPLATE_CREATE, template) as any
    expect(r.ok).toBe(true)
    expect(r.data.name).toBe('My Template')
    expect(r.data.is_system).toBe(0)
  })

  it('fails for empty name', async () => {
    const r = await invoke(IPC.CL_TEMPLATE_CREATE, { name: '', items: '[]', is_recurring: 0 }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for name over 200 chars', async () => {
    const r = await invoke(IPC.CL_TEMPLATE_CREATE, { name: 'x'.repeat(201), items: '[]', is_recurring: 0 }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for items over 100k', async () => {
    const r = await invoke(IPC.CL_TEMPLATE_CREATE, { name: 'Test', items: 'x'.repeat(100_001), is_recurring: 0 }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid JSON items', async () => {
    const r = await invoke(IPC.CL_TEMPLATE_CREATE, { name: 'Test', items: '{bad}', is_recurring: 0 }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for non-array items', async () => {
    const r = await invoke(IPC.CL_TEMPLATE_CREATE, { name: 'Test', items: '{}', is_recurring: 0 }) as any
    expect(r.ok).toBe(false)
  })
})

describe('CL_TEMPLATE_UPDATE', () => {
  it('updates a template name', async () => {
    const t = await invoke(IPC.CL_TEMPLATE_CREATE, { name: 'Original', items: '[]', is_recurring: 0 }) as any
    const r = await invoke(IPC.CL_TEMPLATE_UPDATE, t.data.id, { name: 'Renamed' }) as any
    expect(r.ok).toBe(true)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CL_TEMPLATE_UPDATE, -1, { name: 'X' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for no valid fields', async () => {
    const t = await invoke(IPC.CL_TEMPLATE_CREATE, { name: 'Temp', items: '[]', is_recurring: 0 }) as any
    const r = await invoke(IPC.CL_TEMPLATE_UPDATE, t.data.id, { bogus: 1 }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid items JSON', async () => {
    const t = await invoke(IPC.CL_TEMPLATE_CREATE, { name: 'Temp', items: '[]', is_recurring: 0 }) as any
    const r = await invoke(IPC.CL_TEMPLATE_UPDATE, t.data.id, { items: '{bad}' }) as any
    expect(r.ok).toBe(false)
  })
})

describe('CL_TEMPLATE_DELETE', () => {
  it('deletes a template', async () => {
    const t = await invoke(IPC.CL_TEMPLATE_CREATE, { name: 'To delete', items: '[]', is_recurring: 0 }) as any
    const r = await invoke(IPC.CL_TEMPLATE_DELETE, t.data.id) as any
    expect(r.ok).toBe(true)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CL_TEMPLATE_DELETE, -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('checklist template files (polish R6)', () => {
  it('won\'t write or read a file outside the folders Pulse may use', async () => {
    const id = Number(testDb.db.prepare("INSERT INTO checklist_templates (name, items) VALUES ('Intake', '[]')").run().lastInsertRowid)
    const exp = await invoke(IPC.CL_TEMPLATE_EXPORT, id, '/etc/intake.pulse-checklist')
    expect(exp).toMatchObject({ ok: false, error: expect.stringMatching(/can't use that folder/) })
    const imp = await invoke(IPC.CL_TEMPLATE_IMPORT, 'relative/intake.pulse-checklist')
    expect(imp).toMatchObject({ ok: false, error: expect.stringMatching(/can't use that folder/) })
  })
})
