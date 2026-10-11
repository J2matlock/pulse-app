/**
 * IPC App Handler Tests — APP_*, CLIPBOARD_WRITE channels
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture ──────────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

let mockClipboardText = ''
const mockDialogOpen = vi.fn(async () => ({ canceled: true, filePaths: [] }))
const mockDialogSave = vi.fn(async () => ({ canceled: true, filePath: undefined }))
const mockShellOpenExternal = vi.fn(async () => {})
const mockReloadIgnoringCache = vi.fn()
const mockAppRelaunch = vi.fn()
const mockAppExit = vi.fn()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pulse-test-app',
    getName: () => 'Pulse Test',
    getVersion: () => '1.2.3',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {},
    exit: mockAppExit,
    on: () => {},
    whenReady: () => Promise.resolve(),
    relaunch: mockAppRelaunch,
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() {
      return [{
        isDestroyed: () => false,
        webContents: { reloadIgnoringCache: mockReloadIgnoringCache, send: () => {} },
      }]
    }
  },
  dialog: {
    showOpenDialog: mockDialogOpen,
    showSaveDialog: mockDialogSave,
  },
  shell: {
    openPath: async () => '',
    openExternal: mockShellOpenExternal,
  },
  clipboard: {
    writeText: (t: string) => { mockClipboardText = t },
  },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return {
    default: class {
      get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d }
      set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'object') { for (const [key, val] of Object.entries(k)) map.set(key, val) } else { map.set(k, v) } }
      has(k: string) { return map.has(k) }
      delete(k: string) { map.delete(k) }
      clear() { map.clear() }
    },
  }
})

let testDb: TestDb

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    openDatabase: () => {},
    closeDatabase: () => { lifecycle.calls.push('closeDatabase') },
    resolveDatabasePath: () => '/tmp/test.db',
    checkCloudSyncPath: () => null,
    getPortableDataDir: () => '/tmp/pulse-test-app',
    getMigrationFailure: () => null,
    clearMigrationFailureFlag: () => {},
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  }
})

vi.mock('../src/main/auth', () => ({
  isPasswordSetup: () => true,
  setupPassword: async () => 'key',
  verifyAndUnlock: async (pw: string) => {
    if (pw === 'wrong') throw new Error('Incorrect password')
    if (pw === 'locked-out') throw new Error('Too many failed attempts. Try again in 30 seconds.')
    return 'key'
  },
  verifyAndUnlockRecovery: async () => 'key',
  changePassword: async () => {},
  resetPasswordAfterRecovery: async () => {},
  generateRecoveryKey: async () => 'ABCD-EFGH',
  revokeRecoveryKey: () => {},
  lockApp: () => { lifecycle.calls.push('lockApp') },
  getPasswordHint: () => 'hint',
  hasRecoveryKey: () => false,
  setStoredDbPath: () => {},
  normalizePassword: (pw: string) => pw,
}))

vi.mock('../src/main/index', () => ({
  startScheduledBackup: () => {},
  stopScheduledBackup: () => { lifecycle.calls.push('stopScheduledBackup') },
}))

const lifecycle = vi.hoisted(() => ({ calls: [] as string[] }))

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerAppHandlers } = await import('../src/main/ipc/ipc-app')
  registerAppHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
  mockClipboardText = ''
  mockDialogOpen.mockClear()
  mockDialogSave.mockClear()
  mockShellOpenExternal.mockClear()
  mockReloadIgnoringCache.mockClear()
})
afterEach(() => { cleanupTestDb(testDb) })

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CLIPBOARD_WRITE', () => {
  it('writes text to clipboard', async () => {
    const r = await invoke(IPC.CLIPBOARD_WRITE, 'hello') as any
    expect(r.ok).toBe(true)
    expect(mockClipboardText).toBe('hello')
  })

  it('rejects non-string input', async () => {
    const r = await invoke(IPC.CLIPBOARD_WRITE, 123) as any
    expect(r.ok).toBe(false)
  })

  it('rejects text over 1MB', async () => {
    const r = await invoke(IPC.CLIPBOARD_WRITE, 'x'.repeat(1_000_001)) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/too large/)
  })
})

describe('APP_GET_INFO', () => {
  it('returns app info object', async () => {
    const r = await invoke(IPC.APP_GET_INFO) as any
    expect(r.ok).toBe(true)
    expect(r.data.version).toBe('1.2.3')
    expect(r.data.platform).toBe(process.platform)
    expect(typeof r.data.dbExists).toBe('boolean')
  })
})

describe('APP_OPEN_EXTERNAL', () => {
  it('opens http URLs', async () => {
    const r = await invoke(IPC.APP_OPEN_EXTERNAL, 'http://example.com') as any
    expect(r.ok).toBe(true)
    expect(mockShellOpenExternal).toHaveBeenCalled()
  })

  it('opens https URLs', async () => {
    const r = await invoke(IPC.APP_OPEN_EXTERNAL, 'https://example.com') as any
    expect(r.ok).toBe(true)
  })

  it('rejects file:// URLs', async () => {
    const r = await invoke(IPC.APP_OPEN_EXTERNAL, 'file:///etc/passwd') as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/http/)
  })

  it('rejects javascript: URLs', async () => {
    const r = await invoke(IPC.APP_OPEN_EXTERNAL, 'javascript:alert(1)') as any
    expect(r.ok).toBe(false)
  })

  it('rejects invalid URLs', async () => {
    const r = await invoke(IPC.APP_OPEN_EXTERNAL, 'not a url') as any
    expect(r.ok).toBe(false)
  })

  it('rejects ftp:// URLs', async () => {
    const r = await invoke(IPC.APP_OPEN_EXTERNAL, 'ftp://files.example.com') as any
    expect(r.ok).toBe(false)
  })
})

describe('APP_SHOW_FILE_DIALOG', () => {
  it('calls showOpenDialog with sanitized options', async () => {
    mockDialogOpen.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/file.csv'] })
    const r = await invoke(IPC.APP_SHOW_FILE_DIALOG, {
      title: 'Choose File',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }) as any
    expect(r.ok).toBe(true)
    expect(mockDialogOpen).toHaveBeenCalled()
  })

  it('strips unsafe dialog properties', async () => {
    mockDialogOpen.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await invoke(IPC.APP_SHOW_FILE_DIALOG, {
      properties: ['openFile', 'showHiddenFiles' as any, 'openDirectory'],
    })
    const calledWith = mockDialogOpen.mock.calls[0][0] as any
    expect(calledWith.properties).toEqual(['openFile', 'openDirectory'])
  })

  it('truncates long title', async () => {
    mockDialogOpen.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await invoke(IPC.APP_SHOW_FILE_DIALOG, { title: 'x'.repeat(300), properties: [] })
    const calledWith = mockDialogOpen.mock.calls[0][0] as any
    expect(calledWith.title.length).toBe(200)
  })

  it('limits filter count to 10', async () => {
    mockDialogOpen.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const filters = Array.from({ length: 15 }, (_, i) => ({ name: `F${i}`, extensions: ['txt'] }))
    await invoke(IPC.APP_SHOW_FILE_DIALOG, { properties: [], filters })
    const calledWith = mockDialogOpen.mock.calls[0][0] as any
    expect(calledWith.filters.length).toBe(10)
  })
})

describe('APP_SHOW_SAVE_DIALOG', () => {
  it('calls showSaveDialog', async () => {
    mockDialogSave.mockResolvedValueOnce({ canceled: false, filePath: '/tmp/out.csv' })
    const r = await invoke(IPC.APP_SHOW_SAVE_DIALOG, {
      title: 'Save As',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }) as any
    expect(r.ok).toBe(true)
    expect(mockDialogSave).toHaveBeenCalled()
  })

  it('truncates long title', async () => {
    mockDialogSave.mockResolvedValueOnce({ canceled: true, filePath: undefined })
    await invoke(IPC.APP_SHOW_SAVE_DIALOG, { title: 'y'.repeat(300) })
    const calledWith = mockDialogSave.mock.calls[0][0] as any
    expect(calledWith.title.length).toBe(200)
  })
})

describe('dialog choices vouch for paths (AUDIT-001)', () => {
  it('a file picked in the open dialog passes the path check later, wherever it is', async () => {
    const { assertSafePath } = await import('../src/main/ipc/ipc-utils')
    expect(() => assertSafePath('/srv/test-share/pick.pulse-backup')).toThrow()
    mockDialogOpen.mockResolvedValueOnce({ canceled: false, filePaths: ['/srv/test-share/pick.pulse-backup'] } as never)
    await invoke(IPC.APP_SHOW_FILE_DIALOG, { properties: ['openFile'] })
    expect(() => assertSafePath('/srv/test-share/pick.pulse-backup')).not.toThrow()
  })

  it('a save choice vouches for its folder, so an added extension still passes', async () => {
    const { assertSafePath } = await import('../src/main/ipc/ipc-utils')
    mockDialogSave.mockResolvedValueOnce({ canceled: false, filePath: '/srv/test-save/backup' } as never)
    await invoke(IPC.APP_SHOW_SAVE_DIALOG, { title: 'Save' })
    expect(() => assertSafePath('/srv/test-save/backup.pulse-backup')).not.toThrow()
  })

  it('a cancelled dialog vouches for nothing', async () => {
    const { assertSafePath } = await import('../src/main/ipc/ipc-utils')
    mockDialogOpen.mockResolvedValueOnce({ canceled: true, filePaths: ['/srv/test-cancel/x.csv'] } as never)
    await invoke(IPC.APP_SHOW_FILE_DIALOG, { properties: ['openFile'] })
    expect(() => assertSafePath('/srv/test-cancel/x.csv')).toThrow()
  })
})

describe('APP_FACTORY_RESET', () => {
  it('rejects missing password', async () => {
    const r = await invoke(IPC.APP_FACTORY_RESET, '') as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/[Pp]assword/)
  })

  it('rejects non-string password', async () => {
    const r = await invoke(IPC.APP_FACTORY_RESET, 123) as any
    expect(r.ok).toBe(false)
  })

  it('rejects wrong password and says nothing was erased (AUDIT-064)', async () => {
    const r = await invoke(IPC.APP_FACTORY_RESET, 'wrong') as any
    expect(r.ok).toBe(false)
    expect(r.error).toBe("That password didn't work. Nothing was erased.")
  })

  it('passes a lockout message through, still saying nothing was erased (AUDIT-064)', async () => {
    const r = await invoke(IPC.APP_FACTORY_RESET, 'locked-out') as any
    expect(r.ok).toBe(false)
    expect(r.error).toBe('Too many failed attempts. Try again in 30 seconds. Nothing was erased.')
  })

  it('succeeds with correct password', async () => {
    const r = await invoke(IPC.APP_FACTORY_RESET, 'correct-password') as any
    expect(r.ok).toBe(true)
  })

  it('removes every local copy that could reopen the data, and nothing else', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    const dir = '/tmp/pulse-test-app'
    fs.mkdirSync(`${dir}/backups`, { recursive: true })
    const leftovers = ['pulse-secure.backup.json', 'pulse-secure.corrupt-123.json', 'pulse-orphaned-20260930-120000.db']
    for (const f of leftovers) fs.writeFileSync(`${dir}/${f}`, 'x')
    fs.writeFileSync(`${dir}/backups/pulse-auto-20260930-120000.db`, 'x')
    fs.writeFileSync(`${dir}/unrelated.txt`, 'keep me')

    const r = await invoke(IPC.APP_FACTORY_RESET, 'correct-password') as any
    expect(r.ok).toBe(true)
    for (const f of leftovers) expect(fs.existsSync(`${dir}/${f}`)).toBe(false)
    expect(fs.existsSync(`${dir}/backups`)).toBe(false)
    expect(fs.existsSync(`${dir}/unrelated.txt`)).toBe(true)
    fs.rmSync(`${dir}/unrelated.txt`)
  })
})

describe('APP_INTEGRITY_CHECK', () => {
  it('returns true for healthy DB', async () => {
    const r = await invoke(IPC.APP_INTEGRITY_CHECK) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBe(true)
  })
})

describe('APP_CHECK_FOR_UPDATES', () => {
  it('stays offline in an end-to-end run, so no update banner appears there (polish V1)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const vitest = process.env.VITEST
    const nodeEnv = process.env.NODE_ENV
    delete process.env.VITEST
    process.env.NODE_ENV = 'test'
    try {
      const r = await invoke(IPC.APP_CHECK_FOR_UPDATES) as any
      expect(r).toEqual({ ok: true, data: { available: false } })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      process.env.VITEST = vitest
      process.env.NODE_ENV = nodeEnv
      fetchSpy.mockRestore()
    }
  })
})

describe('APP_CHECK_FOR_UPDATES honours the setting in main (AUDIT-188) and stays quiet offline (AUDIT-099)', () => {
  const latest = () => new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })

  it('an automatic check does nothing when the setting is off; the button still checks', async () => {
    testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_update_check', 'false')").run()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => latest())
    try {
      expect(await invoke(IPC.APP_CHECK_FOR_UPDATES)).toEqual({ ok: true, data: { available: false } })
      expect(fetchSpy).not.toHaveBeenCalled()
      const manual = await invoke(IPC.APP_CHECK_FOR_UPDATES, { manual: true }) as any
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(manual.data).toMatchObject({ available: true, version: '9.9.9' })
    } finally { fetchSpy.mockRestore() }
  })

  it('an automatic check runs when the setting is on or unset', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => latest())
    try {
      expect((await invoke(IPC.APP_CHECK_FOR_UPDATES) as any).data.available).toBe(true)
      testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auto_update_check', 'true')").run()
      expect((await invoke(IPC.APP_CHECK_FOR_UPDATES) as any).data.available).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    } finally { fetchSpy.mockRestore() }
  })

  it('fails closed: an automatic check does nothing when the setting cannot be read', async () => {
    testDb.db.close()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => latest())
    try {
      expect(await invoke(IPC.APP_CHECK_FOR_UPDATES)).toEqual({ ok: true, data: { available: false } })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally { fetchSpy.mockRestore() }
  })

  it('offline: answers "no update" without logging an error', async () => {
    const { logger } = await import('../src/main/logger')
    const errorSpy = vi.spyOn(logger, 'error')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    try {
      expect(await invoke(IPC.APP_CHECK_FOR_UPDATES, { manual: true })).toEqual({ ok: true, data: { available: false } })
      expect(errorSpy).not.toHaveBeenCalled()
    } finally { fetchSpy.mockRestore(); errorSpy.mockRestore() }
  })
})

describe('APP_MIGRATION_STATUS', () => {
  it('returns null when no migration failure', async () => {
    const r = await invoke(IPC.APP_MIGRATION_STATUS) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBeNull()
  })

  it('clears flag when clearFlag=true', async () => {
    const r = await invoke(IPC.APP_MIGRATION_STATUS, true) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBeNull()
  })
})

describe('APP_RELAUNCH', () => {
  it('reloads the window', async () => {
    await invoke(IPC.APP_RELAUNCH)
    expect(mockReloadIgnoringCache).toHaveBeenCalled()
  })

  it('stops scheduled backups, locks and closes the database before reloading (AUDIT-020)', async () => {
    lifecycle.calls.length = 0
    await invoke(IPC.APP_RELAUNCH)
    expect(lifecycle.calls).toEqual(['stopScheduledBackup', 'lockApp', 'closeDatabase'])
  })
})
