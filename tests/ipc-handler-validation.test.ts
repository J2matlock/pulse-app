/**
 * Handler-level validation for the newer IPC modules (appointments, files,
 * links, forms, reports): every channel is called through its real secureWrap
 * handler with malformed payloads — bad IDs, wrong types, oversized strings and
 * arrays, hostile objects, relative/odd paths. Each must answer { ok: false }
 * by validating (never by crashing inside business logic, which the wrapper
 * logs as "IPC handler failed"), and must not change the database.
 * A few happy-path calls check the wiring of channels no other test invokes.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'
import { localDateFromToday } from '../src/shared/dates'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const crashes = vi.hoisted(() => ({ list: [] as Array<{ channel?: string; error?: string }> }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => (name === 'userData' ? '/tmp/pulse-test-ipc-validation' : '/tmp'),
    getName: () => 'Pulse Test', getVersion: () => '0.0.0-test', commandLine: { appendSwitch: () => {} }, on: () => {},
  },
  ipcMain: { handle: (channel: string, h: (...args: unknown[]) => unknown) => { handlers.set(channel, h) }, on: () => {}, removeHandler: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {
    showMessageBox: async () => ({ response: 1 }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
  },
  shell: { openPath: async () => '' },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

let testDb: TestDb
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => testDb.db, cachedStmt: (_k: string, sql: string) => testDb.db.prepare(sql), invalidateGridStmtCache: () => {} }
})

vi.mock('../src/main/logger', () => ({
  logger: {
    info: () => {}, warn: () => {}, debug: () => {},
    error: (_component: string, message: string, meta?: { channel?: string; error?: string }) => {
      if (message === 'IPC handler failed') crashes.list.push({ channel: meta?.channel, error: meta?.error })
    },
  },
}))

const fakeEvent = { senderFrame: { parent: null } }
type Res = { ok: boolean; error?: string; data?: unknown }
const call = async (channel: string, ...args: unknown[]): Promise<Res> => {
  const h = handlers.get(channel)
  if (!h) throw new Error(`No handler for ${channel}`)
  return await h(fakeEvent, ...args) as Res
}

const MODULE_CHANNELS = {
  appointments: [IPC.APPT_LIST, IPC.APPT_FOR_RECORD, IPC.APPT_CREATE, IPC.APPT_UPDATE, IPC.APPT_END_SERIES, IPC.APPT_DELETE, IPC.APPT_RESTORE, IPC.APPT_SET_STATUS, IPC.APPT_UPCOMING_COUNT, IPC.APPT_CANCEL_UPCOMING, IPC.CALENDAR_ITEMS],
  attachments: [IPC.ATTACHMENT_ADD, IPC.ATTACHMENT_ADD_PATHS, IPC.ATTACHMENT_LIST, IPC.ATTACHMENT_DESCRIBE, IPC.ATTACHMENT_DELETE, IPC.ATTACHMENT_RESTORE, IPC.ATTACHMENT_USAGE, IPC.ATTACHMENT_PURGE, IPC.ATTACHMENT_TRASH_LIST, IPC.ATTACHMENT_OPEN, IPC.ATTACHMENT_SAVE_AS, IPC.ATTACHMENT_PREVIEW],
  links: [IPC.LINK_TYPE_GET_ALL, IPC.LINK_TYPE_SAVE, IPC.LINK_SETUP, IPC.LINK_TYPE_COUNT, IPC.LINK_TYPE_DELETE, IPC.RECORD_LINKS_GET, IPC.RECORD_LINK_ADD, IPC.RECORD_LINK_REMOVE, IPC.RECORD_LINK_CREATE, IPC.RECORD_LINKS_MOVE_CHECK, IPC.LINK_COUNTS_FOR_GRID, IPC.GRID_LINK_VALUES, IPC.RECORD_LINK_SEARCH],
  forms: [IPC.FORM_LIST, IPC.FORM_SAVE, IPC.FORM_DELETE, IPC.FORM_SUBMIT, IPC.FORM_UNDO, IPC.FORM_REDO, IPC.FORM_PRINT],
  reports: [IPC.REPORT_FIELDS, IPC.REPORT_RUN, IPC.REPORT_RUN_SAVED, IPC.REPORT_LIST, IPC.REPORT_SAVE, IPC.REPORT_EXPORT, IPC.REPORT_DELETE],
}
const ALL_CHANNELS = Object.values(MODULE_CHANNELS).flat()

/** Channels that take no arguments (anything sent is ignored) */
const NO_ARGS = new Set<string>([IPC.ATTACHMENT_USAGE, IPC.ATTACHMENT_TRASH_LIST])
/** Channels whose only argument is an optional ID, where "none" means "all" */
const OPTIONAL_ID = new Set<string>([IPC.ATTACHMENT_PURGE, IPC.LINK_TYPE_GET_ALL, IPC.REPORT_LIST])

const huge = 'x'.repeat(2_000_000)
const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}') as unknown
const BAD_PAYLOADS: Array<[string, unknown[]]> = [
  ['no arguments', []],
  ['nulls', [null, null, null, null]],
  ['negative IDs', [-1, -1, -1, -1]],
  ['zero IDs', [0, 0, 0, 0]],
  ['fractional IDs', [1.5, 2.5, 3.5, 4.5]],
  ['NaN and Infinity', [NaN, Infinity, NaN, Infinity]],
  ['numeric strings', ['1', '1', '1', '1']],
  ['plain strings', ['x', 'x', 'x', 'x']],
  ['empty objects', [{}, {}, {}, {}]],
  ['empty arrays', [[], [], [], []]],
  ['booleans', [true, false, true, false]],
  ['a 2 MB string', [huge, huge, huge, huge]],
  ['an array of 100,001 numbers', [Array(100_001).fill(1), Array(100_001).fill(1)]],
  ['prototype-polluting objects', [hostile, hostile, hostile, hostile]],
  ['relative and traversal paths', ['../../etc/passwd', ['../x.pdf', 'C:\\x'], '..\\..\\x', 'nul\0byte']],
]

/** Everything in the database, as row counts per table */
function snapshot(): Record<string, number> {
  const tables = testDb.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>
  return Object.fromEntries(tables.map(t => [t.name, (testDb.db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as { c: number }).c]))
}

let gridId: number
let rowIds: number[]

beforeAll(async () => {
  testDb = createTestDb()
  // Load contacts.ts before anything pulls in database.ts: the database mock loads the
  // real database.ts, which imports contacts.ts, and contacts.ts must bind to the mock
  await import('../src/main/contacts')
  const [{ registerAppointmentHandlers }, { registerAttachmentHandlers }, { registerLinkHandlers }, { registerFormHandlers }, { registerReportHandlers }] = await Promise.all([
    import('../src/main/ipc/ipc-appointments'), import('../src/main/ipc/ipc-attachments'), import('../src/main/ipc/ipc-links'),
    import('../src/main/ipc/ipc-forms'), import('../src/main/ipc/ipc-reports'),
  ])
  registerAppointmentHandlers()
  registerAttachmentHandlers()
  registerLinkHandlers()
  registerFormHandlers()
  registerReportHandlers()
  const [{ registerGridHandlers }, { registerDeadlineHandlers }, { registerContactHandlers }] = await Promise.all([
    import('../src/main/ipc/ipc-grid'), import('../src/main/ipc/ipc-deadlines'), import('../src/main/ipc/ipc-contacts'),
  ])
  registerGridHandlers()
  registerDeadlineHandlers()
  registerContactHandlers()
  cleanupTestDb(testDb)
})

beforeEach(() => {
  testDb = createTestDb()
  const g = seedGrid(testDb.db, { rowCount: 3, columnCount: 2 })
  gridId = g.gridId
  rowIds = g.rowIds
  crashes.list.length = 0
})
afterEach(() => cleanupTestDb(testDb))

describe('every appointments / files / links / forms / reports channel is registered', () => {
  it.each(ALL_CHANNELS)('%s', (channel) => {
    expect(handlers.has(channel)).toBe(true)
  })
})

describe.each(Object.entries(MODULE_CHANNELS))('%s handlers reject malformed payloads', (_module, channels) => {
  it.each(BAD_PAYLOADS)('with %s: answer { ok: false } by validating, and change nothing', async (_label, args) => {
    const before = snapshot()
    for (const channel of channels) {
      const res = await call(channel, ...args)
      expect(typeof res?.ok, channel).toBe('boolean')
      const mayPass = NO_ARGS.has(channel) || (OPTIONAL_ID.has(channel) && (args[0] === undefined || args[0] === null))
      if (!mayPass) expect(res.ok, `${channel} accepted ${_label}`).toBe(false)
      if (!res.ok) {
        expect(typeof res.error, channel).toBe('string')
        expect(res.error, channel).not.toMatch(/SQLITE|TypeError|Cannot read|undefined is not|is not a function/)
      }
    }
    expect(crashes.list, 'handlers that crashed instead of validating').toEqual([])
    expect(snapshot()).toEqual(before)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('IDs that are well-formed but do not exist', () => {
  it('are refused with a plain message (no crash, nothing written)', async () => {
    const before = snapshot()
    const missing = 999_999
    const checks: Array<[string, unknown[]]> = [
      [IPC.APPT_UPDATE, [missing, { title: 'Test' }]],
      [IPC.APPT_DELETE, [missing]],
      [IPC.APPT_SET_STATUS, [missing, 'done']],
      [IPC.APPT_END_SERIES, [missing, localDateFromToday(10)]],
      [IPC.ATTACHMENT_DELETE, [missing]],
      [IPC.ATTACHMENT_RESTORE, [missing]],
      [IPC.ATTACHMENT_SAVE_AS, [missing]],
      [IPC.LINK_TYPE_DELETE, [missing]],
      [IPC.RECORD_LINK_ADD, [missing, rowIds[0], rowIds[1]]],
      [IPC.RECORD_LINK_CREATE, [missing, 'forward', rowIds[0], 'Test Person']],
      [IPC.FORM_DELETE, [missing]],
      [IPC.FORM_SUBMIT, [missing, rowIds[0], {}]],
      [IPC.REPORT_RUN_SAVED, [missing]],
      [IPC.REPORT_DELETE, [missing]],
    ]
    for (const [channel, args] of checks) {
      const res = await call(channel, ...args)
      expect(res.ok, channel).toBe(false)
      expect(res.error, channel).not.toMatch(/SQLITE|TypeError|Cannot read/)
    }
    expect(crashes.list).toEqual([])
    expect(snapshot()).toEqual(before)
  })
})

describe('specific limits', () => {
  it('APPT_UPCOMING_COUNT / APPT_CANCEL_UPCOMING refuse more than 1000 records', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => i + 1)
    expect((await call(IPC.APPT_UPCOMING_COUNT, many)).ok).toBe(false)
    expect((await call(IPC.APPT_CANCEL_UPCOMING, many)).ok).toBe(false)
    expect((await call(IPC.APPT_UPCOMING_COUNT, rowIds)).ok).toBe(true)
  })

  it('CALENDAR_ITEMS refuses an end before the start', async () => {
    expect((await call(IPC.CALENDAR_ITEMS, '2026-10-10', '2026-10-01')).ok).toBe(false)
    expect((await call(IPC.CALENDAR_ITEMS, '2026-10-01', '2026-10-10')).ok).toBe(true)
  })

  it('ATTACHMENT_ADD_PATHS refuses more than 50 paths and relative paths', async () => {
    expect((await call(IPC.ATTACHMENT_ADD_PATHS, rowIds[0], Array(51).fill('/tmp/a.pdf'))).ok).toBe(false)
    const before = snapshot()
    for (const bad of ['relative/file.pdf', '../../etc/passwd', '/etc/passwd', '/tmp/a\0.pdf']) {
      const res = await call(IPC.ATTACHMENT_ADD_PATHS, rowIds[0], [bad])
      expect(res.ok, bad).toBe(false)
    }
    // assertSafePath throws on each; the wrapper turns that into a failure
    expect(crashes.list.map(c => c.channel)).toEqual(Array(4).fill(IPC.ATTACHMENT_ADD_PATHS))
    expect(snapshot()).toEqual(before)
  })

  it('ATTACHMENT_DESCRIBE refuses a blank file name and an over-long description in ATTACHMENT_ADD options', async () => {
    expect((await call(IPC.ATTACHMENT_DESCRIBE, 1, { fileName: '   ' })).ok).toBe(false)
    expect((await call(IPC.ATTACHMENT_ADD, rowIds[0], { description: 'x'.repeat(501) })).ok).toBe(false)
  })

  it('RECORD_LINK_SEARCH refuses a search longer than 200 characters', async () => {
    expect((await call(IPC.RECORD_LINK_SEARCH, 1, 'forward', 'x'.repeat(201))).ok).toBe(false)
  })

  it('FORM_SUBMIT refuses note answers longer than 20,000 characters', async () => {
    expect((await call(IPC.FORM_SUBMIT, 1, rowIds[0], {}, { a: 'x'.repeat(20_001) })).ok).toBe(false)
  })

  it('REPORT_EXPORT refuses formats other than csv and pdf', async () => {
    expect((await call(IPC.REPORT_EXPORT, gridId, {}, 'xlsx', 'Report')).ok).toBe(false)
  })

  it('APPT_RESTORE refuses a snapshot with too many appointments', async () => {
    const res = await call(IPC.APPT_RESTORE, { appointments: Array(50_001).fill({}), series: [], createdAppointmentIds: [], createdSeriesIds: [] })
    expect(res.ok).toBe(false)
  })
})

describe('happy paths for channels no other test calls', () => {
  it('APPT_CREATE (a weekly series), APPT_END_SERIES and APPT_CANCEL_UPCOMING work through their handlers', async () => {
    const start = `${localDateFromToday(1)}T10:00`
    const created = await call(IPC.APPT_CREATE, { row_id: rowIds[0], title: 'Weekly visit', start_at: start }, { freq: 'weekly', interval: 1, count: 6 })
    expect(created.ok).toBe(true)
    const count = () => (testDb.db.prepare("SELECT COUNT(*) AS c FROM appointments WHERE row_id = ? AND status = 'scheduled'").get(rowIds[0]) as { c: number }).c
    expect(count()).toBe(6)
    const firstId = (created.data as { ids: number[] }).ids[0]

    const ended = await call(IPC.APPT_END_SERIES, firstId, localDateFromToday(8))
    expect(ended.ok).toBe(true)
    expect(count()).toBe(2)

    expect((await call(IPC.APPT_UPCOMING_COUNT, [rowIds[0]])).data).toBeGreaterThan(0)
    const cancelled = await call(IPC.APPT_CANCEL_UPCOMING, [rowIds[0]])
    expect(cancelled.ok).toBe(true)
    expect(count()).toBe(0)
    expect(crashes.list).toEqual([])
  })

  it('LINK_TYPE_SAVE creates a link type between two lists', async () => {
    const other = seedGrid(testDb.db, { name: 'Other list', rowCount: 1, columnCount: 1 })
    const res = await call(IPC.LINK_TYPE_SAVE, { from_grid_id: gridId, to_grid_id: other.gridId, label_forward: 'Works with', label_backward: 'Worked with by', cardinality: 'many_to_many' })
    expect(res.ok).toBe(true)
    const all = await call(IPC.LINK_TYPE_GET_ALL, gridId)
    expect(JSON.stringify(all.data)).toContain('Works with')
    expect(crashes.list).toEqual([])
  })

  it('ATTACHMENT_PURGE removes one file from the files trash for good', async () => {
    const id = Number(testDb.db.prepare(`INSERT INTO attachments (row_id, file_name, mime_type, size_bytes, sha256, deleted_at)
      VALUES (?, 'old.pdf', 'application/pdf', 10, 'x', datetime('now'))`).run(rowIds[0]).lastInsertRowid)
    const res = await call(IPC.ATTACHMENT_PURGE, id)
    expect(res.ok).toBe(true)
    expect(testDb.db.prepare('SELECT id FROM attachments WHERE id = ?').get(id)).toBeUndefined()
    expect(crashes.list).toEqual([])
  })
})

describe('wiring of purge / undo / import channels other tests only reach through module functions', () => {
  it('GRID_PURGE removes a list in the Trash for good, and refuses one that is not in the Trash', async () => {
    const { trashList } = await import('../src/main/list-trash')
    const other = seedGrid(testDb.db, { name: 'Old list', rowCount: 2, columnCount: 1 })
    expect((await call(IPC.GRID_PURGE, other.gridId)).ok).toBe(false)
    trashList(other.gridId)
    const res = await call(IPC.GRID_PURGE, other.gridId)
    expect(res.ok).toBe(true)
    expect(testDb.db.prepare('SELECT id FROM grids WHERE id = ?').get(other.gridId)).toBeUndefined()
    expect(testDb.db.prepare('SELECT COUNT(*) AS c FROM rows WHERE grid_id = ?').get(other.gridId)).toEqual({ c: 0 })
    expect((await call(IPC.GRID_PURGE, -1)).ok).toBe(false)
    expect(crashes.list).toEqual([])
  })

  it('COLUMN_PURGE removes a deleted column for good', async () => {
    const { trashColumn } = await import('../src/main/list-trash')
    const cols = testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Array<{ id: number }>
    const deletedId = trashColumn(cols[1]?.id ?? 0)
    expect(testDb.db.prepare('SELECT id FROM deleted_columns WHERE id = ?').get(deletedId)).toBeDefined()
    const res = await call(IPC.COLUMN_PURGE, deletedId)
    expect(res.ok).toBe(true)
    expect(testDb.db.prepare('SELECT id FROM deleted_columns WHERE id = ?').get(deletedId)).toBeUndefined()
    expect((await call(IPC.COLUMN_PURGE, 'x')).ok).toBe(false)
    expect(crashes.list).toEqual([])
  })

  it('DEADLINE_STEP_UNDO validates its IDs and step before doing anything', async () => {
    const before = snapshot()
    for (const args of [[], [-1, 1, 0], [rowIds[0], 'x', 0], [rowIds[0], 1, 1.5], [rowIds[0], 1, '0']]) {
      expect((await call(IPC.DEADLINE_STEP_UNDO, ...args)).ok, JSON.stringify(args)).toBe(false)
    }
    expect(crashes.list).toEqual([])
    expect(snapshot()).toEqual(before)
  })

  it('CONTACTS_IMPORT_VCF reads a vCard file and returns the contacts for review without saving them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pulse-test-vcf-'))
    try {
      const file = join(dir, 'contacts.vcf')
      writeFileSync(file, 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Test Person\r\nORG:Test Agency\r\nEND:VCARD\r\n')
      const before = snapshot()
      const res = await call(IPC.CONTACTS_IMPORT_VCF, file)
      expect(res, JSON.stringify(crashes.list)).toMatchObject({ ok: true })
      expect(JSON.stringify(res.data)).toContain('Test Person')
      expect(snapshot()).toEqual(before)
      expect((await call(IPC.CONTACTS_IMPORT_VCF, 'relative.vcf')).ok).toBe(false)
      expect((await call(IPC.CONTACTS_IMPORT_VCF, '/etc/passwd')).ok).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
