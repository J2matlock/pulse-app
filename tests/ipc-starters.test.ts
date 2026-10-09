/**
 * IPC starter handlers — ipc-starters.ts (W01 §4.3)
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const dialogMock = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }))
const sent: string[] = []
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-ipc-starters') },
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
  dialog: { showOpenDialog: (...a: unknown[]) => dialogMock.open(...a), showSaveDialog: (...a: unknown[]) => dialogMock.save(...a) },
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
  const { registerStarterHandlers } = await import('../src/main/ipc/ipc-starters')
  registerStarterHandlers()
})

beforeEach(() => { testDb = createTestDb(); sent.length = 0 })
afterEach(async () => {
  cleanupTestDb(testDb)
  const { registerReadOnlyChecker } = await import('../src/main/ipc/ipc-utils')
  registerReadOnlyChecker(() => false)
})

const hs = { builtinId: 'human-services' }
const opts = { lists: ['caseload'], variant: 'school-counselor', applyWords: true, applyFeatures: true, sampleData: false }

describe('STARTER_LIST / STARTER_PREVIEW', () => {
  it('lists the built-in examples and previews one', async () => {
    const list = await invoke(IPC.STARTER_LIST)
    expect(list.data.map((s: { id: string }) => s.id)).toContain('human-services')
    const p = await invoke(IPC.STARTER_PREVIEW, hs, 'school-counselor')
    expect(p.ok).toBe(true)
    expect(p.data.variant).toBe('school-counselor')
    expect(p.data.lists[0].finalName).toBe('School Counselor')
    expect(p.data.words.find((w: { key: string }) => w.key === 'record')).toEqual({ key: 'record', current: 'records', proposed: 'clients' })
  })

  it('only accepts built-in examples from the window', async () => {
    expect((await invoke(IPC.STARTER_PREVIEW, { filePath: '/etc/passwd' })).ok).toBe(false)
    expect((await invoke(IPC.STARTER_PREVIEW, { builtinId: 'nope' })).error).toMatch(/isn't available/)
  })
})

describe('STARTER_APPLY', () => {
  it('adds the list and tells windows the words changed', async () => {
    const res = await invoke(IPC.STARTER_APPLY, hs, opts)
    expect(res.ok).toBe(true)
    expect(testDb.db.prepare('SELECT name FROM grids WHERE id = ?').get(res.data.gridIds.caseload)).toEqual({ name: 'School Counselor' })
    expect(sent).toContain(IPC.WORKSPACE_CHANGED)
  })

  it('does not push a change when words and features are left alone', async () => {
    const res = await invoke(IPC.STARTER_APPLY, hs, { ...opts, applyWords: false, applyFeatures: false })
    expect(res.ok).toBe(true)
    expect(sent).toEqual([])
  })

  it('rejects bad options with a plain message and passes starter messages through', async () => {
    expect((await invoke(IPC.STARTER_APPLY, hs, { ...opts, extra: 1 })).error).toMatch(/couldn't add that example/)
    expect((await invoke(IPC.STARTER_APPLY, hs, { ...opts, lists: [] })).error).toBe('Pick at least one list to add.')
  })

  it('is blocked when the app is read-only', async () => {
    const { registerReadOnlyChecker } = await import('../src/main/ipc/ipc-utils')
    registerReadOnlyChecker(() => true)
    expect(await invoke(IPC.STARTER_APPLY, hs, opts)).toEqual({ ok: false, error: 'READ_ONLY' })
  })
})

describe('template files', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  // app.getPath (mocked above) points home at this folder, so assertSafePath allows it
  const home = join(tmpdir(), 'pulse-test-ipc-starters')

  it('saves my setup and opens it again through a token', async () => {
    fs.mkdirSync(home, { recursive: true })
    testDb.db.prepare("INSERT INTO grids (name, position) VALUES ('Fleet', 0)").run()
    testDb.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, is_name_column) VALUES (1, 'Truck', 'text', 0, 1)").run()
    const dest = join(home, 'shared-setup')
    dialogMock.save.mockResolvedValue({ canceled: false, filePath: dest })
    const saved = await invoke(IPC.WORKSPACE_EXPORT_TEMPLATE)
    expect(saved).toEqual({ ok: true, data: { filePath: `${dest}.pulse` } })
    expect(JSON.parse(fs.readFileSync(`${dest}.pulse`, 'utf8')).type).toBe('workspace')

    dialogMock.open.mockResolvedValue({ canceled: false, filePaths: [`${dest}.pulse`] })
    const opened = await invoke(IPC.STARTER_OPEN_FILE)
    expect(opened.ok).toBe(true)
    expect(opened.data.summary.listNames).toEqual(['Fleet'])
    expect(JSON.stringify(opened.data)).not.toContain(home)

    const preview = await invoke(IPC.STARTER_PREVIEW, opened.data.source)
    expect(preview.data.lists[0].finalName).toBe('Fleet 2')
    const applied = await invoke(IPC.STARTER_APPLY, opened.data.source, { lists: ['fleet'], applyWords: false, applyFeatures: false, sampleData: false })
    expect(applied.ok).toBe(true)
  })

  it('refuses unknown tokens, cancelled dialogs and files from outside your folders', async () => {
    expect((await invoke(IPC.STARTER_PREVIEW, { fileToken: '00000000-0000-4000-8000-000000000000' })).error).toMatch(/open it again/)
    dialogMock.open.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await invoke(IPC.STARTER_OPEN_FILE)).toEqual({ ok: true, data: null })
    dialogMock.open.mockResolvedValue({ canceled: false, filePaths: ['/etc/hosts'] })
    expect((await invoke(IPC.STARTER_OPEN_FILE)).error).toMatch(/your own folders/)
  })

  it('explains when there is nothing to share', async () => {
    expect((await invoke(IPC.WORKSPACE_EXPORT_TEMPLATE)).error).toMatch(/nothing to share/)
  })
})
