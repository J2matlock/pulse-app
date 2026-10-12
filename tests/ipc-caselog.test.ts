/**
 * IPC Case Log Handler Tests — tests all CASE_LOG_* and SCRAP_NOTE_* handlers.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'
import { localDateString } from '../src/shared/dates'

// ── Handler capture map ──────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-caselog') },
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

let gridId: number
let rowId: number

beforeAll(async () => {
  testDb = createTestDb()
  const { registerCaseLogHandlers } = await import('../src/main/ipc/ipc-caselog')
  registerCaseLogHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
  const seed = seedGrid(testDb.db, { rowCount: 1 })
  gridId = seed.gridId
  rowId = seed.rowIds[0]
})

afterEach(() => { cleanupTestDb(testDb) })

// Helper to create a case log entry
async function createEntry(content = 'Test note', logType = 'note', followUp: string | null = null) {
  return await invoke(IPC.CASE_LOG_CREATE, rowId, content, logType, followUp) as any
}

describe('CASE_LOG_GET paging values (Q-056)', () => {
  it('a limit or offset that is not a whole number falls back to the defaults', async () => {
    for (const [limit, offset] of [[NaN, NaN], [1.5, 2.5], ['10', '0'], [Infinity, -Infinity]]) {
      const r = await invoke(IPC.CASE_LOG_GET, rowId, false, false, limit, offset) as any
      expect(r.ok).toBe(true)
    }
  })
})

describe('CASE_LOG_GET', () => {
  it('returns empty array for row with no entries', async () => {
    const r = await invoke(IPC.CASE_LOG_GET, rowId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toEqual([])
  })

  it('returns entries for valid row', async () => {
    await createEntry('Note 1')
    await createEntry('Note 2')
    const r = await invoke(IPC.CASE_LOG_GET, rowId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveLength(2)
  })

  it('excludes system entries by default', async () => {
    await createEntry('User note', 'note')
    await createEntry('System entry', 'system')
    const r = await invoke(IPC.CASE_LOG_GET, rowId, false) as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveLength(1)
  })

  it('includes system entries when flag is true', async () => {
    await createEntry('User note', 'note')
    await createEntry('System entry', 'system')
    const r = await invoke(IPC.CASE_LOG_GET, rowId, true) as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveLength(2)
  })

  it('excludes voided entries by default', async () => {
    const e = await createEntry('Will void')
    await invoke(IPC.CASE_LOG_VOID, e.data.id, 'test reason')
    const r = await invoke(IPC.CASE_LOG_GET, rowId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveLength(0)
  })

  it('includes voided entries when flag is true', async () => {
    const e = await createEntry('Will void')
    await invoke(IPC.CASE_LOG_VOID, e.data.id, 'test reason')
    const r = await invoke(IPC.CASE_LOG_GET, rowId, false, true) as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveLength(1)
  })

  it('respects limit and offset', async () => {
    for (let i = 0; i < 5; i++) await createEntry(`Note ${i}`)
    const r = await invoke(IPC.CASE_LOG_GET, rowId, false, false, 2, 1) as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveLength(2)
  })

  it('clamps limit to valid range', async () => {
    for (let i = 0; i < 3; i++) await createEntry(`Note ${i}`)
    const r = await invoke(IPC.CASE_LOG_GET, rowId, false, false, 0) as any
    expect(r.ok).toBe(true)
    // limit=0 clamped to 1, should return 1
    expect(r.data.length).toBeLessThanOrEqual(3)
  })

  it('fails for invalid row ID', async () => {
    const r = await invoke(IPC.CASE_LOG_GET, -1) as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Invalid')
  })

  it('fails for non-integer ID', async () => {
    const r = await invoke(IPC.CASE_LOG_GET, 'abc') as any
    expect(r.ok).toBe(false)
  })
})

describe('CASE_LOG_CREATE', () => {
  it('takes people\'s own active types, not archived ones', async () => {
    testDb.db.prepare("INSERT INTO activity_types (key, label, position) VALUES ('session', 'Session', 9)").run()
    testDb.db.prepare("INSERT INTO activity_types (key, label, position, is_archived) VALUES ('old_kind', 'Old kind', 10, 1)").run()
    const r = await createEntry('Weekly session', 'session')
    expect(r.ok).toBe(true)
    expect(r.data.log_type).toBe('session')
    expect((await createEntry('Nope', 'old_kind')).ok).toBe(false)
  })

  it('creates a note entry', async () => {
    const r = await createEntry('Hello world', 'note')
    expect(r.ok).toBe(true)
    expect(r.data.content).toBe('Hello world')
    expect(r.data.log_type).toBe('note')
    expect(r.data.row_id).toBe(rowId)
  })

  it('stores optional minutes and miles, and validates them', async () => {
    const r = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Home visit', 'visit', null, { minutes: 45, miles: 12.46 }) as any
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({ minutes: 45, miles: 12.5 })
    for (const bad of [{ minutes: -5 }, { minutes: 1.5 }, { minutes: 2000 }, { miles: 5000 }, { miles: Number.NaN }]) {
      expect((await invoke(IPC.CASE_LOG_CREATE, rowId, 'x', 'visit', null, bad) as any).ok).toBe(false)
    }
    const set = await invoke(IPC.CASE_LOG_SET_MEASURES, r.data.id, { minutes: 30, miles: null }) as any
    expect(set.ok).toBe(true)
    const row = testDb.db.prepare('SELECT minutes, miles, updated_at, created_at FROM case_log WHERE id = ?').get(r.data.id) as any
    expect(row).toMatchObject({ minutes: 30, miles: null })
    expect(row.updated_at).toBe(row.created_at)  // not marked as an edited note
  })

  it('creates entry with follow-up date', async () => {
    const r = await createEntry('Follow up needed', 'note', '2026-04-01')
    expect(r.ok).toBe(true)
    expect(r.data.follow_up_date).toBe('2026-04-01')
  })

  it('fails for invalid log type', async () => {
    const r = await invoke(IPC.CASE_LOG_CREATE, rowId, 'content', 'invalid_type', null) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/isn't available any more/)
  })

  it('fails for empty content over 100k', async () => {
    const r = await invoke(IPC.CASE_LOG_CREATE, rowId, 'x'.repeat(100_001), 'note', null) as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('too long')
  })

  it('fails for invalid row ID', async () => {
    const r = await invoke(IPC.CASE_LOG_CREATE, 0, 'content', 'note', null) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid follow-up date format', async () => {
    const r = await invoke(IPC.CASE_LOG_CREATE, rowId, 'content', 'note', 'not-a-date') as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('follow-up date')
  })

  it('accepts all valid log types', async () => {
    for (const logType of ['note', 'phone', 'meeting', 'email', 'visit', 'system', 'manual', 'import', 'followup']) {
      const r = await invoke(IPC.CASE_LOG_CREATE, rowId, `Test ${logType}`, logType, null) as any
      expect(r.ok).toBe(true)
    }
  })
})

describe('CASE_LOG_UPDATE', () => {
  it('updates content and preserves original', async () => {
    const e = await createEntry('Original')
    const r = await invoke(IPC.CASE_LOG_UPDATE, e.data.id, 'Updated') as any
    expect(r.ok).toBe(true)
    const entries = (await invoke(IPC.CASE_LOG_GET, rowId) as any).data
    expect(entries[0].content).toBe('Updated')
    expect(entries[0].original_content).toBe('Original')
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CASE_LOG_UPDATE, -1, 'content') as any
    expect(r.ok).toBe(false)
  })

  it('fails for content over 100k', async () => {
    const e = await createEntry('Original')
    const r = await invoke(IPC.CASE_LOG_UPDATE, e.data.id, 'x'.repeat(100_001)) as any
    expect(r.ok).toBe(false)
  })
})

describe('CASE_LOG_DELETE', () => {
  it('deletes an entry', async () => {
    const e = await createEntry('To delete')
    const r = await invoke(IPC.CASE_LOG_DELETE, e.data.id) as any
    expect(r.ok).toBe(true)
    const entries = (await invoke(IPC.CASE_LOG_GET, rowId) as any).data
    expect(entries).toHaveLength(0)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CASE_LOG_DELETE, 0) as any
    expect(r.ok).toBe(false)
  })
})

describe('CASE_LOG_TOGGLE_PIN', () => {
  it('pins and unpins an entry', async () => {
    const e = await createEntry('Pinnable')
    let r = await invoke(IPC.CASE_LOG_TOGGLE_PIN, e.data.id, true) as any
    expect(r.ok).toBe(true)
    let entries = (await invoke(IPC.CASE_LOG_GET, rowId) as any).data
    expect(entries[0].is_pinned).toBe(1)

    r = await invoke(IPC.CASE_LOG_TOGGLE_PIN, e.data.id, false) as any
    expect(r.ok).toBe(true)
    entries = (await invoke(IPC.CASE_LOG_GET, rowId) as any).data
    expect(entries[0].is_pinned).toBe(0)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CASE_LOG_TOGGLE_PIN, -1, true) as any
    expect(r.ok).toBe(false)
  })
})

describe('CASE_LOG_VOID / UNVOID', () => {
  it('voids and unvoids an entry', async () => {
    const e = await createEntry('Will void')
    let r = await invoke(IPC.CASE_LOG_VOID, e.data.id, 'Mistake') as any
    expect(r.ok).toBe(true)

    let entries = (await invoke(IPC.CASE_LOG_GET, rowId, false, true) as any).data
    expect(entries[0].voided_at).toBeTruthy()
    expect(entries[0].voided_reason).toBe('Mistake')

    r = await invoke(IPC.CASE_LOG_UNVOID, e.data.id) as any
    expect(r.ok).toBe(true)

    entries = (await invoke(IPC.CASE_LOG_GET, rowId) as any).data
    expect(entries[0].voided_at).toBeNull()
  })

  it('void fails for invalid ID', async () => {
    const r = await invoke(IPC.CASE_LOG_VOID, 0, 'reason') as any
    expect(r.ok).toBe(false)
  })

  it('void fails for reason over 1000 chars', async () => {
    const e = await createEntry('Test')
    const r = await invoke(IPC.CASE_LOG_VOID, e.data.id, 'x'.repeat(1001)) as any
    expect(r.ok).toBe(false)
  })

  it('unvoid fails for invalid ID', async () => {
    const r = await invoke(IPC.CASE_LOG_UNVOID, -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('CASE_LOG_COMPLETE_FOLLOWUP / UNCOMPLETE', () => {
  it('completes a follow-up and creates system log', async () => {
    const e = await createEntry('Follow up task', 'note', '2026-04-01')
    const r = await invoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, e.data.id) as any
    expect(r.ok).toBe(true)
    expect(r.data.sysLogId).toBeTypeOf('number')

    // Check system log created
    const entries = (await invoke(IPC.CASE_LOG_GET, rowId, true) as any).data
    const sysEntry = entries.find((e: any) => e.log_type === 'system')
    expect(sysEntry).toBeTruthy()
    expect(sysEntry.content).toContain('Follow-up completed')
  })

  it('uncompletes a follow-up', async () => {
    const e = await createEntry('Follow up task', 'note', '2026-04-01')
    await invoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, e.data.id)
    const r = await invoke(IPC.CASE_LOG_UNCOMPLETE_FOLLOWUP, e.data.id) as any
    expect(r.ok).toBe(true)
  })

  it('complete fails for invalid ID', async () => {
    const r = await invoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, -1) as any
    expect(r.ok).toBe(false)
  })

  it('uncomplete fails for invalid ID', async () => {
    const r = await invoke(IPC.CASE_LOG_UNCOMPLETE_FOLLOWUP, 0) as any
    expect(r.ok).toBe(false)
  })
})

describe('CASE_LOG_RESTORE', () => {
  it('brings back a note whose type was archived since (undo)', async () => {
    testDb.db.prepare("INSERT INTO activity_types (key, label, position, is_archived) VALUES ('old_kind', 'Old kind', 10, 1)").run()
    const r = await invoke(IPC.CASE_LOG_RESTORE, {
      id: 77777, row_id: rowId, content: 'Old', log_type: 'old_kind', is_pinned: 0, follow_up_date: null,
      follow_up_completed: 0, voided_at: null, voided_reason: null, created_at: '2026-03-01 12:00:00',
    }) as any
    expect(r.ok).toBe(true)
  })

  it('restores a previously deleted entry', async () => {
    const entry = {
      id: 99999, row_id: rowId, content: 'Restored entry', log_type: 'note',
      is_pinned: 0, follow_up_date: null, follow_up_completed: 0,
      voided_at: null, voided_reason: null, created_at: '2026-03-01 12:00:00',
    }
    const r = await invoke(IPC.CASE_LOG_RESTORE, entry) as any
    expect(r.ok).toBe(true)
    const entries = (await invoke(IPC.CASE_LOG_GET, rowId) as any).data
    expect(entries.some((e: any) => e.id === 99999)).toBe(true)
  })

  it('fails for duplicate ID', async () => {
    const e = await createEntry('Existing')
    const entry = {
      id: e.data.id, row_id: rowId, content: 'Collision', log_type: 'note',
      is_pinned: 0, follow_up_date: null, follow_up_completed: 0,
      voided_at: null, voided_reason: null, created_at: '2026-03-01 12:00:00',
    }
    const r = await invoke(IPC.CASE_LOG_RESTORE, entry) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/is already there\./)
  })

  it('fails for invalid entry format', async () => {
    const r = await invoke(IPC.CASE_LOG_RESTORE, { id: 'not-a-number' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid log type', async () => {
    const entry = {
      id: 88888, row_id: rowId, content: 'Bad type', log_type: 'invalid',
      is_pinned: 0, follow_up_date: null, follow_up_completed: 0,
      voided_at: null, voided_reason: null, created_at: '2026-03-01 12:00:00',
    }
    const r = await invoke(IPC.CASE_LOG_RESTORE, entry) as any
    expect(r.ok).toBe(false)
  })

  it('fails for content over 100k', async () => {
    const entry = {
      id: 77777, row_id: rowId, content: 'x'.repeat(100_001), log_type: 'note',
      is_pinned: 0, follow_up_date: null, follow_up_completed: 0,
      voided_at: null, voided_reason: null, created_at: '2026-03-01 12:00:00',
    }
    const r = await invoke(IPC.CASE_LOG_RESTORE, entry) as any
    expect(r.ok).toBe(false)
  })

  it('fails for created_at out of range', async () => {
    const entry = {
      id: 66666, row_id: rowId, content: 'Future', log_type: 'note',
      is_pinned: 0, follow_up_date: null, follow_up_completed: 0,
      voided_at: null, voided_reason: null, created_at: '2030-01-01 00:00:00',
    }
    const r = await invoke(IPC.CASE_LOG_RESTORE, entry) as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('out of valid range')
  })
})

describe('SCRAP_NOTE_GET', () => {
  it('returns null for row with no note', async () => {
    const r = await invoke(IPC.SCRAP_NOTE_GET, rowId) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBeNull()
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.SCRAP_NOTE_GET, -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('SCRAP_NOTE_UPDATE', () => {
  it('creates and updates a scrap note (upsert)', async () => {
    let r = await invoke(IPC.SCRAP_NOTE_UPDATE, rowId, '<p>Hello</p>') as any
    expect(r.ok).toBe(true)

    const note = (await invoke(IPC.SCRAP_NOTE_GET, rowId) as any).data
    expect(note.content).toBe('<p>Hello</p>')

    r = await invoke(IPC.SCRAP_NOTE_UPDATE, rowId, '<p>Updated</p>') as any
    expect(r.ok).toBe(true)

    const note2 = (await invoke(IPC.SCRAP_NOTE_GET, rowId) as any).data
    expect(note2.content).toBe('<p>Updated</p>')
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.SCRAP_NOTE_UPDATE, 0, 'content') as any
    expect(r.ok).toBe(false)
  })

  it('fails for content over 500k', async () => {
    const r = await invoke(IPC.SCRAP_NOTE_UPDATE, rowId, 'x'.repeat(500_001)) as any
    expect(r.ok).toBe(false)
    expect(r.error).toBe('Scratch notes can be up to 500,000 characters.')
  })
})

describe('Case note records integrity', () => {
  it('keeps every earlier version when a note is edited', async () => {
    const e = await createEntry('First')
    await invoke(IPC.CASE_LOG_UPDATE, e.data.id, 'Second')
    await invoke(IPC.CASE_LOG_UPDATE, e.data.id, 'Third')
    await invoke(IPC.CASE_LOG_UPDATE, e.data.id, 'Third') // no-op edit adds nothing
    const r = await invoke(IPC.CASE_LOG_GET_EDITS, e.data.id) as any
    expect(r.ok).toBe(true)
    expect(r.data.map((v: { content: string }) => v.content)).toEqual(['First', 'Second'])
  })

  it('refuses to delete a note older than the delete window (void instead)', async () => {
    const e = await createEntry('Old note')
    testDb.db.prepare("UPDATE case_log SET created_at = datetime('now', '-1 hour') WHERE id = ?").run(e.data.id)
    const r = await invoke(IPC.CASE_LOG_DELETE, e.data.id) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Void it instead/)
    // Uses the activity word, and no longer says "in the record" (AUDIT-155)
    expect(r.error).toMatch(/^(Notes|Case notes) older than \d+ minutes can't be deleted/)
    expect(r.error).not.toMatch(/record/)
    expect(testDb.db.prepare('SELECT COUNT(*) AS n FROM case_log WHERE id = ?').get(e.data.id)).toEqual({ n: 1 })
  })
})

// ── When it happened (audit 1.22): occurred_at, created_at stays the write time ─
describe('notes dated by when they happened', () => {
  const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDateString(d) }
  const localDay = (ts: string) => localDateString(new Date(ts.replace(' ', 'T') + 'Z'))
  const note = (id: number) => testDb.db.prepare('SELECT created_at, occurred_at FROM case_log WHERE id = ?').get(id) as { created_at: string; occurred_at: string }
  let lastVisit: number
  beforeEach(() => {
    lastVisit = (testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? ORDER BY id LIMIT 1').get(gridId) as { id: number }).id
    testDb.db.prepare("UPDATE columns SET column_type = 'date', config = ? WHERE id = ?").run(JSON.stringify({ note_updates: ['visit'] }), lastVisit)
  })
  const cellValue = () => (testDb.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, lastVisit) as { value: string } | undefined)?.value ?? null

  it('a note happens today unless a day is given', async () => {
    const r = await createEntry('Visit', 'visit')
    expect(localDay(note(r.data.id).occurred_at)).toBe(localDateString())
    expect(r.data.occurred_at).toBe(note(r.data.id).occurred_at)
  })

  it('a late write-up is dated the day it happened, keeps the write time, and sets the date column to that day', async () => {
    const r = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Home visit', 'visit', null, undefined, day(-3))
    expect(r.ok).toBe(true)
    const n = note(r.data.id)
    expect(localDay(n.occurred_at)).toBe(day(-3))
    expect(localDay(n.created_at)).toBe(localDateString())
    expect(r.data.updated_dates).toEqual([expect.objectContaining({ column_id: lastVisit, new_value: day(-3) })])
    expect(cellValue()).toBe(day(-3))
  })

  it("doesn't keep the note when the date it moves can't be saved, so the two never disagree (AUDIT-105)", async () => {
    testDb.db.exec("CREATE TRIGGER fail_cells BEFORE INSERT ON cells BEGIN SELECT RAISE(ABORT, 'disk trouble'); END")
    const before = (testDb.db.prepare('SELECT COUNT(*) AS n FROM case_log WHERE row_id = ?').get(rowId) as { n: number }).n
    const r = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Home visit', 'visit', null)
    expect(r.ok).toBe(false)
    expect((testDb.db.prepare('SELECT COUNT(*) AS n FROM case_log WHERE row_id = ?').get(rowId) as { n: number }).n).toBe(before)
    expect(cellValue()).toBe(null)
  })

  it('refuses a day in the future or a made-up date', async () => {
    const future = await invoke(IPC.CASE_LOG_CREATE, rowId, 'x', 'visit', null, undefined, day(1))
    expect(future.ok).toBe(false)
    expect(future.error).toMatch(/hasn't happened yet/)
    expect((await invoke(IPC.CASE_LOG_CREATE, rowId, 'x', 'visit', null, undefined, '2026-02-31')).ok).toBe(false)
    expect((await invoke(IPC.CASE_LOG_CREATE, rowId, 'x', 'visit', null, undefined, 'last week')).ok).toBe(false)
  })

  it('lists notes in the order they happened', async () => {
    const today = await createEntry('Today', 'visit')
    const back = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Last week', 'visit', null, undefined, day(-7))
    const mid = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Two days ago', 'visit', null, undefined, day(-2))
    const r = await invoke(IPC.CASE_LOG_GET, rowId)
    expect(r.data.map((e: { id: number }) => e.id)).toEqual([today.data.id, mid.data.id, back.data.id])
  })

  it('the day can be corrected later, keeping the day before in the edit history', async () => {
    const r = await createEntry('Visit', 'visit')
    const before = note(r.data.id).occurred_at
    const set = await invoke(IPC.CASE_LOG_SET_OCCURRED, r.data.id, day(-5))
    expect(set.ok).toBe(true)
    expect(localDay(note(r.data.id).occurred_at)).toBe(day(-5))
    const edits = await invoke(IPC.CASE_LOG_GET_EDITS, r.data.id)
    expect(edits.data).toEqual([expect.objectContaining({ content: 'Visit', occurred_at: before })])
    expect((await invoke(IPC.CASE_LOG_SET_OCCURRED, r.data.id, day(2))).ok).toBe(false)
  })

  it('a corrected later day moves the date column forward', async () => {
    const r = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Visit', 'visit', null, undefined, day(-10))
    expect(cellValue()).toBe(day(-10))
    const set = await invoke(IPC.CASE_LOG_SET_OCCURRED, r.data.id, day(-4))
    expect(set.data.updated_dates).toEqual([expect.objectContaining({ new_value: day(-4) })])
    expect(cellValue()).toBe(day(-4))
  })

  it("Pulse's own entries keep their date", async () => {
    const r = await createEntry('Status changed', 'system')
    expect((await invoke(IPC.CASE_LOG_SET_OCCURRED, r.data.id, day(-1))).ok).toBe(false)
  })

  it('notes written without a day (older code paths) happened when written', () => {
    const id = Number(testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at) VALUES (?, 'x', 'note', '2026-01-05 10:00:00')").run(rowId).lastInsertRowid)
    expect(note(id).occurred_at).toBe('2026-01-05 10:00:00')
  })

  it('voiding a note puts back the date it moved, and unvoiding moves it again (audit 1.23)', async () => {
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)").run(rowId, lastVisit, day(-20))
    const r = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Visit on the wrong person', 'visit', null, undefined, day(-1))
    expect(cellValue()).toBe(day(-1))
    const v = await invoke(IPC.CASE_LOG_VOID, r.data.id, 'Wrong person')
    expect(v.data.reverted_dates).toEqual([expect.objectContaining({ column_id: lastVisit, old_value: day(-1), new_value: day(-20) })])
    expect(cellValue()).toBe(day(-20))
    const u = await invoke(IPC.CASE_LOG_UNVOID, r.data.id)
    expect(u.data.updated_dates).toEqual([expect.objectContaining({ new_value: day(-1) })])
    expect(cellValue()).toBe(day(-1))
  })

  it('deleting a note puts back the date it moved, and restoring moves it again', async () => {
    const r = await createEntry('Visit', 'visit')
    const entry = (await invoke(IPC.CASE_LOG_GET, rowId)).data[0]
    const d = await invoke(IPC.CASE_LOG_DELETE, r.data.id)
    expect(d.data.reverted_dates).toEqual([expect.objectContaining({ new_value: null })])
    expect(cellValue()).toBeNull()
    const back = await invoke(IPC.CASE_LOG_RESTORE, entry)
    expect(back.data.updated_dates).toEqual([expect.objectContaining({ new_value: localDateString() })])
    expect(cellValue()).toBe(localDateString())
  })

  it('moving a note to an earlier day moves the date back with it', async () => {
    const r = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Visit', 'visit', null, undefined, day(-2))
    const set = await invoke(IPC.CASE_LOG_SET_OCCURRED, r.data.id, day(-6))
    expect(set.data.reverted_dates).toEqual([expect.objectContaining({ new_value: null })])
    expect(set.data.updated_dates).toEqual([expect.objectContaining({ new_value: day(-6) })])
    expect(cellValue()).toBe(day(-6))
  })

  it('restore (undo of a delete) keeps the day it happened', async () => {
    const r = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Visit', 'visit', null, undefined, day(-3))
    const entry = (await invoke(IPC.CASE_LOG_GET, rowId)).data[0]
    await invoke(IPC.CASE_LOG_DELETE, r.data.id)
    expect((await invoke(IPC.CASE_LOG_RESTORE, entry)).ok).toBe(true)
    expect(localDay(note(r.data.id).occurred_at)).toBe(day(-3))
  })
})
