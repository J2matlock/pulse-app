/**
 * Test helpers — creates a real SQLCipher temp database with all migrations applied.
 * No Electron mocks needed: we import better-sqlite3-multiple-ciphers directly.
 */
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers'
import type { Database } from 'better-sqlite3-multiple-ciphers'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { HUMAN_SERVICES_VOCAB, type Vocab } from '../src/shared/vocab'
import { featuresForExistingInstall, type FeatureMap } from '../src/shared/features'
import { MIGRATIONS } from '../src/main/migration-list'

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
  for (const m of allMigrations) m.up(db)

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

// The production migration list (src/main/migration-list.ts), for direct use in migration tests
export const allMigrations = MIGRATIONS.map(m => ({ version: m.version, up: m.up }))

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0

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
