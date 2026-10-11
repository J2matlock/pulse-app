/**
 * Test helpers — creates a real SQLCipher temp database with all migrations applied.
 * No Electron mocks needed: we import better-sqlite3-multiple-ciphers directly.
 */
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers'
import type { Database } from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Re-export the migration functions — they only depend on the Database type, not Electron
import { HUMAN_SERVICES_VOCAB, type Vocab } from '../src/shared/vocab'
import { featuresForExistingInstall, type FeatureMap } from '../src/shared/features'
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
import { up as migration018 } from '../src/main/migrations/018_perf_phase4'
import { up as migration019 } from '../src/main/migrations/019_perf_phase5'
import { up as migration020 } from '../src/main/migrations/020_perf_phase6'
import { up as migration021 } from '../src/main/migrations/021_perf_phase7'
import { up as migration022 } from '../src/main/migrations/022_dashboard_indexes'
import { up as migration023 } from '../src/main/migrations/023_provider_link_index'
import { up as migration024 } from '../src/main/migrations/024_fix_display_name'
import { up as migration025 } from '../src/main/migrations/025_dashboard_perf_indexes'
import { up as migration026 } from '../src/main/migrations/026_dashboard_completion_index'
import { up as migration027 } from '../src/main/migrations/027_document_storage'
import { up as migration028 } from '../src/main/migrations/028_checklist_groups'
import { up as migration029 } from '../src/main/migrations/029_reference_board'
import { up as migration030 } from '../src/main/migrations/030_task_groups'
import { up as migration031 } from '../src/main/migrations/031_remove_docs_and_refboard'
import { up as migration032 } from '../src/main/migrations/032_case_log_edits'
import { up as migration033 } from '../src/main/migrations/033_rule_calendar_intervals'
import { up as migration034 } from '../src/main/migrations/034_contact_requirements'
import { up as migration035 } from '../src/main/migrations/035_case_log_time_mileage'
import { up as migration036 } from '../src/main/migrations/036_workspace'
import { up as migration037 } from '../src/main/migrations/037_activity_types'
import { up as migration038 } from '../src/main/migrations/038_deadline_engine'
import { up as migration039 } from '../src/main/migrations/039_links'
import { up as migration040 } from '../src/main/migrations/040_appointments'
import { up as migration041 } from '../src/main/migrations/041_forms'
import { up as migration042 } from '../src/main/migrations/042_attachments'
import { up as migration043 } from '../src/main/migrations/043_report_definitions'
import { up as migration044 } from '../src/main/migrations/044_note_occurred_at'
import { up as migration045 } from '../src/main/migrations/045_list_trash'
import { up as migration046 } from '../src/main/migrations/046_deadline_done'
import { up as migration047 } from '../src/main/migrations/047_sample_rows'

const TEST_PASSWORD = 'test-key-hex-0123456789abcdef'

export interface TestDb {
  db: Database
  dbPath: string
  tmpDir: string
}

/**
 * Create a fresh encrypted test database with all migrations applied.
 * Returns the db handle, path, and tmpDir for cleanup.
 */
export function createTestDb(): TestDb {
  const tmpDir = mkdtempSync(join(tmpdir(), 'pulse-test-'))
  const dbPath = join(tmpDir, 'test.db')

  const db = new BetterSqlite3(dbPath) as Database
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('kdf_iter=1000')  // fewer iterations for speed in tests
  db.pragma('cipher_page_size=4096')
  db.pragma('cipher_hmac_algorithm=HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm=PBKDF2_HMAC_SHA512')
  db.pragma(`key='${TEST_PASSWORD}'`)  // key MUST be set after cipher params
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')

  // Run all migrations
  db.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  migration001(db)
  migration002(db)
  migration003(db)
  migration004(db)
  migration005(db)
  migration006(db)
  migration007(db)
  migration008(db)
  migration009(db)
  migration010(db)
  migration011(db)
  migration012(db)
  migration013(db)
  migration014(db)
  migration015(db)
  migration016(db)
  migration017(db)
  migration018(db)
  migration019(db)
  migration020(db)
  migration021(db)
  migration022(db)
  migration023(db)
  migration024(db)
  migration025(db)
  migration026(db)
  migration027(db)
  migration028(db)
  migration029(db)
  migration030(db)
  migration031(db)
  migration032(db)
  migration033(db)
  migration034(db)
  migration035(db)
  migration036(db)
  migration037(db)
  migration038(db)
  migration039(db)
  migration040(db)
  migration041(db)
  migration042(db)
  migration043(db)
  migration044(db)
  migration045(db)
  migration046(db)
  migration047(db)

  return { db, dbPath, tmpDir }
}

/**
 * Create a fresh encrypted database file without running migrations.
 * Useful for testing the migration system itself.
 */
export function createEmptyEncryptedDb(dir?: string): TestDb {
  const tmpDir = dir || mkdtempSync(join(tmpdir(), 'pulse-test-'))
  const dbPath = join(tmpDir, 'test.db')

  const db = new BetterSqlite3(dbPath) as Database
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('kdf_iter=1000')
  db.pragma('cipher_page_size=4096')
  db.pragma('cipher_hmac_algorithm=HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm=PBKDF2_HMAC_SHA512')
  db.pragma(`key='${TEST_PASSWORD}'`)  // key MUST be set after cipher params
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')

  return { db, dbPath, tmpDir }
}

/**
 * Open an existing encrypted database file.
 */
export function openEncryptedDb(dbPath: string, key = TEST_PASSWORD): Database {
  const db = new BetterSqlite3(dbPath) as Database
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('kdf_iter=1000')
  db.pragma('cipher_page_size=4096')
  db.pragma('cipher_hmac_algorithm=HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm=PBKDF2_HMAC_SHA512')
  db.pragma(`key='${key}'`)  // key MUST be set after cipher params
  db.pragma('foreign_keys = ON')
  return db
}

export function cleanupTestDb(t: TestDb): void {
  try { t.db.close() } catch { /* already closed */ }
  try { rmSync(t.tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
}

export { TEST_PASSWORD }

// Re-export all migration functions for direct use in migration tests
export const allMigrations = [
  { version: 1, up: migration001 },
  { version: 2, up: migration002 },
  { version: 3, up: migration003 },
  { version: 4, up: migration004 },
  { version: 5, up: migration005 },
  { version: 6, up: migration006 },
  { version: 7, up: migration007 },
  { version: 8, up: migration008 },
  { version: 9, up: migration009 },
  { version: 10, up: migration010 },
  { version: 11, up: migration011 },
  { version: 12, up: migration012 },
  { version: 13, up: migration013 },
  { version: 14, up: migration014 },
  { version: 15, up: migration015 },
  { version: 16, up: migration016 },
  { version: 17, up: migration017 },
  { version: 18, up: migration018 },
  { version: 19, up: migration019 },
  { version: 20, up: migration020 },
  { version: 21, up: migration021 },
  { version: 22, up: migration022 },
  { version: 23, up: migration023 },
  { version: 24, up: migration024 },
  { version: 25, up: migration025 },
  { version: 26, up: migration026 },
  { version: 27, up: migration027 },
  { version: 28, up: migration028 },
  { version: 29, up: migration029 },
  { version: 30, up: migration030 },
  { version: 31, up: migration031 },
  { version: 32, up: migration032 },
  { version: 33, up: migration033 },
  { version: 34, up: migration034 },
  { version: 35, up: migration035 },
  { version: 36, up: migration036 },
  { version: 37, up: migration037 },
  { version: 38, up: migration038 },
  { version: 39, up: migration039 },
  { version: 40, up: migration040 },
  { version: 41, up: migration041 },
  { version: 42, up: migration042 },
  { version: 43, up: migration043 },
  { version: 44, up: migration044 },
  { version: 45, up: migration045 },
  { version: 46, up: migration046 },
  { version: 47, up: migration047 },
]

export const LATEST_SCHEMA_VERSION = 47

/** Create a grid with some columns and rows, returning their IDs */
export function seedGrid(db: Database, opts?: {
  name?: string
  columnCount?: number
  rowCount?: number
  columnTypes?: string[]
}): { gridId: number; columnIds: number[]; rowIds: number[] } {
  const name = opts?.name ?? 'Test Caseload'
  const colCount = opts?.columnCount ?? 5
  const rowCount = opts?.rowCount ?? 10
  const colTypes = opts?.columnTypes ?? Array(colCount).fill('text')

  const gridResult = db.prepare(
    `INSERT INTO grids (name, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))`
  ).run(name)
  const gridId = gridResult.lastInsertRowid as number

  const columnIds: number[] = []
  for (let i = 0; i < colCount; i++) {
    const isName = i === 0 ? 1 : 0
    const r = db.prepare(
      `INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(gridId, `Column ${i + 1}`, colTypes[i] || 'text', i, isName)
    columnIds.push(r.lastInsertRowid as number)
  }

  const rowIds: number[] = []
  for (let i = 0; i < rowCount; i++) {
    const r = db.prepare(
      `INSERT INTO rows (grid_id, position, created_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))`
    ).run(gridId, i)
    rowIds.push(r.lastInsertRowid as number)
  }

  return { gridId, columnIds, rowIds }
}

/** Save workspace words in a test database (defaults to today's human-services words). */
export function setDbWords(db: Database, vocab: Partial<Vocab> = HUMAN_SERVICES_VOCAB): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_vocab', ?)").run(JSON.stringify(vocab))
}

/** Save feature switches in a test database (defaults to an existing install's). */
export function setDbFeatures(db: Database, features: FeatureMap = featuresForExistingInstall({ trackTime: false, trackMileage: false })): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_features', ?)").run(JSON.stringify(features))
}
