/**
 * Settings Round-Trip Tests — uses IPC handler capture pattern.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture map ──────────────────────────────────────────────────────

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pulse-test-settings',
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {},
    exit: () => {},
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() { return [] }
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    showMessageBoxSync: () => 0,
  },
  shell: {
    openPath: async () => '',
    openExternal: async () => {},
  },
  protocol: {
    registerSchemesAsPrivileged: () => {},
    handle: () => {},
  },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

vi.mock('../src/main/index', () => ({
  startScheduledBackup: () => {},
  stopScheduledBackup: () => {},
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
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    checkCloudSyncPath: () => null,
  }
})

vi.mock('../src/main/backup', () => ({
  setDatabaseBridge: () => {},
  runAutoBackup: async () => {},
  listAutoBackups: () => [],
  listAutoBackupsRich: () => [],
  runScheduledBackup: async () => {},
  runManualBackup: () => ({ destPath: '/tmp/backup.pulse-backup', sizeBytes: 0 }),
  restoreFromDb: async () => {},
  restoreFromPulseBackup: async () => {},
  getBackupInfo: () => ({ size: 0, created: '' }),
  listScheduledBackups: () => [],
  getBackupDir: () => '/tmp/backups',
  verifyBackup: async () => ({ valid: true }),
  getScheduledConfig: () => null,
  setScheduledConfig: () => {},
  checkAndRunScheduled: async () => {},
  runPreMigrationBackup: () => {},
}))

vi.mock('../src/main/auth', () => ({
  isPasswordSetup: () => true,
  setupPassword: async () => 'abc123',
  verifyAndUnlock: async () => 'abc123',
  verifyAndUnlockRecovery: async () => 'abc123',
  changePassword: async () => {},
  resetPasswordAfterRecovery: async () => {},
  generateRecoveryKey: async () => 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX',
  revokeRecoveryKey: () => {},
  lockApp: () => {},
  getPasswordHint: () => '',
  hasRecoveryKey: () => false,
  getDbKey: () => 'test-key',
  setStoredDbPath: () => {},
}))

vi.mock('../src/main/export', () => ({
  exportCsv: async () => '/tmp/export.csv',
  exportPdfGrid: async () => '/tmp/export.pdf',
  exportPdfProfile: async () => '/tmp/profile.pdf',
  exportSupervisorReport: async () => '/tmp/report.pdf',
}))

vi.mock('../src/main/import', () => ({
  parseImportFile: async () => ({ headers: [], rows: [], totalRows: 0 }),
  autoMatchColumns: () => [],
  executeImport: async () => ({ imported: 0, skipped: 0 }),
}))

vi.mock('../src/main/templates', () => ({
  getSetupTemplates: () => [],
  createSetupTemplate: () => 1,
  deleteSetupTemplate: () => {},
  exportGridAsPulse: () => ({}),
  writePulseFile: async () => '/tmp/export.pulse',
  parsePulseFile: async () => ({}),
  applyPulseToNewGrid: () => 1,
  applyPulseToExistingGrid: () => {},
  seedChecklistTemplates: () => {},
  getLetterTemplates: () => [],
  createLetterTemplate: () => 1,
  updateLetterTemplate: () => {},
  deleteLetterTemplate: () => {},
  generateLetter: () => '',
}))

vi.mock('../src/main/file-association', () => ({
  getPendingImport: () => null,
  clearPendingImport: () => {},
  registerPulseFileType: () => {},
  unregisterPulseFileType: () => {},
  isPulseFileTypeRegistered: () => false,
}))

vi.mock('../src/main/contacts', async () => {
  const actual = await vi.importActual<typeof import('../src/main/contacts')>('../src/main/contacts')
  return actual
})

// ── Setup ─────────────────────────────────────────────────────────────────────

type IPCResult<T> = { ok: true; data: T } | { ok: false; error: string }

const fakeEvent = { senderFrame: { parent: null } }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler(fakeEvent, ...args) as T
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerIpcHandlers } = await import('../src/main/ipc-handlers')
  registerIpcHandlers()
})

describe('Settings', () => {
  beforeEach(() => {
    cleanupTestDb(testDb)
    testDb = createTestDb()
  })
  afterEach(() => {
    cleanupTestDb(testDb)
  })

  it('SETTINGS_UPDATE + SETTINGS_GET round-trip for allowed key', async () => {
    const setResult = await invoke<IPCResult<boolean>>(IPC.SETTINGS_UPDATE, 'theme', 'dark')
    expect(setResult.ok).toBe(true)

    const getResult = await invoke<IPCResult<string | null>>(IPC.SETTINGS_GET, 'theme')
    expect(getResult.ok).toBe(true)
    if (getResult.ok) expect(getResult.data).toBe('dark')
  })

  it('SETTINGS_GET_ALL returns all set keys', async () => {
    await invoke(IPC.SETTINGS_UPDATE, 'theme', 'dark')
    await invoke(IPC.SETTINGS_UPDATE, 'font_size', '16')

    const result = await invoke<IPCResult<Record<string, string>>>(IPC.SETTINGS_GET_ALL)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.theme).toBe('dark')
      expect(result.data.font_size).toBe('16')
    }
  })

  it('SETTINGS_UPDATE with disallowed key is rejected', async () => {
    const result = await invoke<IPCResult<boolean>>(IPC.SETTINGS_UPDATE, 'secret_hack', 'malicious')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Unknown settings key')
  })

  it('SETTINGS_GET for unset allowed key returns null', async () => {
    const result = await invoke<IPCResult<string | null>>(IPC.SETTINGS_GET, 'ui_scale')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBeNull()
  })

  it('prefix-allowed keys work (e.g., client_details_columns_1)', async () => {
    const setResult = await invoke<IPCResult<boolean>>(IPC.SETTINGS_UPDATE, 'client_details_columns_1', '["name","date"]')
    expect(setResult.ok).toBe(true)

    const getResult = await invoke<IPCResult<string | null>>(IPC.SETTINGS_GET, 'client_details_columns_1')
    expect(getResult.ok).toBe(true)
    if (getResult.ok) expect(getResult.data).toBe('["name","date"]')
  })

  it('profile_ prefix works', async () => {
    const setResult = await invoke<IPCResult<boolean>>(IPC.SETTINGS_UPDATE, 'profile_layout', 'compact')
    expect(setResult.ok).toBe(true)

    const getResult = await invoke<IPCResult<string | null>>(IPC.SETTINGS_GET, 'profile_layout')
    expect(getResult.ok).toBe(true)
    if (getResult.ok) expect(getResult.data).toBe('compact')
  })

  it('overwriting existing key updates value', async () => {
    await invoke(IPC.SETTINGS_UPDATE, 'theme', 'light')
    await invoke(IPC.SETTINGS_UPDATE, 'theme', 'dark')

    const result = await invoke<IPCResult<string | null>>(IPC.SETTINGS_GET, 'theme')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toBe('dark')
  })

  it('date_format and backup_reminder_enabled are allowed keys', async () => {
    const r1 = await invoke<IPCResult<boolean>>(IPC.SETTINGS_UPDATE, 'date_format', 'us')
    expect(r1.ok).toBe(true)

    const r2 = await invoke<IPCResult<boolean>>(IPC.SETTINGS_UPDATE, 'backup_reminder_enabled', 'true')
    expect(r2.ok).toBe(true)
  })
})
