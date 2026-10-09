/**
 * Backup Round-Trip Integration Tests
 *
 * Verifies the full encrypted backup/restore cycle — the most critical
 * data-safety path. Uses real SQLCipher databases on the file system.
 *
 * Electron APIs (app, electron-store, safeStorage) are NOT available in
 * vitest, so we replicate what backup.ts does at the file/zip/crypto level
 * using the same libraries (yazl/yauzl, better-sqlite3-multiple-ciphers, crypto).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  copyFileSync, existsSync, readFileSync, writeFileSync,
  mkdirSync, mkdtempSync, rmSync, unlinkSync, readdirSync, renameSync,
  openSync, closeSync, fsyncSync, statSync, createWriteStream,
} from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'
import yazl from 'yazl'
import type { Database } from 'better-sqlite3'
import {
  createTestDb, cleanupTestDb, openEncryptedDb, seedGrid,
  TEST_PASSWORD, type TestDb,
} from '../helpers'

/** Read a zip and return entries with their data (using yauzl). */
async function readZipEntries(zipPath: string): Promise<Map<string, Buffer>> {
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

// ── Helpers that mirror backup.ts logic (without Electron deps) ───────────────

function computeSha256(filePath: string): string {
  const data = readFileSync(filePath)
  return createHash('sha256').update(data).digest('hex')
}

interface BackupMeta {
  created: string
  appVersion: string
  backupType: string
  dbFilename: string
  dbSha256: string
}

/** Create a .pulse-backup zip archive (same format as backup.ts createPulseBackup) */
async function createPulseBackup(dbPath: string, destPath: string, backupType = 'test'): Promise<BackupMeta> {
  const dbHash = computeSha256(dbPath)
  const meta: BackupMeta = {
    created: new Date().toISOString(),
    appVersion: '0.0.0-test',
    backupType,
    dbFilename: basename(dbPath),
    dbSha256: dbHash,
  }

  const zip = new yazl.ZipFile()
  zip.addFile(dbPath, basename(dbPath))
  zip.addBuffer(Buffer.from(JSON.stringify(meta, null, 2)), 'backup-meta.json')
  zip.end()

  const tmpPath = destPath + '.tmp'
  await pipeline(zip.outputStream, createWriteStream(tmpPath))
  renameSync(tmpPath, destPath)
  return meta
}

/** Restore from .pulse-backup zip (same logic as backup.ts restoreFromPulseBackup) */
async function restoreFromPulseBackup(
  backupZipPath: string,
  targetDbPath: string,
  safetyDir: string,
): Promise<{ safetyPath: string }> {
  if (!existsSync(backupZipPath)) throw new Error('Backup file not found')

  // Safety backup of current DB
  const safetyPath = join(safetyDir, `pre-restore-${Date.now()}.db`)
  if (existsSync(targetDbPath)) {
    copyFileSync(targetDbPath, safetyPath)
  }

  const tmpDir = join(safetyDir, `restore-tmp-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })

  try {
    const entries = await readZipEntries(backupZipPath)

    // Find .db entry (reject path traversal)
    const dbEntryName = [...entries.keys()].find(name =>
      name.endsWith('.db') && !name.includes('..') && !name.includes('/') && !name.includes('\\')
    )
    if (!dbEntryName) throw new Error('No database file found in backup archive')

    // Verify hash if metadata present
    const metaBuf = entries.get('backup-meta.json')
    if (metaBuf) {
      const meta = JSON.parse(metaBuf.toString('utf8')) as BackupMeta
      if (meta.dbSha256) {
        const dbData = entries.get(dbEntryName)!
        const actualHash = createHash('sha256').update(dbData).digest('hex')
        if (actualHash !== meta.dbSha256) {
          throw new Error('Database file hash mismatch — backup may be corrupted')
        }
      }
    }

    const extractedPath = join(tmpDir, dbEntryName)
    writeFileSync(extractedPath, entries.get(dbEntryName)!)
    if (!existsSync(extractedPath)) throw new Error('Extraction failed')

    // Remove WAL/SHM before overwrite
    for (const suffix of ['-wal', '-shm']) {
      const p = targetDbPath + suffix
      if (existsSync(p)) unlinkSync(p)
    }

    // Atomic copy
    const tmpDest = targetDbPath + '.tmp'
    copyFileSync(extractedPath, tmpDest)
    const fd = openSync(tmpDest, 'r+')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmpDest, targetDbPath)
  } catch (err) {
    // Rollback on failure
    if (existsSync(safetyPath)) {
      try { copyFileSync(safetyPath, targetDbPath) } catch { /* last resort */ }
    }
    throw err
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  return { safetyPath }
}

/** Restore from a raw .db backup file */
function restoreFromDb(backupDbPath: string, targetDbPath: string, safetyDir: string): { safetyPath: string } {
  if (!existsSync(backupDbPath)) throw new Error('Backup file not found')

  const safetyPath = join(safetyDir, `pre-restore-${Date.now()}.db`)
  if (existsSync(targetDbPath)) copyFileSync(targetDbPath, safetyPath)

  for (const suffix of ['-wal', '-shm']) {
    const p = targetDbPath + suffix
    if (existsSync(p)) unlinkSync(p)
  }

  const tmpDest = targetDbPath + '.tmp'
  copyFileSync(backupDbPath, tmpDest)
  const fd = openSync(tmpDest, 'r+')
  try { fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmpDest, targetDbPath)

  return { safetyPath }
}

// ── Test setup ────────────────────────────────────────────────────────────────

let t: TestDb
let backupDir: string

beforeEach(() => {
  t = createTestDb()
  backupDir = join(t.tmpDir, 'backups')
  mkdirSync(backupDir, { recursive: true })
})

afterEach(() => { cleanupTestDb(t) })

// ══════════════════════════════════════════════════════════════════════════════
// 1. Unencrypted-format DB backup/restore round-trip
//    (DB is encrypted with SQLCipher — "unencrypted" here means the backup
//    archive itself is not additionally encrypted, just the raw .db copy)
// ══════════════════════════════════════════════════════════════════════════════

describe('Full backup/restore round-trip (raw .db)', () => {
  it('backup and restore preserves grids, columns, rows, cells, and case log', () => {
    // Insert test data
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 5, columnCount: 3 })
    const nameCol = columnIds[0]
    const dateCol = columnIds[1]
    const numCol = columnIds[2]

    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    for (let i = 0; i < 5; i++) {
      insCell.run(rowIds[i], nameCol, `Client ${i}`)
      insCell.run(rowIds[i], dateCol, `2026-03-0${i + 1}`)
      insCell.run(rowIds[i], numCol, String(100 + i))
    }

    // Insert case log entries
    const insCaseLog = t.db.prepare(
      `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
       VALUES (?, ?, 'note', datetime('now'), datetime('now'))`
    )
    insCaseLog.run(rowIds[0], 'Initial intake completed')
    insCaseLog.run(rowIds[1], 'Follow-up scheduled')

    // Checkpoint WAL and close for consistent backup
    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    // Create backup
    const backupPath = join(backupDir, 'roundtrip.db')
    copyFileSync(t.dbPath, backupPath)

    // Modify original: delete rows, change cells
    const db2 = openEncryptedDb(t.dbPath)
    db2.prepare('DELETE FROM rows WHERE id IN (?, ?, ?)').run(rowIds[0], rowIds[1], rowIds[2])
    db2.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('MODIFIED', rowIds[3], nameCol)
    const countAfterMod = (db2.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(countAfterMod).toBe(2)
    db2.close()

    // Restore
    restoreFromDb(backupPath, t.dbPath, backupDir)

    // Verify ALL original data intact
    const db3 = openEncryptedDb(t.dbPath)

    // 1. Grid exists
    const grid = db3.prepare('SELECT name FROM grids WHERE id = ?').get(gridId) as { name: string }
    expect(grid.name).toBe('Test Caseload')

    // 2. All 3 columns present
    const colCount = (db3.prepare('SELECT COUNT(*) as c FROM columns WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(colCount).toBe(3)

    // 3. All 5 rows restored
    const rowCount = (db3.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(rowCount).toBe(5)

    // 4. Cell values match originals
    const cellVal = (db3.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[3], nameCol) as { value: string })
    expect(cellVal.value).toBe('Client 3') // Not 'MODIFIED'

    // 5. All 15 cells (5 rows * 3 cols)
    const totalCells = (db3.prepare('SELECT COUNT(*) as c FROM cells').get() as { c: number }).c
    expect(totalCells).toBe(15)

    // 6. Case log entries preserved
    const logCount = (db3.prepare('SELECT COUNT(*) as c FROM case_log').get() as { c: number }).c
    expect(logCount).toBe(2)

    const logEntry = db3.prepare('SELECT content FROM case_log WHERE row_id = ?').get(rowIds[0]) as { content: string }
    expect(logEntry.content).toBe('Initial intake completed')

    db3.close()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. Backup integrity verification (SHA-256 hash)
// ══════════════════════════════════════════════════════════════════════════════

describe('Backup integrity verification', () => {
  it('SHA-256 hash in metadata matches the DB file inside the archive', async () => {
    seedGrid(t.db, { rowCount: 3, columnCount: 2 })
    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    const backupZip = join(backupDir, 'integrity.pulse-backup')
    const meta = await createPulseBackup(t.dbPath, backupZip)

    // Read back from the zip and verify
    const entries = await readZipEntries(backupZip)
    const dbEntryName = [...entries.keys()].find(k => k.endsWith('.db'))!
    const dbData = entries.get(dbEntryName)!
    const actualHash = createHash('sha256').update(dbData).digest('hex')

    expect(meta.dbSha256).toHaveLength(64)
    expect(actualHash).toBe(meta.dbSha256)
  })

  it('corrupted backup fails integrity check during restore', async () => {
    seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    const backupZip = join(backupDir, 'corrupt-test.pulse-backup')
    await createPulseBackup(t.dbPath, backupZip)

    // Corrupt the zip file: flip bytes in the middle of the file
    const zipData = readFileSync(backupZip)
    const corruptOffset = Math.floor(zipData.length / 2)
    for (let i = 0; i < 64 && corruptOffset + i < zipData.length; i++) {
      zipData[corruptOffset + i] = zipData[corruptOffset + i]! ^ 0xFF
    }
    writeFileSync(backupZip, zipData)

    // Attempt restore — should fail (either zip parse error or hash mismatch)
    await expect(
      restoreFromPulseBackup(backupZip, t.dbPath, backupDir)
    ).rejects.toThrow()
  })

  it('backup with deliberately wrong hash in metadata is rejected', async () => {
    seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    // Create a zip with intentionally wrong hash
    const badZip = join(backupDir, 'bad-hash.pulse-backup')
    const zip = new yazl.ZipFile()
    zip.addFile(t.dbPath, basename(t.dbPath))
    zip.addBuffer(Buffer.from(JSON.stringify({
      created: new Date().toISOString(),
      appVersion: '0.0.0-test',
      backupType: 'test',
      dbFilename: basename(t.dbPath),
      dbSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    }, null, 2)), 'backup-meta.json')
    zip.end()
    await pipeline(zip.outputStream, createWriteStream(badZip))

    await expect(
      restoreFromPulseBackup(badZip, t.dbPath, backupDir)
    ).rejects.toThrow(/hash mismatch/)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. Schema version compatibility
// ══════════════════════════════════════════════════════════════════════════════

describe('Schema version compatibility', () => {
  it('backup preserves schema_version and all tables survive restore', async () => {
    seedGrid(t.db, { rowCount: 2, columnCount: 2 })

    // Read schema version before backup
    const versionBefore = (t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value
    const tablesBefore = (t.db.prepare("SELECT COUNT(*) as n FROM sqlite_master WHERE type='table'").get() as { n: number }).n

    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    // Backup
    const backupZip = join(backupDir, 'schema-test.pulse-backup')
    await createPulseBackup(t.dbPath, backupZip)

    // Restore to a NEW location (simulates restore to fresh DB path)
    const freshDir = mkdtempSync(join(tmpdir(), 'pulse-restore-'))
    const freshDbPath = join(freshDir, 'restored.db')

    // Extract from backup
    const entries = await readZipEntries(backupZip)
    const dbEntryName = [...entries.keys()].find(k => k.endsWith('.db'))!
    writeFileSync(join(freshDir, dbEntryName), entries.get(dbEntryName)!)
    renameSync(join(freshDir, dbEntryName), freshDbPath)

    // Open restored DB and verify
    const dbRestored = openEncryptedDb(freshDbPath)
    const versionAfter = (dbRestored.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value
    const tablesAfter = (dbRestored.prepare("SELECT COUNT(*) as n FROM sqlite_master WHERE type='table'").get() as { n: number }).n

    expect(versionAfter).toBe(versionBefore)
    expect(tablesAfter).toBe(tablesBefore)
    expect(parseInt(versionAfter)).toBeGreaterThanOrEqual(17) // current schema version

    dbRestored.close()
    try { rmSync(freshDir, { recursive: true, force: true }) } catch { /* cleanup */ }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. Backup with large dataset
// ══════════════════════════════════════════════════════════════════════════════

describe('Large dataset backup/restore', () => {
  it('100 rows with 10 columns each survive backup/restore round-trip', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 100, columnCount: 10 })

    // Insert cell values for all 100 rows * 10 columns = 1000 cells
    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    const insertAll = t.db.transaction(() => {
      for (let r = 0; r < 100; r++) {
        for (let c = 0; c < 10; c++) {
          insCell.run(rowIds[r], columnIds[c], `R${r}C${c}`)
        }
      }
    })
    insertAll()

    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    // Create .pulse-backup
    const backupZip = join(backupDir, 'large.pulse-backup')
    await createPulseBackup(t.dbPath, backupZip)

    // Wipe original and restore
    unlinkSync(t.dbPath)
    expect(existsSync(t.dbPath)).toBe(false)

    // Extract from backup directly
    const entries = await readZipEntries(backupZip)
    const dbEntryName = [...entries.keys()].find(k => k.endsWith('.db'))!
    writeFileSync(t.dbPath, entries.get(dbEntryName)!)

    const dbRestored = openEncryptedDb(t.dbPath)

    // Verify row count
    const rowCount = (dbRestored.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(rowCount).toBe(100)

    // Verify cell count
    const cellCount = (dbRestored.prepare('SELECT COUNT(*) as c FROM cells').get() as { c: number }).c
    expect(cellCount).toBe(1000)

    // Spot-check cells at corners and middle
    const check = (row: number, col: number, expected: string) => {
      const val = (dbRestored.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[row], columnIds[col]) as { value: string })
      expect(val.value).toBe(expected)
    }
    check(0, 0, 'R0C0')           // top-left
    check(99, 9, 'R99C9')         // bottom-right
    check(50, 5, 'R50C5')         // middle
    check(0, 9, 'R0C9')           // top-right
    check(99, 0, 'R99C0')         // bottom-left

    dbRestored.close()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. Concurrent backup safety
// ══════════════════════════════════════════════════════════════════════════════

describe('Concurrent backup safety', () => {
  it('writing to DB during backup does not corrupt either', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 10, columnCount: 2 })
    const nameCol = columnIds[0]

    // Insert initial cells
    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    for (let i = 0; i < 10; i++) {
      insCell.run(rowIds[i], nameCol, `Original-${i}`)
    }

    // WAL checkpoint to flush before backup
    t.db.pragma('wal_checkpoint(TRUNCATE)')

    // Create backup while DB handle is still open
    const backupPath = join(backupDir, 'concurrent-backup.db')
    copyFileSync(t.dbPath, backupPath)
    // Also copy WAL/SHM if they exist (they may contain uncommitted data)
    for (const suffix of ['-wal', '-shm']) {
      const src = t.dbPath + suffix
      if (existsSync(src)) copyFileSync(src, backupPath + suffix)
    }

    // Write MORE data to original DB after backup copy
    for (let i = 0; i < 5; i++) {
      t.db.prepare(
        "INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))"
      ).run(gridId, 100 + i)
    }
    t.db.close()

    // Original should have 15 rows
    const dbOrig = openEncryptedDb(t.dbPath)
    const origCount = (dbOrig.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(origCount).toBe(15)
    dbOrig.close()

    // Backup should have exactly 10 rows (the state at backup time)
    const dbBackup = openEncryptedDb(backupPath)
    const backupCount = (dbBackup.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(backupCount).toBe(10)

    // Both databases should be fully functional (not corrupted)
    const origCells = (dbBackup.prepare('SELECT COUNT(*) as c FROM cells WHERE column_id = ?').get(nameCol) as { c: number }).c
    expect(origCells).toBe(10)
    dbBackup.close()
  })

  it('WAL checkpoint before backup ensures consistent snapshot', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 5, columnCount: 1 })
    const col = columnIds[0]

    // Write cells in WAL (not yet checkpointed)
    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    for (let i = 0; i < 5; i++) {
      insCell.run(rowIds[i], col, `WAL-${i}`)
    }

    // Checkpoint before backup (as backup.ts does)
    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    const backupPath = join(backupDir, 'wal-consistent.db')
    copyFileSync(t.dbPath, backupPath)

    // Backup should contain all WAL data
    const dbBackup = openEncryptedDb(backupPath)
    const cellCount = (dbBackup.prepare('SELECT COUNT(*) as c FROM cells WHERE column_id = ?').get(col) as { c: number }).c
    expect(cellCount).toBe(5)

    const val = (dbBackup.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[2], col) as { value: string })
    expect(val.value).toBe('WAL-2')
    dbBackup.close()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. .pulse-backup zip round-trip (the actual production backup format)
// ══════════════════════════════════════════════════════════════════════════════

describe('.pulse-backup zip round-trip', () => {
  it('full cycle: seed → backup → modify → restore → verify', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 8, columnCount: 3 })
    const col = columnIds[0]

    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    for (let i = 0; i < 8; i++) {
      insCell.run(rowIds[i], col, `Name-${i}`)
    }

    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    // Create .pulse-backup
    const backupZip = join(backupDir, 'zip-roundtrip.pulse-backup')
    await createPulseBackup(t.dbPath, backupZip)

    // Modify: delete all rows
    const db2 = openEncryptedDb(t.dbPath)
    db2.prepare('DELETE FROM cells WHERE column_id = ?').run(col)
    db2.prepare('DELETE FROM rows WHERE grid_id = ?').run(gridId)
    const countAfter = (db2.prepare('SELECT COUNT(*) as c FROM rows').get() as { c: number }).c
    expect(countAfter).toBe(0)
    db2.close()

    // Restore from .pulse-backup
    const { safetyPath } = await restoreFromPulseBackup(backupZip, t.dbPath, backupDir)

    // Verify original data restored
    const db3 = openEncryptedDb(t.dbPath)
    const rowCount = (db3.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(rowCount).toBe(8)

    const cell = db3.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[4], col) as { value: string }
    expect(cell.value).toBe('Name-4')
    db3.close()

    // Safety backup should exist and contain the modified (empty) state
    expect(existsSync(safetyPath)).toBe(true)
    const dbSafety = openEncryptedDb(safetyPath)
    const safetyCount = (dbSafety.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
    expect(safetyCount).toBe(0) // the modified (empty) state was backed up
    dbSafety.close()
  })

  it('metadata in .pulse-backup contains required fields', async () => {
    seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    const backupZip = join(backupDir, 'meta-check.pulse-backup')
    await createPulseBackup(t.dbPath, backupZip, 'manual')

    const entries = await readZipEntries(backupZip)
    const metaBuf = entries.get('backup-meta.json')
    expect(metaBuf).toBeDefined()

    const meta = JSON.parse(metaBuf!.toString('utf8')) as BackupMeta
    expect(meta.created).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(meta.backupType).toBe('manual')
    expect(meta.dbFilename).toBe('test.db')
    expect(meta.dbSha256).toHaveLength(64)
    expect(meta.appVersion).toBeDefined()
  })

  it('zip without .db entry fails restore', async () => {
    t.db.close()

    const badZip = join(backupDir, 'no-db.pulse-backup')
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from('No database here'), 'readme.txt')
    zip.end()
    await pipeline(zip.outputStream, createWriteStream(badZip))

    await expect(
      restoreFromPulseBackup(badZip, t.dbPath, backupDir)
    ).rejects.toThrow(/No database file found/)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7. Edge cases and error paths
// ══════════════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('backup of empty DB (schema only, no data) succeeds', async () => {
    // DB has schema from migrations but no user data
    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    const backupZip = join(backupDir, 'empty.pulse-backup')
    await createPulseBackup(t.dbPath, backupZip)

    expect(existsSync(backupZip)).toBe(true)
    expect(statSync(backupZip).size).toBeGreaterThan(0)

    // Restore and verify schema intact
    const freshDir = mkdtempSync(join(tmpdir(), 'pulse-empty-restore-'))
    const freshDbPath = join(freshDir, 'empty-restored.db')

    const entries = await readZipEntries(backupZip)
    const dbEntryName = [...entries.keys()].find(k => k.endsWith('.db'))!
    writeFileSync(freshDbPath, entries.get(dbEntryName)!)

    const dbRestored = openEncryptedDb(freshDbPath)
    const tables = (dbRestored.prepare("SELECT COUNT(*) as n FROM sqlite_master WHERE type='table'").get() as { n: number }).n
    expect(tables).toBeGreaterThan(5) // schema has many tables even with no data
    dbRestored.close()

    try { rmSync(freshDir, { recursive: true, force: true }) } catch { /* cleanup */ }
  })

  it('restore from nonexistent file throws', async () => {
    t.db.close()

    await expect(
      restoreFromPulseBackup('/tmp/nonexistent-backup.pulse-backup', t.dbPath, backupDir)
    ).rejects.toThrow(/Backup file not found/)

    expect(() => {
      restoreFromDb('/tmp/nonexistent-backup.db', t.dbPath, backupDir)
    }).toThrow(/Backup file not found/)
  })

  it('backup file is encrypted — not readable as plain SQLite', () => {
    seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.pragma('wal_checkpoint(TRUNCATE)')
    t.db.close()

    const backupPath = join(backupDir, 'encrypted-check.db')
    copyFileSync(t.dbPath, backupPath)

    const header = readFileSync(backupPath).subarray(0, 16)
    expect(header.toString('ascii')).not.toContain('SQLite format 3')
  })
})
