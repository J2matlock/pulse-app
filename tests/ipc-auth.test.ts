/**
 * IPC Auth Handler Tests — AUTH_* channels
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

// ── Handler capture ──────────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pulse-test-auth',
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
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '', openExternal: async () => {} },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  clipboard: { writeText: () => {}, clear: vi.fn() },
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
let dbClosed = false

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => { if (dbClosed) throw new Error('Database is not open'); return testDb.db },
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    checkCloudSyncPath: () => null,
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  }
})

const mockSetupPassword = vi.fn(async () => 'key')
const mockVerifyAndUnlock = vi.fn(async (pw: string) => {
  if (pw === 'wrong-password') throw new Error('Incorrect password')
  return 'key'
})
const mockVerifyAndUnlockRecovery = vi.fn(async (key: string) => {
  if (key === 'invalid-key') throw new Error('Invalid recovery key')
  return 'key'
})
const mockChangePassword = vi.fn(async (oldPw: string) => {
  if (oldPw === 'wrong-old') throw new Error('Incorrect password')
})
const mockResetPasswordAfterRecovery = vi.fn(async () => {})
const mockGenerateRecoveryKey = vi.fn(async () => 'ABCD-EFGH-IJKL-MNOP')
const mockRevokeRecoveryKey = vi.fn()
const mockLockApp = vi.fn()

const mockIsPasswordSetup = vi.fn(() => true)
const mockCredentialsUnreadable = vi.fn(() => false)
const mockRestoreOnNewInstall = vi.fn(async (_opts: unknown) => ({ schemaVersion: 31 }))
const mockLockBackup = vi.fn()
vi.mock('../src/main/backup', () => ({
  setDatabaseBridge: () => {},
  runPreMigrationBackup: () => {},
  moveAsideExistingDatabase: () => null,
  restoreBackupOnNewInstall: (opts: unknown) => mockRestoreOnNewInstall(opts),
  runAutoBackupOnLock: () => mockLockBackup(),
}))
vi.mock('../src/main/auth', () => ({
  areCredentialsUnreadable: () => mockCredentialsUnreadable(),
  isPasswordSetup: (...args: unknown[]) => mockIsPasswordSetup(...args),
  setupPassword: (...args: unknown[]) => mockSetupPassword(...args),
  verifyAndUnlock: (pw: string) => mockVerifyAndUnlock(pw),
  verifyAndUnlockRecovery: (key: string) => mockVerifyAndUnlockRecovery(key),
  changePassword: (...args: unknown[]) => mockChangePassword(...args),
  resetPasswordAfterRecovery: (...args: unknown[]) => mockResetPasswordAfterRecovery(...args),
  generateRecoveryKey: () => mockGenerateRecoveryKey(),
  revokeRecoveryKey: () => mockRevokeRecoveryKey(),
  lockApp: () => mockLockApp(),
  getPasswordHint: () => 'my pet name',
  hasRecoveryKey: () => true,
  setStoredDbPath: () => {},
  normalizePassword: (pw: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('crypto')
    return Buffer.byteLength(pw, 'utf8') > 72
      ? crypto.createHash('sha256').update(pw).digest('hex')
      : pw
  },
}))

vi.mock('../src/main/index', () => ({
  startScheduledBackup: () => {},
  stopScheduledBackup: () => {},
}))

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

beforeAll(async () => {
  testDb = createTestDb()
  const { registerAuthHandlers } = await import('../src/main/ipc/ipc-auth')
  registerAuthHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
  vi.clearAllMocks()
})
afterEach(() => { cleanupTestDb(testDb) })

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AUTH_IS_SETUP', () => {
  it('returns boolean', async () => {
    const r = await invoke(IPC.AUTH_IS_SETUP) as any
    expect(r.ok).toBe(true)
    expect(typeof r.data).toBe('boolean')
  })
})

describe('AUTH_GET_HINT', () => {
  it('returns the password hint', async () => {
    const r = await invoke(IPC.AUTH_GET_HINT) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBe('my pet name')
  })
})

describe('AUTH_HAS_RECOVERY_KEY', () => {
  it('returns boolean', async () => {
    const r = await invoke(IPC.AUTH_HAS_RECOVERY_KEY) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBe(true)
  })
})

describe('AUTH_SETUP_PASSWORD', () => {
  beforeEach(() => { mockIsPasswordSetup.mockReturnValue(false) })
  afterEach(() => { mockIsPasswordSetup.mockReturnValue(true) })

  it('rejects if password already configured', async () => {
    mockIsPasswordSetup.mockReturnValue(true)
    const r = await invoke(IPC.AUTH_SETUP_PASSWORD, 'validpass123', 'my hint') as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/already configured/)
  })

  it('sets up password and returns cloudWarning', async () => {
    const r = await invoke(IPC.AUTH_SETUP_PASSWORD, 'validpass123', 'my hint') as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveProperty('cloudWarning')
    expect(mockSetupPassword).toHaveBeenCalled()
  })

  it('rejects password shorter than 12 chars', async () => {
    const r = await invoke(IPC.AUTH_SETUP_PASSWORD, 'short', 'hint') as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/12 characters/)
  })

  it('rejects password over 1024 chars', async () => {
    const r = await invoke(IPC.AUTH_SETUP_PASSWORD, 'x'.repeat(1025), 'hint') as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-string password', async () => {
    const r = await invoke(IPC.AUTH_SETUP_PASSWORD, 12345678, 'hint') as any
    expect(r.ok).toBe(false)
  })

  it('rejects hint over 512 chars', async () => {
    const r = await invoke(IPC.AUTH_SETUP_PASSWORD, 'validpass123', 'h'.repeat(513)) as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/[Hh]int/)
  })

  it('rejects non-string hint', async () => {
    const r = await invoke(IPC.AUTH_SETUP_PASSWORD, 'validpass123', 123) as any
    expect(r.ok).toBe(false)
  })

  it('passes the raw password through (auth.ts normalizes and handles legacy forms)', async () => {
    const longPw = 'a long passphrase that is well over seventy-two bytes in total length, really' // >72 bytes
    await invoke(IPC.AUTH_SETUP_PASSWORD, longPw, 'hint')
    expect(mockSetupPassword.mock.calls[0][0]).toBe(longPw)
  })
})

describe('AUTH_VERIFY_PASSWORD', () => {
  it('succeeds with correct password', async () => {
    const r = await invoke(IPC.AUTH_VERIFY_PASSWORD, 'correct-password') as any
    expect(r.ok).toBe(true)
    expect(r.data).toHaveProperty('cloudWarning')
  })

  it('fails with wrong password', async () => {
    const r = await invoke(IPC.AUTH_VERIFY_PASSWORD, 'wrong-password') as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Incorrect/)
  })

  it('rejects empty password', async () => {
    const r = await invoke(IPC.AUTH_VERIFY_PASSWORD, '') as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-string password', async () => {
    const r = await invoke(IPC.AUTH_VERIFY_PASSWORD, 42) as any
    expect(r.ok).toBe(false)
  })

  it('rejects password over 1024 chars', async () => {
    const r = await invoke(IPC.AUTH_VERIFY_PASSWORD, 'p'.repeat(1025)) as any
    expect(r.ok).toBe(false)
  })
})

describe('AUTH_VERIFY_RECOVERY_KEY', () => {
  it('succeeds with valid recovery key', async () => {
    const r = await invoke(IPC.AUTH_VERIFY_RECOVERY_KEY, 'VALID-KEY') as any
    expect(r.ok).toBe(true)
  })

  it('fails with invalid recovery key', async () => {
    const r = await invoke(IPC.AUTH_VERIFY_RECOVERY_KEY, 'invalid-key') as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/[Ii]nvalid recovery key/)
  })

  it('rejects empty key', async () => {
    const r = await invoke(IPC.AUTH_VERIFY_RECOVERY_KEY, '') as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-string key', async () => {
    const r = await invoke(IPC.AUTH_VERIFY_RECOVERY_KEY, 999) as any
    expect(r.ok).toBe(false)
  })

  it('rejects key over 512 chars', async () => {
    const r = await invoke(IPC.AUTH_VERIFY_RECOVERY_KEY, 'k'.repeat(513)) as any
    expect(r.ok).toBe(false)
  })
})

describe('AUTH_CHANGE_PASSWORD', () => {
  it('changes password with valid inputs', async () => {
    const r = await invoke(IPC.AUTH_CHANGE_PASSWORD, 'old-password', 'new-password-123', 'new hint') as any
    expect(r.ok).toBe(true)
    expect(mockChangePassword).toHaveBeenCalled()
  })

  it('fails with wrong old password', async () => {
    const r = await invoke(IPC.AUTH_CHANGE_PASSWORD, 'wrong-old', 'new-password-123', 'hint') as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Incorrect/)
  })

  it('rejects new password shorter than 12 chars', async () => {
    const r = await invoke(IPC.AUTH_CHANGE_PASSWORD, 'old-password', 'short', 'hint') as any
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/12 characters/)
  })

  it('rejects new password over 1024 chars', async () => {
    const r = await invoke(IPC.AUTH_CHANGE_PASSWORD, 'old-password', 'x'.repeat(1025), 'hint') as any
    expect(r.ok).toBe(false)
  })

  it('rejects hint over 512 chars', async () => {
    const r = await invoke(IPC.AUTH_CHANGE_PASSWORD, 'old-password', 'new-password-123', 'h'.repeat(513)) as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-string new password', async () => {
    const r = await invoke(IPC.AUTH_CHANGE_PASSWORD, 'old-password', 12345678, 'hint') as any
    expect(r.ok).toBe(false)
  })
})

describe('AUTH_LOCK', () => {
  it('locks the app', async () => {
    const r = await invoke(IPC.AUTH_LOCK) as any
    expect(r.ok).toBe(true)
    expect(mockLockApp).toHaveBeenCalled()
  })

  it('makes an auto-backup before locking, while the database is open', async () => {
    mockLockBackup.mockClear()
    await invoke(IPC.AUTH_LOCK)
    expect(mockLockBackup).toHaveBeenCalledTimes(1)
    expect(mockLockBackup.mock.invocationCallOrder[0]!).toBeLessThan(mockLockApp.mock.invocationCallOrder.at(-1)!)
  })

  it('skips the lock backup when already locked, so no false failure is recorded', async () => {
    mockLockBackup.mockClear()
    dbClosed = true
    try {
      const r = await invoke(IPC.AUTH_LOCK) as any
      expect(r.ok).toBe(true)
      expect(mockLockBackup).not.toHaveBeenCalled()
    } finally { dbClosed = false }
  })
})

describe('AUTH_GENERATE_RECOVERY_KEY', () => {
  it('returns a recovery key string', async () => {
    const r = await invoke(IPC.AUTH_GENERATE_RECOVERY_KEY) as any
    expect(r.ok).toBe(true)
    expect(typeof r.data).toBe('string')
    expect(r.data.length).toBeGreaterThan(0)
  })
})

describe('AUTH_REVOKE_RECOVERY_KEY', () => {
  it('revokes the recovery key', async () => {
    const r = await invoke(IPC.AUTH_REVOKE_RECOVERY_KEY) as any
    expect(r.ok).toBe(true)
    expect(mockRevokeRecoveryKey).toHaveBeenCalled()
  })
})

describe('AUTH_RESET_PASSWORD_AFTER_RECOVERY', () => {
  it('resets password with valid inputs', async () => {
    const r = await invoke(IPC.AUTH_RESET_PASSWORD_AFTER_RECOVERY, 'new-password-123', 'new hint') as any
    expect(r.ok).toBe(true)
    expect(mockResetPasswordAfterRecovery).toHaveBeenCalled()
  })

  it('rejects password shorter than 12 chars', async () => {
    const r = await invoke(IPC.AUTH_RESET_PASSWORD_AFTER_RECOVERY, 'short', 'hint') as any
    expect(r.ok).toBe(false)
  })

  it('rejects password over 1024 chars', async () => {
    const r = await invoke(IPC.AUTH_RESET_PASSWORD_AFTER_RECOVERY, 'x'.repeat(1025), 'hint') as any
    expect(r.ok).toBe(false)
  })

  it('rejects hint over 512 chars', async () => {
    const r = await invoke(IPC.AUTH_RESET_PASSWORD_AFTER_RECOVERY, 'valid-pass-123', 'h'.repeat(513)) as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-string password', async () => {
    const r = await invoke(IPC.AUTH_RESET_PASSWORD_AFTER_RECOVERY, 12345678, 'hint') as any
    expect(r.ok).toBe(false)
  })

  it('rejects non-string hint', async () => {
    const r = await invoke(IPC.AUTH_RESET_PASSWORD_AFTER_RECOVERY, 'valid-pass-123', 999) as any
    expect(r.ok).toBe(false)
  })
})

describe('AUTH_RESTORE_FROM_BACKUP', () => {
  afterEach(() => {
    mockIsPasswordSetup.mockReturnValue(true)
    mockCredentialsUnreadable.mockReturnValue(false)
    mockRestoreOnNewInstall.mockClear()
  })

  it('refuses when this computer already has working credentials', async () => {
    mockIsPasswordSetup.mockReturnValue(true)
    mockCredentialsUnreadable.mockReturnValue(false)
    const r = await invoke(IPC.AUTH_RESTORE_FROM_BACKUP, '/tmp/x.pulse-backup', 'old-pass', 'new-password', '')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/already set up/)
    expect(mockRestoreOnNewInstall).not.toHaveBeenCalled()
  })

  it('validates the new password length', async () => {
    mockIsPasswordSetup.mockReturnValue(false)
    const r = await invoke(IPC.AUTH_RESTORE_FROM_BACKUP, '/tmp/x.pulse-backup', 'old-pass', 'short', '')
    expect(r.ok).toBe(false)
    expect(mockRestoreOnNewInstall).not.toHaveBeenCalled()
  })

  it('translates a wrong secret into a human message', async () => {
    mockIsPasswordSetup.mockReturnValue(true)
    mockCredentialsUnreadable.mockReturnValue(true)
    mockRestoreOnNewInstall.mockRejectedValueOnce(new Error('Incorrect password or recovery key'))
    const r = await invoke(IPC.AUTH_RESTORE_FROM_BACKUP, '/tmp/pulse-test-auth/x.pulse-backup', 'nope', 'new-password', '')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/doesn't match this backup/)
  })
})

