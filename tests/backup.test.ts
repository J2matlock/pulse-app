/**
 * Backup & Restore Tests — every test drives the real backup.ts functions
 * (runAutoBackup, runManualBackup, checkAndRunScheduled, restoreFromDb,
 * restoreFromPulseBackup, verifyBackup, getBackupInfo, ...) against real
 * SQLCipher databases in temp folders. Only Electron, electron-store, the auth
 * module (DB path + key) and the database module (data folder) are mocked.
 *
 * The live database handed to backup.ts through setDatabaseBridge is the test
 * database itself, so the snapshot paths (checkpoint + copy for auto-backups,
 * VACUUM INTO for .pulse-backup files) run for real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename, dirname } from 'path'
import { createHash } from 'crypto'
import type { Database } from 'better-sqlite3'
import {
  createTestDb,
  cleanupTestDb,
  openEncryptedDb,
  seedGrid,
  TEST_PASSWORD,
  type TestDb,
} from './helpers'
import { PROD_TEST_KEY_HEX, createProdFormatDb, writeZip, writeZipWithRawNames, readZip, countRows } from './backupTestUtils'
import { allMigrations } from './helpers'

let t: TestDb
let backupDir: string

const storeState = vi.hoisted(() => ({ stores: new Map<string, Record<string, unknown>>() }))

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

// In-memory electron-store. Methods live on the prototype so a test can make the
// store throw (simulating a corrupt status file).
vi.mock('electron-store', () => {
  class MockStore {
    _data: Record<string, unknown>
    constructor(opts?: { name?: string }) {
      const key = opts?.name ?? 'default'
      let data = storeState.stores.get(key)
      if (!data) { data = {}; storeState.stores.set(key, data) }
      this._data = data
    }
    get(k: string, def?: unknown): unknown { return this._data[k] ?? def }
    set(k: string, v: unknown): void { this._data[k] = v }
  }
  return { default: MockStore }
})

// The DB path follows the current test; the DB key is a fixed production-format key
vi.mock('../src/main/auth', () => ({
  getStoredDbPath: () => _currentDbPath,
  getDbKey: () => Buffer.from(PROD_TEST_KEY_HEX, 'hex'),
  getKeyEnvelope: () => null,
  isValidKeyEnvelope: () => false,
  unwrapKeyEnvelope: async () => { throw new Error('Incorrect password or recovery key') },
  adoptRestoredDbKey: async () => {},
}))

// Same as database.ts setEncryptionKey (importing database.ts here would create a
// require cycle with backup.ts)
vi.mock('../src/main/database', () => ({
  getPortableDataDir: () => _currentTmpDir,
  setEncryptionKey: (db: { pragma: (s: string) => unknown }, hexKey: string) => {
    if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error('Invalid database key format')
    db.pragma(`key='${hexKey}'`)
  },
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

let _currentDbPath: string
let _currentTmpDir: string

import {
  pruneBackups,
  selectAutoBackupsToKeep,
  assertPathWithin,
  verifyBackup,
  restoreFromDb,
  restoreFromPulseBackup,
  runAutoBackup,
  runManualBackup,
  checkAndRunScheduled,
  setDatabaseBridge,
  getScheduledConfig,
  setScheduledConfig,
  getBackupInfo,
  recordAutoBackupSuccess,
  type DatabaseBridge,
} from '../src/main/backup'

const LATEST_SCHEMA = allMigrations[allMigrations.length - 1]?.version ?? 0

function useLiveDbBridge(): void {
  setDatabaseBridge({
    closeDatabase: () => { try { t.db.close() } catch { /* already closed */ } },
    getDb: () => t.db,
  })
}

beforeEach(() => {
  for (const data of storeState.stores.values()) for (const k of Object.keys(data)) delete data[k]
  t = createTestDb()
  backupDir = join(t.tmpDir, 'backups')
  mkdirSync(backupDir, { recursive: true })
  _currentDbPath = t.dbPath
  _currentTmpDir = t.tmpDir
  useLiveDbBridge()
})

afterEach(() => {
  vi.useRealTimers()
  cleanupTestDb(t)
})

function openTestDb(path: string, key = TEST_PASSWORD): Database {
  return openEncryptedDb(path, key)
}

const autoFiles = (): string[] => readdirSync(backupDir).filter(f => f.startsWith('pulse-auto-') && f.endsWith('.db'))

/** A production-format, fully migrated database outside the live test DB, closed and ready to verify */
function makeProdFormatBackupDb(name: string, rowCount = 3, hexKey = PROD_TEST_KEY_HEX): string {
  const p = join(t.tmpDir, name)
  const db = createProdFormatDb(p, { hexKey })
  seedGrid(db, { rowCount, columnCount: 2 })
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()
  return p
}

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

// ── Layer 1: auto-backup ─────────────────────────────────────────────────────

describe('runAutoBackup', () => {
  it('writes a timestamped pulse-auto file that opens with the key and holds every row', async () => {
    const { gridId } = seedGrid(t.db, { rowCount: 5, columnCount: 3 })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 1, 22, 12, 0, 0))

    await runAutoBackup()

    expect(autoFiles()).toEqual(['pulse-auto-20260222-120000.db'])
    const db2 = openTestDb(join(backupDir, 'pulse-auto-20260222-120000.db'))
    expect(countRows(db2, 'rows', 'grid_id = ?', gridId)).toBe(5)
    db2.close()
  })

  it('includes changes still sitting in the WAL (it checkpoints before copying)', async () => {
    const { gridId } = seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    t.db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, 50, datetime('now'), datetime('now'))").run(gridId)
    expect(existsSync(t.dbPath + '-wal')).toBe(true)

    await runAutoBackup()

    const [file] = autoFiles()
    const db2 = openTestDb(join(backupDir, file ?? 'missing'))
    expect(countRows(db2, 'rows', 'grid_id = ?', gridId)).toBe(3)
    db2.close()
  })

  it('writes an encrypted file (no SQLite header, no plaintext values)', async () => {
    const { rowIds, columnIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], 'PLAINTEXT_MARKER_VALUE')

    await runAutoBackup()

    const raw = readFileSync(join(backupDir, autoFiles()[0] ?? 'missing'))
    expect(raw.subarray(0, 16).toString('latin1')).not.toContain('SQLite format 3')
    expect(raw.toString('latin1')).not.toContain('PLAINTEXT_MARKER_VALUE')
  })

  it('prunes old auto-backups with the tiered rule and records success', async () => {
    const old = Array.from({ length: 20 }, (_, i) => `pulse-auto-202601${String(i + 1).padStart(2, '0')}-080000.db`)
    for (const f of old) writeFileSync(join(backupDir, f), 'old copy')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 1, 22, 12, 0, 0))

    await runAutoBackup()

    const expected = selectAutoBackupsToKeep([...old, 'pulse-auto-20260222-120000.db'])
    expect(new Set(autoFiles())).toEqual(expected)
    expect(autoFiles()).toContain('pulse-auto-20260222-120000.db')
    const info = getBackupInfo()
    expect(info.lastAutoBackupFailed).toBe(false)
    expect(info.layer1.newest).toBe(join(backupDir, 'pulse-auto-20260222-120000.db'))
  })

  it('does nothing when there is no database file yet', async () => {
    _currentDbPath = join(t.tmpDir, 'not-created-yet.db')
    await runAutoBackup()
    expect(autoFiles()).toEqual([])
  })

  it('fails cleanly when the WAL checkpoint throws: no partial file, failure recorded, lock released', async () => {
    seedGrid(t.db, { rowCount: 5, columnCount: 3 })
    const calls: string[] = []
    const throwingDb: DatabaseBridge = {
      pragma: (sql: string) => {
        calls.push(sql)
        if (sql.includes('wal_checkpoint')) throw new Error('checkpoint failed: database is locked')
        return t.db.pragma(sql)
      },
      exec: (sql: string) => t.db.exec(sql),
    }
    setDatabaseBridge({ closeDatabase: () => {}, getDb: () => throwingDb })

    await expect(runAutoBackup()).rejects.toThrow('checkpoint failed')

    expect(autoFiles()).toEqual([])
    expect(readdirSync(backupDir).filter(f => f.startsWith('pulse-snapshot-'))).toEqual([])
    const info = getBackupInfo()
    expect(info.lastAutoBackupFailed).toBe(true)
    expect(info.lastAutoBackupError).toMatch(/couldn't be saved/)
    // The exclusive lock taken for the snapshot is always released
    expect(calls.slice(calls.indexOf('wal_checkpoint(TRUNCATE)'))).toEqual(['wal_checkpoint(TRUNCATE)', 'locking_mode=NORMAL', 'journal_mode'])
    // ...so the live database still accepts writes
    expect(() => t.db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (1, 99, datetime('now'), datetime('now'))").run()).not.toThrow()
  })
})

// ── Layer 3: manual backup (.pulse-backup) ───────────────────────────────────

describe('runManualBackup', () => {
  it('writes a .pulse-backup holding the database and matching metadata', async () => {
    const { gridId } = seedGrid(t.db, { rowCount: 10, columnCount: 2 })
    const dest = join(t.tmpDir, 'usb', 'my-backup')

    const { destPath, sizeBytes } = await runManualBackup(dest)

    expect(destPath).toBe(dest + '.pulse-backup')
    expect(sizeBytes).toBeGreaterThan(0)
    const entries = await readZip(destPath)
    expect([...entries.keys()].sort()).toEqual(['backup-meta.json', 'test.db'])
    const meta = JSON.parse(entries.get('backup-meta.json')?.toString('utf8') ?? '{}')
    expect(meta).toMatchObject({ backupType: 'manual', appVersion: '0.0.0-test', dbFilename: 'test.db', has_key_envelope: false })
    const dbData = entries.get('test.db') ?? Buffer.alloc(0)
    expect(createHash('sha256').update(dbData).digest('hex')).toBe(meta.dbSha256)

    const extracted = join(t.tmpDir, 'extracted.db')
    writeFileSync(extracted, dbData)
    const db2 = openTestDb(extracted)
    expect(countRows(db2, 'rows', 'grid_id = ?', gridId)).toBe(10)
    expect(Number((db2.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value)).toBe(LATEST_SCHEMA)
    db2.close()
    // The VACUUM INTO snapshot is cleaned up
    expect(readdirSync(dirname(destPath)).filter(f => f.startsWith('pulse-snapshot-'))).toEqual([])
  })

  it('throws a clear error when the database file is missing', async () => {
    _currentDbPath = join(t.tmpDir, 'gone.db')
    await expect(runManualBackup(join(t.tmpDir, 'out'))).rejects.toThrow('Database file not found')
  })
})

describe('Manual Backup into folders with apostrophes and accents (AUDIT-002)', () => {
  it("backs up into a folder named like O'Brien (José) & co and the snapshot opens with the same key", async () => {
    const { gridId } = seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    const oddDir = join(t.tmpDir, "Test O'Brien (José) & co, #1+")
    mkdirSync(oddDir, { recursive: true })

    const result = await runManualBackup(join(oddDir, 'backup'))
    expect(existsSync(result.destPath)).toBe(true)
    // The temporary snapshot is cleaned up after zipping
    expect(readdirSync(oddDir).filter(f => f.endsWith('.db'))).toEqual([])

    const entries = await readZip(result.destPath)
    const dbEntry = [...entries.keys()].find(k => k.endsWith('.db'))
    expect(dbEntry).toBeDefined()
    const extracted = join(oddDir, 'extracted.db')
    writeFileSync(extracted, entries.get(dbEntry as string) as Buffer)
    const db2 = openTestDb(extracted)
    const count = (db2.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(count).toBe(3)
    db2.close()
  })
})

// ── Restore round trips through the real functions ───────────────────────────

describe('Restore', () => {
  it('create 10 records → backup → delete 5 → restore → all 10 back, with a safety copy of the 5', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 10, columnCount: 1 })
    const ins = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    rowIds.forEach((id, i) => ins.run(id, columnIds[0], `Test Person ${i}`))
    const { destPath } = await runManualBackup(join(t.tmpDir, 'out', 'before'))

    for (const id of rowIds.slice(0, 5)) t.db.prepare('DELETE FROM rows WHERE id = ?').run(id)
    expect(countRows(t.db, 'rows', 'grid_id = ?', gridId)).toBe(5)

    const safetyPath = await restoreFromPulseBackup(destPath)

    expect(basename(safetyPath)).toMatch(/^pulse-pre-restore-\d{8}-\d{6}\.db$/)
    expect(t.db.open).toBe(false) // restore closes the live database first
    const db3 = openTestDb(t.dbPath)
    expect(countRows(db3, 'rows', 'grid_id = ?', gridId)).toBe(10)
    expect(countRows(db3, 'cells', 'column_id = ?', columnIds[0])).toBe(10)
    db3.close()
    const dbSafety = openTestDb(safetyPath)
    expect(countRows(dbSafety, 'rows', 'grid_id = ?', gridId)).toBe(5)
    dbSafety.close()
    expect(readdirSync(backupDir).filter(f => f.startsWith('restore-tmp-'))).toEqual([])
  })

  it('a damaged .pulse-backup is refused and the current database is untouched', async () => {
    const { gridId } = seedGrid(t.db, { rowCount: 5, columnCount: 1 })
    const corrupt = join(t.tmpDir, 'corrupt.pulse-backup')
    writeFileSync(corrupt, Buffer.alloc(1024, 0xFF))

    await expect(restoreFromPulseBackup(corrupt)).rejects.toThrow()

    const db2 = openTestDb(t.dbPath)
    expect(countRows(db2, 'rows', 'grid_id = ?', gridId)).toBe(5)
    db2.close()
    expect(readdirSync(backupDir).filter(f => f.startsWith('restore-tmp-'))).toEqual([])
  })

  it('a .pulse-backup whose database does not match its recorded hash is refused', async () => {
    const { gridId } = seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    const other = makeProdFormatBackupDb('tampered.db', 9)
    const zip = join(t.tmpDir, 'tampered.pulse-backup')
    await writeZip(zip, { 'test.db': { file: other }, 'backup-meta.json': JSON.stringify({ dbSha256: 'b'.repeat(64) }) })

    await expect(restoreFromPulseBackup(zip)).rejects.toThrow(/hash mismatch/)

    const db2 = openTestDb(t.dbPath)
    expect(countRows(db2, 'rows', 'grid_id = ?', gridId)).toBe(2)
    db2.close()
  })

  it('a .pulse-backup without a database is refused', async () => {
    const { gridId } = seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    const zip = join(t.tmpDir, 'no-db.pulse-backup')
    await writeZip(zip, { 'readme.txt': 'This is not a database' })

    await expect(restoreFromPulseBackup(zip)).rejects.toThrow('No database file found in backup archive')

    const db2 = openTestDb(t.dbPath)
    expect(countRows(db2, 'rows', 'grid_id = ?', gridId)).toBe(2)
    db2.close()
  })

  it.each([
    ['../evil.db'],
    ['..\\evil.db'],
    ['C:evil.db'],
    ['/abs/evil.db'],
  ])('refuses an archive whose database entry is named %s, writing nothing outside', async (name) => {
    const { gridId } = seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    const evil = makeProdFormatBackupDb('evil-source.db', 7)
    const zip = join(t.tmpDir, 'traversal.pulse-backup')
    await writeZipWithRawNames(zip, [{ name, file: evil }])

    // yauzl refuses such names outright; backup.ts's own entry filter is the second line of defense
    await expect(restoreFromPulseBackup(zip)).rejects.toThrow(/invalid relative path|invalid characters|absolute path|No database file found/)
    expect((await verifyBackup(zip)).valid).toBe(false)

    expect(existsSync(join(t.tmpDir, 'evil.db'))).toBe(false)
    expect(existsSync(join(backupDir, 'evil.db'))).toBe(false)
    expect(readdirSync(backupDir).filter(f => f.startsWith('restore-tmp-'))).toEqual([])
    const db2 = openTestDb(t.dbPath)
    expect(countRows(db2, 'rows', 'grid_id = ?', gridId)).toBe(2)
    db2.close()
  })

  it('ignores a database entry inside a folder in the archive', async () => {
    const { gridId } = seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    const nested = makeProdFormatBackupDb('nested-source.db', 7)
    const zip = join(t.tmpDir, 'nested.pulse-backup')
    await writeZip(zip, { 'nested/pulse.db': { file: nested } })

    await expect(restoreFromPulseBackup(zip)).rejects.toThrow('No database file found in backup archive')
    expect(await verifyBackup(zip)).toMatchObject({ valid: false, error: 'No database file found in archive' })
    const db2 = openTestDb(t.dbPath)
    expect(countRows(db2, 'rows', 'grid_id = ?', gridId)).toBe(2)
    db2.close()
  })

  it('assertPathWithin rejects a path that resolves outside its folder', () => {
    const parentDir = join(backupDir, 'extract')
    expect(() => assertPathWithin(join(parentDir, '..', '..', 'etc', 'passwd'), parentDir)).toThrow('Path traversal detected')
    expect(() => assertPathWithin(join(parentDir, 'safe-file.db'), parentDir)).not.toThrow()
  })
})

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

// ── Verify (uses production-format databases: real key, real SQLCipher settings) ──

describe('verifyBackup', () => {
  it('a valid .db backup reports the app schema version and table count', async () => {
    const p = makeProdFormatBackupDb('verify-valid.db', 5)
    const result = await verifyBackup(p)
    expect(result).toMatchObject({ valid: true, schemaVersion: LATEST_SCHEMA })
    expect(result.tableCount).toBeGreaterThan(10)
  })

  it('a corrupt file is reported invalid with a reason', async () => {
    const corruptPath = join(backupDir, 'verify-corrupt.db')
    writeFileSync(corruptPath, Buffer.alloc(2048, 0xDE))
    const result = await verifyBackup(corruptPath)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('a missing file reports file not found', async () => {
    const result = await verifyBackup(join(backupDir, 'does-not-exist-at-all.db'))
    expect(result).toEqual({ valid: false, error: 'File not found' })
  })

  it('a database encrypted with a different key is invalid (and not "another Pulse" without a key envelope)', async () => {
    const p = makeProdFormatBackupDb('verify-wrong-key.db', 1, 'f'.repeat(64))
    const result = await verifyBackup(p)
    expect(result.valid).toBe(false)
    expect(result.otherPulse).toBe(false)
  })

  it('a .pulse-backup from another Pulse (other key, key envelope inside) is flagged as such', async () => {
    const p = makeProdFormatBackupDb('other.db', 1, 'e'.repeat(64))
    const zip = join(t.tmpDir, 'other.pulse-backup')
    await writeZip(zip, { 'pulse.db': { file: p }, 'key-envelope.json': '{}' })
    const result = await verifyBackup(zip)
    expect(result.valid).toBe(false)
    expect(result.otherPulse).toBe(true)
  })

  it('a valid .pulse-backup verifies: hash checked, database opened', async () => {
    const p = makeProdFormatBackupDb('zip-src.db', 4)
    const zip = join(t.tmpDir, 'verify.pulse-backup')
    await writeZip(zip, {
      'pulse.db': { file: p },
      'backup-meta.json': JSON.stringify({ backupType: 'manual', dbFilename: 'pulse.db', dbSha256: sha256(p) }),
    })
    const result = await verifyBackup(zip)
    expect(result).toMatchObject({ valid: true, schemaVersion: LATEST_SCHEMA })
    expect(readdirSync(backupDir).filter(f => f.startsWith('verify-tmp-'))).toEqual([])
  })

  it('a .pulse-backup whose database does not match its recorded hash is reported corrupt', async () => {
    const p = makeProdFormatBackupDb('zip-bad-hash.db', 2)
    const zip = join(t.tmpDir, 'bad-hash.pulse-backup')
    await writeZip(zip, {
      'pulse.db': { file: p },
      'backup-meta.json': JSON.stringify({ dbSha256: 'a'.repeat(64) }),
    })
    const result = await verifyBackup(zip)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/hash mismatch/)
  })

  it('a .pulse-backup without a database entry is invalid', async () => {
    const zip = join(backupDir, 'verify-no-db.pulse-backup')
    await writeZip(zip, { 'notes.txt': 'Not a database', 'backup-meta.json': JSON.stringify({ backupType: 'manual' }) })
    expect(await verifyBackup(zip)).toEqual({ valid: false, error: 'No database file found in archive' })
  })
})

// ── Layer 2: scheduled backups ───────────────────────────────────────────────

describe('Scheduled backups', () => {
  const scheduledFiles = (dir: string): string[] => existsSync(dir) ? readdirSync(dir).filter(f => f.startsWith('pulse-scheduled-')) : []

  it('default config has correct values', () => {
    const config = getScheduledConfig()
    expect(config.enabled).toBe(false)
    expect(config.intervalHours).toBe(24)
    expect(config.destinationDir).toBe(backupDir)
    expect(config.lastRunISO).toBeNull()
  })

  it('set and get round-trip preserves all fields', () => {
    setScheduledConfig({ enabled: true, intervalHours: 168, destinationDir: '/my/backup/folder', lastRunISO: '2026-03-01T10:00:00.000Z' })
    expect(getScheduledConfig()).toEqual({ enabled: true, intervalHours: 168, destinationDir: '/my/backup/folder', lastRunISO: '2026-03-01T10:00:00.000Z' })
  })

  it('does not run before the interval has passed', async () => {
    const dest = join(t.tmpDir, 'scheduled')
    const lastRunISO = new Date(Date.now() - 23 * 3600_000).toISOString()
    setScheduledConfig({ enabled: true, intervalHours: 24, destinationDir: dest, lastRunISO })
    await checkAndRunScheduled()
    expect(scheduledFiles(dest)).toEqual([])
    expect(getScheduledConfig().lastRunISO).toBe(lastRunISO)
  })

  it('runs once the interval has passed, and records the run', async () => {
    seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    const dest = join(t.tmpDir, 'scheduled')
    const lastRunISO = new Date(Date.now() - 25 * 3600_000).toISOString()
    setScheduledConfig({ enabled: true, intervalHours: 24, destinationDir: dest, lastRunISO })
    await checkAndRunScheduled()
    const files = scheduledFiles(dest)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^pulse-scheduled-\d{8}-\d{6}\.pulse-backup$/)
    const cfg = getScheduledConfig()
    expect(Date.parse(cfg.lastRunISO ?? '')).toBeGreaterThan(Date.parse(lastRunISO))
    expect(cfg.lastError).toBeNull()
    const entries = await readZip(join(dest, files[0] ?? 'missing'))
    expect(entries.has('test.db')).toBe(true)
  })

  it('runs straight away when it has never run', async () => {
    const dest = join(t.tmpDir, 'scheduled-first')
    setScheduledConfig({ enabled: true, intervalHours: 24, destinationDir: dest, lastRunISO: null })
    await checkAndRunScheduled()
    expect(scheduledFiles(dest)).toHaveLength(1)
  })

  it('never runs while turned off', async () => {
    const dest = join(t.tmpDir, 'scheduled-off')
    setScheduledConfig({ enabled: false, intervalHours: 24, destinationDir: dest, lastRunISO: null })
    await checkAndRunScheduled()
    expect(scheduledFiles(dest)).toEqual([])
    expect(getScheduledConfig().lastRunISO).toBeNull()
  })
})

// ── Backup info ──────────────────────────────────────────────────────────────

describe('getBackupInfo', () => {
  it('returns count and newest/oldest across several auto-backups', () => {
    const names = ['pulse-auto-20260301-080000.db', 'pulse-auto-20260301-120000.db', 'pulse-auto-20260301-160000.db', 'pulse-auto-20260301-200000.db']
    for (const name of names) writeFileSync(join(backupDir, name), 'x')
    const info = getBackupInfo()
    expect(info.layer1.count).toBe(4)
    expect(info.layer1.dir).toBe(backupDir)
    expect(info.layer1.newest).toBe(join(backupDir, 'pulse-auto-20260301-200000.db'))
    expect(info.layer1.oldest).toBe(join(backupDir, 'pulse-auto-20260301-080000.db'))
    expect(info.lastAutoBackup).toBe(info.layer1.newest)
  })

  it('returns empty info when no backups exist', () => {
    const info = getBackupInfo()
    expect(info.layer1.count).toBe(0)
    expect(info.layer1.newest).toBeNull()
    expect(info.layer1.oldest).toBeNull()
    expect(info.lastAutoBackup).toBeNull()
    expect(info.lastAutoBackupFailed).toBe(false)
    expect(info.lastAutoBackupError).toBeNull()
  })

  it('ignores files that are not auto-backups', () => {
    writeFileSync(join(backupDir, 'pulse-auto-20260301-100000.db'), 'x')
    writeFileSync(join(backupDir, 'pulse-auto-20260301-110000.db'), 'x')
    writeFileSync(join(backupDir, 'pulse-scheduled-20260301.pulse-backup'), Buffer.alloc(64))
    writeFileSync(join(backupDir, 'random-file.txt'), 'not a backup')
    writeFileSync(join(backupDir, 'pulse-pre-migration-v1-to-v2-20260301-090000.db'), Buffer.alloc(64))
    const info = getBackupInfo()
    expect(info.layer1.count).toBe(2)
    expect(info.layer1.newest).toBe(join(backupDir, 'pulse-auto-20260301-110000.db'))
    expect(info.layer1.oldest).toBe(join(backupDir, 'pulse-auto-20260301-100000.db'))
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

describe('pruneBackups', () => {
  it('keeps only the newest N files with the prefix and suffix, leaving other files alone', () => {
    for (let i = 0; i < 7; i++) writeFileSync(join(backupDir, `pulse-scheduled-20260222-12000${i}.pulse-backup`), 'x')
    writeFileSync(join(backupDir, 'pulse-auto-20200101-000000.db'), 'x')
    pruneBackups(backupDir, 'pulse-scheduled-', '.pulse-backup', 5)
    const remaining = readdirSync(backupDir).filter(f => f.startsWith('pulse-scheduled-')).sort()
    expect(remaining).toEqual([2, 3, 4, 5, 6].map(i => `pulse-scheduled-20260222-12000${i}.pulse-backup`))
    expect(existsSync(join(backupDir, 'pulse-auto-20200101-000000.db'))).toBe(true)
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
