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
    openDatabase: () => {},
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
}))

vi.mock('../src/main/backup', () => ({
  setDatabaseBridge: () => {},
  runAutoBackup: async () => {},
  listAutoBackups: () => [],
  listAutoBackupsRich: () => [{ timestamp: new Date(), path: '/tmp/backup.db', sizeBytes: 1024 }],
  runScheduledBackup: async (config: unknown) => ({ ran: true }),
  runManualBackup: async (path: string) => ({ destPath: path, sizeBytes: 1024 }),
  restoreFromDb: async () => '/tmp/safety.db',
  restoreFromPulseBackup: async () => '/tmp/safety.db',
  getBackupInfo: () => ({ layer1: { count: 1 }, lastAutoBackupFailed: false, lastAutoBackupError: null }),
  verifyBackup: async () => ({ valid: true, rowCount: 10 }),
  getScheduledConfig: () => ({ enabled: false, intervalHours: 24, destinationDir: null }),
  setScheduledConfig: () => {},
  checkAndRunScheduled: async () => {},
  runPreMigrationBackup: () => {},
}))

vi.mock('../src/main/export', () => ({
  exportCsv: vi.fn(async () => '/tmp/export.csv'),
  exportPdfGrid: async () => '/tmp/export.pdf',
  exportPdfProfile: async () => '/tmp/profile.pdf',
  exportPdfBatch: async () => '/tmp/batch.pdf',
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

const fakeEvent = { senderFrame: { parent: null } }

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

describe('BACKUP_SCHEDULED_RUN', () => {
  it('rejects invalid config — enabled not boolean', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_RUN, { enabled: 'yes', intervalDays: 1 }) as { ok: false; error: string }
    expect(result.ok).toBe(false)
  })

  it('rejects invalid intervalDays — 0', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_RUN, { enabled: true, intervalDays: 0 }) as { ok: false; error: string }
    expect(result.ok).toBe(false)
  })

  it('rejects intervalDays > 365', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_RUN, { enabled: true, intervalDays: 400 }) as { ok: false; error: string }
    expect(result.ok).toBe(false)
  })

  it('rejects non-ISO lastRunDate', async () => {
    const result = await invoke(IPC.BACKUP_SCHEDULED_RUN, { enabled: true, intervalDays: 7, lastRunDate: 'not-a-date' }) as { ok: false; error: string }
    expect(result.ok).toBe(false)
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
})

describe('BACKUP_GET_STATUS', () => {
  it('returns ok with status fields', async () => {
    const result = await invoke(IPC.BACKUP_GET_STATUS) as { ok: true; data: Record<string, unknown> }
    expect(result.ok).toBe(true)
    expect(result.data).toHaveProperty('lastAutoBackup')
    expect(result.data).toHaveProperty('lastAutoBackupSuccess')
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

describe('BACKUP_PREVIEW', () => {
  it('fails with empty path', async () => {
    const result = await invoke(IPC.BACKUP_PREVIEW, '') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('fails for non-existent file', async () => {
    const result = await invoke(IPC.BACKUP_PREVIEW, '/tmp/nonexistent-backup.db') as { ok: false }
    expect(result.ok).toBe(false)
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

describe('EXPORT_PDF_BATCH', () => {
  it('rejects too many row IDs', async () => {
    const rowIds = Array.from({ length: 1001 }, (_, i) => i + 1)
    const result = await invoke(IPC.EXPORT_PDF_BATCH, {
      gridId: 1, rowIds, destPath: '/tmp/batch.pdf', sortOrder: 'grid',
      includeSections: { deadlines: true, checklist: true, caseLog: true, scratchPad: true, contactInfo: true, gridData: true },
    }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects invalid sort order', async () => {
    const result = await invoke(IPC.EXPORT_PDF_BATCH, {
      gridId: 1, rowIds: [1], destPath: '/tmp/batch.pdf', sortOrder: 'invalid',
      includeSections: { deadlines: true, checklist: true, caseLog: true, scratchPad: true, contactInfo: true, gridData: true },
    }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects non-positive integer row IDs', async () => {
    const result = await invoke(IPC.EXPORT_PDF_BATCH, {
      gridId: 1, rowIds: [1, -2, 3], destPath: '/tmp/batch.pdf', sortOrder: 'grid',
      includeSections: { deadlines: true, checklist: true, caseLog: true, scratchPad: true, contactInfo: true, gridData: true },
    }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects missing includeSections', async () => {
    const result = await invoke(IPC.EXPORT_PDF_BATCH, {
      gridId: 1, rowIds: [1], destPath: '/tmp/batch.pdf', sortOrder: 'grid',
      includeSections: null,
    }) as { ok: false }
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
    expect(readdirSync(dir)).toEqual(['notes.csv'])
    const notes = readFileSync(join(dir, 'notes.csv'), 'utf-8')
    expect(notes).toContain('José Núñez')
    expect(notes).toContain('Home visit')
    expect(notes).not.toContain('<p>')
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

describe('SETUP_TEMPLATE_CREATE', () => {
  it('rejects empty name', async () => {
    const result = await invoke(IPC.SETUP_TEMPLATE_CREATE, '', null, '{}') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects name > 500 chars', async () => {
    const result = await invoke(IPC.SETUP_TEMPLATE_CREATE, 'x'.repeat(501), null, '{}') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects pulseJson > 10MB', async () => {
    const result = await invoke(IPC.SETUP_TEMPLATE_CREATE, 'Big Template', null, 'x'.repeat(10_000_001)) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects description > 2000 chars', async () => {
    const result = await invoke(IPC.SETUP_TEMPLATE_CREATE, 'Good Name', 'x'.repeat(2001), '{}') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('accepts valid input', async () => {
    const result = await invoke(IPC.SETUP_TEMPLATE_CREATE, 'My Template', 'Description', '{"columns":[]}') as { ok: true; data: number }
    expect(result.ok).toBe(true)
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
    const result = await invoke(IPC.LETTER_TEMPLATE_GENERATE, 1, 1, 1) as { ok: true; data: string }
    expect(result.ok).toBe(true)
    expect(typeof result.data).toBe('string')
  })
})
