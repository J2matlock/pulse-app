/**
 * Unsent note drafts in the encrypted database (note-drafts.ts, ipc-drafts.ts):
 * settings rows `note_draft:<rowId>`, hidden from the settings store, hidden
 * while the record is in the Trash, swept once it's purged.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'
import { IPC_READ_ONLY } from '../src/shared/constants'
import type { NoteDraft } from '../src/shared/noteDraft'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-drafts') },
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {}, exit: () => {}, on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) }, on: () => {} },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: undefined }) },
  shell: { openPath: async () => '', openExternal: async () => {} },
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
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  }
})

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

type Result = { ok: true; data: unknown } | { ok: false; error: string }
async function invoke(channel: string, ...args: unknown[]): Promise<Result> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`)
  return await handler({ senderFrame: { parent: null } }, ...args) as Result
}

function draft(content: string, more: Partial<NoteDraft> = {}): NoteDraft {
  return { content, fieldValues: [], followUp: '', minutes: '', miles: '', extra: {}, ...more }
}

let gridId: number
let rowA: number
let rowB: number

function addRecord(name: string): number {
  const id = Number(testDb.db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, 0)').run(gridId).lastInsertRowid)
  testDb.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run(name, id)
  return id
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerDraftHandlers } = await import('../src/main/ipc/ipc-drafts')
  const { registerSettingsHandlers } = await import('../src/main/ipc/ipc-settings')
  registerDraftHandlers()
  registerSettingsHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
  gridId = Number(testDb.db.prepare("INSERT INTO grids (name, position) VALUES ('Caseload', 0)").run().lastInsertRowid)
  rowA = addRecord('Odette Guidry')
  rowB = addRecord('Mr. Thibodeaux')
})
afterEach(async () => {
  const { registerReadOnlyChecker } = await import('../src/main/ipc/ipc-utils')
  registerReadOnlyChecker(null)
  cleanupTestDb(testDb)
})

const stored = (rowId: number) => testDb.db.prepare('SELECT value FROM settings WHERE key = ?').get(`note_draft:${rowId}`) as { value: string } | undefined

describe('note drafts', () => {
  it('round trip: put, get, then an empty draft deletes it', async () => {
    const d = draft('Visited Odette at home', { minutes: '45', miles: '12.5', extra: { bp: '120/80' }, day: '2026-10-14', fieldValues: ['a', 'b'], format: 'dap' })
    expect(await invoke(IPC.NOTE_DRAFT_PUT, rowA, d)).toEqual({ ok: true, data: true })
    const got = await invoke(IPC.NOTE_DRAFT_GET, rowA)
    expect(got.ok).toBe(true)
    const saved = (got as { data: NoteDraft & { savedAt: string } }).data
    expect(saved).toMatchObject(d)
    expect(Number.isNaN(Date.parse(saved.savedAt))).toBe(false)
    expect(saved.savedAt.endsWith('Z')).toBe(true)
    // Stored in the database's settings table, as JSON
    expect(JSON.parse(stored(rowA)!.value).content).toBe('Visited Odette at home')

    expect((await invoke(IPC.NOTE_DRAFT_PUT, rowA, draft('   '))).ok).toBe(true)
    expect(stored(rowA)).toBeUndefined()
    expect(await invoke(IPC.NOTE_DRAFT_GET, rowA)).toEqual({ ok: true, data: null })
  })

  it('lists records with a draft, newest first, with their names', async () => {
    await invoke(IPC.NOTE_DRAFT_PUT, rowA, draft('first'))
    testDb.db.prepare('UPDATE settings SET value = json_set(value, \'$.savedAt\', \'2020-01-01T00:00:00.000Z\') WHERE key = ?').run(`note_draft:${rowA}`)
    await invoke(IPC.NOTE_DRAFT_PUT, rowB, draft('second'))
    const res = await invoke(IPC.NOTE_DRAFT_LIST)
    expect(res.ok).toBe(true)
    const list = (res as { data: Array<{ rowId: number; gridId: number; name: string }> }).data
    expect(list.map(d => [d.rowId, d.name, d.gridId])).toEqual([[rowB, 'Mr. Thibodeaux', gridId], [rowA, 'Odette Guidry', gridId]])
  })

  it('a record in the Trash hides its draft, and it comes back when the record is restored', async () => {
    await invoke(IPC.NOTE_DRAFT_PUT, rowA, draft('Half-written'))
    testDb.db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").run(rowA)
    expect((await invoke(IPC.NOTE_DRAFT_LIST) as { data: unknown[] }).data).toEqual([])
    expect(await invoke(IPC.NOTE_DRAFT_GET, rowA)).toEqual({ ok: true, data: null })
    // A trashed record takes no new draft either
    expect(await invoke(IPC.NOTE_DRAFT_PUT, rowA, draft('more'))).toEqual({ ok: true, data: false })

    testDb.db.prepare('UPDATE rows SET is_active = 1, deleted_at = NULL WHERE id = ?').run(rowA)
    expect((await invoke(IPC.NOTE_DRAFT_GET, rowA) as { data: NoteDraft }).data.content).toBe('Half-written')
    expect((await invoke(IPC.NOTE_DRAFT_LIST) as { data: Array<{ rowId: number }> }).data.map(d => d.rowId)).toEqual([rowA])
  })

  it('a record of a list in the Trash hides its draft too', async () => {
    await invoke(IPC.NOTE_DRAFT_PUT, rowA, draft('Half-written'))
    testDb.db.prepare('UPDATE grids SET is_active = 0 WHERE id = ?').run(gridId)
    expect((await invoke(IPC.NOTE_DRAFT_LIST) as { data: unknown[] }).data).toEqual([])
    expect(await invoke(IPC.NOTE_DRAFT_GET, rowA)).toEqual({ ok: true, data: null })
  })

  it("a purged record's draft is swept by the next list", async () => {
    await invoke(IPC.NOTE_DRAFT_PUT, rowA, draft('Gone soon'))
    await invoke(IPC.NOTE_DRAFT_PUT, rowB, draft('Stays'))
    testDb.db.prepare('DELETE FROM rows WHERE id = ?').run(rowA)
    expect(stored(rowA)).toBeDefined()
    const list = (await invoke(IPC.NOTE_DRAFT_LIST) as { data: Array<{ rowId: number }> }).data
    expect(list.map(d => d.rowId)).toEqual([rowB])
    expect(stored(rowA)).toBeUndefined()
    expect(stored(rowB)).toBeDefined()
  })

  it('the sweep leaves other settings alone', async () => {
    testDb.db.prepare("INSERT INTO settings (key, value) VALUES ('note_formats', '[]'), ('noteXdraft:5', 'x')").run()
    await invoke(IPC.NOTE_DRAFT_LIST)
    expect(testDb.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key IN ('note_formats', 'noteXdraft:5')").get()).toEqual({ n: 2 })
  })

  it('a record that does not exist takes no draft', async () => {
    expect(await invoke(IPC.NOTE_DRAFT_PUT, 99999, draft('x'))).toEqual({ ok: true, data: false })
    expect(stored(99999)).toBeUndefined()
  })

  it('refuses a draft over the size cap, and anything not shaped like a draft', async () => {
    const big = await invoke(IPC.NOTE_DRAFT_PUT, rowA, draft('x'.repeat(100_001)))
    expect(big.ok).toBe(false)
    expect((big as { error: string }).error).toMatch(/too long/)
    // Each section within its own limit, together over 200,000
    const sections = await invoke(IPC.NOTE_DRAFT_PUT, rowA, draft('x'.repeat(90_000), { fieldValues: ['y'.repeat(90_000), 'z'.repeat(30_000)] }))
    expect(sections.ok).toBe(false)
    for (const bad of [null, 'text', { content: 5 }, { ...draft('a'), extra: { k: 5 } }, { ...draft('a'), fieldValues: 'a' }]) {
      expect((await invoke(IPC.NOTE_DRAFT_PUT, rowA, bad)).ok, JSON.stringify(bad)).toBe(false)
    }
    expect((await invoke(IPC.NOTE_DRAFT_PUT, 'x', draft('a'))).ok).toBe(false)
    expect((await invoke(IPC.NOTE_DRAFT_GET, -1)).ok).toBe(false)
    expect(stored(rowA)).toBeUndefined()
  })

  it('drops keys a draft does not have', async () => {
    await invoke(IPC.NOTE_DRAFT_PUT, rowA, { ...draft('a'), savedAt: 'forged', injected: '<script>' })
    const value = JSON.parse(stored(rowA)!.value) as Record<string, unknown>
    expect(value.injected).toBeUndefined()
    expect(value.savedAt).not.toBe('forged')
  })

  it('an unreadable stored value reads as no draft', async () => {
    testDb.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(`note_draft:${rowA}`, '{not json')
    expect(await invoke(IPC.NOTE_DRAFT_GET, rowA)).toEqual({ ok: true, data: null })
    expect((await invoke(IPC.NOTE_DRAFT_LIST) as { data: unknown[] }).data).toEqual([])
  })

  it('writes are refused while Pulse is read-only', async () => {
    const { registerReadOnlyChecker } = await import('../src/main/ipc/ipc-utils')
    registerReadOnlyChecker(() => true)
    expect(await invoke(IPC.NOTE_DRAFT_PUT, rowA, draft('a'))).toEqual({ ok: false, error: IPC_READ_ONLY })
  })

  it('SETTINGS_GET_ALL never returns drafts, and the settings channels cannot read or write them', async () => {
    await invoke(IPC.NOTE_DRAFT_PUT, rowA, draft('Private visit note'))
    testDb.db.prepare("INSERT INTO settings (key, value) VALUES ('theme', 'dark')").run()
    const all = await invoke(IPC.SETTINGS_GET_ALL) as { ok: true; data: Record<string, string> }
    expect(all.data.theme).toBe('dark')
    expect(Object.keys(all.data).some(k => k.startsWith('note_draft'))).toBe(false)
    expect(JSON.stringify(all.data)).not.toContain('Private visit note')
    expect((await invoke(IPC.SETTINGS_GET, `note_draft:${rowA}`)).ok).toBe(false)
    expect((await invoke(IPC.SETTINGS_UPDATE, `note_draft:${rowA}`, '{}')).ok).toBe(false)
  })
})

describe('drafts stay out of unencrypted storage', () => {
  it('the renderer draft modules never use browser storage or electron-store', () => {
    for (const f of ['src/renderer/utils/noteDrafts.ts']) {
      const text = readFileSync(join(__dirname, '..', f), 'utf8')
      expect(text, f).not.toMatch(/localStorage|sessionStorage|electron-store/)
    }
  })
})
