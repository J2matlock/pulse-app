/**
 * People's own note types (plans/generalization/W03-activity.md §2): keys are
 * made once and never change, used types can only be archived.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(tmpdir(), 'pulse-test-activity-types'), getName: () => 'Pulse Test', getVersion: () => '0.0.0-test', commandLine: { appendSwitch: () => {} }, on: () => {} },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) }, on: () => {} },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }), showMessageBoxSync: () => 0 },
  shell: { openPath: async () => '', openExternal: async () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))
vi.mock('../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))
vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return { default: class { get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d } set(k: string, v?: unknown) { map.set(k, v) } has(k: string) { return map.has(k) } delete(k: string) { map.delete(k) } clear() { map.clear() } } }
})

let testDb: TestDb
// The real module loads only after everything has bound to this mock
// (database.ts imports contacts.ts; loading it first binds that to the real connection)
type DbModule = typeof import('../src/main/database')
let realDb: DbModule
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  invalidateGridStmtCache: () => {},
  registerCloseHook: () => {},
  buildGridQuery: (...a: Parameters<DbModule['buildGridQuery']>) => realDb.buildGridQuery(...a),
  getRow: () => null,
  upsertCell: (rowId: number, columnId: number, value: string | null) => {
    testDb.db.prepare(`INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(rowId, columnId, value)
  },
}))

import { isValidLogType, userTypeKeys } from '../src/main/activity-types'
import { changeHeading, keyFromLabel, labelFor } from '../src/shared/activityTypes'

const fakeEvent = { senderFrame: { parent: null } }
async function invoke(channel: string, ...args: unknown[]): Promise<{ ok: boolean; data?: any; error?: string }> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args) as { ok: boolean; data?: any; error?: string }
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerActivityTypeHandlers } = await import('../src/main/ipc/ipc-activity-types')
  registerActivityTypeHandlers()
  realDb = await vi.importActual<DbModule>('../src/main/database')
})

let rowId: number
beforeEach(() => {
  testDb = createTestDb()
  rowId = seedGrid(testDb.db, { rowCount: 1 }).rowIds[0]!
})
afterEach(() => cleanupTestDb(testDb))

const keys = async (includeArchived = false) => ((await invoke(IPC.ACTIVITY_TYPE_GET_ALL, includeArchived)).data as Array<{ key: string }>).map(t => t.key)

describe('note type keys and labels', () => {
  it('makes a key from the label, avoiding taken and system keys', () => {
    expect(keyFromLabel('No-show', new Set())).toBe('no_show')
    expect(keyFromLabel('No show', new Set(['no_show']))).toBe('no_show_2')
    expect(keyFromLabel('Café visit', new Set())).toBe('cafe_visit')
    expect(keyFromLabel('System', new Set())).toBe('system_2')
    expect(keyFromLabel('!!!', new Set())).toBe('type')
  })

  it('labels archived, system and unknown keys readably', () => {
    const list = [{ key: 'session', label: 'Session' }]
    expect(labelFor(list, 'session')).toBe('Session')
    expect(labelFor(list, 'followup')).toBe('Follow-up')
    expect(labelFor(list, 'home_check')).toBe('Home check')
    // Pulse's own entries are "changes" in the notes log, not "System" (C-01)
    expect(labelFor(list, 'system')).toBe('Change')
  })

  it('reads the column off a change entry for its heading', () => {
    expect(changeHeading('Program changed from Housing to Behavioral Health')).toBe('Program changed')
    expect(changeHeading('Status changed to "Open"')).toBe('Status changed')
    expect(changeHeading('Phone cleared (was 555)')).toBe('Phone cleared')
    expect(changeHeading('Completed checklist item: Intake')).toBeNull()
    expect(changeHeading('Client moved to the Trash')).toBeNull()
  })
})

describe('ACTIVITY_TYPE_*', () => {
  it('starts with the five built-in types', async () => {
    expect(await keys()).toEqual(['note', 'phone', 'meeting', 'email', 'visit'])
  })

  it('adds a type at the end with a key that never changes on rename', async () => {
    const created = await invoke(IPC.ACTIVITY_TYPE_SAVE, { label: 'No-show', icon: '🚫', color: 'red' })
    expect(created.data).toMatchObject({ key: 'no_show', label: 'No-show', icon: '🚫', color: 'red', position: 5, is_archived: 0 })
    const renamed = await invoke(IPC.ACTIVITY_TYPE_SAVE, { id: created.data.id, label: 'Missed', icon: '', color: 'nope' })
    expect(renamed.data).toMatchObject({ key: 'no_show', label: 'Missed', icon: null, color: null })
  })

  it('turns away empty, too long and duplicate names', async () => {
    expect((await invoke(IPC.ACTIVITY_TYPE_SAVE, { label: '  ' })).ok).toBe(false)
    expect((await invoke(IPC.ACTIVITY_TYPE_SAVE, { label: 'x'.repeat(41) })).ok).toBe(false)
    expect((await invoke(IPC.ACTIVITY_TYPE_SAVE, { label: 'phone' })).error).toMatch(/already a type called/)
  })

  it('new notes can use active types only; archived ones stay valid for edits and undo', async () => {
    const id = (await invoke(IPC.ACTIVITY_TYPE_SAVE, { label: 'Session' })).data.id
    expect(isValidLogType('session')).toBe(true)
    await invoke(IPC.ACTIVITY_TYPE_ARCHIVE, id, true)
    expect(isValidLogType('session')).toBe(false)
    expect(isValidLogType('session', { allowArchived: true })).toBe(true)
    expect(isValidLogType('system')).toBe(true)
    expect(isValidLogType('made_up', { allowArchived: true })).toBe(false)
    expect(await keys()).not.toContain('session')
    expect(await keys(true)).toContain('session')
    await invoke(IPC.ACTIVITY_TYPE_ARCHIVE, id, false)
    expect(userTypeKeys().has('session')).toBe(true)
  })

  it('deletes a type only when nothing uses it', async () => {
    const unused = (await invoke(IPC.ACTIVITY_TYPE_SAVE, { label: 'Unused' })).data.id
    expect((await invoke(IPC.ACTIVITY_TYPE_DELETE, unused)).ok).toBe(true)

    const phone = (testDb.db.prepare("SELECT id FROM activity_types WHERE key = 'phone'").get() as { id: number }).id
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Called', 'phone')").run(rowId)
    expect((await invoke(IPC.ACTIVITY_TYPE_DELETE, phone)).error).toMatch(/used by 1 .*Archive it instead/)

    const email = (testDb.db.prepare("SELECT id FROM activity_types WHERE key = 'email'").get() as { id: number }).id
    const gridId = (testDb.db.prepare('SELECT id FROM grids LIMIT 1').get() as { id: number }).id
    testDb.db.prepare("INSERT INTO contact_requirements (grid_id, label, note_types, per_month) VALUES (?, 'Emails', '[\"email\"]', 1)").run(gridId)
    expect((await invoke(IPC.ACTIVITY_TYPE_DELETE, email)).ok).toBe(false)

    // The full list says what each type is used by, so Settings can grey out Delete with the reason (E-21)
    const all = (await invoke(IPC.ACTIVITY_TYPE_GET_ALL, true)).data as Array<{ key: string; in_use?: { notes: number; other: number } }>
    expect(all.find(t => t.key === 'phone')?.in_use).toEqual({ notes: 1, other: 0 })
    expect(all.find(t => t.key === 'email')?.in_use).toEqual({ notes: 0, other: 1 })
    expect(all.find(t => t.key === 'visit')?.in_use).toEqual({ notes: 0, other: 0 })
    // The short list is for note boxes and has no counts to compute
    const active = (await invoke(IPC.ACTIVITY_TYPE_GET_ALL, false)).data as Array<{ in_use?: unknown }>
    expect(active.every(t => t.in_use === undefined)).toBe(true)
  })

  it('counts deadline rules, forms, stage steps and appointments as uses, and names them (L-15)', async () => {
    const db = testDb.db
    const gridId = (db.prepare('SELECT id FROM grids LIMIT 1').get() as { id: number }).id
    const mk = async (label: string) => (await invoke(IPC.ACTIVITY_TYPE_SAVE, { label })).data as { id: number; key: string }
    const del = async (t: { id: number }) => invoke(IPC.ACTIVITY_TYPE_DELETE, t.id)

    const visit = await mk('Auth visit')
    db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Authorized visits', '[]', 'quota', ?)")
      .run(JSON.stringify({ kind: 'quota', activityTypes: [visit.key], limit: 12, startColumnId: 1, endColumnId: 2, warnRemaining: 2, warnDaysBeforeEnd: 14 }))
    expect((await del(visit)).error).toMatch(/deadline rule "Authorized visits".*Archive it instead/)

    const intake = await mk('Intake note')
    db.prepare("INSERT INTO forms (grid_id, name, fields, log_activity_type, position) VALUES (?, 'Intake', '[]', ?, 0)").run(gridId, intake.key)
    expect((await del(intake)).error).toMatch(/form "Intake"/)

    const moved = await mk('Moved on')
    db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Status', 'status', 50, ?)")
      .run(gridId, JSON.stringify({ stage: { options: [{ label: 'Open' }, { label: 'Closed', onEnter: { activityTypeKey: moved.key } }] } }))
    expect((await del(moved)).error).toMatch(/column "Status"/)

    const call = await mk('Booked call')
    db.prepare("INSERT INTO appointments (row_id, title, start_at, all_day, activity_type_key) VALUES (?, 'Call', '2026-10-20T10:00', 0, ?)").run(rowId, call.key)
    expect((await del(call)).error).toMatch(/1 appointment/)
  })

  it('always keeps at least one type to choose from', async () => {
    const ids = (testDb.db.prepare('SELECT id FROM activity_types ORDER BY position').all() as Array<{ id: number }>).map(r => r.id)
    for (const id of ids.slice(1)) expect((await invoke(IPC.ACTIVITY_TYPE_ARCHIVE, id, true)).ok).toBe(true)
    expect((await invoke(IPC.ACTIVITY_TYPE_ARCHIVE, ids[0], true)).error).toMatch(/at least one/)
  })

  it('reorders', async () => {
    const ids = (testDb.db.prepare('SELECT id FROM activity_types ORDER BY position').all() as Array<{ id: number }>).map(r => r.id)
    expect((await invoke(IPC.ACTIVITY_TYPE_REORDER, [...ids].reverse())).ok).toBe(true)
    expect(await keys()).toEqual(['visit', 'email', 'meeting', 'phone', 'note'])
    expect((await invoke(IPC.ACTIVITY_TYPE_REORDER, ['x'])).ok).toBe(false)
  })
})
