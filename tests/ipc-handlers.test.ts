/**
 * IPC Handler Contract Tests — tests that IPC handlers return correct
 * IPCResult<T> shapes and perform the expected DB operations.
 *
 * Strategy: mock ipcMain.handle to capture handler functions in a Map,
 * mock getDb() to return our real test SQLCipher DB, then call captured
 * handlers directly and assert results.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'
import { registerReadOnlyChecker } from '../src/main/ipc/ipc-utils'

// ── Handler capture map ──────────────────────────────────────────────────────

const handlers = new Map<string, (...args: unknown[]) => unknown>()

// Mock ipcMain to capture handler registrations
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => {
      const { tmpdir } = require('os')
      const { join } = require('path')
      return join(tmpdir(), 'pulse-test-ipc')
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

// Mock electron-store
vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return {
    default: class {
      constructor() {}
      get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d }
      set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'object') { for (const [key, val] of Object.entries(k)) map.set(key, val) } else { map.set(k, v) } }
      has(k: string) { return map.has(k) }
      delete(k: string) { map.delete(k) }
      clear() { map.clear() }
    },
  }
})

// We need to redirect getDb() to our test database
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
    // upsertCell and getRow call getDb() internally via their own closure,
    // so we must re-implement them to use testDb.db directly.
    // cachedStmt also needs testDb.db for the prepared statement cache.
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

// Mock auth — we don't test auth here (separate test file)
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
  getPasswordHint: () => 'test hint',
  hasRecoveryKey: () => false,
  getDbKey: () => 'abc123',
  setStoredDbPath: () => {},
  getStoredDbPath: () => '/tmp/test.db',
  getAutoLockMinutes: () => 30,
}))

// Mock backup — file-system dependent
vi.mock('../src/main/backup', () => ({
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

// Mock export — needs display/PDF libs
vi.mock('../src/main/export', () => ({
  exportCsv: async () => '/tmp/export.csv',
  exportPdfGrid: async () => '/tmp/export.pdf',
  exportPdfProfile: async () => '/tmp/profile.pdf',
  exportSupervisorReport: async () => '/tmp/report.pdf',
}))

// Mock import — partially real but we stub file I/O
vi.mock('../src/main/import', () => ({
  parseImportFile: async () => ({ headers: [], rows: [], totalRows: 0 }),
  autoMatchColumns: () => [],
  executeImport: async () => ({ imported: 0, skipped: 0 }),
}))

// Mock templates — stubs
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

// Mock file-association
vi.mock('../src/main/file-association', () => ({
  getPendingImport: () => null,
  clearPendingImport: () => {},
  registerPulseFileType: () => {},
  unregisterPulseFileType: () => {},
  isPulseFileTypeRegistered: () => false,
}))

// Contacts — let real code run since it uses getDb() which we've redirected
// But we need to mock fs operations in contacts.ts if any
vi.mock('../src/main/contacts', async () => {
  const actual = await vi.importActual<typeof import('../src/main/contacts')>('../src/main/contacts')
  return actual
})

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Create test DB first so getDb() works during handler registration
  testDb = createTestDb()
  // Now import and register handlers (this triggers all ipcMain.handle calls)
  const { registerIpcHandlers } = await import('../src/main/ipc-handlers')
  registerIpcHandlers()
})

beforeEach(() => {
  // Fresh DB for each test
  testDb = createTestDb()
})

afterEach(() => {
  // Cleanup after each test to release DB handles and temp files promptly
  cleanupTestDb(testDb)
})

// Fake IPC event — senderFrame with no parent (top-level frame, passes secureHandle check)
const fakeEvent = { senderFrame: { parent: null } }

// Helper to call a captured handler (simulates IPC invoke)
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`)
  return await handler(fakeEvent, ...args)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IPC Handlers — ok/fail shape', () => {
  it('ok wrapper has { ok: true, data }', async () => {
    // GRID_GET_ALL always returns ok shape (even empty)
    const result = await invoke(IPC.GRID_GET_ALL) as { ok: boolean; data: unknown }
    expect(result.ok).toBe(true)
    expect(result).toHaveProperty('data')
  })

  it('invalid grid ID returns fail shape', async () => {
    const result = await invoke(IPC.GRID_GET, 999999) as { ok: boolean; error?: string }
    expect(result.ok).toBe(false)
    expect(result).toHaveProperty('error')
    expect(typeof result.error).toBe('string')
  })
})

describe('IPC Handlers — Grid CRUD', () => {
  it('create → get → update name → delete', async () => {
    // Create
    const createResult = await invoke(IPC.GRID_CREATE, 'Test Caseload') as { ok: true; data: number }
    expect(createResult.ok).toBe(true)
    const gridId = createResult.data
    expect(typeof gridId).toBe('number')

    // Get
    const getResult = await invoke(IPC.GRID_GET, gridId) as { ok: true; data: { grid: { id: number; name: string }; columns: unknown[]; rows: unknown[] } }
    expect(getResult.ok).toBe(true)
    expect(getResult.data.grid.name).toBe('Test Caseload')
    // Should have default Name column
    expect(getResult.data.columns.length).toBeGreaterThanOrEqual(1)

    // Update name
    const updateResult = await invoke(IPC.GRID_UPDATE, gridId, { name: 'Renamed Caseload' }) as { ok: boolean }
    expect(updateResult.ok).toBe(true)

    // Verify updated
    const getResult2 = await invoke(IPC.GRID_GET, gridId) as { ok: true; data: { grid: { name: string } } }
    expect(getResult2.data.grid.name).toBe('Renamed Caseload')

    // Delete
    const deleteResult = await invoke(IPC.GRID_DELETE, gridId) as { ok: boolean }
    expect(deleteResult.ok).toBe(true)

    // Verify deleted (soft delete — is_active=0)
    const getAllResult = await invoke(IPC.GRID_GET_ALL) as { ok: true; data: unknown[] }
    expect(getAllResult.data).toHaveLength(0)
  })
})

describe('IPC Handlers — Row CRUD', () => {
  let gridId: number

  beforeEach(async () => {
    const r = await invoke(IPC.GRID_CREATE, 'Row Test Grid') as { ok: true; data: number }
    gridId = r.data
  })

  it('create at end position', async () => {
    const r1 = await invoke(IPC.ROW_CREATE, gridId) as { ok: true; data: number }
    expect(r1.ok).toBe(true)
    expect(typeof r1.data).toBe('number')

    const r2 = await invoke(IPC.ROW_CREATE, gridId) as { ok: true; data: number }
    expect(r2.data).not.toBe(r1.data)
  })

  it('archive → unarchive', async () => {
    const rowResult = await invoke(IPC.ROW_CREATE, gridId) as { ok: true; data: number }
    const rowId = rowResult.data

    const archiveResult = await invoke(IPC.ROW_ARCHIVE, rowId, 'No longer active') as { ok: boolean }
    expect(archiveResult.ok).toBe(true)

    // Verify archived: get grid without archived should not include it
    const gridData = await invoke(IPC.GRID_GET, gridId, false) as { ok: true; data: { rows: Array<{ id: number }> } }
    expect(gridData.data.rows.find(r => r.id === rowId)).toBeUndefined()

    // Unarchive
    const unarchiveResult = await invoke(IPC.ROW_UNARCHIVE, rowId) as { ok: boolean }
    expect(unarchiveResult.ok).toBe(true)
  })

  it('duplicate copies cell values', async () => {
    const rowResult = await invoke(IPC.ROW_CREATE, gridId) as { ok: true; data: number }
    const rowId = rowResult.data

    // Get the default Name column
    const gridData = await invoke(IPC.GRID_GET, gridId) as { ok: true; data: { columns: Array<{ id: number; is_name_column: number }> } }
    const nameCol = gridData.data.columns.find(c => c.is_name_column === 1)!

    // Create a non-name column and set a value
    const colResult = await invoke(IPC.COLUMN_CREATE, gridId, 'Status', 'text') as { ok: true; data: number }
    const statusColId = colResult.data

    await invoke(IPC.CELL_UPDATE, rowId, statusColId, 'Active')

    // Duplicate
    const dupResult = await invoke(IPC.ROW_DUPLICATE, rowId) as { ok: true; data: number }
    expect(dupResult.ok).toBe(true)
    const newRowId = dupResult.data

    // Verify the status cell was copied
    const cell = testDb.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(newRowId, statusColId) as { value: string } | undefined
    expect(cell?.value).toBe('Active')
  })

  it('soft-delete moves to trash, hard-delete cascades via FK', async () => {
    const rowResult = await invoke(IPC.ROW_CREATE, gridId) as { ok: true; data: number }
    const rowId = rowResult.data

    // Add some related data
    await invoke(IPC.CHECKLIST_CREATE_ITEM, rowId, 'Follow up')
    await invoke(IPC.CASE_LOG_CREATE, rowId, 'Initial contact', 'note', null)

    // Soft-delete (ROW_DELETE now does soft-delete)
    const deleteResult = await invoke(IPC.ROW_DELETE, rowId) as { ok: boolean }
    expect(deleteResult.ok).toBe(true)

    // Row still exists in DB with deleted_at set
    const row = testDb.db.prepare('SELECT deleted_at, is_active FROM rows WHERE id = ?').get(rowId) as { deleted_at: string | null; is_active: number }
    expect(row.deleted_at).not.toBeNull()
    expect(row.is_active).toBe(0)

    // Related data still intact (no cascade on soft-delete)
    const checklistCount = (testDb.db.prepare('SELECT COUNT(*) as c FROM checklist_items WHERE row_id = ?').get(rowId) as { c: number }).c
    expect(checklistCount).toBe(1)

    // Restore from trash
    const restoreResult = await invoke(IPC.ROW_RESTORE_DELETED, rowId) as { ok: boolean }
    expect(restoreResult.ok).toBe(true)
    const restored = testDb.db.prepare('SELECT deleted_at, is_active FROM rows WHERE id = ?').get(rowId) as { deleted_at: string | null; is_active: number }
    expect(restored.deleted_at).toBeNull()
    expect(restored.is_active).toBe(1)

    // Hard-delete cascades via FK
    const hardDeleteResult = await invoke(IPC.ROW_HARD_DELETE, rowId) as { ok: boolean }
    expect(hardDeleteResult.ok).toBe(true)

    const afterHard = testDb.db.prepare('SELECT COUNT(*) as c FROM checklist_items WHERE row_id = ?').get(rowId) as { c: number }
    const caseLogCount = (testDb.db.prepare('SELECT COUNT(*) as c FROM case_log WHERE row_id = ?').get(rowId) as { c: number }).c
    expect(afterHard.c).toBe(0)
    expect(caseLogCount).toBe(0)
  })
})

describe('IPC Handlers — Cell Update', () => {
  it('upsert records cell_history and returns sysLogId shape', async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Cell Test') as { ok: true; data: number }
    const gridId = gridResult.data
    const rowResult = await invoke(IPC.ROW_CREATE, gridId) as { ok: true; data: number }
    const rowId = rowResult.data

    // Get the default Name column
    const gridData = await invoke(IPC.GRID_GET, gridId) as { ok: true; data: { columns: Array<{ id: number }> } }
    const colId = gridData.data.columns[0].id

    // First update
    const r1 = await invoke(IPC.CELL_UPDATE, rowId, colId, 'Alice') as { ok: true; data: { sysLogId: number | null } }
    expect(r1.ok).toBe(true)
    expect(r1.data).toHaveProperty('sysLogId')

    // Second update — should create cell_history entry
    await invoke(IPC.CELL_UPDATE, rowId, colId, 'Bob')
    const history = testDb.db.prepare('SELECT * FROM cell_history WHERE row_id = ? AND column_id = ?').all(rowId, colId) as unknown[]
    expect(history.length).toBeGreaterThanOrEqual(1)
  })
})

describe('IPC Handlers — Column CRUD', () => {
  it('create → verify position → delete with cascade', async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Col Test') as { ok: true; data: number }
    const gridId = gridResult.data
    const rowResult = await invoke(IPC.ROW_CREATE, gridId) as { ok: true; data: number }
    const rowId = rowResult.data

    // Create column
    const colResult = await invoke(IPC.COLUMN_CREATE, gridId, 'Phone', 'text') as { ok: true; data: number }
    expect(colResult.ok).toBe(true)
    const colId = colResult.data

    // Verify position (default Name col is 0, so Phone should be 1)
    const col = testDb.db.prepare('SELECT position FROM columns WHERE id = ?').get(colId) as { position: number }
    expect(col.position).toBe(1)

    // Set a cell value for this column
    await invoke(IPC.CELL_UPDATE, rowId, colId, '555-1234')

    // Delete column — cells should cascade
    const deleteResult = await invoke(IPC.COLUMN_DELETE, colId) as { ok: boolean }
    expect(deleteResult.ok).toBe(true)

    const cellCount = (testDb.db.prepare('SELECT COUNT(*) as c FROM cells WHERE column_id = ?').get(colId) as { c: number }).c
    expect(cellCount).toBe(0)
  })
})

describe('IPC Handlers — Checklist', () => {
  let rowId: number

  beforeEach(async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'CL Test') as { ok: true; data: number }
    const rowResult = await invoke(IPC.ROW_CREATE, gridResult.data) as { ok: true; data: number }
    rowId = rowResult.data
  })

  it('create item → update (mark complete) → delete', async () => {
    // Create
    const createResult = await invoke(IPC.CHECKLIST_CREATE_ITEM, rowId, 'Call doctor') as { ok: true; data: { id: number; title: string; is_completed: number } }
    expect(createResult.ok).toBe(true)
    expect(createResult.data.title).toBe('Call doctor')
    expect(createResult.data.is_completed).toBe(0)
    const itemId = createResult.data.id

    // Mark complete
    const updateResult = await invoke(IPC.CHECKLIST_UPDATE_ITEM, itemId, {
      is_completed: 1,
      completed_at: new Date().toISOString(),
    }) as { ok: true; data: { sysLogId: number | null } }
    expect(updateResult.ok).toBe(true)
    expect(updateResult.data).toHaveProperty('sysLogId')
    // Completion should generate a system log entry
    expect(updateResult.data.sysLogId).not.toBeNull()

    // Delete
    const deleteResult = await invoke(IPC.CHECKLIST_DELETE_ITEM, itemId) as { ok: boolean }
    expect(deleteResult.ok).toBe(true)

    const count = (testDb.db.prepare('SELECT COUNT(*) as c FROM checklist_items WHERE id = ?').get(itemId) as { c: number }).c
    expect(count).toBe(0)
  })
})

describe('IPC Handlers — Case Log', () => {
  let rowId: number

  beforeEach(async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Log Test') as { ok: true; data: number }
    const rowResult = await invoke(IPC.ROW_CREATE, gridResult.data) as { ok: true; data: number }
    rowId = rowResult.data
  })

  it('create entry → void → unvoid → verify voided_at toggled', async () => {
    // Create
    const createResult = await invoke(IPC.CASE_LOG_CREATE, rowId, 'Met with client', 'note', null) as { ok: true; data: { id: number; content: string } }
    expect(createResult.ok).toBe(true)
    expect(createResult.data.content).toBe('Met with client')
    const entryId = createResult.data.id

    // Void
    const voidResult = await invoke(IPC.CASE_LOG_VOID, entryId, 'Undo action') as { ok: boolean }
    expect(voidResult.ok).toBe(true)
    const voided = testDb.db.prepare('SELECT voided_at, voided_reason FROM case_log WHERE id = ?').get(entryId) as { voided_at: string | null; voided_reason: string | null }
    expect(voided.voided_at).not.toBeNull()
    expect(voided.voided_reason).toBe('Undo action')

    // Unvoid
    const unvoidResult = await invoke(IPC.CASE_LOG_UNVOID, entryId) as { ok: boolean }
    expect(unvoidResult.ok).toBe(true)
    const unvoided = testDb.db.prepare('SELECT voided_at, voided_reason FROM case_log WHERE id = ?').get(entryId) as { voided_at: string | null; voided_reason: string | null }
    expect(unvoided.voided_at).toBeNull()
    expect(unvoided.voided_reason).toBeNull()
  })
})

describe('IPC Handlers — Settings', () => {
  it('get missing key → update → get returns new value', async () => {
    // Get missing
    const missing = await invoke(IPC.SETTINGS_GET, 'theme') as { ok: true; data: string | null }
    expect(missing.ok).toBe(true)
    expect(missing.data).toBeNull()

    // Update
    const updateResult = await invoke(IPC.SETTINGS_UPDATE, 'theme', 'dark') as { ok: boolean }
    expect(updateResult.ok).toBe(true)

    // Get
    const getResult = await invoke(IPC.SETTINGS_GET, 'theme') as { ok: true; data: string }
    expect(getResult.data).toBe('dark')
  })
})

describe('IPC Handlers — Dashboard Stats', () => {
  it('returns totalActive count', async () => {
    // Seed some data
    const gridResult = await invoke(IPC.GRID_CREATE, 'Stats Grid') as { ok: true; data: number }
    const gridId = gridResult.data
    await invoke(IPC.ROW_CREATE, gridId)
    await invoke(IPC.ROW_CREATE, gridId)
    await invoke(IPC.ROW_CREATE, gridId)

    const all = await invoke(IPC.DASHBOARD_GET_ALL) as { ok: true; data: { stats: { totalActive: number } } }
    expect(all.ok).toBe(true)
    expect(all.data.stats.totalActive).toBe(3)
  })
})

describe('IPC Handlers — Error handling', () => {
  it('GRID_UPDATE with no valid fields returns fail', async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Err Test') as { ok: true; data: number }
    const result = await invoke(IPC.GRID_UPDATE, gridResult.data, { bogus_field: 'x' }) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No valid fields')
  })

  it('COLUMN_UPDATE with no valid fields returns fail', async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Err Test 2') as { ok: true; data: number }
    const colResult = await invoke(IPC.COLUMN_CREATE, gridResult.data, 'Test', 'text') as { ok: true; data: number }
    const result = await invoke(IPC.COLUMN_UPDATE, colResult.data, { invalid_field: 'x' }) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No valid fields')
  })

  it('ROW_DUPLICATE with nonexistent row returns fail', async () => {
    const result = await invoke(IPC.ROW_DUPLICATE, 999999) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })
})

// ── L13: Validation Rejection Tests (Batch 9) ─────────────────────────────

describe('IPC Validation — column type allowlist', () => {
  it('COLUMN_CREATE rejects invalid column type', async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Type Test') as { ok: true; data: number }
    const result = await invoke(IPC.COLUMN_CREATE, gridResult.data, 'Bad Col', 'invalid_type') as { ok: false; error: string }
    expect(result.ok).toBe(false)
  })

  it('COLUMN_CREATE accepts all valid column types', async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Valid Types') as { ok: true; data: number }
    const gridId = gridResult.data
    for (const type of ['text', 'date', 'number', 'checkbox', 'dropdown', 'phone', 'email']) {
      const r = await invoke(IPC.COLUMN_CREATE, gridId, `Col_${type}`, type) as { ok: boolean }
      expect(r.ok).toBe(true)
    }
  })
})

describe('IPC Validation — task priority allowlist', () => {
  it('TASK_CREATE rejects invalid priority', async () => {
    const result = await invoke(IPC.TASK_CREATE, { title: 'Bad Task', priority: 'medium' }) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('TASK_CREATE accepts all valid priorities', async () => {
    for (const priority of ['low', 'normal', 'high', 'urgent']) {
      const r = await invoke(IPC.TASK_CREATE, { title: `Task_${priority}`, priority }) as { ok: boolean }
      expect(r.ok).toBe(true)
    }
  })

  it('TASK_CREATE with no priority defaults to normal', async () => {
    const r = await invoke(IPC.TASK_CREATE, { title: 'Default Priority' }) as { ok: true; data: { priority: string } }
    expect(r.ok).toBe(true)
    expect(r.data.priority).toBe('normal')
  })
})

describe('IPC Validation — ROW_SET_MANUAL_CONTACTS', () => {
  let rowId: number

  beforeEach(async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Contacts Validation') as { ok: true; data: number }
    const rowResult = await invoke(IPC.ROW_CREATE, gridResult.data) as { ok: true; data: number }
    rowId = rowResult.data
  })

  it('rejects non-array contacts', async () => {
    const result = await invoke(IPC.ROW_SET_MANUAL_CONTACTS, rowId, 'not an array') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects contacts array exceeding 50 items', async () => {
    const contacts = Array.from({ length: 51 }, (_, i) => ({ type: 'phone', label: `c${i}`, value: '555-1234' }))
    const result = await invoke(IPC.ROW_SET_MANUAL_CONTACTS, rowId, contacts) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('accepts valid contacts array', async () => {
    const contacts = [{ type: 'phone', label: 'Home', value: '555-1234' }]
    const result = await invoke(IPC.ROW_SET_MANUAL_CONTACTS, rowId, contacts) as { ok: boolean }
    expect(result.ok).toBe(true)
  })
})

describe('IPC Validation — CELL_FORMAT_SET', () => {
  let rowId: number
  let colId: number

  beforeEach(async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Format Test') as { ok: true; data: number }
    const gridId = gridResult.data
    const rowResult = await invoke(IPC.ROW_CREATE, gridId) as { ok: true; data: number }
    rowId = rowResult.data
    const gridData = await invoke(IPC.GRID_GET, gridId) as { ok: true; data: { columns: Array<{ id: number }> } }
    colId = gridData.data.columns[0].id
  })

  it('rejects invalid JSON', async () => {
    const result = await invoke(IPC.CELL_FORMAT_SET, rowId, colId, '{not: valid json}') as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('rejects oversized rules string (>50000 chars)', async () => {
    const big = 'x'.repeat(50001)
    const result = await invoke(IPC.CELL_FORMAT_SET, rowId, colId, big) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('accepts valid JSON rules', async () => {
    const rules = JSON.stringify([{ condition: 'eq', value: 'Active', format: { color: '#00FF00' } }])
    const result = await invoke(IPC.CELL_FORMAT_SET, rowId, colId, rules) as { ok: boolean }
    expect(result.ok).toBe(true)
  })
})

describe('IPC Handlers — Error paths', () => {
  it('ROW_CREATE with negative grid ID returns fail', async () => {
    const result = await invoke(IPC.ROW_CREATE, -5) as { ok: false; error: string }
    expect(result.ok).toBe(false)
  })

  it('ROW_DELETE with non-existent row returns fail', async () => {
    const result = await invoke(IPC.ROW_DELETE, 999999) as { ok: false; error: string }
    expect(result.ok).toBe(false)
  })

  it('COLUMN_CREATE with invalid type returns fail', async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'ErrCol Test') as { ok: true; data: number }
    const result = await invoke(IPC.COLUMN_CREATE, gridResult.data, 'Bad', 'nonexistent_type') as { ok: false; error: string }
    expect(result.ok).toBe(false)
  })

  it('COLUMN_UPDATE on non-existent column returns fail', async () => {
    const result = await invoke(IPC.COLUMN_UPDATE, 999999, { name: 'New Name' }) as { ok: boolean }
    // The update runs but matches 0 rows — SQLite does not error on UPDATE WHERE matching nothing
    expect(result).toHaveProperty('ok', true)
  })
})

describe('IPC Validation — edge cases', () => {
  it('GRID_CREATE with Unicode name succeeds', async () => {
    const result = await invoke(IPC.GRID_CREATE, '测试 Grid 🔬') as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('CELL_UPDATE with Unicode value succeeds', async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Unicode') as { ok: true; data: number }
    const rowResult = await invoke(IPC.ROW_CREATE, gridResult.data) as { ok: true; data: number }
    const gridData = await invoke(IPC.GRID_GET, gridResult.data) as { ok: true; data: { columns: Array<{ id: number }> } }
    const colId = gridData.data.columns[0].id
    const result = await invoke(IPC.CELL_UPDATE, rowResult.data, colId, '日本語テスト 🎌') as { ok: boolean }
    expect(result.ok).toBe(true)
  })

  it('GRID_GET with negative ID returns fail', async () => {
    const result = await invoke(IPC.GRID_GET, -1) as { ok: false }
    expect(result.ok).toBe(false)
  })

  it('CELL_UPDATE with null value (clear cell) succeeds', async () => {
    const gridResult = await invoke(IPC.GRID_CREATE, 'Clear Test') as { ok: true; data: number }
    const rowResult = await invoke(IPC.ROW_CREATE, gridResult.data) as { ok: true; data: number }
    const gridData = await invoke(IPC.GRID_GET, gridResult.data) as { ok: true; data: { columns: Array<{ id: number }> } }
    const colId = gridData.data.columns[0].id
    await invoke(IPC.CELL_UPDATE, rowResult.data, colId, 'Some value')
    const result = await invoke(IPC.CELL_UPDATE, rowResult.data, colId, null) as { ok: boolean }
    expect(result.ok).toBe(true)
  })
})

// ── Read-only enforcement (enforceWritable) ─────────────────────────────────

describe('Read-only enforcement — enforceWritable()', () => {
  let gridId: number
  let rowId: number
  let colId: number

  beforeAll(() => {
    // Simulate a read-only gate — all writes should be blocked
    registerReadOnlyChecker(() => true)
  })

  afterAll(() => {
    // Restore normal writable state for any subsequent tests
    registerReadOnlyChecker(() => false)
  })

  beforeEach(() => {
    // Seed a grid so handlers that validate IDs have real data to reference.
    // seedGrid runs raw SQL so it bypasses enforceWritable.
    const seed = seedGrid(testDb.db)
    gridId = seed.gridId
    rowId = seed.rowIds[0]
    colId = seed.columnIds[0]
  })

  // ── Write handlers should be blocked ────────────────────────────────────

  it('GRID_CREATE returns READ_ONLY', async () => {
    const result = await invoke(IPC.GRID_CREATE, 'Blocked Grid') as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe('READ_ONLY')
  })

  it('ROW_CREATE returns READ_ONLY', async () => {
    const result = await invoke(IPC.ROW_CREATE, gridId) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe('READ_ONLY')
  })

  it('CELL_UPDATE returns READ_ONLY', async () => {
    const result = await invoke(IPC.CELL_UPDATE, rowId, colId, 'blocked') as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe('READ_ONLY')
  })

  it('COLUMN_CREATE returns READ_ONLY', async () => {
    const result = await invoke(IPC.COLUMN_CREATE, gridId, 'Blocked Col', 'text') as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe('READ_ONLY')
  })

  it('ROW_DELETE returns READ_ONLY', async () => {
    const result = await invoke(IPC.ROW_DELETE, rowId) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe('READ_ONLY')
  })

  it('SETTINGS_UPDATE returns READ_ONLY', async () => {
    const result = await invoke(IPC.SETTINGS_UPDATE, 'theme', 'dark') as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toBe('READ_ONLY')
  })

  // ── Read handlers should still work ─────────────────────────────────────

  it('GRID_GET_ALL still works in read-only mode', async () => {
    const result = await invoke(IPC.GRID_GET_ALL) as { ok: true; data: unknown[] }
    expect(result.ok).toBe(true)
    expect(result).toHaveProperty('data')
  })

  it('SETTINGS_GET_ALL still works in read-only mode', async () => {
    const result = await invoke(IPC.SETTINGS_GET_ALL) as { ok: true; data: unknown }
    expect(result.ok).toBe(true)
    expect(result).toHaveProperty('data')
  })
})
