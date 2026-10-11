/**
 * IPC injection tests — send malformed args to key IPC handlers and verify
 * they handle bad input safely (no crashes, no SQL injection, proper error returns).
 *
 * Uses the handler-capture pattern from ipc-handlers.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from '../helpers'
import { IPC } from '../../src/shared/ipc-channels'

// ── Handler capture map ──────────────────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => {
      const { tmpdir } = require('os')
      const { join } = require('path')
      return join(tmpdir(), 'pulse-test-inject')
    },
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
  },
  shell: { openPath: async () => '', openExternal: async () => {} },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

vi.mock('../../src/main/index', () => ({
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

vi.mock('../../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/database')>('../../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    checkCloudSyncPath: () => null,
    cachedStmt: (key: string, sql: string) => testDb.db.prepare(sql),
    upsertCell: (rowId: number, columnId: number, value: string | null) => {
      testDb.db.prepare(`
        INSERT INTO cells (row_id, column_id, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(row_id, column_id)
        DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(rowId, columnId, value)
    },
    getRow: (gridId: number, rowId: number) => {
      const cols = testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Array<{ id: number }>
      if (cols.length === 0) return null
      const query = actual.buildGridQuery(cols.map(c => c.id), true)
      const rows = testDb.db.prepare(query).all(gridId) as Record<string, unknown>[]
      return rows.find(r => r.id === rowId) ?? null
    },
  }
})

vi.mock('../../src/main/auth', () => ({
  isPasswordSetup: () => true,
  setupPassword: async () => 'abc123',
  verifyAndUnlock: async () => 'abc123',
  verifyAndUnlockRecovery: async () => 'abc123',
  changePassword: async () => {},
  resetPasswordAfterRecovery: async () => {},
  generateRecoveryKey: async () => 'ABCD-EFGH-IJKL-MNOP',
  revokeRecoveryKey: () => {},
  lockApp: () => {},
  getPasswordHint: () => '',
  hasRecoveryKey: () => false,
  getDbKey: () => 'abc123',
  setStoredDbPath: () => {},
  getStoredDbPath: () => '/tmp/test.db',
  getAutoLockMinutes: () => 30,
  getLoginLockoutRemaining: () => 0,
}))

vi.mock('../../src/main/backup', () => ({
  setDatabaseBridge: () => {},
  runAutoBackup: async () => {},
  listAutoBackups: () => [],
  listAutoBackupsRich: () => [],
  runManualBackup: () => ({ destPath: '/tmp/backup.pulse-backup', sizeBytes: 0 }),
  restoreFromDb: async () => {},
  restoreFromPulseBackup: async () => {},
  getBackupInfo: () => ({ size: 0, created: '' }),
  getBackupDir: () => '/tmp/backups',
  verifyBackup: async () => ({ valid: true }),
  getScheduledConfig: () => null,
  setScheduledConfig: () => {},
  checkAndRunScheduled: async () => {},
  runPreMigrationBackup: () => {},
}))

vi.mock('../../src/main/export', () => ({
  exportCsv: async () => '/tmp/export.csv',
  exportPdfGrid: async () => '/tmp/export.pdf',
  exportPdfProfile: async () => '/tmp/profile.pdf',
  batchPrint: async () => '/tmp/batch.pdf',
  exportSupervisorReport: async () => '/tmp/report.pdf',
}))

vi.mock('../../src/main/import', () => ({
  parseImportFile: async () => ({ headers: [], rows: [], totalRows: 0 }),
  autoMatchColumns: () => [],
  executeImport: async () => ({ imported: 0, skipped: 0 }),
}))

vi.mock('../../src/main/templates', () => ({
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

vi.mock('../../src/main/file-association', () => ({
  getPendingImport: () => null,
  clearPendingImport: () => {},
  registerPulseFileType: () => {},
  unregisterPulseFileType: () => {},
  isPulseFileTypeRegistered: () => false,
}))

vi.mock('../../src/main/contacts', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/contacts')>('../../src/main/contacts')
  return actual
})

// Import SAFE_IDENT via ESM (not require)
import { SAFE_IDENT, validId } from '../../src/main/ipc/ipc-utils'

// Helper to invoke a captured handler with a valid sender frame
const validEvent = { senderFrame: { parent: null } }
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return await handler(validEvent, ...args)
}

beforeAll(async () => {
  // Create initial test DB so getDb() works during handler registration
  testDb = createTestDb()
  // Import and register all handlers via the central registration function
  const { registerIpcHandlers } = await import('../../src/main/ipc-handlers')
  registerIpcHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
})

afterEach(() => {
  cleanupTestDb(testDb)
})

describe('IPC Injection: CELL_UPDATE with malformed args', () => {
  it('handles SQL fragment in cell value safely (parameterized query)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db)
    const sqlPayload = "'; DROP TABLE cells; --"
    const result = await invoke(IPC.CELL_UPDATE, rowIds[0], columnIds[0], sqlPayload) as any
    expect(result.ok).toBe(true)

    // Verify the SQL fragment was stored as a literal string, not executed
    const cell = testDb.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?')
      .get(rowIds[0], columnIds[0]) as { value: string }
    expect(cell.value).toBe(sqlPayload)

    // Verify cells table still exists
    const tables = testDb.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cells'").get()
    expect(tables).toBeTruthy()
  })

  it('handles null rowId', async () => {
    const result = await invoke(IPC.CELL_UPDATE, null, 1, 'value') as any
    expect(result.ok).toBe(false)
  })

  it('handles undefined columnId', async () => {
    const result = await invoke(IPC.CELL_UPDATE, 1, undefined, 'value') as any
    expect(result.ok).toBe(false)
  })

  it('handles negative IDs', async () => {
    const result = await invoke(IPC.CELL_UPDATE, -1, -5, 'value') as any
    expect(result.ok).toBe(false)
  })

  it('handles zero IDs', async () => {
    const result = await invoke(IPC.CELL_UPDATE, 0, 0, 'value') as any
    expect(result.ok).toBe(false)
  })

  it('handles float IDs', async () => {
    const result = await invoke(IPC.CELL_UPDATE, 1.5, 2.7, 'value') as any
    expect(result.ok).toBe(false)
  })

  it('handles NaN ID', async () => {
    const result = await invoke(IPC.CELL_UPDATE, NaN, 1, 'value') as any
    expect(result.ok).toBe(false)
  })

  it('handles Infinity ID', async () => {
    const result = await invoke(IPC.CELL_UPDATE, Infinity, 1, 'value') as any
    expect(result.ok).toBe(false)
  })

  it('handles object where string expected for value', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db)
    // Object value — should not crash; might be stringified or rejected
    const result = await invoke(IPC.CELL_UPDATE, rowIds[0], columnIds[0], { evil: true }) as any
    // Should either succeed (toString) or fail gracefully — never crash
    expect(result).toHaveProperty('ok')
  })

  it('handles very long string value', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db)
    const longValue = 'A'.repeat(100_000)
    const result = await invoke(IPC.CELL_UPDATE, rowIds[0], columnIds[0], longValue) as any
    expect(result).toHaveProperty('ok')
  })
})

describe('IPC Injection: GRID_CREATE with malformed args', () => {
  it('handles SQL injection in grid name', async () => {
    const sqlPayload = "Test'; DROP TABLE grids; --"
    const result = await invoke(IPC.GRID_CREATE, sqlPayload) as any
    expect(result.ok).toBe(true)

    // result.data is the gridId (number)
    const gridId = result.data as number
    const grid = testDb.db.prepare('SELECT name FROM grids WHERE id = ?').get(gridId) as { name: string }
    expect(grid.name).toBe(sqlPayload)

    // Verify grids table still exists (SQL injection didn't execute)
    const tables = testDb.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='grids'").get()
    expect(tables).toBeTruthy()
  })

  it('handles empty string name', async () => {
    const result = await invoke(IPC.GRID_CREATE, '') as any
    expect(result).toHaveProperty('ok')
  })

  it('handles null name', async () => {
    const result = await invoke(IPC.GRID_CREATE, null) as any
    expect(result).toHaveProperty('ok')
  })

  it('handles number instead of string name', async () => {
    const result = await invoke(IPC.GRID_CREATE, 12345) as any
    expect(result).toHaveProperty('ok')
  })

  it('handles object instead of string name', async () => {
    const result = await invoke(IPC.GRID_CREATE, { toString: () => 'evil' }) as any
    expect(result).toHaveProperty('ok')
  })
})

describe('IPC Injection: ROW_CREATE with malformed args', () => {
  it('handles non-existent gridId', async () => {
    const result = await invoke(IPC.ROW_CREATE, 999999, 0) as any
    expect(result).toHaveProperty('ok')
  })

  it('handles string instead of number gridId', async () => {
    const result = await invoke(IPC.ROW_CREATE, 'not-a-number', 0) as any
    expect(result.ok).toBe(false)
  })

  it('handles negative position', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.ROW_CREATE, gridId, -1) as any
    expect(result).toHaveProperty('ok')
  })

  it('handles extremely large position', async () => {
    const { gridId } = seedGrid(testDb.db)
    const result = await invoke(IPC.ROW_CREATE, gridId, Number.MAX_SAFE_INTEGER) as any
    expect(result).toHaveProperty('ok')
  })

  it('handles array instead of number', async () => {
    const result = await invoke(IPC.ROW_CREATE, [1, 2, 3], 0) as any
    expect(result.ok).toBe(false)
  })
})

describe('IPC Injection: validId boundary checks', () => {
  const badIds = [
    { name: 'negative', value: -1 },
    { name: 'zero', value: 0 },
    { name: 'float', value: 1.5 },
    { name: 'NaN', value: NaN },
    { name: 'Infinity', value: Infinity },
    { name: '-Infinity', value: -Infinity },
    { name: 'string', value: '1' },
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'boolean', value: true },
    { name: 'MAX_SAFE_INTEGER + 1', value: Number.MAX_SAFE_INTEGER + 1 },
  ]

  for (const { name, value } of badIds) {
    it(`ROW_DELETE rejects ${name} as rowId`, async () => {
      const result = await invoke(IPC.ROW_DELETE, value) as any
      expect(result.ok).toBe(false)
    })
  }
})

describe('IPC Injection: validId unit tests', () => {
  it('accepts positive integers', () => {
    expect(validId(1)).toBe(true)
    expect(validId(100)).toBe(true)
    expect(validId(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it('rejects non-positive-integers', () => {
    expect(validId(0)).toBe(false)
    expect(validId(-1)).toBe(false)
    expect(validId(1.5)).toBe(false)
    expect(validId(NaN)).toBe(false)
    expect(validId(Infinity)).toBe(false)
    expect(validId(null)).toBe(false)
    expect(validId(undefined)).toBe(false)
    expect(validId('1')).toBe(false)
    expect(validId(true)).toBe(false)
  })
})

describe('IPC Injection: SAFE_IDENT field name validation', () => {
  it('accepts valid SQL identifiers', () => {
    expect(SAFE_IDENT.test('valid_field')).toBe(true)
    expect(SAFE_IDENT.test('name')).toBe(true)
    expect(SAFE_IDENT.test('col1')).toBe(true)
    expect(SAFE_IDENT.test('a')).toBe(true)
  })

  it('rejects SQL injection in field names', () => {
    expect(SAFE_IDENT.test("name; DROP TABLE--")).toBe(false)
    expect(SAFE_IDENT.test("name' OR '1'='1")).toBe(false)
    expect(SAFE_IDENT.test('Name')).toBe(false) // uppercase rejected
    expect(SAFE_IDENT.test('1name')).toBe(false) // starts with digit
    expect(SAFE_IDENT.test('')).toBe(false)
    expect(SAFE_IDENT.test(' ')).toBe(false)
    expect(SAFE_IDENT.test('field-name')).toBe(false)
    expect(SAFE_IDENT.test('field.name')).toBe(false)
    expect(SAFE_IDENT.test('field name')).toBe(false)
  })
})
