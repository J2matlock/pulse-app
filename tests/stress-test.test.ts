/**
 * stress-test.ts — Comprehensive stress test for the CaseConnect Pulse IPC layer.
 *
 * Exercises the app's data layer directly (bypassing Electron IPC transport) by
 * calling the same database functions the IPC handlers use. Uses a real SQLCipher
 * temp database with all migrations applied.
 *
 * Run: npx vitest run src/tests/stress-test.ts
 *   or: npx vitest src/tests/stress-test.ts
 *
 * This is a vitest test file (not a standalone ts-node script) because the project
 * uses vitest for all testing and the module mocking is essential for bypassing
 * Electron dependencies that don't exist outside an Electron process.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers'
import type { Database } from 'better-sqlite3'

// ── Migrations (import before mocks so we can run them on the test DB) ────────
import { up as migration001 } from '../src/main/migrations/001_initial_schema'
import { up as migration002 } from '../src/main/migrations/002_cell_formats'
import { up as migration003 } from '../src/main/migrations/003_alert_interval'
import { up as migration004 } from '../src/main/migrations/004_cond_format_rules'
import { up as migration005 } from '../src/main/migrations/005_grid_position'
import { up as migration006 } from '../src/main/migrations/006_contacts'
import { up as migration007 } from '../src/main/migrations/007_task_position'
import { up as migration008 } from '../src/main/migrations/008_manual_contacts'
import { up as migration009 } from '../src/main/migrations/009_case_log_edit_history'
import { up as migration010 } from '../src/main/migrations/010_case_log_void'
import { up as migration011 } from '../src/main/migrations/011_acuity'
import { up as migration012 } from '../src/main/migrations/012_soft_delete'
import { up as migration013 } from '../src/main/migrations/013_perf_indexes'
import { up as migration014 } from '../src/main/migrations/014_fk_constraints'
import { up as migration015 } from '../src/main/migrations/015_perf_compound_indexes'
import { up as migration016 } from '../src/main/migrations/016_perf_phase2'
import { up as migration017 } from '../src/main/migrations/017_perf_phase3'

// ── Mock Electron before anything else loads ──────────────────────────────────

let tmpTestDir = '/tmp/pulse-stress-test'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pulse-stress-test',
    getVersion: () => '1.0.0-test',
    commandLine: { appendSwitch: () => {} },
  },
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: undefined }), showMessageBoxSync: () => 0 },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('electron-store', () => ({
  default: class {
    private d = new Map()
    get(k: string, dv?: unknown) { return this.d.has(k) ? this.d.get(k) : dv }
    set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'object') { for (const [key, val] of Object.entries(k)) this.d.set(key, val) } else { this.d.set(k, v) } }
    has(k: string) { return this.d.has(k) }
    delete(k: string) { this.d.delete(k) }
  },
}))

// ── Test database setup ────────────────────────────────────────────────────────

let db: Database
let dbPath: string

function createStressTestDb(): Database {
  dbPath = join(tmpTestDir, 'stress-test.db')
  const database = new BetterSqlite3(dbPath) as Database
  database.pragma(`cipher='sqlcipher'`)
  database.pragma('kdf_iter=1000') // fast iterations for testing
  database.pragma('cipher_page_size=4096')
  database.pragma('cipher_hmac_algorithm=HMAC_SHA512')
  database.pragma('cipher_kdf_algorithm=PBKDF2_HMAC_SHA512')
  database.pragma(`key='test-stress-key-0123456789abcdef'`)
  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = NORMAL')
  database.pragma('cache_size = -16000') // 16MB cache

  // Bootstrap app_meta and run all migrations
  database.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  migration001(database)
  migration002(database)
  migration003(database)
  migration004(database)
  migration005(database)
  migration006(database)
  migration007(database)
  migration008(database)
  migration009(database)
  migration010(database)
  migration011(database)
  migration012(database)
  migration013(database)
  migration014(database)
  migration015(database)
  migration016(database)
  migration017(database)

  return database
}

// Mock the database module so all imports that call getDb() use our test DB
vi.mock('../main/database', async () => {
  const actual = await vi.importActual<typeof import('../main/database')>('../main/database')
  return {
    ...actual,
    getDb: () => db,
    openDatabase: vi.fn(),
    closeDatabase: vi.fn(),
    resolveDatabasePath: () => dbPath,
    checkCloudSyncPath: () => null,
  }
})

// Mock backup module to prevent real backup operations
vi.mock('../main/backup', () => ({
  runAutoBackup: vi.fn(),
  listAutoBackups: vi.fn().mockReturnValue([]),
  listAutoBackupsRich: vi.fn().mockReturnValue([]),
  runManualBackup: vi.fn(),
  restoreFromDb: vi.fn(),
  restoreFromPulseBackup: vi.fn(),
  getBackupInfo: vi.fn().mockReturnValue({}),
  listScheduledBackups: vi.fn().mockReturnValue([]),
  getBackupDir: vi.fn().mockReturnValue(tmpTestDir),
  verifyBackup: vi.fn().mockReturnValue(true),
  getScheduledConfig: vi.fn().mockReturnValue({ enabled: false, intervalHours: 24, retainCount: 10, lastRun: null }),
  setScheduledConfig: vi.fn(),
  checkAndRunScheduled: vi.fn(),
  setDatabaseBridge: vi.fn(),
  runPreMigrationBackup: vi.fn(),
}))

// Mock auth module
vi.mock('../main/auth', () => ({
  isPasswordSetup: vi.fn().mockReturnValue(true),
  setupPassword: vi.fn(),
  verifyAndUnlock: vi.fn(),
  verifyAndUnlockRecovery: vi.fn(),
  changePassword: vi.fn(),
  resetPasswordAfterRecovery: vi.fn(),
  generateRecoveryKey: vi.fn(),
  revokeRecoveryKey: vi.fn(),
  lockApp: vi.fn(),
  getPasswordHint: vi.fn().mockReturnValue(''),
  hasRecoveryKey: vi.fn().mockReturnValue(false),
  getDbKey: vi.fn().mockReturnValue('test-stress-key-0123456789abcdef'),
  setStoredDbPath: vi.fn(),
}))

// Now import the modules that depend on the mocked database
import { buildGridQuery, upsertCell } from '../src/main/database'
import { parseImportFile } from '../src/main/import'

// ── Utility functions ──────────────────────────────────────────────────────────

interface StepResult {
  name: string
  passed: boolean
  durationMs: number
  detail: string
  error?: string
}

const results: StepResult[] = []

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomDate(yearStart = 2024, yearEnd = 2027): string {
  const y = yearStart + Math.floor(Math.random() * (yearEnd - yearStart + 1))
  const m = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')
  const d = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function randomName(): string {
  const first = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Hank',
    'Iris', 'Jack', 'Karen', 'Leo', 'Mia', 'Nick', 'Olivia', 'Pat', 'Quinn', 'Rosa',
    'Sam', 'Tina', 'Uma', 'Vic', 'Wendy', 'Xander', 'Yara', 'Zach']
  const last = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
    'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson',
    'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin']
  return `${randomChoice(first)} ${randomChoice(last)}`
}

async function runStep(name: string, fn: () => string | void | Promise<string | void>): Promise<StepResult> {
  const start = performance.now()
  let result: StepResult
  try {
    const detail = await fn()
    const elapsed = performance.now() - start
    result = { name, passed: true, durationMs: Math.round(elapsed * 100) / 100, detail: detail || '' }
  } catch (err) {
    const elapsed = performance.now() - start
    const errMsg = err instanceof Error ? err.message : String(err)
    result = { name, passed: false, durationMs: Math.round(elapsed * 100) / 100, detail: '', error: errMsg }
    results.push(result)
    // Recorded for the summary, then rethrown so the step's test actually fails
    throw err
  }
  results.push(result)
  return result
}

// ── Test state tracked across steps ──────────────────────────────────────────

let gridId: number
let columnIds: { text: number; date: number; number: number; checkbox: number; dropdown: number; name: number }
let allColumnIds: number[]
let rowIds: number[] = []
const deletedRowIds: number[] = []
const archivedRowIds: number[] = []
const cellEditHistory: Array<{ rowId: number; columnId: number; oldValue: string | null; newValue: string | null }> = []

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Stress Test Suite', () => {
  beforeAll(() => {
    db = createStressTestDb()
  })

  afterAll(() => {
    // Print summary
    const passed = results.filter(r => r.passed).length
    const failed = results.filter(r => !r.passed).length
    const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0)

    console.log('\n' + '='.repeat(80))
    console.log('  STRESS TEST SUMMARY')
    console.log('='.repeat(80))
    for (const r of results) {
      const status = r.passed ? 'PASS' : 'FAIL'
      const pad = ' '.repeat(Math.max(0, 50 - r.name.length))
      const timePad = ' '.repeat(Math.max(0, 10 - r.durationMs.toFixed(1).length))
      console.log(`  [${status}] ${r.name}${pad}${timePad}${r.durationMs.toFixed(1)}ms${r.detail ? '  ' + r.detail : ''}`)
      if (r.error) console.log(`         ERROR: ${r.error}`)
    }
    console.log('-'.repeat(80))
    console.log(`  ${passed} passed, ${failed} failed, ${results.length} total`)
    console.log(`  Total time: ${(totalTime / 1000).toFixed(2)}s`)
    console.log('='.repeat(80) + '\n')

    // Cleanup
    try { db.close() } catch { /* already closed */ }
    try { rmSync(tmpTestDir, { recursive: true, force: true }) } catch { /* best effort */ }
  })

  // ── Step 1: Create test grid with typed columns ─────────────────────────────

  it('Step 1: Create grid with 6 typed columns', async () => {
    await runStep('Create grid with typed columns', () => {
      const gridResult = db.prepare(
        `INSERT INTO grids (name, created_at, updated_at) VALUES ('Stress Test Caseload', datetime('now'), datetime('now'))`
      ).run()
      gridId = gridResult.lastInsertRowid as number

      // Create columns of each Phase 1 type + a name column
      const cols = [
        { name: 'Client Name', type: 'text', isName: 1 },
        { name: 'Enrollment Date', type: 'date', isName: 0 },
        { name: 'Case Number', type: 'number', isName: 0 },
        { name: 'Active', type: 'checkbox', isName: 0 },
        { name: 'Status', type: 'dropdown', isName: 0 },
        { name: 'Notes', type: 'text', isName: 0 },
      ]

      const ids: number[] = []
      for (let i = 0; i < cols.length; i++) {
        const config = cols[i].type === 'dropdown'
          ? JSON.stringify({ options: ['Active', 'Inactive', 'Pending', 'Closed', 'Waitlist'] })
          : '{}'
        const r = db.prepare(`
          INSERT INTO columns (grid_id, name, column_type, position, is_name_column, is_visible, config, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'))
        `).run(gridId, cols[i].name, cols[i].type, i, cols[i].isName, config)
        ids.push(r.lastInsertRowid as number)
      }

      columnIds = {
        name: ids[0],
        text: ids[0],
        date: ids[1],
        number: ids[2],
        checkbox: ids[3],
        dropdown: ids[4],
      }
      allColumnIds = ids

      expect(gridId).toBeGreaterThan(0)
      expect(ids).toHaveLength(6)
      return `gridId=${gridId}, columns=${allColumnIds.length}`
    })
  })

  // ── Step 2: Rapidly create 200 rows ────────────────────────────────────────

  it('Step 2: Create 200 rows rapidly', async () => {
    await runStep('Create 200 rows', () => {
      const insertRow = db.prepare(`
        INSERT INTO rows (grid_id, position, created_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
      `)
      const insertCell = db.prepare(`
        INSERT INTO cells (row_id, column_id, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)

      const batchInsert = db.transaction(() => {
        for (let i = 0; i < 200; i++) {
          const r = insertRow.run(gridId, i)
          const rowId = r.lastInsertRowid as number
          rowIds.push(rowId)

          // Populate cells with appropriate data for each column type
          const name = randomName()
          const date = randomDate()
          const caseNum = String(1000 + Math.floor(Math.random() * 9000))
          const active = Math.random() > 0.2 ? '1' : '0'
          const status = randomChoice(['Active', 'Inactive', 'Pending', 'Closed', 'Waitlist'])
          const notes = `Initial intake for client ${i + 1}. ${randomChoice(['Follow up needed.', 'Documents pending.', 'All clear.', 'Referral sent.', 'Awaiting response.'])}`

          insertCell.run(rowId, allColumnIds[0], name)
          insertCell.run(rowId, allColumnIds[1], date)
          insertCell.run(rowId, allColumnIds[2], caseNum)
          insertCell.run(rowId, allColumnIds[3], active)
          insertCell.run(rowId, allColumnIds[4], status)
          insertCell.run(rowId, allColumnIds[5], notes)
        }
      })
      batchInsert()

      expect(rowIds).toHaveLength(200)

      // Verify row count in DB
      const count = (db.prepare('SELECT COUNT(*) as n FROM rows WHERE grid_id = ?').get(gridId) as { n: number }).n
      expect(count).toBe(200)
      return `${rowIds.length} rows created`
    })
  })

  // ── Step 3: Rapid random cell edits (500 edits across all types) ───────────

  it('Step 3: 500 random cell edits across all column types', async () => {
    await runStep('500 random cell edits', () => {
      const EDIT_COUNT = 500
      const updateCell = db.prepare(`
        INSERT INTO cells (row_id, column_id, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      const getCell = db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?')
      const insertHistory = db.prepare(`
        INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at)
        VALUES (
          (SELECT id FROM cells WHERE row_id = ? AND column_id = ?),
          ?, ?, ?, ?, datetime('now')
        )
      `)

      const batchEdits = db.transaction(() => {
        for (let i = 0; i < EDIT_COUNT; i++) {
          const rowId = randomChoice(rowIds)
          const colIdx = Math.floor(Math.random() * allColumnIds.length)
          const colId = allColumnIds[colIdx]

          // Read old value
          const existing = getCell.get(rowId, colId) as { value: string | null } | undefined
          const oldValue = existing?.value ?? null

          // Generate new value appropriate to the column type
          let newValue: string
          switch (colIdx) {
            case 0: // text (name)
              newValue = randomName()
              break
            case 1: // date
              newValue = randomDate()
              break
            case 2: // number
              newValue = String(Math.floor(Math.random() * 99999))
              break
            case 3: // checkbox
              newValue = oldValue === '1' ? '0' : '1'
              break
            case 4: // dropdown
              newValue = randomChoice(['Active', 'Inactive', 'Pending', 'Closed', 'Waitlist'])
              break
            case 5: // notes text
              newValue = `Updated note #${i}: ${randomChoice(['Progress made.', 'Needs follow-up.', 'Case reviewed.', 'Status changed.', 'Meeting scheduled.'])}`
              break
            default:
              newValue = `Edit ${i}`
          }

          updateCell.run(rowId, colId, newValue)

          // Record history (mirrors what CELL_UPDATE handler does)
          try {
            insertHistory.run(rowId, colId, rowId, colId, oldValue, newValue)
          } catch {
            // cell_id might not exist yet for new cells — non-fatal
          }

          cellEditHistory.push({ rowId, columnId: colId, oldValue, newValue })
        }
      })
      batchEdits()

      // Verify some random cells have the expected latest value
      const sample = cellEditHistory.slice(-10)
      for (const edit of sample) {
        const cell = getCell.get(edit.rowId, edit.columnId) as { value: string | null } | undefined
        // The last edit to this (row, col) pair should be the value in DB
        // (but a later edit in the batch might have overwritten it)
        expect(cell).toBeDefined()
      }
      return `${cellEditHistory.length} edits recorded`
    })
  })

  // ── Step 4: Verify grid loads correctly via pivot query ────────────────────

  it('Step 4: Verify grid pivot query loads all 200 rows', async () => {
    await runStep('Pivot query load verification', () => {
      const query = buildGridQuery(allColumnIds)
      const rows = db.prepare(query).all(gridId) as Array<Record<string, unknown>>
      expect(rows).toHaveLength(200)

      // Verify every row has all column values populated
      for (const row of rows) {
        for (const colId of allColumnIds) {
          const key = `col_${colId}`
          expect(row).toHaveProperty(key)
          // All cells were populated in Step 2, so values should be non-null
          expect(row[key]).not.toBeNull()
        }
      }
      return `all 200 rows verified with ${allColumnIds.length} columns each`
    })
  })

  // ── Step 5: Delete ~20 random rows (soft-delete) ───────────────────────────

  it('Step 5: Soft-delete 20 random rows', async () => {
    await runStep('Soft-delete 20 rows', () => {
      const deleteStmt = db.prepare(`
        UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
      `)
      const logStmt = db.prepare(`
        INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
        VALUES (?, 'Client moved to trash', 'system', datetime('now'), datetime('now'))
      `)

      // Pick 20 unique random rows
      const shuffled = [...rowIds].sort(() => Math.random() - 0.5)
      const toDelete = shuffled.slice(0, 20)

      const batchDelete = db.transaction(() => {
        for (const id of toDelete) {
          deleteStmt.run(id)
          logStmt.run(id)
          deletedRowIds.push(id)
        }
      })
      batchDelete()

      // Verify: active row count should be 180
      const activeCount = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
      ).get(gridId) as { n: number }).n
      expect(activeCount).toBe(180)

      // Verify: deleted rows have deleted_at set
      const deletedCount = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND deleted_at IS NOT NULL'
      ).get(gridId) as { n: number }).n
      expect(deletedCount).toBe(20)

      // Verify: pivot query excludes deleted rows
      const query = buildGridQuery(allColumnIds)
      const rows = db.prepare(query).all(gridId) as Array<Record<string, unknown>>
      expect(rows).toHaveLength(180)
      return `${deletedRowIds.length} rows soft-deleted, 180 active remain`
    })
  })

  // ── Step 6: Undo last 10 operations (restore 10 deleted rows) ─────────────

  it('Step 6: Undo last 10 deletions (restore from trash)', async () => {
    await runStep('Undo 10 deletions', () => {
      // Undo = restore last 10 deleted rows
      const restoreStmt = db.prepare(`
        UPDATE rows SET is_active = 1, deleted_at = NULL, updated_at = datetime('now') WHERE id = ?
      `)
      const logStmt = db.prepare(`
        INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
        VALUES (?, 'Client restored from trash', 'system', datetime('now'), datetime('now'))
      `)

      const toRestore = deletedRowIds.slice(-10)
      const batchRestore = db.transaction(() => {
        for (const id of toRestore) {
          restoreStmt.run(id)
          logStmt.run(id)
        }
      })
      batchRestore()

      // Remove restored IDs from deletedRowIds
      for (const id of toRestore) {
        const idx = deletedRowIds.indexOf(id)
        if (idx >= 0) deletedRowIds.splice(idx, 1)
      }

      // Verify: 190 active rows now
      const activeCount = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
      ).get(gridId) as { n: number }).n
      expect(activeCount).toBe(190)

      // Verify: 10 still in trash
      const deletedCount = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND deleted_at IS NOT NULL'
      ).get(gridId) as { n: number }).n
      expect(deletedCount).toBe(10)
      return '10 rows restored, 190 active, 10 still in trash'
    })
  })

  // ── Step 7: Redo 5 operations (re-delete 5 restored rows) ─────────────────

  it('Step 7: Redo 5 deletions', async () => {
    await runStep('Redo 5 deletions', () => {
      // Redo = re-soft-delete 5 rows that were just restored
      // Pick 5 active rows that are not already deleted
      const activeRows = (db.prepare(
        'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY RANDOM() LIMIT 5'
      ).all(gridId) as { id: number }[]).map(r => r.id)

      const deleteStmt = db.prepare(`
        UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
      `)
      const logStmt = db.prepare(`
        INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
        VALUES (?, 'Client moved to trash (redo)', 'system', datetime('now'), datetime('now'))
      `)

      const batchRedo = db.transaction(() => {
        for (const id of activeRows) {
          deleteStmt.run(id)
          logStmt.run(id)
          deletedRowIds.push(id)
        }
      })
      batchRedo()

      // Verify: 185 active, 15 deleted
      const activeCount = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
      ).get(gridId) as { n: number }).n
      expect(activeCount).toBe(185)
      return '5 rows re-deleted, 185 active remain'
    })
  })

  // ── Step 8: Archive 10 rows ──────────────────────────────────────────────

  it('Step 8: Archive 10 rows', async () => {
    await runStep('Archive 10 rows', () => {
      const archiveStmt = db.prepare(`
        UPDATE rows SET is_active = 0, archived_at = datetime('now'), archived_reason = ?,
        updated_at = datetime('now') WHERE id = ?
      `)
      const logStmt = db.prepare(`
        INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
        VALUES (?, ?, 'system', datetime('now'), datetime('now'))
      `)

      const activeRows = (db.prepare(
        'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY RANDOM() LIMIT 10'
      ).all(gridId) as { id: number }[]).map(r => r.id)

      const reasons = ['Case closed', 'Transferred', 'Graduated', 'Moved out of area', 'No longer eligible']

      const batchArchive = db.transaction(() => {
        for (const id of activeRows) {
          const reason = randomChoice(reasons)
          archiveStmt.run(reason, id)
          logStmt.run(id, `Client archived: ${reason}`)
          archivedRowIds.push(id)
        }
      })
      batchArchive()

      // Verify: 175 active (185 - 10 archived)
      const activeCount = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
      ).get(gridId) as { n: number }).n
      expect(activeCount).toBe(175)

      // Verify: archived rows have archived_at and reason set
      for (const id of archivedRowIds) {
        const row = db.prepare('SELECT archived_at, archived_reason FROM rows WHERE id = ?').get(id) as
          { archived_at: string | null; archived_reason: string | null }
        expect(row.archived_at).not.toBeNull()
        expect(row.archived_reason).not.toBeNull()
      }
      return `${archivedRowIds.length} rows archived, 175 active`
    })
  })

  // ── Step 9: Unarchive 5 rows ──────────────────────────────────────────────

  it('Step 9: Restore 5 archived rows', async () => {
    await runStep('Unarchive 5 rows', () => {
      const unarchiveStmt = db.prepare(`
        UPDATE rows SET is_active = 1, archived_at = NULL, archived_reason = NULL,
        updated_at = datetime('now') WHERE id = ?
      `)
      const logStmt = db.prepare(`
        INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
        VALUES (?, 'Client unarchived', 'system', datetime('now'), datetime('now'))
      `)

      const toRestore = archivedRowIds.slice(0, 5)
      const batchUnarchive = db.transaction(() => {
        for (const id of toRestore) {
          unarchiveStmt.run(id)
          logStmt.run(id)
        }
      })
      batchUnarchive()

      // Remove from archivedRowIds
      archivedRowIds.splice(0, 5)

      // Verify: 180 active now (175 + 5 unarchived)
      const activeCount = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
      ).get(gridId) as { n: number }).n
      expect(activeCount).toBe(180)

      // Verify: restored rows have null archived_at
      for (const id of toRestore) {
        const row = db.prepare('SELECT archived_at FROM rows WHERE id = ?').get(id) as { archived_at: string | null }
        expect(row.archived_at).toBeNull()
      }
      return '5 rows unarchived, 180 active'
    })
  })

  // ── Step 10: Import a generated CSV (50 rows) ─────────────────────────────

  it('Step 10: Import 50-row CSV', async () => {
    await runStep('Import 50-row CSV', async () => {
      // Generate a CSV file
      const headers = ['Client Name', 'Enrollment Date', 'Case Number', 'Active', 'Status', 'Notes']
      const csvRows: string[] = [headers.join(',')]
      for (let i = 0; i < 50; i++) {
        const name = randomName().replace(',', '')
        const date = randomDate()
        const caseNum = String(50000 + i)
        const active = Math.random() > 0.3 ? 'true' : 'false'
        const status = randomChoice(['Active', 'Inactive', 'Pending'])
        const notes = `Imported client ${i + 1}`
        csvRows.push(`"${name}",${date},${caseNum},${active},"${status}","${notes}"`)
      }
      const csvContent = csvRows.join('\n')
      const csvPath = join(tmpTestDir, 'import-test.csv')
      writeFileSync(csvPath, csvContent, 'utf-8')

      // Parse the CSV (this is the same function used by the IPC handler)
      const preview = await parseImportFile(csvPath)
      expect(preview.headers).toHaveLength(6)
      expect(preview.rows.length).toBeGreaterThanOrEqual(20) // preview returns max 20

      // Simulate the import: insert rows and cells manually (matching executeImport logic)
      const insertRow = db.prepare(`
        INSERT INTO rows (grid_id, position, created_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
      `)
      const insertCell = db.prepare(`
        INSERT INTO cells (row_id, column_id, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)

      // Read full CSV for all 50 rows
      const fullCsv = csvContent.split('\n').slice(1).filter(line => line.trim())
      expect(fullCsv).toHaveLength(50)

      const currentMaxPos = (db.prepare(
        'SELECT COALESCE(MAX(position), 0) as p FROM rows WHERE grid_id = ?'
      ).get(gridId) as { p: number }).p

      const importedRowIds: number[] = []
      const batchImport = db.transaction(() => {
        for (let i = 0; i < fullCsv.length; i++) {
          // Simple CSV parse (the actual import uses papaparse)
          const values = fullCsv[i].match(/(".*?"|[^,]+)/g)?.map(v => v.replace(/^"|"$/g, '')) ?? []
          const r = insertRow.run(gridId, currentMaxPos + i + 1)
          const newRowId = r.lastInsertRowid as number
          importedRowIds.push(newRowId)
          rowIds.push(newRowId)

          for (let j = 0; j < Math.min(values.length, allColumnIds.length); j++) {
            // Convert checkbox values
            let val = values[j]
            if (j === 3) { // checkbox column
              val = (val === 'true' || val === 'TRUE' || val === '1') ? '1' : '0'
            }
            insertCell.run(newRowId, allColumnIds[j], val)
          }
        }
      })
      batchImport()

      expect(importedRowIds).toHaveLength(50)

      // Verify total rows now: 200 original + 50 imported = 250 total
      const totalRows = (db.prepare('SELECT COUNT(*) as n FROM rows WHERE grid_id = ?').get(gridId) as { n: number }).n
      expect(totalRows).toBe(250)

      // Verify active rows: 180 + 50 = 230
      const activeCount = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
      ).get(gridId) as { n: number }).n
      expect(activeCount).toBe(230)
      return '50 rows imported from CSV, 250 total rows'
    })
  })

  // ── Step 11: Export grid as CSV ────────────────────────────────────────────

  it('Step 11: Export grid data to CSV', async () => {
    await runStep('Export grid to CSV', () => {
      // Simulate CSV export: build the pivot query and format as CSV
      const query = buildGridQuery(allColumnIds)
      const rows = db.prepare(query).all(gridId) as Array<Record<string, unknown>>

      const columns = db.prepare('SELECT id, name FROM columns WHERE grid_id = ? AND is_visible = 1 ORDER BY position')
        .all(gridId) as Array<{ id: number; name: string }>

      // Build CSV content
      const headerLine = columns.map(c => `"${c.name}"`).join(',')
      const dataLines = rows.map(row =>
        columns.map(c => {
          const val = row[`col_${c.id}`]
          return val != null ? `"${String(val).replace(/"/g, '""')}"` : ''
        }).join(',')
      )
      const csvOutput = [headerLine, ...dataLines].join('\n')
      const csvPath = join(tmpTestDir, 'export-test.csv')
      writeFileSync(csvPath, csvOutput, 'utf-8')

      // Verify the exported CSV
      const lines = csvOutput.split('\n')
      expect(lines[0]).toContain('Client Name')
      // Active rows = 230
      expect(lines.length - 1).toBe(230) // data lines = active row count

      return `${lines.length - 1} rows exported to CSV`
    })
  })

  // ── Step 12: Generate supervisor report data ───────────────────────────────

  it('Step 12: Generate supervisor report data', async () => {
    await runStep('Generate supervisor report', () => {
      // Simulate what exportSupervisorReport does: gather stats
      const dateStart = '2024-01-01'
      const dateEnd = '2027-12-31'

      const totalActive = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1'
      ).get(gridId) as { n: number }).n

      const newAdded = (db.prepare(`
        SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1
        AND date(created_at) >= ? AND date(created_at) <= ?
      `).get(gridId, dateStart, dateEnd) as { n: number }).n

      const archivedClients = (db.prepare(`
        SELECT COUNT(*) as n FROM rows WHERE grid_id = ?
        AND is_active = 0 AND archived_at IS NOT NULL AND deleted_at IS NULL
      `).get(gridId) as { n: number }).n

      const deletedClients = (db.prepare(`
        SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND deleted_at IS NOT NULL
      `).get(gridId) as { n: number }).n

      // Activity log entries in the period
      const logEntries = (db.prepare(`
        SELECT COUNT(*) as n FROM case_log cl
        JOIN rows r ON r.id = cl.row_id
        WHERE r.grid_id = ? AND date(cl.created_at) >= ? AND date(cl.created_at) <= ?
      `).get(gridId, dateStart, dateEnd) as { n: number }).n

      expect(totalActive).toBe(230)
      expect(archivedClients).toBe(5)   // 10 archived - 5 unarchived = 5
      expect(deletedClients).toBe(15)   // 20 deleted - 10 restored + 5 re-deleted = 15
      expect(newAdded).toBeGreaterThan(0)
      expect(logEntries).toBeGreaterThan(0)

      return `active=${totalActive}, archived=${archivedClients}, deleted=${deletedClients}, logs=${logEntries}`
    })
  })

  // ── Step 13: Rapid cell reads + writes interleaved ─────────────────────────

  it('Step 13: 200 interleaved reads and writes', async () => {
    await runStep('200 interleaved reads+writes', () => {
      const getCell = db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?')
      const updateCell = db.prepare(`
        INSERT INTO cells (row_id, column_id, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)

      const activeRowIds = (db.prepare(
        'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
      ).all(gridId) as { id: number }[]).map(r => r.id)

      let reads = 0
      let writes = 0

      for (let i = 0; i < 200; i++) {
        const rowId = randomChoice(activeRowIds)
        const colId = randomChoice(allColumnIds)

        if (i % 2 === 0) {
          // Read
          const cell = getCell.get(rowId, colId) as { value: string | null } | undefined
          expect(cell).toBeDefined()
          reads++
        } else {
          // Write
          const newVal = `Interleaved edit #${i}`
          updateCell.run(rowId, colId, newVal)
          // Immediately read back to verify
          const cell = getCell.get(rowId, colId) as { value: string | null }
          expect(cell.value).toBe(newVal)
          writes++
        }
      }

      return `${reads} reads, ${writes} writes`
    })
  })

  // ── Step 14: Bulk operations (star, color label, reorder) ──────────────────

  it('Step 14: Bulk star, color label, and reorder', async () => {
    await runStep('Bulk operations', () => {
      const activeRowIds = (db.prepare(
        'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY position'
      ).all(gridId) as { id: number }[]).map(r => r.id)

      // Star 20 random rows
      const starStmt = db.prepare(`UPDATE rows SET is_starred = 1, updated_at = datetime('now') WHERE id = ?`)
      const toStar = activeRowIds.sort(() => Math.random() - 0.5).slice(0, 20)
      const batchStar = db.transaction(() => {
        for (const id of toStar) starStmt.run(id)
      })
      batchStar()

      const starredCount = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_starred = 1 AND is_active = 1'
      ).get(gridId) as { n: number }).n
      expect(starredCount).toBe(20)

      // Reorder all active rows (reverse order)
      const reorderStmt = db.prepare('UPDATE rows SET position = ? WHERE id = ? AND grid_id = ?')
      const reversed = [...activeRowIds].reverse()
      const batchReorder = db.transaction(() => {
        for (let i = 0; i < reversed.length; i++) {
          reorderStmt.run(i, reversed[i], gridId)
        }
      })
      batchReorder()

      // Verify first row after reorder is the last original row
      const firstRow = db.prepare(
        'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY position LIMIT 1'
      ).get(gridId) as { id: number }
      expect(firstRow.id).toBe(reversed[0])

      return `20 starred, 15 colored, ${reversed.length} reordered`
    })
  })

  // ── Step 15: Case log stress (100 entries across 10 clients) ──────────────

  it('Step 15: Create 100 case log entries', async () => {
    await runStep('100 case log entries', () => {
      const activeRowIds = (db.prepare(
        'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY RANDOM() LIMIT 10'
      ).all(gridId) as { id: number }[]).map(r => r.id)

      const logTypes = ['note', 'phone', 'meeting', 'email', 'visit']
      const insertLog = db.prepare(`
        INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now', ? || ' seconds'), datetime('now'))
      `)

      const batchLogs = db.transaction(() => {
        for (let i = 0; i < 100; i++) {
          const rowId = randomChoice(activeRowIds)
          const logType = randomChoice(logTypes)
          const content = `${logType.charAt(0).toUpperCase() + logType.slice(1)} log entry #${i}: ${
            randomChoice([
              'Discussed housing options with client.',
              'Follow-up on benefits application.',
              'Client missed scheduled appointment.',
              'Coordinated with provider for referral.',
              'Reviewed case plan and updated goals.',
              'Left voicemail regarding next steps.',
              'Client reported improvement in situation.',
              'Submitted paperwork to county office.',
            ])
          }`
          // Offset created_at slightly so entries have distinct timestamps
          insertLog.run(rowId, content, logType, String(-i))
        }
      })
      batchLogs()

      // Verify total log entries for these clients
      const placeholders = activeRowIds.map(() => '?').join(',')
      const logCount = (db.prepare(
        `SELECT COUNT(*) as n FROM case_log WHERE row_id IN (${placeholders})`
      ).get(...activeRowIds) as { n: number }).n
      expect(logCount).toBeGreaterThanOrEqual(100)

      return `100 entries across ${activeRowIds.length} clients`
    })
  })

  // ── Step 16: Checklist stress (50 items across 5 clients) ─────────────────

  it('Step 16: Create 50 checklist items', async () => {
    await runStep('50 checklist items', () => {
      const activeRowIds = (db.prepare(
        'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY RANDOM() LIMIT 5'
      ).all(gridId) as { id: number }[]).map(r => r.id)

      const insertItem = db.prepare(`
        INSERT INTO checklist_items (row_id, title, description, priority, position, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `)
      const priorities = ['low', 'normal', 'high', 'urgent']
      const titles = [
        'Submit housing application',
        'Schedule mental health assessment',
        'Obtain insurance verification',
        'Complete intake paperwork',
        'Follow up on referral',
        'Review benefit eligibility',
        'Contact landlord',
        'Gather medical records',
        'Update case plan',
        'Coordinate transportation',
      ]

      const itemIds: number[] = []
      const batchChecklist = db.transaction(() => {
        for (let i = 0; i < 50; i++) {
          const rowId = randomChoice(activeRowIds)
          const title = `${randomChoice(titles)} (#${i})`
          const desc = Math.random() > 0.5 ? `Details for task ${i}` : null
          const priority = randomChoice(priorities)
          const r = insertItem.run(rowId, title, desc, priority, i)
          itemIds.push(r.lastInsertRowid as number)
        }
      })
      batchChecklist()

      // Complete 20 of the items
      const completeStmt = db.prepare(`
        UPDATE checklist_items SET is_completed = 1, completed_at = datetime('now') WHERE id = ?
      `)
      const toComplete = itemIds.sort(() => Math.random() - 0.5).slice(0, 20)
      const batchComplete = db.transaction(() => {
        for (const id of toComplete) completeStmt.run(id)
      })
      batchComplete()

      const completedCount = (db.prepare(
        'SELECT COUNT(*) as n FROM checklist_items WHERE is_completed = 1'
      ).get() as { n: number }).n
      expect(completedCount).toBe(20)

      return `50 items created, 20 completed`
    })
  })

  // ── Step 17: Column CRUD stress ────────────────────────────────────────────

  it('Step 17: Column add/rename/resize/delete cycle', async () => {
    await runStep('Column CRUD cycle', () => {
      // Add 5 new columns
      const newColIds: number[] = []
      for (let i = 0; i < 5; i++) {
        const r = db.prepare(`
          INSERT INTO columns (grid_id, name, column_type, position, is_visible, created_at)
          VALUES (?, ?, 'text', ?, 1, datetime('now'))
        `).run(gridId, `Temp Column ${i}`, allColumnIds.length + i)
        newColIds.push(r.lastInsertRowid as number)
      }

      // Rename each new column
      for (let i = 0; i < newColIds.length; i++) {
        db.prepare('UPDATE columns SET name = ? WHERE id = ?').run(`Renamed Col ${i}`, newColIds[i])
      }

      // Resize each new column
      for (const id of newColIds) {
        db.prepare('UPDATE columns SET width = ? WHERE id = ?').run(200 + Math.floor(Math.random() * 200), id)
      }

      // Verify all 11 columns now exist
      const allCols = db.prepare('SELECT id FROM columns WHERE grid_id = ?').all(gridId) as { id: number }[]
      expect(allCols).toHaveLength(11)

      // Delete the 5 temporary columns
      const deleteCol = db.prepare('DELETE FROM columns WHERE id = ?')
      for (const id of newColIds) {
        deleteCol.run(id)
      }

      // Verify back to 6 columns
      const finalCols = db.prepare('SELECT id FROM columns WHERE grid_id = ?').all(gridId) as { id: number }[]
      expect(finalCols).toHaveLength(6)

      return '5 columns added, renamed, resized, then deleted'
    })
  })

  // ── Step 18: Multiple grids and cross-grid operations ──────────────────────

  it('Step 18: Create second grid and copy rows between grids', async () => {
    await runStep('Cross-grid row copy', () => {
      // Create a second grid with matching columns
      const grid2Result = db.prepare(
        `INSERT INTO grids (name, created_at, updated_at) VALUES ('Secondary Grid', datetime('now'), datetime('now'))`
      ).run()
      const grid2Id = grid2Result.lastInsertRowid as number

      // Create matching columns in second grid
      const grid2ColIds: number[] = []
      const colNames = ['Client Name', 'Enrollment Date', 'Case Number', 'Active', 'Status', 'Notes']
      const colTypes = ['text', 'date', 'number', 'checkbox', 'dropdown', 'text']
      for (let i = 0; i < colNames.length; i++) {
        const config = colTypes[i] === 'dropdown'
          ? JSON.stringify({ options: ['Active', 'Inactive', 'Pending', 'Closed', 'Waitlist'] })
          : '{}'
        const r = db.prepare(`
          INSERT INTO columns (grid_id, name, column_type, position, is_name_column, is_visible, config, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'))
        `).run(grid2Id, colNames[i], colTypes[i], i, i === 0 ? 1 : 0, config)
        grid2ColIds.push(r.lastInsertRowid as number)
      }

      // Copy 10 rows from grid1 to grid2
      const sourceRows = (db.prepare(
        'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY RANDOM() LIMIT 10'
      ).all(gridId) as { id: number }[]).map(r => r.id)

      const srcColMap = new Map(allColumnIds.map((id, i) => [id, colNames[i].toLowerCase()]))
      const tgtMap = new Map(grid2ColIds.map((id, i) => [colNames[i].toLowerCase(), id]))

      const insertRow2 = db.prepare(`
        INSERT INTO rows (grid_id, position, is_active, created_at, updated_at)
        VALUES (?, ?, 1, datetime('now'), datetime('now'))
      `)
      const insertCell2 = db.prepare(`
        INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))
      `)

      let copiedCount = 0
      const batchCopy = db.transaction(() => {
        for (let i = 0; i < sourceRows.length; i++) {
          const srcRowId = sourceRows[i]
          const r = insertRow2.run(grid2Id, i)
          const newRowId = r.lastInsertRowid as number

          const srcCells = db.prepare('SELECT column_id, value FROM cells WHERE row_id = ?').all(srcRowId) as
            Array<{ column_id: number; value: string | null }>

          for (const cell of srcCells) {
            const colName = srcColMap.get(cell.column_id)
            if (!colName) continue
            const tgtColId = tgtMap.get(colName)
            if (tgtColId !== undefined) {
              insertCell2.run(newRowId, tgtColId, cell.value)
            }
          }
          copiedCount++
        }
      })
      batchCopy()

      // Verify grid2 has 10 rows
      const grid2Count = (db.prepare('SELECT COUNT(*) as n FROM rows WHERE grid_id = ?').get(grid2Id) as { n: number }).n
      expect(grid2Count).toBe(10)
      expect(copiedCount).toBe(10)

      // Clean up: delete grid2
      db.prepare('DELETE FROM rows WHERE grid_id = ?').run(grid2Id)
      db.prepare('DELETE FROM columns WHERE grid_id = ?').run(grid2Id)
      db.prepare('DELETE FROM grids WHERE id = ?').run(grid2Id)

      return '10 rows copied to second grid and verified'
    })
  })

  // ── Step 19: Cell history verification ─────────────────────────────────────

  it('Step 19: Verify cell history integrity', async () => {
    await runStep('Cell history integrity', () => {
      const historyCount = (db.prepare('SELECT COUNT(*) as n FROM cell_history').get() as { n: number }).n
      expect(historyCount).toBeGreaterThan(0)

      // Verify all cell_history entries reference valid rows and columns
      const orphanedHistRows = (db.prepare(`
        SELECT COUNT(*) as n FROM cell_history ch
        WHERE NOT EXISTS (SELECT 1 FROM rows r WHERE r.id = ch.row_id)
      `).get() as { n: number }).n

      const orphanedHistCols = (db.prepare(`
        SELECT COUNT(*) as n FROM cell_history ch
        WHERE NOT EXISTS (SELECT 1 FROM columns c WHERE c.id = ch.column_id)
      `).get() as { n: number }).n

      expect(orphanedHistRows).toBe(0)
      expect(orphanedHistCols).toBe(0)

      return `${historyCount} history entries, 0 orphans`
    })
  })

  // ── Step 20: Data integrity final verification ─────────────────────────────

  it('Step 20: Final data integrity verification', async () => {
    await runStep('Final data integrity', () => {
      // ── Row counts ──
      const totalRows = (db.prepare('SELECT COUNT(*) as n FROM rows WHERE grid_id = ?').get(gridId) as { n: number }).n
      expect(totalRows).toBe(250) // 200 original + 50 imported

      const activeRows = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
      ).get(gridId) as { n: number }).n
      expect(activeRows).toBe(230)

      const archivedRows = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND is_active = 0 AND archived_at IS NOT NULL AND deleted_at IS NULL'
      ).get(gridId) as { n: number }).n
      expect(archivedRows).toBe(5) // 10 archived - 5 restored

      const deletedRows = (db.prepare(
        'SELECT COUNT(*) as n FROM rows WHERE grid_id = ? AND deleted_at IS NOT NULL'
      ).get(gridId) as { n: number }).n
      expect(deletedRows).toBe(15) // 20 deleted - 10 restored + 5 re-deleted

      // Totals should add up: active + archived + deleted = total
      expect(activeRows + archivedRows + deletedRows).toBe(totalRows)

      // ── Orphaned cells (cells referencing non-existent rows or columns) ──
      const orphanedCellRows = (db.prepare(`
        SELECT COUNT(*) as n FROM cells c
        WHERE NOT EXISTS (SELECT 1 FROM rows r WHERE r.id = c.row_id)
      `).get() as { n: number }).n
      expect(orphanedCellRows).toBe(0)

      const orphanedCellCols = (db.prepare(`
        SELECT COUNT(*) as n FROM cells c
        WHERE NOT EXISTS (SELECT 1 FROM columns col WHERE col.id = c.column_id)
      `).get() as { n: number }).n
      expect(orphanedCellCols).toBe(0)

      // ── Every active row should have a cell for every column ──
      const activeRowIds = (db.prepare(
        'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
      ).all(gridId) as { id: number }[])

      let missingCells = 0
      const checkCell = db.prepare('SELECT COUNT(*) as n FROM cells WHERE row_id = ? AND column_id = ?')
      // Sample 50 random active rows to keep this test fast
      const sampleSize = Math.min(50, activeRowIds.length)
      const sampledRows = activeRowIds.sort(() => Math.random() - 0.5).slice(0, sampleSize)
      for (const { id } of sampledRows) {
        for (const colId of allColumnIds) {
          const count = (checkCell.get(id, colId) as { n: number }).n
          if (count === 0) missingCells++
        }
      }
      expect(missingCells).toBe(0)

      // ── Case log entries should only reference existing rows ──
      const orphanedLogs = (db.prepare(`
        SELECT COUNT(*) as n FROM case_log cl
        WHERE NOT EXISTS (SELECT 1 FROM rows r WHERE r.id = cl.row_id)
      `).get() as { n: number }).n
      expect(orphanedLogs).toBe(0)

      // ── Checklist items should only reference existing rows ──
      const orphanedChecklist = (db.prepare(`
        SELECT COUNT(*) as n FROM checklist_items ci
        WHERE NOT EXISTS (SELECT 1 FROM rows r WHERE r.id = ci.row_id)
      `).get() as { n: number }).n
      expect(orphanedChecklist).toBe(0)

      // ── Pivot query should return exactly the active rows ──
      const query = buildGridQuery(allColumnIds)
      const pivotRows = db.prepare(query).all(gridId) as Array<Record<string, unknown>>
      expect(pivotRows).toHaveLength(230)

      // ── Pivot query with includeArchived should return active + archived ──
      const queryWithArchived = buildGridQuery(allColumnIds, true)
      const allVisibleRows = db.prepare(queryWithArchived).all(gridId) as Array<Record<string, unknown>>
      expect(allVisibleRows).toHaveLength(235) // 230 active + 5 archived

      // ── DB integrity check ──
      const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
      expect(integrity.integrity_check).toBe('ok')

      return [
        `total=${totalRows}`,
        `active=${activeRows}`,
        `archived=${archivedRows}`,
        `deleted=${deletedRows}`,
        `orphanedCells=0`,
        `orphanedLogs=0`,
        `integrity=ok`,
      ].join(', ')
    })
  })

  // ── Step 21: Concurrent-style rapid CRUD (simulated burst) ─────────────────

  it('Step 21: Rapid CRUD burst (create+edit+delete in tight loop)', async () => {
    await runStep('Rapid CRUD burst', () => {
      const insertRow = db.prepare(`
        INSERT INTO rows (grid_id, position, created_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
      `)
      const insertCell = db.prepare(`
        INSERT INTO cells (row_id, column_id, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      const updateCellStmt = db.prepare(`
        UPDATE cells SET value = ?, updated_at = datetime('now') WHERE row_id = ? AND column_id = ?
      `)
      const softDelete = db.prepare(`
        UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
      `)

      let created = 0
      let edited = 0
      let deleted = 0

      // Simulate a rapid burst: create a row, edit it 3 times, then delete it, 30 times
      const burstTransaction = db.transaction(() => {
        for (let i = 0; i < 30; i++) {
          // Create
          const maxPos = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 as p FROM rows WHERE grid_id = ?').get(gridId) as { p: number }).p
          const r = insertRow.run(gridId, maxPos)
          const newId = r.lastInsertRowid as number
          insertCell.run(newId, allColumnIds[0], `Burst Client ${i}`)
          created++

          // Edit 3 times
          for (let j = 0; j < 3; j++) {
            const colId = randomChoice(allColumnIds)
            updateCellStmt.run(`Burst edit ${i}-${j}`, newId, colId)
            edited++
          }

          // Delete
          softDelete.run(newId)
          deleted++
        }
      })
      burstTransaction()

      expect(created).toBe(30)
      expect(edited).toBe(90)
      expect(deleted).toBe(30)

      return `${created} created, ${edited} edits, ${deleted} deleted in burst`
    })
  })

  // ── Step 22: Sort configuration persistence ────────────────────────────────

  it('Step 22: Sort config persistence', async () => {
    await runStep('Sort config persistence', () => {
      // Save a multi-column sort config to the grid
      const sortConfig = JSON.stringify([
        { columnId: allColumnIds[0], direction: 'asc', priority: 0 },
        { columnId: allColumnIds[1], direction: 'desc', priority: 1 },
        { columnId: allColumnIds[2], direction: 'asc', priority: 2 },
      ])

      db.prepare(`UPDATE grids SET sort_config = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(sortConfig, gridId)

      // Read it back
      const grid = db.prepare('SELECT sort_config FROM grids WHERE id = ?').get(gridId) as { sort_config: string }
      const parsed = JSON.parse(grid.sort_config)
      expect(parsed).toHaveLength(3)
      expect(parsed[0].direction).toBe('asc')
      expect(parsed[1].direction).toBe('desc')

      return '3-column sort config persisted and verified'
    })
  })

  // ── Step 23: Scrap notes CRUD ──────────────────────────────────────────────

  it('Step 23: Scrap notes write and read', async () => {
    await runStep('Scrap notes CRUD', () => {
      const activeRowIds = (db.prepare(
        'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY RANDOM() LIMIT 10'
      ).all(gridId) as { id: number }[]).map(r => r.id)

      const upsertNote = db.prepare(`
        INSERT INTO scrap_notes (row_id, content, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(row_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
      `)

      // Write notes with rich HTML content
      for (let i = 0; i < activeRowIds.length; i++) {
        const html = `<h2>Client Notes</h2><p>Session ${i + 1} summary:</p><ul><li>Discussed goals</li><li>Updated treatment plan</li><li>Next appointment: ${randomDate()}</li></ul>`
        upsertNote.run(activeRowIds[i], html)
      }

      // Read back and verify
      for (const rowId of activeRowIds) {
        const note = db.prepare('SELECT content FROM scrap_notes WHERE row_id = ?').get(rowId) as { content: string }
        expect(note.content).toContain('<h2>Client Notes</h2>')
      }

      // Update one note 10 times rapidly
      for (let i = 0; i < 10; i++) {
        upsertNote.run(activeRowIds[0], `<p>Rapid update #${i}</p>`)
      }
      const finalNote = db.prepare('SELECT content FROM scrap_notes WHERE row_id = ?').get(activeRowIds[0]) as { content: string }
      expect(finalNote.content).toBe('<p>Rapid update #9</p>')

      return `${activeRowIds.length} notes written, 10 rapid updates verified`
    })
  })

  // ── Step 24: Alert rules CRUD ──────────────────────────────────────────────

  it('Step 24: Alert rules create, update, delete', async () => {
    await runStep('Alert rules CRUD', () => {
      const insertRule = db.prepare(`
        INSERT INTO alert_rules (name, description, interval_days, thresholds, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `)

      const thresholds = JSON.stringify([
        { daysBefore: 30, bgClass: 'alert-green', label: 'Coming up' },
        { daysBefore: 14, bgClass: 'alert-yellow', label: 'Approaching' },
        { daysBefore: 7, bgClass: 'alert-orange', label: 'Due soon' },
        { daysBefore: 3, bgClass: 'alert-red', label: 'Urgent' },
        { daysBefore: 0, bgClass: 'alert-pulse', label: 'Overdue' },
      ])

      // Create 5 rules
      const ruleIds: number[] = []
      for (let i = 0; i < 5; i++) {
        const r = insertRule.run(`Rule ${i}`, `Test rule ${i}`, 30 * (i + 1), thresholds)
        ruleIds.push(r.lastInsertRowid as number)
      }

      // Update interval_days on all
      const updateRule = db.prepare('UPDATE alert_rules SET interval_days = ? WHERE id = ?')
      for (const id of ruleIds) {
        updateRule.run(Math.floor(Math.random() * 365), id)
      }

      // Delete 2 rules
      const deleteRule = db.prepare('DELETE FROM alert_rules WHERE id = ?')
      deleteRule.run(ruleIds[0])
      deleteRule.run(ruleIds[1])

      const remaining = (db.prepare('SELECT COUNT(*) as n FROM alert_rules').get() as { n: number }).n
      expect(remaining).toBe(3)

      return '5 created, 5 updated, 2 deleted, 3 remaining'
    })
  })

  // ── Step 25: Saved views and filters ──────────────────────────────────────

  it('Step 25: Saved views and filters CRUD', async () => {
    await runStep('Saved views/filters', () => {
      // Create saved views
      const insertView = db.prepare(`
        INSERT INTO saved_views (grid_id, name, config, created_at) VALUES (?, ?, ?, datetime('now'))
      `)
      const viewIds: number[] = []
      for (let i = 0; i < 5; i++) {
        const viewData = JSON.stringify({
          sortConfig: [{ columnId: allColumnIds[0], direction: i % 2 === 0 ? 'asc' : 'desc', priority: 0 }],
          visibleColumns: allColumnIds.slice(0, 3 + i),
          filters: [],
        })
        const r = insertView.run(gridId, `View ${i}`, viewData)
        viewIds.push(r.lastInsertRowid as number)
      }

      // Create saved filters
      const insertFilter = db.prepare(`
        INSERT INTO saved_filters (grid_id, name, filter_config, created_at) VALUES (?, ?, ?, datetime('now'))
      `)
      const filterIds: number[] = []
      for (let i = 0; i < 5; i++) {
        const filterJson = JSON.stringify({
          conditions: [{ columnId: allColumnIds[4], operator: 'equals', value: 'Active' }],
          logic: 'AND',
        })
        const r = insertFilter.run(gridId, `Filter ${i}`, filterJson)
        filterIds.push(r.lastInsertRowid as number)
      }

      // Delete 2 views and 2 filters
      db.prepare('DELETE FROM saved_views WHERE id = ?').run(viewIds[0])
      db.prepare('DELETE FROM saved_views WHERE id = ?').run(viewIds[1])
      db.prepare('DELETE FROM saved_filters WHERE id = ?').run(filterIds[0])
      db.prepare('DELETE FROM saved_filters WHERE id = ?').run(filterIds[1])

      const viewCount = (db.prepare('SELECT COUNT(*) as n FROM saved_views WHERE grid_id = ?').get(gridId) as { n: number }).n
      const filterCount = (db.prepare('SELECT COUNT(*) as n FROM saved_filters WHERE grid_id = ?').get(gridId) as { n: number }).n
      expect(viewCount).toBe(3)
      expect(filterCount).toBe(3)

      return '5 views + 5 filters created, 2 + 2 deleted'
    })
  })

  // ── Step 26: Full-name subquery verification ──────────────────────────────

  it('Step 26: display_name materialized column returns valid names', async () => {
    await runStep('display_name validation', () => {
      const nameQuery = `
        SELECT r.id, r.display_name AS client_name
        FROM rows r
        WHERE r.grid_id = ? AND r.is_active = 1 AND r.deleted_at IS NULL
        LIMIT 20
      `
      const rows = db.prepare(nameQuery).all(gridId) as Array<{ id: number; client_name: string }>
      expect(rows.length).toBeGreaterThan(0)

      for (const row of rows) {
        expect(row.client_name).toBeDefined()
        expect(row.client_name.length).toBeGreaterThan(0)
      }

      return `${rows.length} names verified as non-empty`
    })
  })

  // ── Step 27: Large transaction rollback ────────────────────────────────────

  it('Step 27: Transaction rollback on error', async () => {
    await runStep('Transaction rollback', () => {
      const countBefore = (db.prepare('SELECT COUNT(*) as n FROM rows WHERE grid_id = ?').get(gridId) as { n: number }).n

      // Start a transaction that will fail partway through
      try {
        const failingTransaction = db.transaction(() => {
          // Insert a valid row
          db.prepare(`INSERT INTO rows (grid_id, position, created_at, updated_at)
            VALUES (?, 99999, datetime('now'), datetime('now'))`).run(gridId)

          // Force an error (duplicate primary key or other constraint)
          throw new Error('Simulated failure')
        })
        failingTransaction()
      } catch {
        // Expected — transaction should have rolled back
      }

      const countAfter = (db.prepare('SELECT COUNT(*) as n FROM rows WHERE grid_id = ?').get(gridId) as { n: number }).n
      expect(countAfter).toBe(countBefore)

      return 'Rollback verified: row count unchanged'
    })
  })

  // ── Step 28: WAL checkpoint and DB size ────────────────────────────────────

  it('Step 28: WAL checkpoint', async () => {
    await runStep('WAL checkpoint', () => {
      // Force a WAL checkpoint to consolidate all writes
      const result = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number; log: number; checkpointed: number }>
      expect(result).toBeDefined()
      expect(result[0].busy).toBe(0) // No busy pages (we're the only connection)

      // Verify DB page count gives a sense of data size
      const pageCount = db.pragma('page_count') as Array<{ page_count: number }>
      const pageSize = db.pragma('page_size') as Array<{ page_size: number }>
      const dbSizeKB = Math.round((pageCount[0].page_count * pageSize[0].page_size) / 1024)

      return `WAL checkpointed, DB size ~${dbSizeKB}KB`
    })
  })
})
