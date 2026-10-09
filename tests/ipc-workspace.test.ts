/**
 * IPC Workspace handler tests — ipc-workspace.ts (W01 words and feature switches)
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const sent: string[] = []
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-ws') },
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
  BrowserWindow: class { static getAllWindows() { return [{ isDestroyed: () => false, webContents: { send: (ch: string) => { sent.push(ch) } } }] } },
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
  const { registerWorkspaceHandlers } = await import('../src/main/ipc/ipc-workspace')
  const { registerSettingsHandlers } = await import('../src/main/ipc/ipc-settings')
  registerWorkspaceHandlers()
  registerSettingsHandlers()
})

beforeEach(() => { testDb = createTestDb(); sent.length = 0 })
afterEach(async () => {
  cleanupTestDb(testDb)
  const { registerReadOnlyChecker } = await import('../src/main/ipc/ipc-utils')
  registerReadOnlyChecker(() => false)
})

const customer = { one: 'customer', many: 'customers', article: 'a' as const }

describe('WORKSPACE_GET', () => {
  it('returns empty words and switches on a new database', async () => {
    const res = await invoke(IPC.WORKSPACE_GET)
    expect(res).toEqual({ ok: true, data: { vocab: {}, features: {}, gridVocab: {}, measures: [], calendar: { holidays: [], weekend: [0, 6] } } })
  })

  it("includes each list's own words and skips unreadable ones", async () => {
    const a = testDb.db.prepare("INSERT INTO grids (name, position, vocab) VALUES ('Vehicles', 0, ?)").run(JSON.stringify({ record: { one: 'vehicle', many: 'vehicles', article: 'a' } }))
    testDb.db.prepare("INSERT INTO grids (name, position, vocab) VALUES ('Broken', 1, 'not json')").run()
    const res = await invoke(IPC.WORKSPACE_GET)
    expect(Object.keys(res.data.gridVocab)).toEqual([String(a.lastInsertRowid)])
    expect(res.data.gridVocab[Number(a.lastInsertRowid)].record.one).toBe('vehicle')
  })
})

describe('WORKSPACE_UPDATE', () => {
  it('saves words, replaces them on the next save, and tells windows', async () => {
    let res = await invoke(IPC.WORKSPACE_UPDATE, { vocab: { record: customer, list: { one: 'shop', many: 'shops', article: 'a' } } })
    expect(res.ok).toBe(true)
    expect(res.data.vocab.record.one).toBe('customer')
    expect(sent).toContain(IPC.WORKSPACE_CHANGED)

    res = await invoke(IPC.WORKSPACE_UPDATE, { vocab: { record: customer } })
    expect(res.data.vocab.list).toBeUndefined()
  })

  it('merges feature switches and drops unknown keys', async () => {
    await invoke(IPC.WORKSPACE_UPDATE, { features: { letters: true, tasks: false } })
    const res = await invoke(IPC.WORKSPACE_UPDATE, { features: { letters: false, madeUp: true } })
    expect(res.data.features).toEqual({ letters: false, tasks: false })
  })

  it('rejects bad words with a readable message and saves nothing', async () => {
    const tooLong = await invoke(IPC.WORKSPACE_UPDATE, { vocab: { record: { one: 'x'.repeat(41), many: 'xs', article: 'a' } } })
    expect(tooLong.ok).toBe(false)
    expect(tooLong.error).toMatch(/1 to 40 characters/)

    const html = await invoke(IPC.WORKSPACE_UPDATE, { vocab: { record: { one: '<b>', many: 'bs', article: 'a' } } })
    expect(html.error).toMatch(/cannot contain/)

    for (const bad of [null, 'x', { vocab: { nope: customer } }, { other: 1 }]) {
      expect((await invoke(IPC.WORKSPACE_UPDATE, bad)).ok).toBe(false)
    }
    expect(testDb.db.prepare("SELECT 1 FROM settings WHERE key LIKE 'workspace_%'").get()).toBeUndefined()
    expect(sent).toEqual([])
  })

  it('is blocked when the app is read-only', async () => {
    const { registerReadOnlyChecker } = await import('../src/main/ipc/ipc-utils')
    registerReadOnlyChecker(() => true)
    const res = await invoke(IPC.WORKSPACE_UPDATE, { features: { letters: true } })
    expect(res).toEqual({ ok: false, error: 'READ_ONLY' })
  })
})

describe('settings keys', () => {
  it('reads workspace keys through SETTINGS_GET but only writes them through WORKSPACE_UPDATE', async () => {
    await invoke(IPC.WORKSPACE_UPDATE, { features: { letters: true } })
    const got = await invoke(IPC.SETTINGS_GET, 'workspace_features')
    expect(JSON.parse(got.data)).toEqual({ letters: true })

    const write = await invoke(IPC.SETTINGS_UPDATE, 'workspace_vocab', '{}')
    expect(write.ok).toBe(false)
    expect((await invoke(IPC.SETTINGS_UPDATE, 'feature_offers_dismissed', '["links"]')).ok).toBe(true)
  })
})

describe('vocabFor (main)', () => {
  it("layers a list's words over the workspace's over generic", async () => {
    const { vocabFor, featureOn } = await import('../src/main/vocab')
    await invoke(IPC.WORKSPACE_UPDATE, { vocab: { record: customer }, features: { letters: true } })
    const g = testDb.db.prepare("INSERT INTO grids (name, position, vocab) VALUES ('Vehicles', 0, ?)").run(JSON.stringify({ record: { one: 'vehicle', many: 'vehicles', article: 'a' } }))
    expect(vocabFor().record.one).toBe('customer')
    expect(vocabFor(Number(g.lastInsertRowid)).record.one).toBe('vehicle')
    expect(vocabFor(Number(g.lastInsertRowid)).activity.one).toBe('note')
    expect(featureOn('letters')).toBe(true)
    expect(featureOn('appointments')).toBe(false)
  })
})

describe('HOLIDAYS_SET', () => {
  it('saves days off and the weekend, sorted and without duplicates', async () => {
    const res = await invoke(IPC.HOLIDAYS_SET, ['2026-12-25', '2026-11-26', '2026-12-25'], [5, 6])
    expect(res.data.calendar).toEqual({ holidays: ['2026-11-26', '2026-12-25'], weekend: [5, 6] })
    expect(sent).toContain(IPC.WORKSPACE_CHANGED)
  })

  it('rejects unreadable dates and a week with no working days', async () => {
    expect((await invoke(IPC.HOLIDAYS_SET, ['2026-02-31'])).ok).toBe(false)
    expect((await invoke(IPC.HOLIDAYS_SET, [], [0, 1, 2, 3, 4, 5, 6])).ok).toBe(false)
  })
})

describe('GRID_SETTINGS_UPDATE', () => {
  it("sets a list's kind and own words, and clears the words with null", async () => {
    const id = Number(testDb.db.prepare("INSERT INTO grids (name, position) VALUES ('Fleet', 0)").run().lastInsertRowid)
    const res = await invoke(IPC.GRID_SETTINGS_UPDATE, id, { record_kind: 'thing', vocab: { record: { one: 'truck', many: 'trucks', article: 'a' } } })
    expect(res.data.gridVocab[id].record.one).toBe('truck')
    expect(testDb.db.prepare('SELECT record_kind FROM grids WHERE id = ?').get(id)).toEqual({ record_kind: 'thing' })
    expect(sent).toContain(IPC.WORKSPACE_CHANGED)
    await invoke(IPC.GRID_SETTINGS_UPDATE, id, { vocab: null })
    expect(testDb.db.prepare('SELECT vocab FROM grids WHERE id = ?').get(id)).toEqual({ vocab: null })
  })

  it('renames a list and turns priority levels on and off, in one call', async () => {
    const id = Number(testDb.db.prepare("INSERT INTO grids (name, position) VALUES ('Fleet', 0)").run().lastInsertRowid)
    expect((await invoke(IPC.GRID_SETTINGS_UPDATE, id, { name: '  Trucks ', acuity_enabled: true })).ok).toBe(true)
    expect(testDb.db.prepare('SELECT name, acuity_enabled FROM grids WHERE id = ?').get(id)).toEqual({ name: 'Trucks', acuity_enabled: 1 })
    await invoke(IPC.GRID_SETTINGS_UPDATE, id, { acuity_enabled: false })
    expect(testDb.db.prepare('SELECT acuity_enabled FROM grids WHERE id = ?').get(id)).toEqual({ acuity_enabled: 0 })
    expect((await invoke(IPC.GRID_SETTINGS_UPDATE, id, { name: '   ' })).ok).toBe(false)
    expect(testDb.db.prepare('SELECT name FROM grids WHERE id = ?').get(id)).toEqual({ name: 'Trucks' })
  })

  it('rejects unknown lists and bad settings', async () => {
    expect((await invoke(IPC.GRID_SETTINGS_UPDATE, 999, { record_kind: 'thing' })).error).toMatch(/doesn't exist/)
    const id = Number(testDb.db.prepare("INSERT INTO grids (name, position) VALUES ('Fleet', 0)").run().lastInsertRowid)
    expect((await invoke(IPC.GRID_SETTINGS_UPDATE, id, { record_kind: 'animal' })).ok).toBe(false)
    expect((await invoke(IPC.GRID_SETTINGS_UPDATE, 'x', {})).ok).toBe(false)
  })
})
