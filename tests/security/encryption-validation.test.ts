/**
 * Encryption validation tests — verify that encrypted databases cannot be
 * read without the correct key, and that the encryption is real (not just
 * a flag that gets ignored).
 */
import { describe, it, expect, afterEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers'
import type { Database } from 'better-sqlite3-multiple-ciphers'
import { readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import {
  createTestDb,
  createEmptyEncryptedDb,
  openEncryptedDb,
  cleanupTestDb,
  seedGrid,
  TEST_PASSWORD,
  type TestDb,
} from '../helpers'

const temps: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pulse-enc-test-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ }
  }
  temps.length = 0
})

describe('Encrypted database is not readable as plain SQLite', () => {
  it('file header does not contain "SQLite format 3"', () => {
    const t = createTestDb()
    try {
      // Write some data so the file is non-trivial
      seedGrid(t.db, { rowCount: 5, columnCount: 3 })
      t.db.close()

      const header = readFileSync(t.dbPath).subarray(0, 32)
      const headerStr = header.toString('ascii')
      expect(headerStr).not.toContain('SQLite format 3')
    } finally {
      try { rmSync(t.tmpDir, { recursive: true, force: true }) } catch { /* */ }
    }
  })

  it('encrypted file looks like random bytes (high entropy)', () => {
    const t = createTestDb()
    try {
      seedGrid(t.db, { rowCount: 10, columnCount: 5 })
      t.db.close()

      const data = readFileSync(t.dbPath)
      // Count unique byte values in first 1024 bytes — encrypted data should have high diversity
      const first1k = data.subarray(0, Math.min(1024, data.length))
      const uniqueBytes = new Set(first1k)
      // Encrypted data should use most of the 256 possible byte values
      expect(uniqueBytes.size).toBeGreaterThan(100)
    } finally {
      try { rmSync(t.tmpDir, { recursive: true, force: true }) } catch { /* */ }
    }
  })
})

describe('Opening encrypted DB without key fails', () => {
  it('opening without any key throws on query', () => {
    const t = createTestDb()
    try {
      seedGrid(t.db, { rowCount: 3, columnCount: 2 })
      t.db.close()

      // Open without encryption setup
      const plainDb = new BetterSqlite3(t.dbPath) as Database
      expect(() => {
        plainDb.prepare('SELECT * FROM grids').all()
      }).toThrow()
      plainDb.close()
    } finally {
      try { rmSync(t.tmpDir, { recursive: true, force: true }) } catch { /* */ }
    }
  })

  it('opening with wrong key throws on query', () => {
    const t = createTestDb()
    try {
      seedGrid(t.db, { rowCount: 3, columnCount: 2 })
      t.db.close()

      // Open with wrong key
      const wrongDb = new BetterSqlite3(t.dbPath) as Database
      wrongDb.pragma(`cipher='sqlcipher'`)
      wrongDb.pragma('kdf_iter=1000')
      wrongDb.pragma('cipher_page_size=4096')
      wrongDb.pragma('cipher_hmac_algorithm=HMAC_SHA512')
      wrongDb.pragma('cipher_kdf_algorithm=PBKDF2_HMAC_SHA512')
      wrongDb.pragma(`key='completely-wrong-key-1234567890ab'`)

      expect(() => {
        wrongDb.prepare('SELECT * FROM grids').all()
      }).toThrow()
      wrongDb.close()
    } finally {
      try { rmSync(t.tmpDir, { recursive: true, force: true }) } catch { /* */ }
    }
  })

  it('opening with correct key succeeds', () => {
    const t = createTestDb()
    try {
      const { gridId } = seedGrid(t.db, { rowCount: 3, columnCount: 2, name: 'Encryption Test' })
      t.db.close()

      // Reopen with correct key
      const db = openEncryptedDb(t.dbPath, TEST_PASSWORD)
      const grids = db.prepare('SELECT name FROM grids WHERE id = ?').get(gridId) as { name: string }
      expect(grids.name).toBe('Encryption Test')
      db.close()
    } finally {
      try { rmSync(t.tmpDir, { recursive: true, force: true }) } catch { /* */ }
    }
  })
})

describe('Data integrity after encrypt/close/reopen', () => {
  it('cell data survives close and reopen cycle', () => {
    const t = createTestDb()
    try {
      const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 2, columnCount: 2 })
      t.db.prepare(`
        INSERT INTO cells (row_id, column_id, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(rowIds[0], columnIds[0], 'Sensitive Client Data')
      t.db.close()

      const db = openEncryptedDb(t.dbPath, TEST_PASSWORD)
      const cell = db.prepare(
        'SELECT value FROM cells WHERE row_id = ? AND column_id = ?'
      ).get(rowIds[0], columnIds[0]) as { value: string }
      expect(cell.value).toBe('Sensitive Client Data')
      db.close()
    } finally {
      try { rmSync(t.tmpDir, { recursive: true, force: true }) } catch { /* */ }
    }
  })

  it('multiple tables survive close and reopen', () => {
    const t = createTestDb()
    try {
      seedGrid(t.db, { rowCount: 5, columnCount: 3 })
      t.db.close()

      const db = openEncryptedDb(t.dbPath, TEST_PASSWORD)
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all() as Array<{ name: string }>
      const tableNames = tables.map(t => t.name)

      expect(tableNames).toContain('grids')
      expect(tableNames).toContain('columns')
      expect(tableNames).toContain('rows')
      expect(tableNames).toContain('cells')
      expect(tableNames).toContain('case_log')
      db.close()
    } finally {
      try { rmSync(t.tmpDir, { recursive: true, force: true }) } catch { /* */ }
    }
  })
})

describe('Encryption with different cipher parameters fails cross-read', () => {
  it('DB encrypted with different kdf_iter cannot be opened with standard params', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'diff-iter.db')

    // Create with non-standard iterations
    const db1 = new BetterSqlite3(dbPath) as Database
    db1.pragma(`cipher='sqlcipher'`)
    db1.pragma('kdf_iter=5000')  // Different from our standard 1000
    db1.pragma('cipher_page_size=4096')
    db1.pragma('cipher_hmac_algorithm=HMAC_SHA512')
    db1.pragma('cipher_kdf_algorithm=PBKDF2_HMAC_SHA512')
    db1.pragma(`key='${TEST_PASSWORD}'`)
    db1.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)')
    db1.prepare('INSERT INTO test (val) VALUES (?)').run('secret')
    db1.close()

    // Try to open with standard params (kdf_iter=1000) — should fail
    expect(() => {
      const db2 = openEncryptedDb(dbPath, TEST_PASSWORD)
      db2.prepare('SELECT * FROM test').all()
      db2.close()
    }).toThrow()
  })
})

describe('Empty encrypted database', () => {
  it('empty encrypted DB is still not readable without key', () => {
    const t = createEmptyEncryptedDb()
    try {
      // Create at least one table so the file has content
      t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      t.db.close()

      const plainDb = new BetterSqlite3(t.dbPath) as Database
      expect(() => {
        plainDb.prepare("SELECT * FROM app_meta").all()
      }).toThrow()
      plainDb.close()
    } finally {
      cleanupTestDb(t)
    }
  })
})
