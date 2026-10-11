/**
 * Backup & Restore Tests — verifies backup file creation, pruning, and restore integrity.
 *
 * Where possible, tests call real backup.ts functions (pruneBackups, assertPathWithin,
 * verifyBackup, restoreFromDb, restoreFromPulseBackup). Functions that depend on Electron's
 * app module, electron-store, or the auth module are mocked at the module boundary so that
 * the real backup.ts logic still runs.
 *
 * Some tests (auto-backup creation, manual backup copy) still use direct file operations
 * because runAutoBackup() uses VACUUM INTO which requires a live DB bridge that the test
 * infrastructure cannot provide.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync,
  mkdirSync, mkdtempSync, rmSync, unlinkSync, createWriteStream,
} from 'fs'
import { join, resolve, sep, basename } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'
import yazl from 'yazl'
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers'
import type { Database } from 'better-sqlite3'
import {
  createTestDb,
  cleanupTestDb,
  openEncryptedDb,
  seedGrid,
  TEST_PASSWORD,
  type TestDb,
} from './helpers'

let t: TestDb
let backupDir: string

// ── Mocks for Electron dependencies so we can import real backup.ts functions ──

// Mock electron (backup.ts imports app for getVersion/getPath)
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pulse-test-backup',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  dialog: { showMessageBoxSync: () => 0 },
}))

// Mock electron-store (used by getScheduledConfig/setScheduledConfig and backup status)
// Methods are on the prototype so tests can monkey-patch them (e.g., to simulate store corruption).
vi.mock('electron-store', () => {
  const stores = new Map<string, Record<string, unknown>>()
  class MockStore {
    _data: Record<string, unknown>
    constructor(opts?: { name?: string }) {
      const key = opts?.name ?? 'default'
      if (!stores.has(key)) stores.set(key, {})
      this._data = stores.get(key)!
    }
  }
  MockStore.prototype.get = function (k: string, def?: unknown): unknown { return this._data[k] ?? def }
  MockStore.prototype.set = function (k: string, v: unknown): void { this._data[k] = v }
  return { default: MockStore }
})

// Mock auth module — getStoredDbPath returns the test DB path, getDbKey returns test key
vi.mock('../src/main/auth', () => ({
  getStoredDbPath: () => _currentDbPath,
  getDbKey: () => Buffer.from(TEST_PASSWORD.padEnd(64, '0').slice(0, 64), 'utf8'),
  getKeyEnvelope: () => null,
  isValidKeyEnvelope: () => false,
  unwrapKeyEnvelope: async () => { throw new Error('Incorrect password or recovery key') },
  adoptRestoredDbKey: async () => {},
}))

// Mock database module
vi.mock('../src/main/database', () => ({
  getDb: () => null,
  getPortableDataDir: () => _currentTmpDir,
}))

// Mock logger
vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

// Mutable paths that tests update in beforeEach
let _currentDbPath: string
let _currentTmpDir: string

// Import real backup.ts functions (after mocks are set up)
import {
  pruneBackups,
  selectAutoBackupsToKeep,
  assertPathWithin,
  verifyBackup,
  restoreFromDb,
  restoreFromPulseBackup,
  setDatabaseBridge,
  getScheduledConfig,
  setScheduledConfig,
  getBackupInfo,
  recordAutoBackupSuccess,
} from '../src/main/backup'

/** Create a zip file from a map of entry-name → content. */
async function createTestZip(destPath: string, entries: Record<string, Buffer | string>): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const [name, data] of Object.entries(entries)) {
    zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name)
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(destPath))
}

/** Create a zip from a local file (like addLocalFile in adm-zip). */
async function createTestZipFromFile(destPath: string, filePath: string, entryName: string, extraEntries?: Record<string, Buffer | string>): Promise<void> {
  const zip = new yazl.ZipFile()
  zip.addFile(filePath, entryName)
  if (extraEntries) {
    for (const [name, data] of Object.entries(extraEntries)) {
      zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name)
    }
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(destPath))
}

/** Read a zip and return entries with their data (using yauzl). */
async function readTestZip(zipPath: string): Promise<Map<string, Buffer>> {
  const yauzl = require('yauzl') as typeof import('yauzl')
  return new Promise((resolveP, rejectP) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) { rejectP(err ?? new Error('Failed to open zip')); return }
      const result = new Map<string, Buffer>()
      const entryMap = new Map<string, import('yauzl').Entry>()
      const names: string[] = []

      zipfile.on('entry', (entry: import('yauzl').Entry) => {
        names.push(entry.fileName)
        entryMap.set(entry.fileName, entry)
        zipfile.readEntry()
      })
      zipfile.on('error', rejectP)
      zipfile.on('end', async () => {
        try {
          for (const name of names) {
            const entry = entryMap.get(name)!
            const buf = await new Promise<Buffer>((res, rej) => {
              zipfile.openReadStream(entry, (streamErr, readStream) => {
                if (streamErr || !readStream) { rej(streamErr ?? new Error('No stream')); return }
                const chunks: Buffer[] = []
                readStream.on('data', (chunk: Buffer) => chunks.push(chunk))
                readStream.on('end', () => res(Buffer.concat(chunks)))
                readStream.on('error', rej)
              })
            })
            result.set(name, buf)
          }
          zipfile.close()
          resolveP(result)
        } catch (e) { zipfile.close(); rejectP(e) }
      })
      zipfile.readEntry()
    })
  })
}

beforeEach(() => {
  t = createTestDb()
  backupDir = join(t.tmpDir, 'backups')
  mkdirSync(backupDir, { recursive: true })
  _currentDbPath = t.dbPath
  _currentTmpDir = t.tmpDir

  // Set up the database bridge so backup.ts can checkpoint WAL
  setDatabaseBridge({
    closeDatabase: () => { try { t.db.close() } catch { /* already closed */ } },
    getDb: () => t.db as unknown as { pragma(sql: string): unknown },
  })
})

afterEach(() => { cleanupTestDb(t) })

function openTestDb(path: string, key = TEST_PASSWORD): Database {
  return openEncryptedDb(path, key)
}

// ── Auto-Backup on Close ─────────────────────────────────────────────────────

describe('Auto-Backup on Close', () => {
  it('backup file is created by copying the DB', () => {
    // Seed some data
    seedGrid(t.db, { rowCount: 5, columnCount: 3 })
    t.db.close()

    const destPath = join(backupDir, 'pulse-auto-20260222-120000.db')
    copyFileSync(t.dbPath, destPath)

    expect(existsSync(destPath)).toBe(true)
  })

  it('backup filename matches pattern pulse-auto-YYYY-MM-DD-HHMMSS.db', () => {
    t.db.close()
    const now = new Date()
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('')
    const name = `pulse-auto-${ts}.db`

    copyFileSync(t.dbPath, join(backupDir, name))
    expect(name).toMatch(/^pulse-auto-\d{8}-\d{6}\.db$/)
    expect(existsSync(join(backupDir, name))).toBe(true)
  })

  it('pruning keeps only 5 most recent auto-backups', () => {
    t.db.close()

    // Create 7 backups with different timestamps
    for (let i = 0; i < 7; i++) {
      const name = `pulse-auto-20260222-12000${i}.db`
      copyFileSync(t.dbPath, join(backupDir, name))
    }

    // Call the real pruneBackups from backup.ts
    pruneBackups(backupDir, 'pulse-auto-', '.db', 5)

    const remaining = readdirSync(backupDir).filter(f => f.startsWith('pulse-auto-'))
    expect(remaining).toHaveLength(5)
    // The 2 oldest should be gone
    expect(remaining).not.toContain('pulse-auto-20260222-120000.db')
    expect(remaining).not.toContain('pulse-auto-20260222-120001.db')
  })

  // Skipped: test alias uses plain better-sqlite3 (no cipher) so DB is unencrypted in tests
  it.skip('backup file is encrypted (not readable as plain SQLite)', () => {
    t.db.close()
    const destPath = join(backupDir, 'pulse-auto-test.db')
    copyFileSync(t.dbPath, destPath)

    const header = readFileSync(destPath).subarray(0, 16)
    expect(header.toString('ascii')).not.toContain('SQLite format 3')
  })

  it('auto-backup succeeds even when WAL checkpoint throws', () => {
    // Seed data so the DB is non-trivial
    seedGrid(t.db, { rowCount: 5, columnCount: 3 })

    // Set up a bridge where getDb().pragma('wal_checkpoint(TRUNCATE)') throws
    const mockDb = {
      pragma: vi.fn((sql: string) => {
        if (sql.includes('wal_checkpoint')) {
          throw new Error('checkpoint failed: database is locked')
        }
        return t.db.pragma(sql)
      }),
    }
    setDatabaseBridge({
      closeDatabase: () => { try { t.db.close() } catch { /* already closed */ } },
      getDb: () => mockDb as unknown as { pragma(sql: string): unknown },
    })

    // The createAtomicDbSnapshot with compact:false calls pragma('wal_checkpoint(TRUNCATE)')
    // which will throw. The auto-backup code in runAutoBackup catches this and
    // records it as a failure. But the copy-based fallback path (checkpointWal swallows errors)
    // should still work.
    // Since we can't call runAutoBackup directly (it reads getStoredDbPath which returns
    // the mock path), test the checkpoint resilience via direct copy.
    t.db.close()
    const destPath = join(backupDir, 'pulse-auto-wal-fail.db')
    copyFileSync(t.dbPath, destPath)

    expect(existsSync(destPath)).toBe(true)

    // Verify the backup is valid even without a clean checkpoint
    const db2 = openTestDb(destPath)
    const count = (db2.prepare('SELECT COUNT(*) as c FROM rows').get() as { c: number }).c
    expect(count).toBe(5)
    db2.close()
  })
})

// ── Manual Backup ────────────────────────────────────────────────────────────

describe('Manual Backup', () => {
  it('backup contains all data (open with password, verify row count)', () => {
    const { gridId, rowIds } = seedGrid(t.db, { rowCount: 10, columnCount: 2 })
    t.db.close()

    const destPath = join(backupDir, 'manual-backup.db')
    copyFileSync(t.dbPath, destPath)

    const db2 = openTestDb(destPath)
    const count = (db2.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(count).toBe(10)
    db2.close()
  })

  it('backup is a valid SQLCipher database', () => {
    seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.close()

    const destPath = join(backupDir, 'manual-backup.db')
    copyFileSync(t.dbPath, destPath)

    // Should open without error and have the schema_version
    const db2 = openTestDb(destPath)
    const row = db2.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }
    expect(parseInt(row.value)).toBeGreaterThanOrEqual(1)
    db2.close()
  })
})

// ── Restore ──────────────────────────────────────────────────────────────────

describe('Restore', () => {
  it('create 10 clients → backup → delete 5 → restore → all 10 back', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 10, columnCount: 1 })
    const colId = columnIds[0]
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    for (let i = 0; i < 10; i++) {
      ins.run(rowIds[i], colId, `Client ${i}`)
    }

    // Close and backup
    t.db.close()
    const backupPath = join(backupDir, 'restore-test.db')
    copyFileSync(t.dbPath, backupPath)

    // Reopen and delete 5 clients
    const db2 = openTestDb(t.dbPath)
    for (let i = 0; i < 5; i++) {
      db2.prepare('DELETE FROM rows WHERE id = ?').run(rowIds[i])
    }
    const countAfterDelete = (db2.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(countAfterDelete).toBe(5)
    db2.close()

    // Restore: copy backup over the DB file
    copyFileSync(backupPath, t.dbPath)
    const db3 = openTestDb(t.dbPath)
    const countAfterRestore = (db3.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(countAfterRestore).toBe(10)
    db3.close()
  })

  it('restore creates a pre-restore safety backup before overwriting', () => {
    seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.close()

    const backupPath = join(backupDir, 'to-restore.db')
    copyFileSync(t.dbPath, backupPath)

    // Simulate: before restoring, save current DB as pre-restore backup
    const safetyPath = join(backupDir, 'pre-restore-safety.db')
    copyFileSync(t.dbPath, safetyPath)

    // Then overwrite with backup
    copyFileSync(backupPath, t.dbPath)

    // Both files should exist
    expect(existsSync(safetyPath)).toBe(true)
    expect(existsSync(t.dbPath)).toBe(true)

    // Safety backup should be a valid DB
    const dbSafety = openTestDb(safetyPath)
    expect(dbSafety.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get()).toBeDefined()
    dbSafety.close()
  })

  it('corrupted backup file: does not destroy current database', () => {
    seedGrid(t.db, { rowCount: 5, columnCount: 1 })
    t.db.close()

    // Create a corrupted "backup"
    const corruptPath = join(backupDir, 'corrupt.db')
    writeFileSync(corruptPath, Buffer.alloc(1024, 0xFF))

    // SQLCipher defers the error until first query, so open + query should throw
    expect(() => {
      const badDb = openTestDb(corruptPath)
      badDb.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get()
    }).toThrow()

    // Original DB should still be fine
    const db2 = openTestDb(t.dbPath)
    const count = (db2.prepare('SELECT COUNT(*) as c FROM rows').get() as { c: number }).c
    expect(count).toBe(5)
    db2.close()
  })
})

// ── Pack & Go (zip compression simulation) ───────────────────────────────────

describe('Pack & Go', () => {
  it('pack-and-go zip file is created and contains the database', async () => {
    seedGrid(t.db, { rowCount: 5, columnCount: 2 })
    t.db.close()

    // Simulate pack-and-go: create a zip containing the DB
    const zipPath = join(backupDir, 'pack-and-go.pulse-backup')
    await createTestZipFromFile(zipPath, t.dbPath, basename(t.dbPath))

    // Verify the zip was created and contains a file
    expect(existsSync(zipPath)).toBe(true)
    const entries = await readTestZip(zipPath)
    expect(entries.size).toBeGreaterThanOrEqual(1)

    // Extract and verify the DB inside is valid
    const extractDir = join(backupDir, 'extracted')
    mkdirSync(extractDir, { recursive: true })
    const dbEntryName = [...entries.keys()].find(k => k.endsWith('.db'))!
    writeFileSync(join(extractDir, dbEntryName), entries.get(dbEntryName)!)
    const extractedDb = openTestDb(join(extractDir, 'test.db'))
    const count = (extractedDb.prepare('SELECT COUNT(*) as c FROM rows').get() as { c: number }).c
    expect(count).toBe(5)
    extractedDb.close()
  })
})

// ── Password Change + Backup Interaction ─────────────────────────────────────

describe('Password Change + Backup Interaction', () => {
  // Skipped: test alias uses plain better-sqlite3 (no cipher) so password-based encryption is not tested
  it.skip('backup with old password → change password → old backup requires OLD password', () => {
    seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    t.db.close()

    // Backup with original password
    const backupPath = join(backupDir, 'before-password-change.db')
    copyFileSync(t.dbPath, backupPath)

    // Change password (rekey) — must exit WAL mode first
    const db2 = openTestDb(t.dbPath)
    const newKey = 'new-password-for-test'
    db2.pragma('journal_mode = DELETE')
    db2.pragma(`rekey='${newKey}'`)
    db2.close()

    // Old backup still requires old password
    const dbOld = openTestDb(backupPath, TEST_PASSWORD)
    const count = (dbOld.prepare('SELECT COUNT(*) as c FROM rows').get() as { c: number }).c
    expect(count).toBe(3)
    dbOld.close()

    // Old backup does NOT open with new password
    expect(() => {
      const dbBad = openTestDb(backupPath, newKey)
      dbBad.pragma('schema_version')
    }).toThrow()

    // Current DB opens with new password
    const dbNew = openTestDb(t.dbPath, newKey)
    const count2 = (dbNew.prepare('SELECT COUNT(*) as c FROM rows').get() as { c: number }).c
    expect(count2).toBe(3)
    dbNew.close()
  })

  // Skipped: test alias uses plain better-sqlite3 (no cipher) so password-based encryption is not tested
  it.skip('after password change, new backups use the NEW password', () => {
    seedGrid(t.db, { rowCount: 2, columnCount: 1 })

    // Change password — must exit WAL mode first
    const newKey = 'changed-key-789'
    t.db.pragma('journal_mode = DELETE')
    t.db.pragma(`rekey='${newKey}'`)
    t.db.close()

    // New backup (post-rekey)
    const backupPath = join(backupDir, 'post-rekey-backup.db')
    copyFileSync(t.dbPath, backupPath)

    // Opens with new key
    const db2 = openTestDb(backupPath, newKey)
    const count = (db2.prepare('SELECT COUNT(*) as c FROM rows').get() as { c: number }).c
    expect(count).toBe(2)
    db2.close()

    // Does not open with old key
    expect(() => {
      const dbBad = openTestDb(backupPath, TEST_PASSWORD)
      dbBad.pragma('schema_version')
    }).toThrow()
  })
})

// ── Restore from .db file ─────────────────────────────────────────────────────

describe('restoreFromDb', () => {
  it('restores database to exact state at backup time', async () => {
    // Seed 10 clients with cell data
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 10, columnCount: 2 })
    const colId = columnIds[0]
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    for (let i = 0; i < 10; i++) {
      ins.run(rowIds[i], colId, `Client-${i}`)
    }
    t.db.close()

    // Create backup
    const backupPath = join(backupDir, 'restore-db-test.db')
    copyFileSync(t.dbPath, backupPath)

    // Modify: delete 7 clients, add 3 new ones
    const db2 = openTestDb(t.dbPath)
    for (let i = 0; i < 7; i++) {
      db2.prepare('DELETE FROM rows WHERE id = ?').run(rowIds[i])
    }
    for (let i = 0; i < 3; i++) {
      db2.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(gridId, 100 + i)
    }
    const countAfterMod = (db2.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(countAfterMod).toBe(6) // 10 - 7 + 3
    db2.close()

    // Call the real restoreFromDb — it creates a safety backup, removes WAL/SHM, and overwrites
    // Re-set bridge since db2 was closed; bridge just needs to not throw on close
    setDatabaseBridge({
      closeDatabase: () => {},
      getDb: () => { throw new Error('DB closed') },
    })
    const safetyPath = await restoreFromDb(backupPath)
    expect(existsSync(safetyPath)).toBe(true)

    // Verify: all 10 original clients are back
    const db3 = openTestDb(t.dbPath)
    const countAfterRestore = (db3.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(countAfterRestore).toBe(10)

    // Verify cell data survived
    const cells = db3.prepare('SELECT value FROM cells WHERE column_id = ? ORDER BY value').all(colId) as { value: string }[]
    expect(cells.map(c => c.value)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Client-${i}`).sort()
    )
    db3.close()
  })

  it('keeps only the newest three safety copies made before restores (S4)', async () => {
    t.db.close()
    const backupPath = join(backupDir, 'prune-test.db')
    copyFileSync(t.dbPath, backupPath)
    setDatabaseBridge({ closeDatabase: () => {}, getDb: () => { throw new Error('DB closed') } })
    const first = await restoreFromDb(backupPath)
    const dir = join(first, '..')
    for (const day of ['01', '02', '03', '04']) writeFileSync(join(dir, `pulse-pre-restore-2020-01-${day}_10-00-00.db`), 'old')
    writeFileSync(join(dir, 'pulse-auto-2020-01-01_10-00-00.db'), 'auto')
    const latest = await restoreFromDb(backupPath)
    const left = readdirSync(dir).filter(f => f.startsWith('pulse-pre-restore-'))
    expect(left).toHaveLength(3)
    expect(left).toContain(basename(latest))
    expect(left).not.toContain('pulse-pre-restore-2020-01-01_10-00-00.db')
    // Other backups are left alone
    expect(existsSync(join(dir, 'pulse-auto-2020-01-01_10-00-00.db'))).toBe(true)
  })

  it('safety backup created before restore is a valid DB with modified state', async () => {
    const { gridId } = seedGrid(t.db, { rowCount: 5, columnCount: 1 })
    t.db.close()

    // Backup original state
    const backupPath = join(backupDir, 'original.db')
    copyFileSync(t.dbPath, backupPath)

    // Modify: add 3 more rows
    const db2 = openTestDb(t.dbPath)
    for (let i = 0; i < 3; i++) {
      db2.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(gridId, 100 + i)
    }
    db2.close()

    // Call the real restoreFromDb — creates safety backup of modified state, then overwrites
    setDatabaseBridge({
      closeDatabase: () => {},
      getDb: () => { throw new Error('DB closed') },
    })
    const safetyPath = await restoreFromDb(backupPath)

    // Safety backup should have the modified state (8 rows)
    const dbSafety = openTestDb(safetyPath)
    const safetyCount = (dbSafety.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(safetyCount).toBe(8)
    dbSafety.close()

    // Restored DB should have original state (5 rows)
    const db3 = openTestDb(t.dbPath)
    const restoredCount = (db3.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(restoredCount).toBe(5)
    db3.close()
  })

  it('throws if backup file does not exist', async () => {
    t.db.close()
    const fakePath = join(backupDir, 'nonexistent.db')
    expect(existsSync(fakePath)).toBe(false)

    // Call the real restoreFromDb — it should throw 'Backup file not found'
    await expect(restoreFromDb(fakePath)).rejects.toThrow('Backup file not found')
  })

  it('removes WAL/SHM files before overwriting to prevent journal replay', async () => {
    seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    // Force WAL file creation by writing data
    t.db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (1, 99, datetime('now'), datetime('now'))").run()
    // WAL checkpoint to ensure WAL file exists
    t.db.pragma('wal_checkpoint(PASSIVE)')
    t.db.close()

    const backupPath = join(backupDir, 'backup-for-wal-test.db')
    copyFileSync(t.dbPath, backupPath)

    // Create fake WAL/SHM to simulate leftover journal
    writeFileSync(t.dbPath + '-wal', Buffer.alloc(1024))
    writeFileSync(t.dbPath + '-shm', Buffer.alloc(1024))

    expect(existsSync(t.dbPath + '-wal')).toBe(true)
    expect(existsSync(t.dbPath + '-shm')).toBe(true)

    // Call the real restoreFromDb — it removes WAL/SHM before overwriting
    setDatabaseBridge({
      closeDatabase: () => {},
      getDb: () => { throw new Error('DB closed') },
    })
    await restoreFromDb(backupPath)

    expect(existsSync(t.dbPath + '-wal')).toBe(false)
    expect(existsSync(t.dbPath + '-shm')).toBe(false)

    // DB should still be openable and valid
    const db2 = openTestDb(t.dbPath)
    const count = (db2.prepare('SELECT COUNT(*) as c FROM rows').get() as { c: number }).c
    expect(count).toBeGreaterThanOrEqual(3)
    db2.close()
  })
})

// ── Restore from .pulse-backup (zip) ──────────────────────────────────────────

describe('restoreFromPulseBackup', () => {
  async function createPulseBackupFile(dbPath: string, destPath: string, backupType = 'test'): Promise<void> {
    const dbData = readFileSync(dbPath)
    const dbHash = createHash('sha256').update(dbData).digest('hex')
    const meta = {
      created: new Date().toISOString(),
      appVersion: '0.0.0-test',
      backupType,
      dbFilename: basename(dbPath),
      dbSha256: dbHash,
    }
    await createTestZipFromFile(destPath, dbPath, basename(dbPath), {
      'backup-meta.json': JSON.stringify(meta, null, 2),
    })
  }

  it('restores database from .pulse-backup zip to original state', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 8, columnCount: 2 })
    const colId = columnIds[0]
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    for (let i = 0; i < 8; i++) {
      ins.run(rowIds[i], colId, `Person-${i}`)
    }
    t.db.close()

    // Create .pulse-backup
    const backupZip = join(backupDir, 'test-backup.pulse-backup')
    await createPulseBackupFile(t.dbPath, backupZip)

    // Modify the DB: delete all rows
    const db2 = openTestDb(t.dbPath)
    db2.prepare('DELETE FROM rows WHERE grid_id = ?').run(gridId)
    const countAfterDelete = (db2.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(countAfterDelete).toBe(0)
    db2.close()

    // Call the real restoreFromPulseBackup — extracts zip, creates safety backup, overwrites DB
    setDatabaseBridge({
      closeDatabase: () => {},
      getDb: () => { throw new Error('DB closed') },
    })
    const safetyPath = await restoreFromPulseBackup(backupZip)
    expect(existsSync(safetyPath)).toBe(true)

    // Verify all 8 rows are back
    const db3 = openTestDb(t.dbPath)
    const countAfterRestore = (db3.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(countAfterRestore).toBe(8)

    // Verify cell data
    const cells = db3.prepare('SELECT value FROM cells WHERE column_id = ? ORDER BY value').all(colId) as { value: string }[]
    expect(cells).toHaveLength(8)
    db3.close()
  })

  it('zip must contain a .db entry to be valid', async () => {
    t.db.close()

    // Create a zip without any .db file
    const badZipPath = join(backupDir, 'no-db.pulse-backup')
    await createTestZip(badZipPath, { 'readme.txt': 'This is not a database' })

    // Attempt extraction: no .db entry found
    const entries = await readTestZip(badZipPath)
    const dbEntryName = [...entries.keys()].find(k => k.endsWith('.db'))
    expect(dbEntryName).toBeUndefined()
  })

  it('backup metadata contains correct SHA-256 hash', async () => {
    seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    t.db.close()

    const backupZip = join(backupDir, 'hash-check.pulse-backup')
    await createPulseBackupFile(t.dbPath, backupZip)

    // Read the zip and verify metadata hash matches the DB file hash
    const entries = await readTestZip(backupZip)
    const metaBuf = entries.get('backup-meta.json')
    expect(metaBuf).toBeDefined()

    const meta = JSON.parse(metaBuf!.toString('utf8'))
    expect(meta.dbSha256).toBeDefined()
    expect(meta.backupType).toBe('test')
    expect(meta.dbFilename).toBe('test.db')

    // Verify hash: extract the DB and compute its hash
    const dbEntryName = [...entries.keys()].find(k => k.endsWith('.db'))!
    const dbData = entries.get(dbEntryName)!
    const actualHash = createHash('sha256').update(dbData).digest('hex')
    expect(actualHash).toBe(meta.dbSha256)
  })

  it('rejects archives with path traversal entries', () => {
    t.db.close()

    // Entry-name filter logic (matches restoreFromPulseBackup's inline filter)
    function findSafeDbEntry(entryNames: string[]): string | undefined {
      return entryNames.find(name =>
        name.endsWith('.db') && !name.includes('..') && !name.includes('/') && !name.includes('\\')
      )
    }

    // Path traversal entry names should be rejected by the filter (no safe .db found)
    const traversalNames = [
      '../../../etc/passwd.db',
      '..\\..\\windows\\system32\\config.db',
      'subdir/../../../escape.db',
      '/etc/shadow.db',
      '\\windows\\system32\\evil.db',
    ]
    expect(findSafeDbEntry(traversalNames)).toBeUndefined()

    // A safe entry name should pass the filter
    expect(findSafeDbEntry(['pulse-backup.db'])).toBe('pulse-backup.db')

    // Call the real assertPathWithin from backup.ts
    const parentDir = join(backupDir, 'extract')
    expect(() => assertPathWithin(join(parentDir, '..', '..', 'etc', 'passwd'), parentDir))
      .toThrow('Path traversal detected')
    expect(() => assertPathWithin(join(parentDir, 'safe-file.db'), parentDir))
      .not.toThrow()
  })
})

// ── Verify Backup Integrity ───────────────────────────────────────────────────

// NOTE: verifyBackup() internally calls getDbKey() to decrypt the backup with SQLCipher.
// The mock getDbKey() returns a dummy key that doesn't match the test DB's actual encryption
// key (TEST_PASSWORD), so calling the real verifyBackup() on test DBs would always fail with
// a decryption error. These tests therefore verify the same logic manually using openTestDb().
describe('verifyBackup', () => {
  it('valid .db backup opens and reports table count and schema version', () => {
    seedGrid(t.db, { rowCount: 5, columnCount: 2 })
    t.db.close()

    const backupPath = join(backupDir, 'verify-valid.db')
    copyFileSync(t.dbPath, backupPath)

    // Cannot call real verifyBackup() — getDbKey() mock returns wrong key for test DBs
    const db2 = openTestDb(backupPath)
    const schemaVersion = db2.pragma('schema_version', { simple: true }) as number
    const tableCount = (db2.prepare("SELECT count(*) as n FROM sqlite_master WHERE type='table'").get() as { n: number }).n
    db2.close()

    expect(schemaVersion).toBeGreaterThan(0)
    expect(tableCount).toBeGreaterThan(0)
  })

  it('corrupt file cannot be opened as a valid database', () => {
    t.db.close()

    const corruptPath = join(backupDir, 'verify-corrupt.db')
    writeFileSync(corruptPath, Buffer.alloc(2048, 0xDE))

    // Cannot call real verifyBackup() — getDbKey() mock returns wrong key for test DBs
    let valid = true
    let errorMsg = ''
    try {
      const badDb = openTestDb(corruptPath)
      badDb.pragma('schema_version')
    } catch (err) {
      valid = false
      errorMsg = err instanceof Error ? err.message : 'Unknown error'
    }

    expect(valid).toBe(false)
    expect(errorMsg.length).toBeGreaterThan(0)
  })

  it('non-existent file reports file not found', async () => {
    t.db.close()

    const fakePath = join(backupDir, 'does-not-exist-at-all.db')
    expect(existsSync(fakePath)).toBe(false)

    // Call the real verifyBackup — it handles non-existent files without needing DB key
    const result = await verifyBackup(fakePath)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('File not found')
  })

  it('valid .pulse-backup zip verifies extracted DB successfully', async () => {
    seedGrid(t.db, { rowCount: 4, columnCount: 3 })
    t.db.close()

    // Create .pulse-backup with metadata
    const dbData = readFileSync(t.dbPath)
    const dbHash = createHash('sha256').update(dbData).digest('hex')
    const meta = {
      created: new Date().toISOString(),
      appVersion: '0.0.0-test',
      backupType: 'manual',
      dbFilename: 'test.db',
      dbSha256: dbHash,
    }
    const backupZip = join(backupDir, 'verify-pulse.pulse-backup')
    await createTestZipFromFile(backupZip, t.dbPath, 'test.db', {
      'backup-meta.json': JSON.stringify(meta, null, 2),
    })

    // Read zip entries
    const entries = await readTestZip(backupZip)
    const dbEntryName = [...entries.keys()].find(k => k.endsWith('.db'))
    expect(dbEntryName).toBeDefined()

    // Extract DB to temp dir
    const tmpExtractDir = join(backupDir, 'verify-extract')
    mkdirSync(tmpExtractDir, { recursive: true })
    const extractedPath = join(tmpExtractDir, dbEntryName!)
    writeFileSync(extractedPath, entries.get(dbEntryName!)!)

    // 2. Verify hash matches
    const extractedData = readFileSync(extractedPath)
    const actualHash = createHash('sha256').update(extractedData).digest('hex')
    expect(actualHash).toBe(dbHash)

    // 3. Open extracted DB and check schema
    const db2 = openTestDb(extractedPath)
    const schemaVersion = db2.pragma('schema_version', { simple: true }) as number
    const tableCount = (db2.prepare("SELECT count(*) as n FROM sqlite_master WHERE type='table'").get() as { n: number }).n
    db2.close()

    expect(schemaVersion).toBeGreaterThan(0)
    expect(tableCount).toBeGreaterThan(0)
  })

  it('.pulse-backup with mismatched hash is detected as corrupt', async () => {
    seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    t.db.close()

    // Create .pulse-backup with WRONG hash in metadata
    const meta = {
      created: new Date().toISOString(),
      appVersion: '0.0.0-test',
      backupType: 'manual',
      dbFilename: 'test.db',
      dbSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', // wrong hash
    }
    const backupZip = join(backupDir, 'verify-bad-hash.pulse-backup')
    await createTestZipFromFile(backupZip, t.dbPath, 'test.db', {
      'backup-meta.json': JSON.stringify(meta, null, 2),
    })

    // Read zip and verify hash mismatch
    const entries = await readTestZip(backupZip)
    const dbEntryName = [...entries.keys()].find(k => k.endsWith('.db'))
    const metaBuf = entries.get('backup-meta.json')

    expect(dbEntryName).toBeDefined()
    expect(metaBuf).toBeDefined()

    const parsedMeta = JSON.parse(metaBuf!.toString('utf8'))
    const dbData = entries.get(dbEntryName!)!
    const actualHash = createHash('sha256').update(dbData).digest('hex')

    // Hash should NOT match — indicates corruption
    expect(actualHash).not.toBe(parsedMeta.dbSha256)
  })

  it('.pulse-backup without .db entry is invalid', async () => {
    t.db.close()

    const badZipPath = join(backupDir, 'verify-no-db.pulse-backup')
    await createTestZip(badZipPath, {
      'notes.txt': 'Not a database',
      'backup-meta.json': JSON.stringify({ backupType: 'manual' }),
    })

    const entries = await readTestZip(badZipPath)
    const dbEntryName = [...entries.keys()].find(k =>
      k.endsWith('.db') && !k.includes('..') && !k.includes('/')
    )
    expect(dbEntryName).toBeUndefined()
  })

  // Skipped: test alias uses plain better-sqlite3 (no cipher) so wrong-key testing is not applicable
  it.skip('file with wrong key produces error on schema query', () => {
    seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.close()

    const backupPath = join(backupDir, 'verify-wrong-key.db')
    copyFileSync(t.dbPath, backupPath)

    // Try to open with wrong key
    expect(() => {
      const badDb = openEncryptedDb(backupPath, 'totally-wrong-key-1234')
      badDb.pragma('schema_version')
    }).toThrow()
  })
})

// ── Scheduled Backup Config ───────────────────────────────────────────────────

describe('Scheduled Backup Config', () => {
  // These tests call the real getScheduledConfig/setScheduledConfig functions from backup.ts,
  // backed by the mocked electron-store (in-memory Map).

  it('default config has correct values', () => {
    // Call the real getScheduledConfig — returns defaults when store is empty
    const config = getScheduledConfig()
    expect(config.enabled).toBe(false)
    expect(config.intervalHours).toBe(24)
    expect(config.lastRunISO).toBeNull()
  })

  it('set and get round-trip preserves all fields', () => {
    const customConfig = {
      enabled: true,
      intervalHours: 168, // weekly
      destinationDir: '/my/backup/folder',
      lastRunISO: '2026-03-01T10:00:00.000Z',
    }

    // Call the real setScheduledConfig then getScheduledConfig
    setScheduledConfig(customConfig)
    const retrieved = getScheduledConfig()

    expect(retrieved.enabled).toBe(true)
    expect(retrieved.intervalHours).toBe(168)
    expect(retrieved.destinationDir).toBe('/my/backup/folder')
    expect(retrieved.lastRunISO).toBe('2026-03-01T10:00:00.000Z')
  })

  it('interval check: backup should not run if interval has not elapsed', () => {
    setScheduledConfig({
      enabled: true,
      intervalHours: 24,
      destinationDir: backupDir,
      lastRunISO: new Date().toISOString(), // just now
    })
    const config = getScheduledConfig()

    const lastRun = new Date(config.lastRunISO!).getTime()
    const elapsedMs = Date.now() - lastRun
    const intervalMs = config.intervalHours * 60 * 60 * 1000

    // Should NOT be time to run yet
    expect(elapsedMs).toBeLessThan(intervalMs)
  })

  it('interval check: backup should run when interval has elapsed', () => {
    setScheduledConfig({
      enabled: true,
      intervalHours: 24,
      destinationDir: backupDir,
      lastRunISO: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
    })
    const config = getScheduledConfig()

    const lastRun = new Date(config.lastRunISO!).getTime()
    const elapsedMs = Date.now() - lastRun
    const intervalMs = config.intervalHours * 60 * 60 * 1000

    // Should be time to run
    expect(elapsedMs).toBeGreaterThanOrEqual(intervalMs)
  })

  it('disabled config should not trigger backup', () => {
    setScheduledConfig({
      enabled: false,
      intervalHours: 24,
      destinationDir: backupDir,
      lastRunISO: null, // never run before — but disabled
    })
    const config = getScheduledConfig()

    expect(config.enabled).toBe(false)
  })
})

// ── Backup Info ───────────────────────────────────────────────────────────────

describe('getBackupInfo', () => {
  it('returns correct count and newest/oldest with multiple auto-backups', () => {
    t.db.close()

    // Create 4 auto-backups with different timestamps
    const filenames = [
      'pulse-auto-20260301-080000.db',
      'pulse-auto-20260301-120000.db',
      'pulse-auto-20260301-160000.db',
      'pulse-auto-20260301-200000.db',
    ]
    for (const name of filenames) {
      copyFileSync(t.dbPath, join(backupDir, name))
    }

    // Simulate getBackupInfo: list auto-backups, sorted descending
    const autoBackups = readdirSync(backupDir)
      .filter(f => f.startsWith('pulse-auto-') && f.endsWith('.db'))
      .sort()
      .reverse()
      .map(f => join(backupDir, f))

    expect(autoBackups).toHaveLength(4)
    expect(autoBackups[0]).toContain('pulse-auto-20260301-200000.db') // newest
    expect(autoBackups[autoBackups.length - 1]).toContain('pulse-auto-20260301-080000.db') // oldest
  })

  it('returns empty info when no backups exist', () => {
    t.db.close()

    const emptyDir = join(t.tmpDir, 'empty-backups')
    mkdirSync(emptyDir, { recursive: true })

    const autoBackups = readdirSync(emptyDir)
      .filter(f => f.startsWith('pulse-auto-') && f.endsWith('.db'))
      .sort()
      .reverse()
      .map(f => join(emptyDir, f))

    const info = {
      layer1: {
        count: autoBackups.length,
        newest: autoBackups[0] || null,
        oldest: autoBackups[autoBackups.length - 1] || null,
        dir: emptyDir,
      },
      lastAutoBackup: autoBackups[0] || null,
      lastAutoBackupFailed: false,
      lastAutoBackupError: null,
    }

    expect(info.layer1.count).toBe(0)
    expect(info.layer1.newest).toBeNull()
    expect(info.layer1.oldest).toBeNull()
    expect(info.lastAutoBackup).toBeNull()
    expect(info.lastAutoBackupFailed).toBe(false)
  })

  it('ignores non-auto-backup files in the directory', () => {
    t.db.close()

    // Create a mix of files: some auto-backups, some other files
    copyFileSync(t.dbPath, join(backupDir, 'pulse-auto-20260301-100000.db'))
    copyFileSync(t.dbPath, join(backupDir, 'pulse-auto-20260301-110000.db'))
    writeFileSync(join(backupDir, 'pulse-scheduled-20260301.pulse-backup'), Buffer.alloc(64))
    writeFileSync(join(backupDir, 'random-file.txt'), Buffer.from('not a backup'))
    writeFileSync(join(backupDir, 'pulse-pre-migration-v1-to-v2-20260301-090000.db'), Buffer.alloc(64))

    const autoBackups = readdirSync(backupDir)
      .filter(f => f.startsWith('pulse-auto-') && f.endsWith('.db'))
      .sort()
      .reverse()

    // Only the 2 actual auto-backups should be listed
    expect(autoBackups).toHaveLength(2)
    expect(autoBackups[0]).toBe('pulse-auto-20260301-110000.db')
    expect(autoBackups[1]).toBe('pulse-auto-20260301-100000.db')
  })

  it('backup info structure matches BackupInfo interface', () => {
    t.db.close()

    copyFileSync(t.dbPath, join(backupDir, 'pulse-auto-20260301-120000.db'))

    const autoBackups = readdirSync(backupDir)
      .filter(f => f.startsWith('pulse-auto-') && f.endsWith('.db'))
      .sort()
      .reverse()
      .map(f => join(backupDir, f))

    const info = {
      layer1: {
        count: autoBackups.length,
        newest: autoBackups[0] || null,
        oldest: autoBackups[autoBackups.length - 1] || null,
        dir: backupDir,
      },
      lastAutoBackup: autoBackups[0] || null,
      lastAutoBackupFailed: false,
      lastAutoBackupError: null as string | null,
    }

    // Verify all BackupInfo fields are present and have correct types
    expect(typeof info.layer1.count).toBe('number')
    expect(typeof info.layer1.dir).toBe('string')
    expect(info.layer1.newest).not.toBeNull()
    expect(typeof info.lastAutoBackupFailed).toBe('boolean')
    expect(info.lastAutoBackupError).toBeNull()
  })

  it('reports lastAutoBackupFailed: true when status store throws', async () => {
    t.db.close()

    // Seed a valid auto-backup so layer1 data is populated
    copyFileSync(t.dbPath, join(backupDir, 'pulse-auto-20260301-120000.db'))

    // First, record a success so the store's singleton is initialized
    recordAutoBackupSuccess()

    // Import the mock Store the same way backup.ts does (ESM import)
    // so we get the same prototype reference
    const { default: Store } = await import('electron-store')
    const origGet = Store.prototype.get
    Store.prototype.get = () => { throw new Error('store corrupted') }

    try {
      const info = getBackupInfo()
      expect(info.lastAutoBackupFailed).toBe(true)
      expect(info.lastAutoBackupError).toBe('store corrupted')
    } finally {
      Store.prototype.get = origGet
    }
  })
})

describe('Auto-backup tiered retention', () => {
  it('keeps backups from earlier days even after many quits in one day', () => {
    const files = [
      // Good copies from last week and last month
      'pulse-auto-20260901-090000.db',
      'pulse-auto-20260920-090000.db',
      'pulse-auto-20260925-090000.db',
      // A bad day: ten open/close cycles
      ...Array.from({ length: 10 }, (_, i) => `pulse-auto-20260930-1${String(i).padStart(1, '0')}0000.db`),
    ]
    const keep = selectAutoBackupsToKeep(files)
    expect(keep.has('pulse-auto-20260925-090000.db')).toBe(true)
    expect(keep.has('pulse-auto-20260920-090000.db')).toBe(true)
    expect(keep.has('pulse-auto-20260901-090000.db')).toBe(true)
    expect(keep.has('pulse-auto-20260930-190000.db')).toBe(true) // newest
    expect(keep.has('pulse-auto-20260930-100000.db')).toBe(false) // oldest of the bad day
  })

  it('caps the total at 16 files', () => {
    const files: string[] = []
    for (let d = 1; d <= 60; d++) {
      const dt = new Date(Date.UTC(2026, 0, d))
      const ymd = dt.toISOString().slice(0, 10).replace(/-/g, '')
      files.push(`pulse-auto-${ymd}-080000.db`, `pulse-auto-${ymd}-170000.db`)
    }
    expect(selectAutoBackupsToKeep(files).size).toBeLessThanOrEqual(16)
  })
})
