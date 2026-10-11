/**
 * The real openDatabase → runMigrations path against encrypted temp databases
 * (AUDIT-015, AUDIT-016, AUDIT-106). Only Electron, electron-store, the logger
 * and the key store are faked; database.ts, backup.ts and every migration are real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers'
import type { Database } from 'better-sqlite3'
import type { Migration } from '../src/main/migration-list'

const KEY_HEX = 'a1'.repeat(32)

const h = vi.hoisted(() => ({
  storedPath: '',
  stores: new Map<string, Map<string, unknown>>(),
  // The live list database.ts runs; tests add a failing migration to it
  list: [] as Migration[],
  real: [] as Migration[],
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => tmpdir(), getVersion: () => '9.9.9', on: () => {} },
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false },
  clipboard: { clear: () => {} },
  dialog: {},
}))

vi.mock('electron-store', () => ({
  default: class {
    private data: Map<string, unknown>
    constructor(opts?: { name?: string }) {
      const name = opts?.name ?? 'config'
      if (!h.stores.has(name)) h.stores.set(name, new Map())
      this.data = h.stores.get(name) as Map<string, unknown>
    }
    get(k: string, d?: unknown) { return this.data.has(k) ? this.data.get(k) : d }
    set(k: string, v?: unknown) { this.data.set(k, v) }
    has(k: string) { return this.data.has(k) }
    delete(k: string) { this.data.delete(k) }
  },
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../src/main/auth', () => ({
  getDbKey: () => Buffer.from(KEY_HEX, 'hex'),
  setStoredDbPath: (p: string) => { h.storedPath = p },
  getStoredDbPath: () => h.storedPath,
  isPasswordSetup: () => true,
  getKeyEnvelope: () => null,
  isValidKeyEnvelope: () => false,
  unwrapKeyEnvelope: () => { throw new Error('not used') },
  adoptRestoredDbKey: () => { throw new Error('not used') },
}))

vi.mock('../src/main/migration-list', async () => {
  const actual = await vi.importActual<typeof import('../src/main/migration-list')>('../src/main/migration-list')
  h.real.push(...actual.MIGRATIONS)
  h.list.push(...actual.MIGRATIONS)
  return { MIGRATIONS: h.list, applyMigration: actual.applyMigration }
})

import { openDatabase, closeDatabase, getDb, getMigrationFailure, latestSchemaVersion, DatabaseOpenError } from '../src/main/database'
import { trashColumn, type ColumnSnapshot } from '../src/main/list-trash'

let dir: string
let dbPath: string

/** Open a file the way the app does (same cipher settings and key) */
function openRaw(path: string): Database {
  const db = new BetterSqlite3(path) as Database
  db.pragma(`cipher='sqlcipher'`)
  db.pragma(`key='${KEY_HEX}'`)
  db.pragma('kdf_iter=256000')
  db.pragma('cipher_page_size=4096')
  db.pragma('cipher_hmac_algorithm=HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm=PBKDF2_HMAC_SHA512')
  db.pragma('foreign_keys = ON')
  return db
}

/** Make pulse.db at an older schema, the way an older Pulse would have left it */
function makeDbAt(version: number, seed?: (db: Database) => void): void {
  const db = openRaw(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of h.real) {
    if (m.version > version) break
    if (m.noTransaction) m.up(db)
    else db.transaction(() => m.up(db))()
  }
  seed?.(db)
  db.close()
}

const versionOf = (db: Database) => Number((db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value)
const count = (db: Database, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
const backupsDir = () => join(dir, 'backups')
const preMigrationCopies = () => existsSync(backupsDir()) ? readdirSync(backupsDir()).filter(f => f.startsWith('pulse-pre-migration-')) : []
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

/** The kind of DatabaseOpenError openDatabase threw (the lock screen explains each one) */
function openFailureKind(): string {
  try { openDatabase() } catch (err) {
    expect(err).toBeInstanceOf(DatabaseOpenError)
    return err instanceof DatabaseOpenError ? err.kind : 'not a DatabaseOpenError'
  }
  return 'opened'
}

function expectHealthy(db: Database): void {
  expect(db.pragma('foreign_key_check')).toEqual([])
  expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
}

/** A grid, two columns, three rows with cells and notes: what a real list has */
function seedList(db: Database): { gridId: number; rowIds: number[]; colIds: number[] } {
  const gridId = Number(db.prepare("INSERT INTO grids (name) VALUES ('Test List')").run().lastInsertRowid)
  const colIds = [
    Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position, is_name_column) VALUES (?, 'Name', 'text', 0, 1)").run(gridId).lastInsertRowid),
    Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position) VALUES (?, 'Due', 'date', 1)").run(gridId).lastInsertRowid),
  ]
  const rowIds: number[] = []
  for (let i = 0; i < 3; i++) {
    const rowId = Number(db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, ?)').run(gridId, i).lastInsertRowid)
    rowIds.push(rowId)
    db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, colIds[0], `Test Person ${i + 1}`)
    db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, '2026-03-0' || ?)").run(rowId, colIds[1], i + 1)
    db.prepare("INSERT INTO case_log (row_id, content) VALUES (?, 'Test note')").run(rowId)
  }
  return { gridId, rowIds, colIds }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pulse-open-'))
  dbPath = join(dir, 'pulse.db')
  process.env.PULSE_DATA_DIR = dir
  h.stores.clear()
  h.storedPath = ''
  h.list.splice(0, h.list.length, ...h.real)
})

afterEach(() => {
  closeDatabase()
  delete process.env.PULSE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe('openDatabase on a new install', () => {
  it('creates the database at the newest schema and makes no pre-migration copy', () => {
    openDatabase()
    expect(versionOf(getDb())).toBe(latestSchemaVersion())
    expect(preMigrationCopies()).toEqual([])
    expect(h.storedPath).toBe(dbPath)
    expectHealthy(getDb())
  })
})

describe('openDatabase upgrading an older database', () => {
  it('upgrades a v30 database with data, keeps it, and saves a pre-migration copy that still opens', () => {
    makeDbAt(30, db => { seedList(db) })
    openDatabase()

    const db = getDb()
    expect(versionOf(db)).toBe(latestSchemaVersion())
    expect(count(db, 'rows')).toBe(3)
    expect(count(db, 'cells')).toBe(6)
    expect(count(db, 'case_log')).toBe(3)
    expect((db.prepare('SELECT display_name FROM rows ORDER BY position').all() as Array<{ display_name: string }>).map(r => r.display_name))
      .toEqual(['Test Person 1', 'Test Person 2', 'Test Person 3'])
    expectHealthy(db)
    expect(getMigrationFailure()).toBeNull()

    const copies = preMigrationCopies()
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatch(new RegExp(`^pulse-pre-migration-v30-to-v${latestSchemaVersion()}-`))
    const copy = openRaw(join(backupsDir(), copies[0] as string))
    try {
      expect(versionOf(copy)).toBe(30)
      expect(count(copy, 'rows')).toBe(3)
    } finally { copy.close() }
  })

  it('upgrades a v1 database with data through every table rebuild (005, 007, 014, 017, 024, 031)', () => {
    makeDbAt(1, db => { seedList(db) })
    openDatabase()
    const db = getDb()
    expect(versionOf(db)).toBe(latestSchemaVersion())
    expect(count(db, 'grids')).toBe(1)
    expect(count(db, 'columns')).toBe(2)
    expect(count(db, 'rows')).toBe(3)
    expect(count(db, 'cells')).toBe(6)
    expect(count(db, 'case_log')).toBe(3)
    expect((db.prepare("SELECT value FROM cells WHERE value LIKE 'Test Person%' ORDER BY value").all() as Array<{ value: string }>).map(r => r.value))
      .toEqual(['Test Person 1', 'Test Person 2', 'Test Person 3'])
    expectHealthy(db)
  })

  it('upgrades a v13 database whose formats and contact links point at deleted records (014 rebuilds those tables with foreign keys)', () => {
    let kept = { rowId: 0, colId: 0 }
    makeDbAt(13, db => {
      const { gridId, rowIds, colIds } = seedList(db)
      const providerId = Number(db.prepare("INSERT INTO providers (name) VALUES ('Test Contact')").run().lastInsertRowid)
      for (const rowId of rowIds) {
        db.prepare("INSERT INTO cell_formats (row_id, column_id, rules) VALUES (?, ?, '[]')").run(rowId, colIds[0])
        db.prepare('INSERT INTO provider_client_links (provider_id, row_id, grid_id) VALUES (?, ?, ?)').run(providerId, rowId, gridId)
      }
      // Before v14 these tables had no foreign keys, so deleting a record left its rows behind
      db.prepare('DELETE FROM rows WHERE id = ?').run(rowIds[2])
      db.prepare("INSERT INTO cond_format_rules (name, rule_json) VALUES ('Overdue', '{}'), ('Overdue', '{}')").run()
      kept = { rowId: rowIds[0] as number, colId: colIds[0] as number }
    })

    openDatabase()

    const db = getDb()
    expect(versionOf(db)).toBe(latestSchemaVersion())
    expect(count(db, 'rows')).toBe(2)
    expect(count(db, 'cell_formats')).toBe(2)
    expect(count(db, 'provider_client_links')).toBe(2)
    expect(db.prepare('SELECT 1 AS ok FROM cell_formats WHERE row_id = ? AND column_id = ?').get(kept.rowId, kept.colId)).toEqual({ ok: 1 })
    expect((db.prepare('SELECT name FROM cond_format_rules ORDER BY id').all() as Array<{ name: string }>).map(r => r.name)).toEqual(['Overdue', 'Overdue (1)'])
    expectHealthy(db)
  })
})

describe('openDatabase refusing or failing safely', () => {
  it('refuses a database made by a newer Pulse and leaves the file untouched', () => {
    makeDbAt(latestSchemaVersion(), db => {
      db.pragma('wal_checkpoint(TRUNCATE)')
      db.prepare("UPDATE app_meta SET value = ? WHERE key = 'schema_version'").run(String(latestSchemaVersion() + 1))
      db.pragma('wal_checkpoint(TRUNCATE)')
    })
    const before = sha(dbPath)

    expect(() => openDatabase()).toThrow(/newer version of Pulse/)
    expect(openFailureKind()).toBe('newer')

    expect(() => getDb()).toThrow()
    expect(sha(dbPath)).toBe(before)
    expect(preMigrationCopies()).toEqual([])
  })

  it('rolls back a failing migration, keeps the last good version, and records the failure', () => {
    const latest = latestSchemaVersion()
    makeDbAt(latest, db => { seedList(db) })
    h.list.push({
      version: latest + 1,
      up: (db) => {
        db.exec('CREATE TABLE half_done (x INTEGER)')
        db.prepare("UPDATE rows SET position = 99")
          .run()
        throw new Error('simulated failure')
      },
    })

    expect(() => openDatabase()).toThrow(/Migration to version \d+ failed/)
    expect(() => getDb()).toThrow()
    expect(openFailureKind()).toBe('migration')

    const failure = getMigrationFailure()
    expect(failure?.version).toBe(latest + 1)
    expect(failure?.error).toBe('simulated failure')

    const db = openRaw(dbPath)
    try {
      expect(versionOf(db)).toBe(latest)
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined()
      expect((db.prepare('SELECT DISTINCT position FROM rows ORDER BY position').all() as Array<{ position: number }>).map(r => r.position)).toEqual([0, 1, 2])
    } finally { db.close() }
    // The copy made before the attempt is there to restore from
    expect(preMigrationCopies()[0]).toMatch(new RegExp(`^pulse-pre-migration-v${latest}-to-v${latest + 1}-`))

    // Once the faulty migration is gone (a fixed Pulse), the database opens and the flag clears
    h.list.pop()
    openDatabase()
    expect(versionOf(getDb())).toBe(latest)
    expect(getMigrationFailure()).toBeNull()
  })

  it('a rebuild: true migration can rebuild the records table without wiping cells or notes (AUDIT-107)', () => {
    const latest = latestSchemaVersion()
    makeDbAt(latest, db => { seedList(db) })
    h.list.push({
      version: latest + 1,
      rebuild: true,
      up: (db) => {
        // SQLite's procedure: set aside triggers and views that mention the table (the
        // rename re-checks them), new table, copy, drop old, rename, then put back
        // its indexes, triggers and views
        const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rows'").get() as { sql: string }
        const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rows' AND sql IS NOT NULL").all() as Array<{ sql: string }>
        const dependents = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('trigger', 'view') AND sql LIKE '%rows%'").all() as Array<{ type: string; name: string; sql: string }>
        for (const d of dependents) db.exec(`DROP ${d.type.toUpperCase()} IF EXISTS "${d.name}"`)
        db.exec(table.sql.replace(/CREATE TABLE\s+"?rows"?/i, 'CREATE TABLE rows_new'))
        db.exec('INSERT INTO rows_new SELECT * FROM rows')
        db.exec('DROP TABLE rows')
        db.exec('ALTER TABLE rows_new RENAME TO rows')
        for (const i of indexes) db.exec(i.sql)
        for (const d of dependents) db.exec(d.sql)
      },
    })

    openDatabase()
    const db = getDb()
    expect(versionOf(db)).toBe(latest)
    expect(count(db, 'rows')).toBe(3)
    expect(count(db, 'cells')).toBe(6)
    expect(count(db, 'case_log')).toBe(3)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    // Deleting a record still cascades to its cells, so the links survived the rebuild
    const one = (db.prepare('SELECT id FROM rows LIMIT 1').get() as { id: number }).id
    db.prepare('DELETE FROM rows WHERE id = ?').run(one)
    expect(count(db, 'cells')).toBe(4)
  })

  it('reports a damaged file as unreadable and leaves it in place', () => {
    writeFileSync(dbPath, Buffer.alloc(8192, 7))
    const before = sha(dbPath)
    expect(openFailureKind()).toBe('unreadable')
    expect(() => getDb()).toThrow()
    expect(sha(dbPath)).toBe(before)
  })

  it('opening again closes the connection that was still open (AUDIT-020)', () => {
    openDatabase()
    const first = getDb()
    openDatabase()
    expect(first.open).toBe(false)
    expect(getDb()).not.toBe(first)
    expect(versionOf(getDb())).toBe(latestSchemaVersion())
  })

  it('re-opening an up-to-date database runs nothing and makes no copy', () => {
    openDatabase()
    closeDatabase()
    openDatabase()
    expect(versionOf(getDb())).toBe(latestSchemaVersion())
    expect(preMigrationCopies()).toEqual([])
  })
})

describe('the 30-day Trash purge on open', () => {
  it('also takes purged records out of deleted-column snapshots, like Delete forever (AUDIT-108)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      openDatabase()
      const { rowIds, colIds } = seedList(getDb())
      trashColumn(colIds[1] as number)
      // Record 1 has been in the Trash for 40 days; records 2 and 3 are fine
      getDb().prepare("UPDATE rows SET deleted_at = datetime('now', '-40 days') WHERE id = ?").run(rowIds[0])
      closeDatabase()

      openDatabase()
      vi.runOnlyPendingTimers()
      const db = getDb()
      expect(db.prepare('SELECT id FROM rows ORDER BY id').all().map(r => (r as { id: number }).id)).toEqual(rowIds.slice(1))
      const snap = JSON.parse((db.prepare('SELECT snapshot FROM deleted_columns').get() as { snapshot: string }).snapshot) as ColumnSnapshot
      const cells = snap.tables.find(t => t.table === 'cells')?.rows ?? []
      expect(cells.map(c => c.row_id)).toEqual(rowIds.slice(1))
      expectHealthy(db)
    } finally {
      vi.useRealTimers()
    }
  })
})
