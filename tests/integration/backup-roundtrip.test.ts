/**
 * Backup Round-Trip Integration Tests
 *
 * The full encrypted backup/restore cycle — the most critical data-safety
 * path — through the real backup.ts functions (runAutoBackup, runManualBackup,
 * restoreFromDb, restoreFromPulseBackup, verifyBackup) on real SQLCipher
 * databases. Only Electron, electron-store, the auth module (DB path + key) and
 * the database module (data folder) are mocked; the live test database is
 * handed to backup.ts as the open database.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import {
  createTestDb, cleanupTestDb, openEncryptedDb, seedGrid, type TestDb,
} from '../helpers'
import { PROD_TEST_KEY_HEX, createProdFormatDb, writeZip, readZip, countRows } from '../backupTestUtils'

const storeState = vi.hoisted(() => ({ stores: new Map<string, Record<string, unknown>>() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-roundtrip', getVersion: () => '0.0.0-test', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

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

vi.mock('../../src/main/auth', () => ({
  getStoredDbPath: () => currentDbPath,
  getDbKey: () => Buffer.from(PROD_TEST_KEY_HEX, 'hex'),
  getKeyEnvelope: () => null,
  isValidKeyEnvelope: () => false,
  unwrapKeyEnvelope: async () => { throw new Error('Incorrect password or recovery key') },
  adoptRestoredDbKey: async () => {},
}))

vi.mock('../../src/main/database', () => ({
  getPortableDataDir: () => currentTmpDir,
  setEncryptionKey: (db: { pragma: (s: string) => unknown }, hexKey: string) => {
    if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error('Invalid database key format')
    db.pragma(`key='${hexKey}'`)
  },
}))

vi.mock('../../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

let currentDbPath: string
let currentTmpDir: string

import {
  runAutoBackup, runManualBackup, restoreFromDb, restoreFromPulseBackup, verifyBackup, setDatabaseBridge,
} from '../../src/main/backup'

let t: TestDb
let backupDir: string

beforeEach(() => {
  for (const data of storeState.stores.values()) for (const k of Object.keys(data)) delete data[k]
  t = createTestDb()
  backupDir = join(t.tmpDir, 'backups')
  currentDbPath = t.dbPath
  currentTmpDir = t.tmpDir
  setDatabaseBridge({
    closeDatabase: () => { try { t.db.close() } catch { /* already closed */ } },
    getDb: () => t.db,
  })
})

afterEach(() => { cleanupTestDb(t) })

const autoBackups = (): string[] => readdirSync(backupDir).filter(f => f.startsWith('pulse-auto-')).map(f => join(backupDir, f))

/** After a restore the live handle is closed; reopen the restored file */
const reopen = () => openEncryptedDb(t.dbPath)

// ══════════════════════════════════════════════════════════════════════════════
// 1. Auto-backup (.db) → restoreFromDb
// ══════════════════════════════════════════════════════════════════════════════

describe('Full backup/restore round-trip (auto-backup .db)', () => {
  it('backup and restore preserves grids, columns, rows, cells, and case log', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 5, columnCount: 3 })
    const [nameCol, dateCol, numCol] = columnIds as [number, number, number]
    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    rowIds.forEach((id, i) => {
      insCell.run(id, nameCol, `Test Person ${i}`)
      insCell.run(id, dateCol, `2026-03-0${i + 1}`)
      insCell.run(id, numCol, String(100 + i))
    })
    const insNote = t.db.prepare(`INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'note', datetime('now'), datetime('now'))`)
    insNote.run(rowIds[0], 'Initial intake completed')
    insNote.run(rowIds[1], 'Follow-up scheduled')

    await runAutoBackup()
    const [backupPath] = autoBackups()

    // Modify the live database after the backup
    t.db.prepare('DELETE FROM rows WHERE id IN (?, ?, ?)').run(rowIds[0], rowIds[1], rowIds[2])
    t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('MODIFIED', rowIds[3], nameCol)
    expect(countRows(t.db, 'rows', 'grid_id = ?', gridId)).toBe(2)

    const safetyPath = await restoreFromDb(backupPath ?? 'missing')

    const db3 = reopen()
    expect((db3.prepare('SELECT name FROM grids WHERE id = ?').get(gridId) as { name: string }).name).toBe('Test Caseload')
    expect(countRows(db3, 'columns', 'grid_id = ?', gridId)).toBe(3)
    expect(countRows(db3, 'rows', 'grid_id = ?', gridId)).toBe(5)
    expect((db3.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[3], nameCol) as { value: string }).value).toBe('Test Person 3')
    expect(countRows(db3, 'cells')).toBe(15)
    expect(countRows(db3, 'case_log')).toBe(2)
    expect((db3.prepare('SELECT content FROM case_log WHERE row_id = ?').get(rowIds[0]) as { content: string }).content).toBe('Initial intake completed')
    db3.close()

    // The safety copy holds the state just before the restore
    const dbSafety = openEncryptedDb(safetyPath)
    expect(countRows(dbSafety, 'rows', 'grid_id = ?', gridId)).toBe(2)
    dbSafety.close()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. Backup integrity
// ══════════════════════════════════════════════════════════════════════════════

describe('Backup integrity verification', () => {
  it('a damaged .pulse-backup is refused by restore, and the current data is kept', async () => {
    const { gridId } = seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    const { destPath } = await runManualBackup(join(t.tmpDir, 'out', 'corrupt-test'))

    const zipData = readFileSync(destPath)
    const corruptOffset = Math.floor(zipData.length / 2)
    for (let i = 0; i < 64 && corruptOffset + i < zipData.length; i++) {
      zipData[corruptOffset + i] = (zipData[corruptOffset + i] ?? 0) ^ 0xFF
    }
    writeFileSync(destPath, zipData)

    expect((await verifyBackup(destPath)).valid).toBe(false)
    t.db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, 9, datetime('now'), datetime('now'))").run(gridId)
    await expect(restoreFromPulseBackup(destPath)).rejects.toThrow()

    const db2 = reopen()
    expect(countRows(db2, 'rows', 'grid_id = ?', gridId)).toBe(4)
    db2.close()
  })

  it('verifyBackup (run before every restore from Settings) rejects a backup whose hash does not match', async () => {
    const src = join(t.tmpDir, 'prod.db')
    const db = createProdFormatDb(src)
    seedGrid(db, { rowCount: 2, columnCount: 1 })
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    const badZip = join(t.tmpDir, 'bad-hash.pulse-backup')
    await writeZip(badZip, {
      'pulse.db': { file: src },
      'backup-meta.json': JSON.stringify({ dbSha256: '0'.repeat(64) }),
    })
    const result = await verifyBackup(badZip)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/hash mismatch/)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. Schema version
// ══════════════════════════════════════════════════════════════════════════════

describe('Schema version compatibility', () => {
  it('backup preserves schema_version and every table survives restore', async () => {
    seedGrid(t.db, { rowCount: 2, columnCount: 2 })
    const versionBefore = (t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value
    const tablesBefore = (t.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map(r => r.name)

    const { destPath } = await runManualBackup(join(t.tmpDir, 'out', 'schema-test'))
    t.db.exec('DROP TABLE IF EXISTS saved_views')
    await restoreFromPulseBackup(destPath)

    const db2 = reopen()
    expect((db2.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe(versionBefore)
    expect((db2.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map(r => r.name)).toEqual(tablesBefore)
    db2.close()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. Large dataset
// ══════════════════════════════════════════════════════════════════════════════

describe('Large dataset backup/restore', () => {
  it('250 records with 10 columns each survive a .pulse-backup round trip', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 250, columnCount: 10 })
    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    t.db.transaction(() => {
      rowIds.forEach((r, ri) => columnIds.forEach((c, ci) => insCell.run(r, c, `R${ri}C${ci}`)))
    })()

    const { destPath } = await runManualBackup(join(t.tmpDir, 'out', 'large'))
    t.db.prepare('DELETE FROM cells').run()
    await restoreFromPulseBackup(destPath)

    const db2 = reopen()
    expect(countRows(db2, 'rows', 'grid_id = ?', gridId)).toBe(250)
    expect(countRows(db2, 'cells')).toBe(2500)
    const check = (row: number, col: number, expected: string) => {
      const val = db2.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[row], columnIds[col]) as { value: string }
      expect(val.value).toBe(expected)
    }
    check(0, 0, 'R0C0')
    check(249, 9, 'R249C9')
    check(125, 5, 'R125C5')
    db2.close()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. Backups taken while the database is open and in use
// ══════════════════════════════════════════════════════════════════════════════

describe('Backups of a database in use', () => {
  it('an auto-backup is a point-in-time copy: later writes go to the live DB only', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 10, columnCount: 2 })
    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    rowIds.forEach((id, i) => insCell.run(id, columnIds[0], `Original-${i}`))

    await runAutoBackup()
    for (let i = 0; i < 5; i++) {
      t.db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(gridId, 100 + i)
    }
    expect(countRows(t.db, 'rows', 'grid_id = ?', gridId)).toBe(15)

    const dbBackup = openEncryptedDb(autoBackups()[0] ?? 'missing')
    expect(countRows(dbBackup, 'rows', 'grid_id = ?', gridId)).toBe(10)
    expect(countRows(dbBackup, 'cells', 'column_id = ?', columnIds[0])).toBe(10)
    dbBackup.close()
  })

  it('a .pulse-backup includes writes not yet checkpointed from the WAL', async () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 5, columnCount: 1 })
    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    rowIds.forEach((id, i) => insCell.run(id, columnIds[0], `WAL-${i}`))
    expect(statSync(t.dbPath + '-wal').size).toBeGreaterThan(0)

    const { destPath } = await runManualBackup(join(t.tmpDir, 'out', 'wal'))
    const extracted = join(t.tmpDir, 'extracted.db')
    writeFileSync(extracted, (await readZip(destPath)).get('test.db') ?? Buffer.alloc(0))
    const dbBackup = openEncryptedDb(extracted)
    expect(countRows(dbBackup, 'cells', 'column_id = ?', columnIds[0])).toBe(5)
    expect((dbBackup.prepare('SELECT value FROM cells WHERE row_id = ?').get(rowIds[2]) as { value: string }).value).toBe('WAL-2')
    dbBackup.close()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. .pulse-backup round trip (the production format)
// ══════════════════════════════════════════════════════════════════════════════

describe('.pulse-backup zip round-trip', () => {
  it('full cycle: seed → backup → modify → restore → verify, with a safety copy of the modified state', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 8, columnCount: 3 })
    const col = columnIds[0]
    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    rowIds.forEach((id, i) => insCell.run(id, col, `Name-${i}`))

    const { destPath } = await runManualBackup(join(t.tmpDir, 'out', 'zip-roundtrip'))
    t.db.prepare('DELETE FROM cells WHERE column_id = ?').run(col)
    t.db.prepare('DELETE FROM rows WHERE grid_id = ?').run(gridId)
    expect(countRows(t.db, 'rows')).toBe(0)

    const safetyPath = await restoreFromPulseBackup(destPath)

    const db3 = reopen()
    expect(countRows(db3, 'rows', 'grid_id = ?', gridId)).toBe(8)
    expect((db3.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[4], col) as { value: string }).value).toBe('Name-4')
    db3.close()
    const dbSafety = openEncryptedDb(safetyPath)
    expect(countRows(dbSafety, 'rows', 'grid_id = ?', gridId)).toBe(0)
    dbSafety.close()
  })

  it('metadata in .pulse-backup contains the required fields', async () => {
    seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const { destPath } = await runManualBackup(join(t.tmpDir, 'out', 'meta-check'))
    const meta = JSON.parse((await readZip(destPath)).get('backup-meta.json')?.toString('utf8') ?? '{}')
    expect(meta.created).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(meta.backupType).toBe('manual')
    expect(meta.dbFilename).toBe('test.db')
    expect(meta.dbSha256).toHaveLength(64)
    expect(meta.appVersion).toBe('0.0.0-test')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7. Edge cases and error paths
// ══════════════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('backup of an empty database (schema only) restores with its schema', async () => {
    const { destPath, sizeBytes } = await runManualBackup(join(t.tmpDir, 'out', 'empty'))
    expect(sizeBytes).toBeGreaterThan(0)
    await restoreFromPulseBackup(destPath)
    const db2 = reopen()
    expect(countRows(db2, 'sqlite_master', "type = 'table'")).toBeGreaterThan(5)
    db2.close()
  })

  it('restore from a file that does not exist throws and changes nothing', async () => {
    mkdirSync(backupDir, { recursive: true })
    await expect(restoreFromPulseBackup(join(t.tmpDir, 'nonexistent.pulse-backup'))).rejects.toThrow(/Backup file not found/)
    await expect(restoreFromDb(join(t.tmpDir, 'nonexistent.db'))).rejects.toThrow(/Backup file not found/)
    expect(readdirSync(backupDir).filter(f => f.startsWith('pulse-pre-restore-'))).toEqual([])
    expect(t.db.open).toBe(true)
  })

  it('the database inside a .pulse-backup is encrypted', async () => {
    const { rowIds, columnIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], 'PLAINTEXT_MARKER_VALUE')
    const { destPath } = await runManualBackup(join(t.tmpDir, 'out', 'encrypted-check'))
    const dbBytes = (await readZip(destPath)).get('test.db') ?? Buffer.alloc(0)
    expect(dbBytes.length).toBeGreaterThan(0)
    expect(dbBytes.subarray(0, 16).toString('latin1')).not.toContain('SQLite format 3')
    expect(dbBytes.toString('latin1')).not.toContain('PLAINTEXT_MARKER_VALUE')
    expect(existsSync(destPath)).toBe(true)
  })
})
