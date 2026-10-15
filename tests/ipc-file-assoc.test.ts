/**
 * ipc-file-assoc.test.ts — Tests for FILE_ASSOC_* IPC handlers.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture ──────────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()
let testDb: TestDb

// Track file-association mock state so we can vary behavior per test
let mockPendingImport: string | null = null
let mockIsRegistered = false
let mockPlatform = 'linux'
const originalPlatform = process.platform

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-fassoc') },
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

let clearPendingCalled = false
let registerCalled = false
let unregisterCalled = false

vi.mock('../src/main/file-association', () => ({
  getPendingImport: () => mockPendingImport,
  clearPendingImport: () => { clearPendingCalled = true; mockPendingImport = null },
  registerPulseFileType: () => { registerCalled = true },
  unregisterPulseFileType: () => { unregisterCalled = true },
  isPulseFileTypeRegistered: () => mockIsRegistered,
}))

let mockKind: 'setup' | 'workspace' | 'unknown' = 'setup'
vi.mock('../src/main/templates', () => ({
  readPulseKind: async () => mockKind,
  parsePulseFile: async (path: string) => ({
    pulse: { name: 'Parsed Template' },
    preview: { columns: 3, rows: 10 },
  }),
}))

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

// ── Setup ────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  testDb = createTestDb()
  const { registerFileAssocHandlers } = await import('../src/main/ipc/ipc-file-assoc')
  registerFileAssocHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
  mockPendingImport = null
  mockIsRegistered = false
  clearPendingCalled = false
  registerCalled = false
  unregisterCalled = false
})

afterEach(() => { cleanupTestDb(testDb) })

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FILE_ASSOC_GET_PENDING', () => {
  it('returns null when no pending import', async () => {
    const result = await invoke(IPC.FILE_ASSOC_GET_PENDING) as { ok: true; data: null }
    expect(result.ok).toBe(true)
    expect(result.data).toBeNull()
  })

  it('hands a workspace template to the example dialog by token', async () => {
    const { mkdtempSync, writeFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const { tmpdir } = require('os') as typeof import('os')
    const file = join(mkdtempSync(join(tmpdir(), 'fassoc-')), 'shared.pulse')
    writeFileSync(file, JSON.stringify({ pulse_template: '2.0', type: 'workspace', id: 'my-setup', name: 'Shared setup', description: 'From a coworker', icon: 'users',
      lists: [{ key: 'fleet', name: 'Fleet', kind: 'thing', columns: [{ name: 'Truck', column_type: 'text', position: 0 }] }] }))
    mockKind = 'workspace'
    mockPendingImport = file
    const result = await invoke(IPC.FILE_ASSOC_GET_PENDING) as { ok: true; data: { workspace: { source: { fileToken: string }; summary: { listNames: string[] } } } }
    mockKind = 'setup'
    expect(result.ok).toBe(true)
    expect(result.data.workspace.summary.listNames).toEqual(['Fleet'])
    expect(result.data.workspace.source.fileToken).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns file info when pending import exists', async () => {
    mockPendingImport = '/tmp/test.pulse'
    const result = await invoke(IPC.FILE_ASSOC_GET_PENDING) as { ok: true; data: { filePath: string; preview: unknown } }
    expect(result.ok).toBe(true)
    expect(result.data.filePath).toBe('/tmp/test.pulse')
    expect(result.data.preview).toHaveProperty('columns')
    expect(result.data.preview).toHaveProperty('rows')
  })
})

describe('FILE_ASSOC_CLEAR_PENDING', () => {
  it('returns ok and clears pending', async () => {
    mockPendingImport = '/tmp/something.pulse'
    const result = await invoke(IPC.FILE_ASSOC_CLEAR_PENDING) as { ok: true; data: boolean }
    expect(result.ok).toBe(true)
    expect(result.data).toBe(true)
    expect(clearPendingCalled).toBe(true)
  })

  it('succeeds even with no pending import', async () => {
    const result = await invoke(IPC.FILE_ASSOC_CLEAR_PENDING) as { ok: boolean }
    expect(result.ok).toBe(true)
  })
})

describe('FILE_ASSOC_REGISTER', () => {
  it('fails on non-win32 platform', async () => {
    // process.platform is linux in test env
    const result = await invoke(IPC.FILE_ASSOC_REGISTER, true) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('only be set up on Windows')
  })

  it('refuses anything but true or false (Q-056)', async () => {
    for (const v of ['yes', 1, {}]) {
      expect(await invoke(IPC.FILE_ASSOC_REGISTER, v)).toEqual({ ok: false, error: 'Invalid setting' })
    }
  })

  it('fails on non-win32 when unregistering', async () => {
    const result = await invoke(IPC.FILE_ASSOC_REGISTER, false) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('FILE_ASSOC_IS_REGISTERED', () => {
  it('returns false on non-win32 platform', async () => {
    const result = await invoke(IPC.FILE_ASSOC_IS_REGISTERED) as { ok: true; data: boolean }
    expect(result.ok).toBe(true)
    expect(result.data).toBe(false)
  })
})

describe('Handler registration', () => {
  it('all 4 FILE_ASSOC channels are registered', () => {
    expect(handlers.has(IPC.FILE_ASSOC_GET_PENDING)).toBe(true)
    expect(handlers.has(IPC.FILE_ASSOC_CLEAR_PENDING)).toBe(true)
    expect(handlers.has(IPC.FILE_ASSOC_REGISTER)).toBe(true)
    expect(handlers.has(IPC.FILE_ASSOC_IS_REGISTERED)).toBe(true)
  })
})
