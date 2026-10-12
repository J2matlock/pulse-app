/**
 * ipc-export.test.ts — Tests for EXPORT_*, BACKUP_*, IMPORT_*, SETUP_TEMPLATE_*, LETTER_TEMPLATE_* IPC handlers.
 * Uses mocked external dependencies (backup, export, import, templates) to test validation and routing.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── Handler capture ──────────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()
let testDb: TestDb
let safeTmpDir: string

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      const { tmpdir } = require('os')
      const { join } = require('path')
      const base = join(tmpdir(), 'pulse-test-export')
      if (name === 'home') return base
      if (name === 'documents' || name === 'desktop' || name === 'downloads' || name === 'temp' || name === 'userData') return join(base, name)
      return base
    },
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
  BrowserWindow: class {
    static getAllWindows() { return [{ isDestroyed: () => false, webContents: { send: () => {} } }] }
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  },
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
    openDatabase: () => { backupMock.opened++; if (backupMock.openError) { const e = backupMock.openError; backupMock.openError = null; throw e } },
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    cachedStmt: (key: string, sql: string) => testDb.db.prepare(sql),
    setEncryptionKey: () => {},
  }
})

vi.mock('../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))

vi.mock('../src/main/auth', () => ({
  isPasswordSetup: () => true,
  getDbKey: () => Buffer.from('a'.repeat(64), 'hex'),
  getAutoLockMinutes: () => 30,
  lockApp: vi.fn(),
}))

vi.mock('../src/main/backup', () => ({
  setDatabaseBridge: () => {},
  runAutoBackup: async () => {},
  listAutoBackups: () => [],
  listAutoBackupsRich: () => [{ timestamp: new Date(), path: '/tmp/backup.db', sizeBytes: 1024 }],
  runManualBackup: async (path: string) => ({ destPath: path, sizeBytes: 1024 }),
  restoreFromDb: async () => { if (backupMock.restoreError) throw backupMock.restoreError; return '/tmp/safety.db' },
  restoreFromPulseBackup: async () => { if (backupMock.restoreError) throw backupMock.restoreError; return '/tmp/safety.db' },
  getBackupInfo: () => ({ layer1: { count: 1 }, lastAutoBackupFailed: false, lastAutoBackupError: null }),
  verifyBackup: async () => ({ valid: true, rowCount: 10 }),
  getScheduledConfig: () => ({ enabled: false, intervalHours: 24, destinationDir: '/old/dest', lastRunISO: '2026-10-01T09:00:00.000Z' }),
  setScheduledConfig: (cfg: unknown) => { backupMock.lastSet = cfg },
  checkAndRunScheduled: async () => {},
  runScheduledBackupNow: async () => ({ ran: true, destPath: '/old/dest/pulse-scheduled-x.pulse-backup', lastRunISO: '2026-10-10T09:00:00.000Z' }),
  restoreOtherPulseBackup: (opts: unknown) => backupMock.restoreOther!(opts),
  getBackupMadeInfo: async () => ({ madeAt: '2026-10-09T08:00:00.000Z', appVersion: '2.2.0' }),
  withBackupDbFile: async (p: string, fn: (f: string) => unknown) => fn(p),
  getBackupHealth: () => ({ lastOffsiteISO: null, trackingSinceISO: '2020-01-01T00:00:00.000Z', scheduled: { enabled: false, intervalHours: 24, lastRunISO: null, lastError: null, overdue: false } }),
  describeBackupError: () => 'The backup couldn\'t be saved.',
  runPreMigrationBackup: () => {},
}))
const backupMock = vi.hoisted(() => ({ lastSet: null as unknown, restoreOther: null as null | ((opts: unknown) => Promise<unknown>), restoreError: null as Error | null, openError: null as Error | null, opened: 0 }))

vi.mock('../src/main/export', () => ({
  exportCsv: vi.fn(async () => '/tmp/export.csv'),
  exportPdfGrid: async () => '/tmp/export.pdf',
  exportPdfProfile: async () => '/tmp/profile.pdf',
  exportSupervisorReport: async () => '/tmp/report.pdf',
  exportLetterPdf: async () => '/tmp/letter.pdf',
  exportContactPdf: async () => '/tmp/contact.pdf',
  exportDirectoryPdf: async () => '/tmp/directory.pdf',
}))

vi.mock('../src/main/import', () => ({
  parseImportFile: async () => ({ headers: ['Name', 'Age'], rows: [['Alice', '30']], totalRows: 1, sheetNames: ['Sheet1'] }),
  autoMatchColumns: () => [{ header: 'Name', columnId: 1, confidence: 1.0 }],
  executeImport: async () => ({ imported: 1, skipped: 0 }),
}))

vi.mock('../src/main/templates', () => ({
  getSetupTemplates: () => [{ id: 1, name: 'Test Template' }],
  createSetupTemplate: () => 1,
  deleteSetupTemplate: () => {},
  exportGridAsPulse: () => ({ name: 'Test', columns: [], rows: [] }),
  writePulseFile: () => {},
  parsePulseFile: async () => ({ pulse: { name: 'Imported' }, preview: { columns: 3, rows: 10 } }),
  applyPulseToNewGrid: () => 42,
  applyPulseToExistingGrid: () => {},
  validatePulseJson: (json: string) => JSON.parse(json),
  getLetterTemplates: () => [{ id: 1, name: 'Letter 1' }],
  createLetterTemplate: () => 1,
  updateLetterTemplate: () => {},
  deleteLetterTemplate: () => {},
  generateLetter: () => 'Dear Client, ...',
}))

vi.mock('../src/main/contacts', () => ({
  getProvider: (id: number) => id === 1 ? { id: 1, name: 'Dr. Smith' } : null,
}))

vi.mock('../src/main/file-association', () => ({
  getPendingImport: () => null,
  clearPendingImport: () => {},
  registerPulseFileType: () => {},
  unregisterPulseFileType: () => {},
  isPulseFileTypeRegistered: () => false,
}))

const fakeEvent = { senderFrame: { parent: null }, sender: { send: vi.fn() } }

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

// ── Setup ────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  testDb = createTestDb()
  const { registerExportHandlers } = await import('../src/main/ipc/ipc-export')
  registerExportHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
  safeTmpDir = mkdtempSync(join(tmpdir(), 'pulse-test-export-safe-'))
})

afterEach(() => {
  cleanupTestDb(testDb)
})

// ── Backup handlers ──────────────────────────────────────────────────────────

describe('BACKUP_AUTO_LIST', () => {
  it('returns ok with array', async () => {
    const result = await invoke(IPC.BACKUP_AUTO_LIST) as { ok: boolean; data: unknown[] }
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
  })
})

describe('BACKUP_GET_INFO', () => {
  it('returns ok with backup info shape', async () => {
    const result = await invoke(IPC.BACKUP_GET_INFO) as { ok: true; data: Record<string, unknown> }
    expect(result.ok).toBe(true)
    expect(result.data).toHaveProperty('dbSize')
    expect(result.data).toHaveProperty('totalClients')
    expect(result.data).toHaveProperty('dbPath')
    expect(result.data).toHaveProperty('autoBackupCount')
  })

  it('counts active records only in lists that still exist (X-11)', async () => {
    const kept = seedGrid(testDb.db, { rowCount: 3, columnCount: 1 })
    const gone = seedGrid(testDb.db, { rowCount: 2, columnCount: 1 })
    testDb.db.prepare('UPDATE grids SET is_active = 0 WHERE id = ?').run(gone.gridId)
    const result = await invoke(IPC.BACKUP_GET_INFO) as { ok: true; data: { totalClients: number } }
    expect(result.data.totalClients).toBe(kept.rowIds.length)
  })
})

describe('BACKUP_VERIFY', () => {
  it('rejects relative path', async () => {
    const result = await invoke(IPC.BACKUP_VERIFY, 'relative/path.db') as { ok: false; error: string }
    expect(result.ok).toBe(false)
  })
})

describe('BACKUP_SCHEDULED_GET_CONFIG', () => {
  it('returns ok', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_GET_CONFIG) as { ok: boolean }
    expect(result.ok).toBe(true)
  })
})

describe('BACKUP_SCHEDULED_SET_CONFIG', () => {
  it('rejects null config', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_SET_CONFIG, null) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects config with non-boolean enabled', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_SET_CONFIG, { enabled: 'yes', intervalHours: 24 }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects invalid intervalHours (0)', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_SET_CONFIG, { enabled: true, intervalHours: 0 }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects intervalHours > 720', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_SET_CONFIG, { enabled: true, intervalHours: 800 }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('keeps the recorded last run when the renderer saves settings', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_SET_CONFIG, { enabled: true, intervalHours: 12, lastRunISO: null }) as { ok: true }
    expect(result.ok).toBe(true)
    expect(backupMock.lastSet).toEqual({ enabled: true, intervalHours: 12, destinationDir: '/old/dest', lastRunISO: '2026-10-01T09:00:00.000Z' })
  })

  it('accepts the folder already saved without re-checking it, but checks a new one (AUDIT-001)', async () => {
    // '/old/dest' was vouched for when it was picked; a later toggle mustn't refuse it
    const same = await invoke(IPC.BACKUP_SCHEDULED_SET_CONFIG, { enabled: false, intervalHours: 24, destinationDir: '/old/dest' }) as { ok: boolean }
    expect(same.ok).toBe(true)
    const other = await invoke(IPC.BACKUP_SCHEDULED_SET_CONFIG, { enabled: true, intervalHours: 24, destinationDir: '/etc/pulse' }) as { ok: boolean; error?: string }
    expect(other.ok).toBe(false)
    expect(other.error).toMatch(/can't use that location/)
  })
})

describe('BACKUP_SCHEDULED_RUN_NOW', () => {
  it('runs the scheduled backup in main and returns the result', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_RUN_NOW) as { ok: true; data: { ran: boolean; lastRunISO: string } }
    expect(result.ok).toBe(true)
    expect(result.data.ran).toBe(true)
    expect(result.data.lastRunISO).toBe('2026-10-10T09:00:00.000Z')
  })
})

describe('BACKUP_GET_STATUS', () => {
  it('returns ok with status fields', async () => {
    const result = await invoke(IPC.BACKUP_GET_STATUS) as { ok: true; data: Record<string, unknown> }
    expect(result.ok).toBe(true)
    expect(result.data).toHaveProperty('lastAutoBackup')
    expect(result.data).toHaveProperty('lastAutoBackupSuccess')
  })

  it('reminds by default when nothing has been saved to another place', async () => {
    const result = await invoke(IPC.BACKUP_GET_STATUS) as { ok: true; data: { reminderEnabled: boolean; offsiteOverdue: boolean; remindAfterDays: number } }
    expect(result.data.reminderEnabled).toBe(true)
    expect(result.data.remindAfterDays).toBe(7)
    expect(result.data.offsiteOverdue).toBe(true)
  })

  it('stays quiet when the user switched reminders off', async () => {
    testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_reminder_enabled', 'false')").run()
    const result = await invoke(IPC.BACKUP_GET_STATUS) as { ok: true; data: { reminderEnabled: boolean; offsiteOverdue: boolean } }
    expect(result.data.reminderEnabled).toBe(false)
    expect(result.data.offsiteOverdue).toBe(false)
  })
})

describe('BACKUP_VALIDATE_DESTINATION', () => {
  it('returns invalid for empty string', async () => {
    const result = await invoke(IPC.BACKUP_VALIDATE_DESTINATION, '') as { ok: true; data: { valid: boolean; error: string } }
    expect(result.ok).toBe(true)
    expect(result.data.valid).toBe(false)
  })

  it('returns invalid for non-existent directory', async () => {
    const result = await invoke(IPC.BACKUP_VALIDATE_DESTINATION, '/nonexistent/path/to/dir') as { ok: true; data: { valid: boolean } }
    expect(result.ok).toBe(true)
    expect(result.data.valid).toBe(false)
  })
})

describe('IMPORT_UNDO (audit X-19)', () => {
  it('moves the imported records to Trash, and only that list\'s', async () => {
    const a = seedGrid(testDb.db, { rowCount: 3 })
    const b = seedGrid(testDb.db, { name: 'Other', rowCount: 1 })
    const result = await invoke(IPC.IMPORT_UNDO, a.gridId, [...a.rowIds.slice(0, 2), b.rowIds[0]]) as { ok: true; data: { moved: number } }
    expect(result.ok).toBe(true)
    expect(result.data.moved).toBe(2)
    const trashed = testDb.db.prepare('SELECT COUNT(*) AS n FROM rows WHERE deleted_at IS NOT NULL').get() as { n: number }
    expect(trashed.n).toBe(2)
  })

  it('rejects an empty or bad request', async () => {
    expect((await invoke(IPC.IMPORT_UNDO, 1, []) as { ok: boolean }).ok).toBe(false)
    expect((await invoke(IPC.IMPORT_UNDO, 0, [1]) as { ok: boolean }).ok).toBe(false)
  })
})

describe('BACKUP_RESTORE_OTHER', () => {
  const path = join(tmpdir(), 'pulse-test-export', 'temp', 'old.pulse-backup')

  it('rejects a weak new password before touching anything', async () => {
    backupMock.restoreOther = vi.fn()
    const result = await invoke(IPC.BACKUP_RESTORE_OTHER, path, 'old secret', 'short', '') as { ok: false }
    expect(result.ok).toBe(false)
    expect(backupMock.restoreOther).not.toHaveBeenCalled()
  })

  it('explains a wrong password in plain words', async () => {
    backupMock.restoreOther = vi.fn(async () => { throw new Error('Incorrect password or recovery key') })
    const result = await invoke(IPC.BACKUP_RESTORE_OTHER, path, 'wrong', 'A-Strong-New-Pass-42', '') as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/doesn't match this backup/)
  })

  it('says which of the three open failures it was when the restored data then fails to open, keeps no key and locks (S4, F-031)', async () => {
    const { lockApp } = await import('../src/main/auth')
    const { DatabaseOpenError } = await import('../src/main/database')
    vi.mocked(lockApp).mockClear(); fakeEvent.sender.send.mockClear()
    backupMock.restoreOther = vi.fn(async () => ({ safetyPath: '/b/pulse-pre-restore-x.pulse-backup', schemaVersion: 43 }))
    backupMock.openError = new Error('SQLITE_CORRUPT: database disk image is malformed')
    const result = await invoke(IPC.BACKUP_RESTORE_OTHER, path, 'right', 'A-Strong-New-Pass-42', '') as { ok: false; error: string }
    // The form turns the code into plain words (tests/renderer/RestoreFromBackupForm.test.tsx)
    expect(result).toEqual({ ok: false, error: 'DB_OPEN_FAILED:unreadable' })
    expect(lockApp).toHaveBeenCalled()
    expect(fakeEvent.sender.send).toHaveBeenCalledWith(IPC.AUTH_FORCE_LOCK)
    backupMock.openError = new DatabaseOpenError('migration', 'Migration to version 48 failed')
    expect(await invoke(IPC.BACKUP_RESTORE_OTHER, path, 'right', 'A-Strong-New-Pass-42', '')).toEqual({ ok: false, error: 'DB_OPEN_FAILED:migration' })
  })

  it('returns the safety copy path', async () => {
    backupMock.restoreOther = vi.fn(async () => ({ safetyPath: '/b/pulse-pre-restore-x.pulse-backup', schemaVersion: 43 }))
    const result = await invoke(IPC.BACKUP_RESTORE_OTHER, path, 'right', 'A-Strong-New-Pass-42', '') as { ok: true; data: { safetyPath: string } }
    expect(result.ok).toBe(true)
    expect(result.data.safetyPath).toBe('/b/pulse-pre-restore-x.pulse-backup')
  })
})

describe('restores in a read-only mode (AUDIT-093)', () => {
  const path = join(tmpdir(), 'pulse-test-export', 'temp', 'old.pulse-backup')

  it.each([
    [IPC.BACKUP_RESTORE_FILE, [path]],
    [IPC.BACKUP_RESTORE_AUTO, [path]],
    [IPC.BACKUP_RESTORE_OTHER, [path, 'secret', 'A-Strong-New-Pass-42', '']],
  ] as const)('%s is refused and replaces nothing', async (channel, args) => {
    const { registerReadOnlyChecker } = await import('../src/main/ipc/ipc-utils')
    backupMock.restoreOther = vi.fn()
    backupMock.opened = 0
    registerReadOnlyChecker(() => true)
    try {
      expect(await invoke(channel, ...args)).toEqual({ ok: false, error: 'READ_ONLY' })
      expect(backupMock.restoreOther).not.toHaveBeenCalled()
      expect(backupMock.opened).toBe(0)
    } finally {
      registerReadOnlyChecker(null)
    }
  })
})

describe('a restored backup that will not open (AUDIT-162)', () => {
  const path = join(tmpdir(), 'pulse-test-export', 'temp', 'old.pulse-backup')

  it.each([IPC.BACKUP_RESTORE_FILE, IPC.BACKUP_RESTORE_AUTO])('%s explains plainly, without "Restore failed" or "database"', async (channel) => {
    // The mocked restore reports a safety copy that doesn't exist on disk
    backupMock.openError = new Error('SQLITE_CORRUPT: database disk image is malformed')
    const result = await invoke(channel, path) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe("That backup couldn't be opened. Close Pulse and open it again. If your data is missing, restore a different backup from Settings → Backup.")
    expect(result.error).not.toMatch(/Restore failed|database/i)
  })
})

describe('a restore that fails before anything is replaced (polish R5)', () => {
  const path = join(tmpdir(), 'pulse-test-export', 'temp', 'old.pulse-backup')
  afterEach(() => { backupMock.restoreError = null })

  it.each([IPC.BACKUP_RESTORE_FILE, IPC.BACKUP_RESTORE_AUTO])('%s reopens the database and explains in plain words', async (channel) => {
    backupMock.restoreError = new Error('end of central directory record signature not found')
    backupMock.opened = 0
    const result = await invoke(channel, path) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe("This file is damaged or isn't a Pulse backup. Try a different backup file.")
    expect(backupMock.opened).toBe(1)
  })

  it('a damaged backup from another Pulse is explained, not quoted', async () => {
    backupMock.restoreOther = vi.fn(async () => { throw new Error('Database file hash mismatch — backup may be corrupted') })
    const result = await invoke(IPC.BACKUP_RESTORE_OTHER, path, 'right', 'A-Strong-New-Pass-42', '') as { ok: false; error: string }
    expect(result.error).toMatch(/damaged or isn't a Pulse backup/)
  })
})

describe('BACKUP_PREVIEW', () => {
  it('fails with empty path', async () => {
    const result = await invoke(IPC.BACKUP_PREVIEW, '') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('fails for non-existent file', async () => {
    const result = await invoke(IPC.BACKUP_PREVIEW, '/tmp/nonexistent-backup.db') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it("doesn't count records of lists in the Trash (S4)", async () => {
    const dir = join(tmpdir(), 'pulse-test-export', 'documents', `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'backup.db')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sqlite = require('better-sqlite3-multiple-ciphers')
    const db = new Sqlite(file)
    db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO app_meta VALUES ('schema_version', '47');
             CREATE TABLE grids (id INTEGER PRIMARY KEY, is_active INTEGER); INSERT INTO grids VALUES (1, 1), (2, 0);
             CREATE TABLE rows (id INTEGER PRIMARY KEY, grid_id INTEGER, is_active INTEGER, deleted_at TEXT);
             INSERT INTO rows VALUES (1, 1, 1, NULL), (2, 1, 1, NULL), (3, 1, 0, NULL), (4, 2, 1, NULL), (5, 2, 1, NULL);`)
    db.close()
    const result = await invoke(IPC.BACKUP_PREVIEW, file) as { ok: true; data: { gridCount: number; rowCount: number } }
    expect(result).toMatchObject({ ok: true, data: { gridCount: 1, rowCount: 2, schemaVersion: 47 } })
  })
})

// ── Export handlers ──────────────────────────────────────────────────────────

describe('EXPORT_CSV', () => {
  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.EXPORT_CSV, { gridId: -1, destPath: '/tmp/test.csv', columnIds: [], activeRowIds: [], dateFormat: 'YYYY-MM-DD' }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects relative destPath', async () => {
    const result = await invoke(IPC.EXPORT_CSV, { gridId: 1, destPath: 'relative.csv', columnIds: [], activeRowIds: [], dateFormat: 'YYYY-MM-DD' }) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('EXPORT_PDF_GRID', () => {
  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.EXPORT_PDF_GRID, { gridId: 0, destPath: '/tmp/test.pdf' }) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('EXPORT_PDF_PROFILE', () => {
  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.EXPORT_PDF_PROFILE, { gridId: 0, rowId: 1, destPath: '/tmp/p.pdf' }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects invalid row ID', async () => {
    const result = await invoke(IPC.EXPORT_PDF_PROFILE, { gridId: 1, rowId: -1, destPath: '/tmp/p.pdf' }) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('EXPORT_SUPERVISOR_REPORT', () => {
  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.EXPORT_SUPERVISOR_REPORT, { gridId: -1, destPath: '/tmp/r.pdf' }) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('EXPORT_PDF_CONTACT', () => {
  it('rejects invalid provider ID', async () => {
    const result = await invoke(IPC.EXPORT_PDF_CONTACT, 0) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('returns null when dialog is canceled', async () => {
    const result = await invoke(IPC.EXPORT_PDF_CONTACT, 1) as { ok: true; data: null }
    expect(result.ok).toBe(true)
    expect(result.data).toBeNull()
  })

  it('saves to a network folder picked in its own dialog, and the choice vouches only for that folder (F-033)', async () => {
    const electron = await import('electron')
    const { clearUserChosenPaths, assertSafePath } = await import('../src/main/ipc/ipc-utils')
    clearUserChosenPaths()
    const share = '/run/user/1000/gvfs/smb-share:server=nas,share=team/out.pdf'
    expect(() => assertSafePath(share)).toThrow()
    const spy = vi.spyOn(electron.dialog, 'showSaveDialog').mockResolvedValueOnce({ canceled: false, filePath: share })
    const result = await invoke(IPC.EXPORT_PDF_CONTACT, 1) as { ok: boolean; data: string }
    expect(result).toEqual({ ok: true, data: share })
    // A path no dialog returned is still refused
    expect(() => assertSafePath('/run/user/1000/gvfs/other-share/x.pdf')).toThrow()
    spy.mockRestore()
    clearUserChosenPaths()
  })
})

describe('EXPORT_PDF_DIRECTORY', () => {
  it('returns null when dialog is canceled', async () => {
    const result = await invoke(IPC.EXPORT_PDF_DIRECTORY, {}) as { ok: true; data: null }
    expect(result.ok).toBe(true)
    expect(result.data).toBeNull()
  })
})

describe('LETTER_TEMPLATE_EXPORT_PDF', () => {
  it('rejects non-string text', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_EXPORT_PDF, { text: 123 }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects text > 500K chars', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_EXPORT_PDF, { text: 'x'.repeat(500_001) }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('returns null when dialog is canceled', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_EXPORT_PDF, { text: 'Hello world' }) as { ok: true; data: null }
    expect(result.ok).toBe(true)
    expect(result.data).toBeNull()
  })
})

describe('EXPORT_ALL_CSV', () => {
  it('fails with empty destFolder', async () => {
    const result = await invoke(IPC.EXPORT_ALL_CSV, '') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('exports every list with hidden columns, gives same-named lists their own file, and adds the notes (X-21)', async () => {
    const dir = join(tmpdir(), 'pulse-test-export', 'documents', `all-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    const a = seedGrid(testDb.db, { name: 'Clients', rowCount: 1, columnCount: 2 })
    const b = seedGrid(testDb.db, { name: 'Clients', rowCount: 1, columnCount: 1 })
    testDb.db.prepare("UPDATE columns SET name = 'Name' WHERE id IN (?, ?)").run(a.columnIds[0], b.columnIds[0])
    testDb.db.prepare("UPDATE columns SET name = 'Secret', is_visible = 0 WHERE id = ?").run(a.columnIds[1])
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, 'José Núñez'), (?, ?, 'hidden value')").run(a.rowIds[0], a.columnIds[0], a.rowIds[0], a.columnIds[1])
    testDb.db.prepare("UPDATE rows SET display_name = 'José Núñez' WHERE id = ?").run(a.rowIds[0])
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, '<p>Home visit</p>', 'note', '2026-10-06 15:00:00', '2026-10-06 15:00:00')").run(a.rowIds[0])
    const result = await invoke(IPC.EXPORT_ALL_CSV, dir) as { ok: true; data: { exported: number; errors: string[]; notes: number } }
    expect(result).toEqual({ ok: true, data: expect.anything() })
    expect(result.data).toMatchObject({ exported: 2, errors: [], notes: 1 })
    // Each list goes to its own file with its hidden columns (exportCsv itself is covered in export-csv.test.ts)
    const { exportCsv } = await import('../src/main/export')
    const calls = vi.mocked(exportCsv).mock.calls.slice(-2).map(c => c[0] as { destPath: string; includeHidden?: boolean })
    expect(calls.map(c => c.destPath)).toEqual([join(dir, 'Clients.csv'), join(dir, 'Clients (2).csv')])
    expect(calls.every(c => c.includeHidden)).toBe(true)
    // Archived records come out too (S4)
    expect(calls.every(c => (c as { includeArchived?: boolean }).includeArchived)).toBe(true)
    expect(readdirSync(dir)).toEqual(['notes.csv'])
    const notes = readFileSync(join(dir, 'notes.csv'), 'utf-8')
    expect(notes).toContain('José Núñez')
    expect(notes).toContain('Home visit')
    expect(notes).not.toContain('<p>')
  })
})

describe('Export All file names (AUDIT-126)', () => {
  it('keeps list names Windows reserves for devices from becoming file names', async () => {
    const { listFileBase } = await import('../src/main/ipc/ipc-export')
    expect(listFileBase('Con')).toBe('Con_')
    expect(listFileBase('nul')).toBe('nul_')
    expect(listFileBase('PRN')).toBe('PRN_')
    expect(listFileBase('Aux.old')).toBe('Aux_.old')
    expect(listFileBase('COM1')).toBe('COM1_')
    expect(listFileBase('lpt9')).toBe('lpt9_')
    expect(listFileBase('Consults')).toBe('Consults')
    expect(listFileBase('Intake...  ')).toBe('Intake')
    expect(listFileBase('A/B: C')).toBe('A_B_ C')
    expect(listFileBase(' . ')).toBe('')
  })
})

// ── Import handlers ──────────────────────────────────────────────────────────

describe('IMPORT_DETECT_COLUMNS', () => {
  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.IMPORT_DETECT_COLUMNS, -1, ['Name']) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects non-array headers', async () => {
    const result = await invoke(IPC.IMPORT_DETECT_COLUMNS, 1, 'not-an-array') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects > 200 headers', async () => {
    const headers = Array.from({ length: 201 }, (_, i) => `Col${i}`)
    const result = await invoke(IPC.IMPORT_DETECT_COLUMNS, 1, headers) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('IMPORT_FILE_PREVIEW', () => {
  it('rejects relative path', async () => {
    const result = await invoke(IPC.IMPORT_FILE_PREVIEW, 'relative.csv') as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('IMPORT_FILE', () => {
  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.IMPORT_FILE, { gridId: 0, filePath: '/tmp/import.csv', columnMappings: [] }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects > 200 column mappings', async () => {
    const mappings = Array.from({ length: 201 }, (_, i) => ({ header: `Col${i}`, columnId: i + 1 }))
    const result = await invoke(IPC.IMPORT_FILE, { gridId: 1, filePath: '/tmp/import.csv', columnMappings: mappings }) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

// ── Setup Template handlers ──────────────────────────────────────────────────

describe('SETUP_TEMPLATE_GET_ALL', () => {
  it('returns ok with array', async () => {
    const result = await invoke(IPC.SETUP_TEMPLATE_GET_ALL) as { ok: boolean; data: unknown[] }
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
  })
})

describe('SETUP_TEMPLATE_DELETE', () => {
  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.SETUP_TEMPLATE_DELETE, -1) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('SETUP_TEMPLATE_EXPORT', () => {
  it('rejects invalid grid ID', async () => {
    const result = await invoke(IPC.SETUP_TEMPLATE_EXPORT, 0, '/tmp/out.pulse') as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('SETUP_TEMPLATE_EXPORT_SAVED (audit X-27)', () => {
  const dest = join(tmpdir(), 'pulse-test-export', 'temp', 'mine.pulse')

  it('exports a template from the library by its id', async () => {
    const id = testDb.db.prepare(`INSERT INTO setup_templates (name, description, template_data, is_system, created_at) VALUES ('Mine', NULL, '{"name":"Mine","columns":[]}', 0, datetime('now'))`).run().lastInsertRowid as number
    const result = await invoke(IPC.SETUP_TEMPLATE_EXPORT_SAVED, id, dest) as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('says so when the template is gone', async () => {
    const result = await invoke(IPC.SETUP_TEMPLATE_EXPORT_SAVED, 999999, dest) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/doesn't exist/)
  })
})

describe('SETUP_TEMPLATE_APPLY', () => {
  it('applies to new grid', async () => {
    const pulse = JSON.stringify({ name: 'Test', columns: [], description: null })
    const result = await invoke(IPC.SETUP_TEMPLATE_APPLY, pulse, 'new') as { ok: true; data: number }
    expect(result.ok).toBe(true)
    expect(result.data).toBe(42)
  })

  it('fails with invalid mode', async () => {
    const pulse = JSON.stringify({ name: 'Test', columns: [] })
    const result = await invoke(IPC.SETUP_TEMPLATE_APPLY, pulse, 'invalid') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('fails with existing mode but no gridId', async () => {
    const pulse = JSON.stringify({ name: 'Test', columns: [] })
    const result = await invoke(IPC.SETUP_TEMPLATE_APPLY, pulse, 'existing') as { ok: false }
    expect(result.ok).toBe(false)
  })
})

// ── Letter Template handlers ─────────────────────────────────────────────────

describe('LETTER_TEMPLATE_GET_ALL', () => {
  it('returns ok with array', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_GET_ALL) as { ok: boolean; data: unknown[] }
    expect(result.ok).toBe(true)
  })
})

describe('LETTER_TEMPLATE_CREATE', () => {
  it('rejects empty name', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_CREATE, '', null, 'content') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects content > 500K chars', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_CREATE, 'Name', null, 'x'.repeat(500_001)) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('accepts valid input', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_CREATE, 'Letter', null, '<p>Content</p>') as { ok: true }
    expect(result.ok).toBe(true)
  })
})

describe('LETTER_TEMPLATE_UPDATE', () => {
  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_UPDATE, 0, { name: 'New Name' }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects empty name update', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_UPDATE, 1, { name: '' }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects content > 500K', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_UPDATE, 1, { content: 'x'.repeat(500_001) }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects description > 2000 chars', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_UPDATE, 1, { description: 'x'.repeat(2001) }) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('LETTER_TEMPLATE_DELETE', () => {
  it('rejects invalid ID', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_DELETE, 0) as { ok: false }
    expect(result.ok).toBe(false)
  })
})

describe('LETTER_TEMPLATE_GENERATE', () => {
  it('rejects invalid templateId', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_GENERATE, 0, 1, 1) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects invalid rowId', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_GENERATE, 1, -1, 1) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects invalid gridId', async () => {
    const result = await invoke(IPC.LETTER_TEMPLATE_GENERATE, 1, 1, 0) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('returns generated letter text on valid IDs', async () => {
    // A record that exists and isn't in the Trash (letters for any other are refused, A16-06)
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const result = await invoke(IPC.LETTER_TEMPLATE_GENERATE, 1, rowIds[0], gridId) as { ok: true; data: string }
    expect(result.ok).toBe(true)
    expect(typeof result.data).toBe('string')
  })
})
