/**
 * SQLCipher-specific test suite. The cipher build always ships with Pulse, so these
 * run unconditionally: a broken or missing cipher module must fail, not skip.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers'
import type { Database } from 'better-sqlite3-multiple-ciphers'

const KEY_A = 'test-cipher-key-alpha-0123456789'
const KEY_B = 'test-cipher-key-bravo-9876543210'

// Temp dirs to clean up after all tests
const tempDirs: string[] = []

function createCipherDb(dbPath: string, key: string): Database {
  const db = new BetterSqlite3(dbPath) as Database
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('kdf_iter=1000')
  db.pragma('cipher_page_size=4096')
  db.pragma('cipher_hmac_algorithm=HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm=PBKDF2_HMAC_SHA512')
  db.pragma(`key='${key}'`)
  db.pragma('foreign_keys = ON')
  return db
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pulse-cipher-test-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})

describe('SQLCipher encryption', () => {
  it('should open encrypted database with correct key', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'correct-key.db')

    // Create DB, insert data, close
    const db = createCipherDb(dbPath, KEY_A)
    db.exec('CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT)')
    db.prepare('INSERT INTO clients (name) VALUES (?)').run('Alice')
    db.prepare('INSERT INTO clients (name) VALUES (?)').run('Bob')
    db.close()

    // Reopen with correct key — should read data
    const db2 = createCipherDb(dbPath, KEY_A)
    const rows = db2.prepare('SELECT name FROM clients ORDER BY name').all() as { name: string }[]
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('Alice')
    expect(rows[1].name).toBe('Bob')
    db2.close()
  })

  it('should reject wrong key', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'wrong-key.db')

    // Create DB with KEY_A
    const db = createCipherDb(dbPath, KEY_A)
    db.exec('CREATE TABLE data (id INTEGER PRIMARY KEY, val TEXT)')
    db.prepare('INSERT INTO data (val) VALUES (?)').run('secret')
    db.close()

    // Reopen with wrong key — should throw on query
    expect(() => {
      const db2 = createCipherDb(dbPath, 'completely-wrong-key')
      db2.prepare('SELECT * FROM data').all()
    }).toThrow()
  })

  it('should support rekey operation', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'rekey.db')

    // Create DB with KEY_A
    const db = createCipherDb(dbPath, KEY_A)
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)')
    db.prepare('INSERT INTO items (label) VALUES (?)').run('Item 1')
    db.prepare('INSERT INTO items (label) VALUES (?)').run('Item 2')

    // Rekey to KEY_B (must exit WAL mode first)
    db.pragma('journal_mode = DELETE')
    db.pragma(`rekey='${KEY_B}'`)
    db.close()

    // KEY_B should work
    const db2 = createCipherDb(dbPath, KEY_B)
    const rows = db2.prepare('SELECT label FROM items ORDER BY label').all() as { label: string }[]
    expect(rows).toHaveLength(2)
    expect(rows[0].label).toBe('Item 1')
    expect(rows[1].label).toBe('Item 2')
    db2.close()

    // KEY_A should fail
    expect(() => {
      const db3 = createCipherDb(dbPath, KEY_A)
      db3.prepare('SELECT * FROM items').all()
    }).toThrow()
  })

  it('should produce encrypted file on disk (no plaintext table/column names)', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'encrypted-check.db')

    // Create DB with recognizable table and column names
    const db = createCipherDb(dbPath, KEY_A)
    db.exec('CREATE TABLE plaintext_marker_table (plaintext_marker_column TEXT)')
    db.prepare('INSERT INTO plaintext_marker_table (plaintext_marker_column) VALUES (?)').run('plaintext_marker_value')
    db.close()

    // Read the raw file bytes
    const rawBytes = readFileSync(dbPath)

    // The raw file should NOT contain the plaintext marker strings
    const rawString = rawBytes.toString('latin1') // latin1 preserves byte values
    expect(rawString).not.toContain('plaintext_marker_table')
    expect(rawString).not.toContain('plaintext_marker_column')
    expect(rawString).not.toContain('plaintext_marker_value')

    // Standard unencrypted SQLite files start with "SQLite format 3\0"
    const header = rawBytes.subarray(0, 16).toString('ascii')
    expect(header).not.toContain('SQLite format 3')
  })

  it('should handle multiple open/close cycles without corruption', () => {
    const dir = makeTempDir()
    const dbPath = join(dir, 'multi-cycle.db')

    // Create
    const db1 = createCipherDb(dbPath, KEY_A)
    db1.exec('CREATE TABLE counters (id INTEGER PRIMARY KEY, n INTEGER)')
    db1.prepare('INSERT INTO counters (n) VALUES (?)').run(0)
    db1.close()

    // Open/increment/close 10 times
    for (let i = 1; i <= 10; i++) {
      const db = createCipherDb(dbPath, KEY_A)
      db.prepare('UPDATE counters SET n = ? WHERE id = 1').run(i)
      db.close()
    }

    // Verify final value
    const dbFinal = createCipherDb(dbPath, KEY_A)
    const row = dbFinal.prepare('SELECT n FROM counters WHERE id = 1').get() as { n: number }
    expect(row.n).toBe(10)
    dbFinal.close()
  })
})
