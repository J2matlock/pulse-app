/**
 * Shared helpers for backup tests: databases in the exact format Pulse writes
 * (SQLCipher 4 defaults, keyed with the hex DB key the way setEncryptionKey does),
 * and small zip read/write helpers for building or inspecting .pulse-backup files.
 *
 * The regular createTestDb() uses a passphrase and 1,000 KDF iterations for speed,
 * which backup.ts's readEncryptedDbInfo can't open, so tests that go through
 * verifyBackup / restoreBackupOnNewInstall need a production-format database.
 */
import BetterSqlite3 from 'better-sqlite3-multiple-ciphers'
import type { Database } from 'better-sqlite3'
import { createWriteStream, readFileSync, writeFileSync } from 'fs'
import { pipeline } from 'stream/promises'
import yazl from 'yazl'
import yauzl from 'yauzl'
import { allMigrations } from './helpers'

/** A fixed 256-bit DB key for tests (64 lowercase hex chars, as getDbKey().toString('hex') gives) */
export const PROD_TEST_KEY_HEX = '0123456789abcdef'.repeat(4)

/** Open a database the way production does: cipher, then the hex key, defaults for everything else. */
export function openProdFormatDb(dbPath: string, hexKey = PROD_TEST_KEY_HEX): Database {
  const db = new BetterSqlite3(dbPath) as Database
  db.pragma(`cipher='sqlcipher'`)
  db.pragma(`key='${hexKey}'`)
  db.pragma('foreign_keys = ON')
  return db
}

/**
 * Create a production-format database with the real migrations applied, up to
 * `upToVersion` (default: all of them). Returns the open handle in WAL mode.
 */
export function createProdFormatDb(dbPath: string, opts: { hexKey?: string; upToVersion?: number } = {}): Database {
  const db = openProdFormatDb(dbPath, opts.hexKey)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const upTo = opts.upToVersion ?? Infinity
  for (const m of allMigrations) {
    if (m.version > upTo) break
    // Same as createTestDb: called directly (016 runs VACUUM, which can't be in a transaction)
    m.up(db)
  }
  return db
}

/** Write a zip whose entries are buffers/strings, or `{ file }` to add a file from disk. */
export async function writeZip(destPath: string, entries: Record<string, Buffer | string | { file: string }>): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const [name, data] of Object.entries(entries)) {
    if (typeof data === 'object' && !Buffer.isBuffer(data)) zip.addFile(data.file, name)
    else zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name)
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(destPath))
}

/**
 * Write a zip with entry names yazl refuses to create ("../x.db", "a\\b.db",
 * "C:x.db"), as a hostile archive would have. Each entry is written under a
 * same-length placeholder name, then the placeholder bytes are swapped for the
 * real name in the finished archive (names aren't covered by the CRC).
 */
export async function writeZipWithRawNames(destPath: string, entries: Array<{ name: string; file: string }>): Promise<void> {
  const placeholders = entries.map((e, i) => {
    const tag = `z${i}`
    if (e.name.length < tag.length + 1) throw new Error(`Entry name too short to swap in: ${e.name}`)
    return tag.padStart(Buffer.byteLength(e.name), 'q')
  })
  await writeZip(destPath, Object.fromEntries(entries.map((e, i) => [placeholders[i] ?? '', { file: e.file }])))
  let buf = readFileSync(destPath)
  entries.forEach((e, i) => {
    const from = Buffer.from(placeholders[i] ?? '')
    const to = Buffer.from(e.name)
    let at = buf.indexOf(from)
    let swaps = 0
    while (at !== -1) { to.copy(buf, at); swaps++; at = buf.indexOf(from, at + to.length) }
    if (swaps < 2) throw new Error(`Expected the name in both zip headers: ${e.name}`)
  })
  writeFileSync(destPath, buf)
  buf = Buffer.alloc(0)
}

/** Read every entry of a zip into memory. */
export function readZip(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolveP, rejectP) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) { rejectP(err ?? new Error('Failed to open zip')); return }
      const result = new Map<string, Buffer>()
      zipfile.on('error', rejectP)
      zipfile.on('end', () => { zipfile.close(); resolveP(result) })
      zipfile.on('entry', (entry: yauzl.Entry) => {
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) { zipfile.close(); rejectP(streamErr ?? new Error('No stream')); return }
          const chunks: Buffer[] = []
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk))
          readStream.on('end', () => { result.set(entry.fileName, Buffer.concat(chunks)); zipfile.readEntry() })
          readStream.on('error', rejectP)
        })
      })
      zipfile.readEntry()
    })
  })
}

/** Count rows in a table of an open database */
export function countRows(db: Database, table: string, where = '1=1', ...params: unknown[]): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).get(...params) as { c: number }).c
}
