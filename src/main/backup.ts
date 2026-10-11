/**
 * backup.ts — Three-layer backup system.
 *
 * Layer 1: Silent auto-backup on close (rolling 5 copies, internal .db files)
 * Layer 2: Scheduled backup (configurable interval, user-chosen destination, .pulse-backup)
 * Layer 3: Manual "Pack & Go" (.pulse-backup — same format as Layer 2)
 *
 * User-facing backups (Layers 2 & 3) always produce .pulse-backup zip archives
 * containing the database plus metadata. Internal backups (Layer 1 & pre-migration)
 * stay as raw .db copies for speed.
 */

import { copyFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, statSync, rmSync, chmodSync, renameSync, openSync, closeSync, fsyncSync, createReadStream, createWriteStream } from 'fs'
import { join, dirname, basename, resolve, sep } from 'path'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'
import yazl from 'yazl'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yauzl = require('yauzl') as typeof import('yauzl')
import { app } from 'electron'
import { logger } from './logger'
import { logNonFatal } from './ipc/ipc-utils'
import Store from 'electron-store'
import { getStoredDbPath, getDbKey, getKeyEnvelope, isValidKeyEnvelope, unwrapKeyEnvelope, adoptRestoredDbKey } from './auth'
import { MS_PER_DAY } from '../shared/constants'
import { LIMIT_MB_RANGE, formatBytes } from '../shared/attachments'
import { getPortableDataDir, setEncryptionKey, resolveDatabasePath } from './database'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const BetterSqlite3 = require('better-sqlite3-multiple-ciphers') as typeof import('better-sqlite3')

// ── Bridge to database.ts (avoids circular require that breaks in bundled builds) ──
// database.ts calls setDatabaseBridge() at startup to provide its functions.

/** Minimal subset of the better-sqlite3 Database interface used by backup routines. */
export interface DatabaseBridge {
  pragma(sql: string): unknown
  exec(sql: string): void
}

let _closeDatabase: (() => void) | null = null
let _getDb: (() => DatabaseBridge) | null = null

export function setDatabaseBridge(fns: {
  closeDatabase: () => void
  getDb: () => DatabaseBridge
}): void {
  _closeDatabase = fns.closeDatabase
  _getDb = fns.getDb
}

function closeDatabaseIfOpen(): void {
  try {
    _closeDatabase?.()
  } catch (err) { logNonFatal('backup', 'closeDatabaseIfOpen', err) }
}

/**
 * Atomic copy: write to temp file, fsync, then rename.
 * Prevents data corruption if power is lost mid-write.
 */
function atomicCopyFileSync(src: string, dest: string): void {
  const tmpDest = dest + '.tmp'
  copyFileSync(src, tmpDest)
  // fsync the temp file to ensure all data is flushed to disk before rename
  const fd = openSync(tmpDest, 'r+')
  try { fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmpDest, dest)
}

/**
 * Validate that a resolved path stays within the expected parent directory.
 * Prevents path traversal attacks from ZIP entry names.
 */
export function assertPathWithin(child: string, parent: string): void {
  const resolvedChild = resolve(child)
  const resolvedParent = resolve(parent)
  if (!resolvedChild.startsWith(resolvedParent + sep) && resolvedChild !== resolvedParent) {
    throw new Error(`Path traversal detected: ${child} is outside ${parent}`)
  }
}


// ── yauzl helpers (promisified wrappers for callback-based API) ──────────────

interface ZipEntry {
  entryName: string
  uncompressedSize: number
}

interface OpenZipResult {
  entries: ZipEntry[]
  /** Extract a single entry to a file on disk (streaming). */
  extractEntry(entryName: string, destPath: string): Promise<void>
  /** Read a small entry fully into a Buffer (for metadata JSON). */
  readEntry(entryName: string): Promise<Buffer>
  close(): void
}

function openZip(zipPath: string): Promise<OpenZipResult> {
  return new Promise<OpenZipResult>((resolveP, rejectP) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) { rejectP(err ?? new Error('Failed to open zip')); return }

      const entries: ZipEntry[] = []
      const entryMap = new Map<string, import('yauzl').Entry>()

      zipfile.on('entry', (entry: import('yauzl').Entry) => {
        entries.push({ entryName: entry.fileName, uncompressedSize: entry.uncompressedSize })
        entryMap.set(entry.fileName, entry)
        zipfile.readEntry()
      })

      zipfile.on('error', rejectP)

      zipfile.on('end', () => {
        resolveP({
          entries,
          extractEntry(entryName: string, destPath: string): Promise<void> {
            return new Promise<void>((res, rej) => {
              const entry = entryMap.get(entryName)
              if (!entry) { rej(new Error(`Entry not found: ${entryName}`)); return }
              zipfile.openReadStream(entry, (streamErr, readStream) => {
                if (streamErr || !readStream) { rej(streamErr ?? new Error('No stream')); return }
                const ws = createWriteStream(destPath)
                readStream.pipe(ws)
                ws.on('finish', res)
                ws.on('error', rej)
                readStream.on('error', rej)
              })
            })
          },
          readEntry(entryName: string): Promise<Buffer> {
            return new Promise<Buffer>((res, rej) => {
              const entry = entryMap.get(entryName)
              if (!entry) { rej(new Error(`Entry not found: ${entryName}`)); return }
              zipfile.openReadStream(entry, (streamErr, readStream) => {
                if (streamErr || !readStream) { rej(streamErr ?? new Error('No stream')); return }
                const chunks: Buffer[] = []
                readStream.on('data', (chunk: Buffer) => chunks.push(chunk))
                readStream.on('end', () => res(Buffer.concat(chunks)))
                readStream.on('error', rej)
              })
            })
          },
          close() { zipfile.close() }
        })
      })

      zipfile.readEntry()
    })
  })
}

const MAX_AUTO_BACKUPS = 5
const MAX_SCHEDULED_BACKUPS = 10
const KEY_ENVELOPE_ENTRY = 'key-envelope.json'
/**
 * Largest database a backup may hold. Files live inside the database and their
 * allowance goes up to LIMIT_MB_RANGE.max, so the limit is that plus room for
 * everything else. Making and restoring use the same number, so Pulse never
 * writes a backup it would later refuse to restore.
 */
export const MAX_BACKUP_BYTES = (LIMIT_MB_RANGE.max + 512) * 1024 * 1024
let _maxBackupBytesOverride: number | null = null
/** Tests only: pretend the limit is this many bytes (null puts it back). */
export function setMaxBackupBytesForTests(n: number | null): void { _maxBackupBytesOverride = n }
function maxBackupBytes(): number { return _maxBackupBytesOverride ?? MAX_BACKUP_BYTES }
function tooBigToRestore(): string { return `This backup is larger than ${formatBytes(maxBackupBytes())}, so Pulse won't restore it.` }

/** A .db entry at the archive root (no directories, no traversal, no drive letters). */
function isSafeDbEntryName(name: string): boolean {
  return name.endsWith('.db') && !name.includes('..') && !name.includes('/') && !name.includes('\\') && !/^[A-Za-z]:/.test(name)
}

/**
 * Open an encrypted DB read-only with an explicit key and read its app schema
 * version. Throws if the key is wrong or the file isn't a Pulse database.
 */
function readEncryptedDbInfo(dbFile: string, hexKey: string): { schemaVersion: number; tableCount: number } {
  let db: InstanceType<typeof BetterSqlite3> | null = null
  try {
    db = new BetterSqlite3(dbFile, { readonly: true })
    db.pragma(`cipher='sqlcipher'`)
    setEncryptionKey(db, hexKey)
    db.pragma("kdf_iter=256000")
    db.pragma("cipher_page_size=4096")
    db.pragma("cipher_hmac_algorithm=HMAC_SHA512")
    db.pragma("cipher_kdf_algorithm=PBKDF2_HMAC_SHA512")
    const tableCount = (db.prepare("SELECT count(*) as n FROM sqlite_master WHERE type='table'").get() as { n: number }).n
    // app_meta.schema_version is the app's migration level; PRAGMA schema_version is SQLite's schema cookie
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string } | undefined
    return { schemaVersion: row ? parseInt(row.value, 10) : 0, tableCount }
  } finally {
    try { db?.close() } catch (err) { logNonFatal('backup', 'close encrypted DB after inspection', err) }
  }
}

/**
 * Flush WAL into the main DB file so a copyFileSync produces a self-consistent backup.
 * Safe to call even if the DB is closed — silently no-ops.
 */
function checkpointWal(): void {
  try {
    const database = _getDb?.()
    if (database) database.pragma('wal_checkpoint(TRUNCATE)')
  } catch (err) { logger.warn('backup', 'WAL checkpoint failed (DB may not be open)', err) }
}

/**
 * Remove stale WAL and SHM files so SQLite doesn't replay old journal
 * data on top of a freshly restored database.
 */
function removeWalFiles(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const p = dbPath + suffix
    if (existsSync(p)) {
      try { unlinkSync(p) } catch (err) {
        logger.warn('backup', `Could not remove WAL file ${p}`, err)
      }
    }
  }
}

/**
 * Compute SHA-256 of a file using streaming to avoid blocking on large files.
 */
function streamHash(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', (err) => { stream.destroy(); reject(err) })
  })
}

/**
 * Create an atomic point-in-time snapshot of the database.
 * Returns the path to the temp snapshot file, which the caller must clean up.
 *
 * Options:
 * - compact: true (default) — uses VACUUM INTO, produces a defragmented copy
 *   but blocks the DB for the duration. Best for manual backups.
 * - compact: false — uses WAL checkpoint + file copy. Much faster and
 *   non-blocking for large databases. Best for auto-backup on close.
 *
 * Falls back to checkpoint+copy if the database bridge is unavailable.
 */
function createAtomicDbSnapshot(dbPath: string, snapshotDir: string, opts?: { compact?: boolean }): string {
  const compact = opts?.compact ?? true
  const tmpDbPath = join(snapshotDir, `pulse-snapshot-${Date.now()}.db`)

  const database = _getDb?.()
  if (!compact && database) {
    // Fast path: checkpoint WAL to flush all data to main file, then copy.
    // Use exclusive lock to prevent any writes between checkpoint and copy,
    // ensuring the backup is a consistent point-in-time snapshot.
    try {
      database.pragma('locking_mode=EXCLUSIVE')
      database.pragma('wal_checkpoint(TRUNCATE)')
      copyFileSync(dbPath, tmpDbPath)
    } finally {
      // Always release the exclusive lock, even if copy fails
      database.pragma('locking_mode=NORMAL')
      // A no-op read is required to actually release the EXCLUSIVE lock
      database.pragma('journal_mode')
    }
    return tmpDbPath
  }

  if (database) {
    // VACUUM INTO is atomic — no window for interleaved writes
    const SAFE_PATH_RE = /^[a-zA-Z0-9_\-./\\: ]+$/
    if (!SAFE_PATH_RE.test(tmpDbPath)) {
      throw new Error('Snapshot path contains unsafe characters')
    }
    // No quote check needed — SAFE_PATH_RE already rejects quotes, so the
    // replace(/'/g, "''") below is defense-in-depth (not dead code per se,
    // but the regex guarantees no quotes reach this point).
    database.exec(`VACUUM INTO '${tmpDbPath}'`)
  } else {
    // Fallback: checkpoint WAL then copy (less safe but works without DB bridge).
    // No exclusive lock possible without a DB handle — best-effort only.
    checkpointWal()
    copyFileSync(dbPath, tmpDbPath)
  }

  return tmpDbPath
}

/**
 * Create a .pulse-backup zip archive containing the database and metadata.
 * Used by both scheduled (Layer 2) and manual (Layer 3) backups.
 * Uses VACUUM INTO for an atomic snapshot so no writes can interleave between
 * checkpoint and copy. The temp snapshot is cleaned up after zipping.
 * Async: uses streaming hash to avoid blocking the main thread on large DBs.
 */
async function createPulseBackup(dbPath: string, destPath: string, backupType: string): Promise<number> {
  const finalPath = destPath.endsWith('.pulse-backup') ? destPath : destPath + '.pulse-backup'
  mkdirSync(dirname(finalPath), { recursive: true, mode: 0o700 })

  // Create an atomic snapshot via VACUUM INTO so the zip contains a
  // consistent point-in-time copy (no interleaved writes possible)
  const snapshotDir = dirname(finalPath)
  const tmpDbPath = createAtomicDbSnapshot(dbPath, snapshotDir)

  try {
    const snapshotBytes = statSync(tmpDbPath).size
    // A little room under the limit: the zip around the data adds a few bytes
    if (snapshotBytes > maxBackupBytes() * 0.98) {
      throw Object.assign(
        new Error(`Your data is ${formatBytes(snapshotBytes)}, which is more than a backup can hold (${formatBytes(maxBackupBytes())}). Remove files you no longer need and empty the files trash, then try again.`),
        { code: 'PULSE_TOO_BIG' },
      )
    }
    // Compute SHA-256 with streaming to avoid blocking on large DBs
    const dbHash = await streamHash(tmpDbPath)

    const storedDocsDir = join(getPortableDataDir(), 'pulse-files', 'documents')
    const hasStoredDocs = existsSync(storedDocsDir) && readdirSync(storedDocsDir).length > 0

    // Password/recovery-wrapped DB key so this backup can be opened on another
    // computer (see KeyEnvelope in auth.ts). Without it, the backup only works
    // on the machine that made it.
    const envelope = getKeyEnvelope()
    if (!envelope) logger.warn('backup', 'Key envelope unavailable — backup will only restore on this computer')

    const meta = {
      created: new Date().toISOString(),
      appVersion: app.getVersion(),
      backupType,
      dbFilename: basename(dbPath),
      dbSha256: dbHash,
      has_stored_documents: hasStoredDocs,
      has_key_envelope: !!envelope
    }

    // Streaming zip: never loads the entire DB into memory
    const zipfile = new yazl.ZipFile()
    zipfile.addFile(tmpDbPath, basename(dbPath))
    zipfile.addBuffer(Buffer.from(JSON.stringify(meta, null, 2)), 'backup-meta.json')
    if (envelope) zipfile.addBuffer(Buffer.from(JSON.stringify(envelope)), KEY_ENVELOPE_ENTRY)
    zipfile.end()

    // Atomic write: stream to temp file then rename
    const tmpZipPath = finalPath + '.tmp'
    await pipeline(zipfile.outputStream, createWriteStream(tmpZipPath))
    renameSync(tmpZipPath, finalPath)

    return statSync(finalPath).size
  } finally {
    // Always clean up the temporary snapshot file
    try { if (existsSync(tmpDbPath)) unlinkSync(tmpDbPath) } catch (err) { logNonFatal('backup', 'cleanup snapshot temp file', err) }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────────────

export function getBackupDir(): string {
  const dbPath = getStoredDbPath()
  if (dbPath) {
    return join(dbPath, '..', 'backups')
  }
  return join(app.getPath('userData'), 'backups')
}

function nowTimestamp(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
}

// ──────────────────────────────────────────────────────────────────────────────
// Layer 1 — Auto-backup on close (rolling 5)
// ──────────────────────────────────────────────────────────────────────────────

export async function runAutoBackup(): Promise<void> {
  const dbPath = getStoredDbPath()
  if (!dbPath || !existsSync(dbPath)) return

  const backupDir = getBackupDir()
  mkdirSync(backupDir, { recursive: true, mode: 0o700 })

  const destPath = join(backupDir, `pulse-auto-${nowTimestamp()}.db`)
  assertPathWithin(destPath, backupDir)
  try {
    // Use checkpoint+copy (compact: false) for auto-backup — fast and non-blocking.
    // VACUUM INTO rewrites the entire DB which blocks during large databases.
    const tmpSnapshotPath = createAtomicDbSnapshot(dbPath, backupDir, { compact: false })
    try {
      renameSync(tmpSnapshotPath, destPath)
    } catch (err) {
      // rename may fail across filesystems; fall back to copy+delete
      logNonFatal('backup', 'rename snapshot failed, falling back to copy', err)
      copyFileSync(tmpSnapshotPath, destPath)
      try { unlinkSync(tmpSnapshotPath) } catch (err2) { logNonFatal('backup', 'cleanup snapshot after copy fallback', err2) }
    }
    if (process.platform !== 'win32') {
      try { chmodSync(destPath, 0o600) } catch (err) { logNonFatal('backup', 'chmod auto-backup file', err) }
    }
    recordAutoBackupSuccess()
  } catch (err) {
    // Clean up partial file
    try { if (existsSync(destPath)) unlinkSync(destPath) } catch (err2) { logNonFatal('backup', 'cleanup partial auto-backup file', err2) }
    // Settings shows this word for word, so it's the plain-language reason, not ENOSPC and a path
    recordAutoBackupFailure(describeBackupError(err))
    throw err
  }

  pruneAutoBackups(backupDir)
}

const AUTO_KEEP_DAILY = 7
const AUTO_KEEP_WEEKLY = 4

/**
 * Which auto-backups to keep: the newest few, plus the newest from each of the
 * last 7 days that had one, plus the newest from each of the last 4 weeks.
 * A plain "last 5" rotated out every good copy if the user closed the app five
 * times after a bad bulk edit. Worst case: 5 + 7 + 4 = 16 files.
 */
export function selectAutoBackupsToKeep(filenames: string[]): Set<string> {
  const parsed = filenames
    .map(f => {
      const m = f.match(/^pulse-auto-(\d{4})(\d{2})(\d{2})-\d{6}\.db$/)
      if (!m) return null
      const dayNumber = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY)
      return { f, day: `${m[1]}${m[2]}${m[3]}`, week: Math.floor((dayNumber + 3) / 7) } // +3: weeks start Monday
    })
    .filter((x): x is { f: string; day: string; week: number } => x !== null)
    .sort((a, b) => (a.f < b.f ? 1 : -1)) // newest first (timestamped names sort chronologically)

  const keep = new Set(parsed.slice(0, MAX_AUTO_BACKUPS).map(p => p.f))
  const days = new Set<string>()
  const weeks = new Set<number>()
  for (const p of parsed) {
    if (!days.has(p.day) && days.size < AUTO_KEEP_DAILY) { days.add(p.day); keep.add(p.f) }
    if (!weeks.has(p.week) && weeks.size < AUTO_KEEP_WEEKLY) { weeks.add(p.week); keep.add(p.f) }
  }
  return keep
}

function pruneAutoBackups(dir: string): void {
  const files = readdirSync(dir).filter(f => f.startsWith('pulse-auto-') && f.endsWith('.db'))
  const keep = selectAutoBackupsToKeep(files)
  for (const f of files) {
    if (keep.has(f)) continue
    try { unlinkSync(join(dir, f)) } catch (err) { logger.warn('backup', `Could not prune old backup ${f}`, err) }
  }
}

export function pruneBackups(dir: string, prefix: string, suffix: string, keep: number): void {
  const files = readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
    .sort()  // lexicographic = chronological for YYYY-MM-DD prefix

  while (files.length > keep) {
    const oldest = files.shift()!
    try { unlinkSync(join(dir, oldest)) } catch (err) {
      logger.warn('backup', `Could not prune old backup ${oldest}`, err)
    }
  }
}

export function listAutoBackups(): string[] {
  const backupDir = getBackupDir()
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .filter(f => f.startsWith('pulse-auto-') && f.endsWith('.db'))
    .sort()
    .reverse()
    .map(f => join(backupDir, f))
}

export interface AutoBackupEntry {
  path: string
  filename: string
  timestamp: Date
  sizeBytes: number
}

export function listAutoBackupsRich(): AutoBackupEntry[] {
  const backupDir = getBackupDir()
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .filter(f => f.startsWith('pulse-auto-') && f.endsWith('.db'))
    .sort()
    .reverse()
    .map(filename => {
      const path = join(backupDir, filename)
      const sizeBytes = statSync(path).size
      // Parse timestamp from "pulse-auto-YYYYMMDD-HHmmss.db"
      const m = filename.match(/pulse-auto-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/)
      const timestamp = m
        ? new Date(
            parseInt(m[1] ?? '0'), parseInt(m[2] ?? '1') - 1, parseInt(m[3] ?? '1'),
            parseInt(m[4] ?? '0'), parseInt(m[5] ?? '0'), parseInt(m[6] ?? '0')
          )
        : new Date(statSync(path).mtime)
      return { path, filename, timestamp, sizeBytes }
    })
}

/**
 * Run `fn` against the database file inside a backup. A .pulse-backup is a zip,
 * so its database is extracted to a private temp folder first and removed after.
 */
export async function withBackupDbFile<T>(backupPath: string, fn: (dbFile: string) => T): Promise<T> {
  if (!backupPath.endsWith('.pulse-backup')) return fn(backupPath)
  if (statSync(backupPath).size > maxBackupBytes()) throw new Error(tooBigToRestore())
  const tmpDir = join(getBackupDir(), `preview-tmp-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 })
  let zip: OpenZipResult | null = null
  try {
    zip = await openZip(backupPath)
    const dbEntry = zip.entries.find(e => isSafeDbEntryName(e.entryName))
    if (!dbEntry) throw new Error('No database file found in archive')
    const dbFile = join(tmpDir, dbEntry.entryName)
    assertPathWithin(dbFile, tmpDir)
    await zip.extractEntry(dbEntry.entryName, dbFile)
    return fn(dbFile)
  } finally {
    zip?.close()
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch (err) { logNonFatal('backup', 'cleanup preview temp dir', err) }
  }
}

export interface VerifyResult {
  valid: boolean
  error?: string
  /** The archive opens but not with this install's key, and it carries its own key envelope */
  otherPulse?: boolean
  schemaVersion?: number
  tableCount?: number
}

export async function verifyBackup(backupPath: string): Promise<VerifyResult> {
  if (!existsSync(backupPath)) return { valid: false, error: 'File not found' }

  // For .pulse-backup files, extract DB to temp dir first
  let dbToCheck = backupPath
  let tmpDir: string | null = null
  let hasEnvelope = false

  if (backupPath.endsWith('.pulse-backup')) {
    let zip: OpenZipResult | null = null
    try {
      const compressedSize = statSync(backupPath).size
      if (compressedSize > maxBackupBytes()) {
        return { valid: false, error: tooBigToRestore() }
      }
      zip = await openZip(backupPath)
      const dbEntry = zip.entries.find(e => isSafeDbEntryName(e.entryName))
      if (!dbEntry) return { valid: false, error: 'No database file found in archive' }
      hasEnvelope = zip.entries.some(e => e.entryName === KEY_ENVELOPE_ENTRY)
      tmpDir = join(getBackupDir(), `verify-tmp-${Date.now()}`)
      mkdirSync(tmpDir, { recursive: true, mode: 0o700 })
      dbToCheck = join(tmpDir, dbEntry.entryName)
      // Validate extracted path stays within tmpDir
      try { assertPathWithin(dbToCheck, tmpDir) } catch (err) {
        logger.warn('backup', 'Path traversal detected in backup archive', err)
        if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }) } catch (cleanErr: unknown) {
          logger.warn('backup', 'Could not remove verify temp dir after traversal check', cleanErr)
        } }
        return { valid: false, error: 'Path traversal detected in archive' }
      }
      await zip.extractEntry(dbEntry.entryName, dbToCheck)
      if (!existsSync(dbToCheck)) return { valid: false, error: 'Extraction failed' }

      // Verify SHA-256 hash if metadata includes one (streaming to avoid blocking)
      const metaEntryInfo = zip.entries.find(e => e.entryName === 'backup-meta.json')
      if (metaEntryInfo) {
        try {
          const metaBuf = await zip.readEntry('backup-meta.json')
          const meta = JSON.parse(metaBuf.toString('utf8'))
          if (meta.dbSha256) {
            const actualHash = await streamHash(dbToCheck)
            if (actualHash !== meta.dbSha256) {
              if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }) } catch (cleanErr: unknown) {
                logger.warn('backup', 'Could not remove verify temp dir after hash mismatch', cleanErr)
              } }
              return { valid: false, error: 'Database file hash mismatch — backup may be corrupted' }
            }
          }
        } catch (err) {
          logger.warn('backup', 'Could not parse backup-meta.json — skipping hash check', err)
        }
      }
    } catch (err) {
      if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }) } catch (cleanErr: unknown) {
        logger.warn('backup', 'Could not remove verify temp dir after archive error', cleanErr)
      } }
      return { valid: false, error: err instanceof Error ? err.message : 'Archive read failed' }
    } finally {
      zip?.close()
    }
  }

  try {
    const { schemaVersion, tableCount } = readEncryptedDbInfo(dbToCheck, getDbKey().toString('hex'))
    return { valid: true, schemaVersion, tableCount }
  } catch (err) {
    // This install's key doesn't open it. With a key envelope inside, it was made
    // by another Pulse (another computer, or before a reinstall) and can still be
    // restored with that Pulse's password or recovery key.
    return { valid: false, error: err instanceof Error ? err.message : 'Could not open backup database', otherPulse: hasEnvelope }
  } finally {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch (err) {
        logger.warn('backup', 'Could not remove verify temp dir', err)
      }
    }
  }
}

/**
 * When a backup was made and by which Pulse, for the restore preview. Read from
 * backup-meta.json in a .pulse-backup, or from the timestamp in a local
 * backup's file name.
 */
export async function getBackupMadeInfo(backupPath: string): Promise<{ madeAt: string | null; appVersion: string | null }> {
  if (backupPath.endsWith('.pulse-backup')) {
    let zip: OpenZipResult | null = null
    try {
      zip = await openZip(backupPath)
      if (!zip.entries.some(e => e.entryName === 'backup-meta.json')) return { madeAt: null, appVersion: null }
      const meta = JSON.parse((await zip.readEntry('backup-meta.json')).toString('utf8')) as { created?: unknown; appVersion?: unknown }
      const madeAt = typeof meta.created === 'string' && !isNaN(Date.parse(meta.created)) ? meta.created : null
      const appVersion = typeof meta.appVersion === 'string' && /^[\w.+-]{1,40}$/.test(meta.appVersion) ? meta.appVersion : null
      return { madeAt, appVersion }
    } catch (err) {
      logNonFatal('backup', 'read backup-meta.json for preview', err)
      return { madeAt: null, appVersion: null }
    } finally {
      zip?.close()
    }
  }
  const m = basename(backupPath).match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
    return { madeAt: d.toISOString(), appVersion: null }
  }
  try { return { madeAt: statSync(backupPath).mtime.toISOString(), appVersion: null } } catch { return { madeAt: null, appVersion: null } }
}

// ──────────────────────────────────────────────────────────────────────────────
// Layer 2 — Scheduled backup (interval-based, user destination, rolling 10)
// ──────────────────────────────────────────────────────────────────────────────

export interface ScheduledBackupConfig {
  enabled: boolean
  intervalDays: number       // 1, 3, or 7
  destinationDir: string     // user-chosen folder
  lastRunDate: string | null // ISO date YYYY-MM-DD
}

export async function runScheduledBackup(config: ScheduledBackupConfig): Promise<{ ran: boolean; destPath?: string; error?: string }> {
  if (!config.enabled) return { ran: false, error: 'Backup not enabled' }

  const dbPath = getStoredDbPath()
  if (!dbPath || !existsSync(dbPath)) return { ran: false, error: `Database file not found: ${dbPath || '(empty)'}` }

  // Check if interval has elapsed
  if (config.lastRunDate) {
    const lastRun = new Date(config.lastRunDate + 'T00:00:00')
    const daysSince = Math.floor((Date.now() - lastRun.getTime()) / MS_PER_DAY)
    if (daysSince < config.intervalDays) return { ran: false, error: `Interval not elapsed (${daysSince}d < ${config.intervalDays}d)` }
  }

  try {
    const destDir = config.destinationDir || getBackupDir()
    mkdirSync(destDir, { recursive: true, mode: 0o700 })

    const destPath = join(destDir, `pulse-scheduled-${nowTimestamp()}.pulse-backup`)
    await createPulseBackup(dbPath, destPath, 'scheduled')

    pruneBackups(destDir, 'pulse-scheduled-', '.pulse-backup', MAX_SCHEDULED_BACKUPS)

    return { ran: true, destPath }
  } catch (err) {
    return { ran: false, error: err instanceof Error ? err.message : 'Backup failed' }
  }
}

export function listScheduledBackups(destinationDir: string): string[] {
  if (!destinationDir || !existsSync(destinationDir)) return []
  return readdirSync(destinationDir)
    .filter(f => f.startsWith('pulse-scheduled-') && (f.endsWith('.pulse-backup') || f.endsWith('.db')))
    .sort()
    .reverse()
    .map(f => join(destinationDir, f))
}

// ── Scheduled backup config persistence ──────────────────────────────────────

interface ScheduledConfigStore {
  scheduledBackup: PersistentScheduledConfig
}

let _configStore: Store<ScheduledConfigStore> | null = null

function getConfigStore(): Store<ScheduledConfigStore> {
  if (!_configStore) {
    const cwd = getPortableDataDir()
    _configStore = new Store<ScheduledConfigStore>({ name: 'pulse-backup-config', cwd })
  }
  return _configStore
}

export interface PersistentScheduledConfig {
  enabled: boolean
  intervalHours: number
  destinationDir: string
  /** Last backup that worked */
  lastRunISO: string | null
  /** Why the most recent attempt failed; cleared when one works */
  lastError?: string | null
  lastAttemptISO?: string | null
}

export function getScheduledConfig(): PersistentScheduledConfig {
  const store = getConfigStore()
  return store.get('scheduledBackup', {
    enabled: false,
    intervalHours: 24,
    destinationDir: getBackupDir(),
    lastRunISO: null
  }) as PersistentScheduledConfig
}

export function setScheduledConfig(config: PersistentScheduledConfig): void {
  const store = getConfigStore()
  store.set('scheduledBackup', config)
}

export async function checkAndRunScheduled(): Promise<void> {
  const config = getScheduledConfig()
  if (!config.enabled) return

  const dbPath = getStoredDbPath()
  if (!dbPath || !existsSync(dbPath)) return

  // Check if interval has elapsed
  if (config.lastRunISO) {
    const lastRun = new Date(config.lastRunISO).getTime()
    const elapsedMs = Date.now() - lastRun
    const intervalMs = config.intervalHours * 60 * 60 * 1000
    if (elapsedMs < intervalMs) return
  }

  try {
    const destPath = await performScheduledBackup(config)
    logger.info('backup', `Scheduled backup saved: ${destPath}`)
  } catch (err) {
    logger.error('backup', 'Scheduled backup failed', err)
    recordScheduledFailure(err)
  }
}

/** Remember a failed scheduled run so Settings, the checkup and the status bar can say so. */
function recordScheduledFailure(err: unknown): void {
  try {
    setScheduledConfig({ ...getScheduledConfig(), lastError: describeBackupError(err), lastAttemptISO: new Date().toISOString() })
  } catch (storeErr) { logNonFatal('backup', 'record scheduled backup failure', storeErr) }
}

/**
 * Write one scheduled backup to the configured folder and record the run.
 * Throws on failure; callers decide whether to log or report it.
 */
async function performScheduledBackup(config: PersistentScheduledConfig): Promise<string> {
  const dbPath = getStoredDbPath()
  if (!dbPath || !existsSync(dbPath)) throw new Error('Database file not found')
  const destDir = config.destinationDir || getBackupDir()
  mkdirSync(destDir, { recursive: true, mode: 0o700 })
  const destPath = join(destDir, `pulse-scheduled-${nowTimestamp()}.pulse-backup`)
  await createPulseBackup(dbPath, destPath, 'scheduled')
  pruneBackups(destDir, 'pulse-scheduled-', '.pulse-backup', MAX_SCHEDULED_BACKUPS)
  // Re-read so a settings change saved while the backup was writing isn't undone
  const nowISO = new Date().toISOString()
  setScheduledConfig({ ...getScheduledConfig(), lastRunISO: nowISO, lastAttemptISO: nowISO, lastError: null })
  if (isOutsideDataFolder(destDir)) recordOffsiteBackup()
  return destPath
}

/**
 * Plain-language reason a backup couldn't be written, for people who don't
 * know what EACCES means.
 */
export function describeBackupError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'The backup folder can\'t be found. If it\'s on a USB drive or network folder, check that it\'s connected.'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'Pulse isn\'t allowed to save in the backup folder. Choose a different folder.'
  if (code === 'ENOSPC') return 'The backup drive is full. Free up space or choose a different folder.'
  if (code === 'PULSE_TOO_BIG' && err instanceof Error) return err.message
  if (err instanceof Error && err.message === 'Database file not found') return 'Pulse couldn\'t find your data file to back up.'
  return 'The backup couldn\'t be saved. Try again, or choose a different folder.'
}

/** "Run now" in Settings: back up to the scheduled folder straight away. */
export async function runScheduledBackupNow(): Promise<{ ran: boolean; destPath?: string; lastRunISO?: string | null; error?: string }> {
  try {
    const destPath = await performScheduledBackup(getScheduledConfig())
    logger.info('backup', `Scheduled backup (run now) saved: ${destPath}`)
    return { ran: true, destPath, lastRunISO: getScheduledConfig().lastRunISO }
  } catch (err) {
    logger.error('backup', 'Scheduled backup (run now) failed', err)
    recordScheduledFailure(err)
    return { ran: false, error: describeBackupError(err) }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Layer 3 — Manual Pack & Go (compressed zip → .pulse-backup)
// ──────────────────────────────────────────────────────────────────────────────

export interface ManualBackupResult {
  destPath: string
  sizeBytes: number
}

export async function runManualBackup(destPath: string): Promise<ManualBackupResult> {
  const dbPath = getStoredDbPath()
  if (!dbPath || !existsSync(dbPath)) {
    throw new Error('Database file not found')
  }

  const finalPath = destPath.endsWith('.pulse-backup') ? destPath : destPath + '.pulse-backup'
  const sizeBytes = await createPulseBackup(dbPath, finalPath, 'manual')
  if (isOutsideDataFolder(dirname(finalPath))) recordOffsiteBackup()

  return { destPath: finalPath, sizeBytes }
}

// ──────────────────────────────────────────────────────────────────────────────
// Pre-migration safety backup
// ──────────────────────────────────────────────────────────────────────────────

const MAX_PRE_MIGRATION_BACKUPS = 5

/**
 * Called by runMigrations() before applying any pending schema upgrades.
 * Checkpoints the WAL so the DB file is self-consistent, then copies it.
 * If the migration fails, the user can restore from this file.
 */
export function runPreMigrationBackup(
  fromVersion: number,
  toVersion: number,
  dbPath: string,
  database: DatabaseBridge
): void {
  if (!existsSync(dbPath)) return  // fresh install, nothing to protect

  try {
    const backupDir = getBackupDir()
    mkdirSync(backupDir, { recursive: true, mode: 0o700 })

    // Flush WAL into the main DB file so the copy is self-consistent.
    // Use exclusive lock to prevent writes between checkpoint and copy.
    const destPath = join(
      backupDir,
      `pulse-pre-migration-v${fromVersion}-to-v${toVersion}-${nowTimestamp()}.db`
    )
    try {
      database.pragma('locking_mode=EXCLUSIVE')
      database.pragma('wal_checkpoint(TRUNCATE)')
      atomicCopyFileSync(dbPath, destPath)
    } finally {
      database.pragma('locking_mode=NORMAL')
      // A no-op read is required to actually release the EXCLUSIVE lock
      database.pragma('journal_mode')
    }
    if (process.platform !== 'win32') {
      try { chmodSync(destPath, 0o600) } catch (err) { logNonFatal('backup', 'chmod pre-migration backup file', err) }
    }

    pruneBackups(backupDir, 'pulse-pre-migration-', '.db', MAX_PRE_MIGRATION_BACKUPS)

    logger.info('backup', `Pre-migration backup saved: ${destPath}`)
  } catch (err) {
    // Log but don't block — a failed backup is better than blocking a required migration
    logger.error('backup', 'Pre-migration backup failed (migrations will still run)', err)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Restore
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Restore from a .db file (Layer 1 or Layer 2 backup).
 * Creates a safety backup of the current DB first, then overwrites.
 * Returns the safety backup path.
 */
export async function restoreFromDb(backupDbPath: string): Promise<string> {
  const dbPath = getStoredDbPath()
  if (!dbPath) throw new Error('No active database path found')
  if (!existsSync(backupDbPath)) throw new Error('Backup file not found')

  // Checkpoint WAL so the safety copy captures all recent changes
  checkpointWal()

  // Safety backup before restore
  const safetyDir = getBackupDir()
  mkdirSync(safetyDir, { recursive: true, mode: 0o700 })
  const safetyPath = join(safetyDir, `pulse-pre-restore-${nowTimestamp()}.db`)
  if (existsSync(dbPath)) {
    atomicCopyFileSync(dbPath, safetyPath)
  }

  // Close DB before overwriting to avoid file-lock issues (especially on Windows)
  closeDatabaseIfOpen()

  try {
    // Remove stale WAL/SHM BEFORE overwriting so SQLite doesn't replay
    // old journal data on top of the restored file
    removeWalFiles(dbPath)
    // Atomic copy: temp file → fsync → rename prevents corruption on power loss
    atomicCopyFileSync(backupDbPath, dbPath)
  } catch (err) {
    // Rollback: restore the safety backup if overwrite failed
    if (existsSync(safetyPath)) {
      try { atomicCopyFileSync(safetyPath, dbPath) } catch (restoreErr) { logger.error('backup', 'Safety copy restore failed', restoreErr) }
    }
    throw err
  }

  return safetyPath
}

/**
 * Restore from a .pulse-backup zip file (Layer 3).
 * Uses yauzl for streaming extraction — no shell commands, no injection risk.
 * Returns the safety backup path.
 */
export async function restoreFromPulseBackup(backupZipPath: string): Promise<string> {
  if (!existsSync(backupZipPath)) throw new Error('Backup file not found')

  // Reject oversized compressed files before opening (zip bomb pre-check)
  const compressedSize = statSync(backupZipPath).size
  if (compressedSize > maxBackupBytes()) {
    throw new Error(tooBigToRestore())
  }

  const dbPath = getStoredDbPath()
  if (!dbPath) throw new Error('No active database path found')

  // Checkpoint WAL so the safety copy captures all recent changes
  checkpointWal()

  // Safety backup before touching anything
  const safetyDir = getBackupDir()
  mkdirSync(safetyDir, { recursive: true, mode: 0o700 })
  const safetyPath = join(safetyDir, `pulse-pre-restore-${nowTimestamp()}.db`)
  if (existsSync(dbPath)) {
    atomicCopyFileSync(dbPath, safetyPath)
  }

  // Close DB before overwriting to avoid file-lock issues (especially on Windows)
  closeDatabaseIfOpen()

  const tmpDir = join(safetyDir, `restore-tmp-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 })

  let zip: OpenZipResult | null = null
  try {
    zip = await openZip(backupZipPath)

    // Zip bomb protection: validate total uncompressed size before extracting anything
    const totalUncompressed = zip.entries.reduce((sum, e) => sum + e.uncompressedSize, 0)
    if (totalUncompressed > maxBackupBytes()) {
      throw new Error(tooBigToRestore())
    }

    // Find the .db entry — reject any entry with path traversal components
    const dbEntry = zip.entries.find(e => isSafeDbEntryName(e.entryName))
    if (!dbEntry) throw new Error('No database file found in backup archive')

    // Extract to isolated tmpDir only — no shell, no path traversal
    const extractedPath = join(tmpDir, dbEntry.entryName)

    // Validate extracted path stays within tmpDir (defense against path traversal)
    assertPathWithin(extractedPath, tmpDir)

    await zip.extractEntry(dbEntry.entryName, extractedPath)
    if (!existsSync(extractedPath)) throw new Error('Extraction failed — file missing after extract')

    // Remove stale WAL/SHM BEFORE overwriting, then atomic copy
    removeWalFiles(dbPath)
    atomicCopyFileSync(extractedPath, dbPath)

  } catch (err) {
    // Restore the safety backup if anything went wrong
    if (existsSync(safetyPath)) {
      try { atomicCopyFileSync(safetyPath, dbPath) } catch (restoreErr) { logger.error('backup', 'Safety copy restore failed', restoreErr) }
    }
    throw err
  } finally {
    zip?.close()
    // Always remove temp dir — even on error, to avoid unencrypted DB data residue
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch (err) { logNonFatal('backup', 'cleanup restore temp dir', err) }
  }

  return safetyPath
}

// ──────────────────────────────────────────────────────────────────────────────
// Backup info
// ──────────────────────────────────────────────────────────────────────────────

export interface BackupInfo {
  layer1: { count: number; newest: string | null; oldest: string | null; dir: string }
  lastAutoBackup: string | null
  lastAutoBackupFailed: boolean
  lastAutoBackupError: string | null
}

// ── Auto-backup status tracking ──────────────────────────────────────────────
// Persists failure state in electron-store so the renderer can warn on next launch.

interface BackupStatusStore {
  backupStatus: { failed: boolean; error: string | null; timestamp: string | null }
  /** Last backup saved outside the Pulse data folder (manual, Move, or scheduled elsewhere) */
  lastOffsiteISO: string | null
  /** When Pulse started keeping track, so a new user isn't nagged on day one */
  trackingSinceISO: string | null
}

let _statusStore: Store<BackupStatusStore> | null = null

function getStatusStore(): Store<BackupStatusStore> {
  if (!_statusStore) {
    const cwd = getPortableDataDir()
    _statusStore = new Store<BackupStatusStore>({ name: 'pulse-backup-status', cwd })
  }
  return _statusStore
}

/** True when `dir` is outside the folder that holds the database, i.e. a copy that survives losing it */
export function isOutsideDataFolder(dir: string): boolean {
  const roots = [getPortableDataDir(), getStoredDbPath() ? dirname(getStoredDbPath()!) : null].filter((r): r is string => !!r)
  const target = resolve(dir)
  return !roots.some(root => {
    const r = resolve(root)
    return target === r || target.startsWith(r + sep)
  })
}

export function recordOffsiteBackup(): void {
  try { getStatusStore().set('lastOffsiteISO', new Date().toISOString()) } catch (err) { logNonFatal('backup', 'record off-computer backup', err) }
}

export interface BackupHealth {
  lastOffsiteISO: string | null
  trackingSinceISO: string
  scheduled: {
    enabled: boolean
    intervalHours: number
    lastRunISO: string | null
    lastError: string | null
    /** On, failing, and at least two runs have been missed */
    overdue: boolean
  }
}

/** Everything the window needs to warn about backups that aren't happening. */
export function getBackupHealth(): BackupHealth {
  const store = getStatusStore()
  let trackingSinceISO = store.get('trackingSinceISO', null)
  if (!trackingSinceISO) {
    trackingSinceISO = new Date().toISOString()
    try { store.set('trackingSinceISO', trackingSinceISO) } catch (err) { logNonFatal('backup', 'record backup tracking start', err) }
  }
  const cfg = getScheduledConfig()
  const lastError = cfg.lastError ?? null
  const sinceMs = Date.parse(cfg.lastRunISO ?? trackingSinceISO)
  const overdue = cfg.enabled && !!lastError && Date.now() - sinceMs > 2 * cfg.intervalHours * 60 * 60 * 1000
  return {
    lastOffsiteISO: store.get('lastOffsiteISO', null),
    trackingSinceISO,
    scheduled: { enabled: cfg.enabled, intervalHours: cfg.intervalHours, lastRunISO: cfg.lastRunISO, lastError, overdue },
  }
}

const LOCK_BACKUP_MIN_GAP_MS = 60 * 60 * 1000

/**
 * Auto-backup when Pulse locks (auto-lock, sleep, Ctrl+L), not only on quit:
 * many people never quit, the laptop just sleeps. At most once an hour.
 * Must run while the database is still open.
 */
export function runAutoBackupOnLock(): void {
  try {
    const last = getStatusStore().get('backupStatus', { failed: false, error: null, timestamp: null })
    if (!last.failed && last.timestamp && Date.now() - Date.parse(last.timestamp) < LOCK_BACKUP_MIN_GAP_MS) return
  } catch (err) { logNonFatal('backup', 'read auto-backup status before lock backup', err) }
  // runAutoBackup's work is synchronous, so it finishes before the caller closes the database
  runAutoBackup().catch(err => logNonFatal('backup', 'auto-backup on lock', err))
}

export function recordAutoBackupSuccess(): void {
  try { getStatusStore().set('backupStatus', { failed: false, error: null, timestamp: new Date().toISOString() }) } catch (err) { logNonFatal('backup', 'record backup success to status store', err) }
}

export function recordAutoBackupFailure(error: string): void {
  try { getStatusStore().set('backupStatus', { failed: true, error, timestamp: new Date().toISOString() }) } catch (err) { logNonFatal('backup', 'record backup failure to status store', err) }
}

function getAutoBackupStatus(): { failed: boolean; error: string | null } {
  try {
    const status = getStatusStore().get('backupStatus', { failed: false, error: null, timestamp: null })
    return { failed: status.failed, error: status.error }
  } catch (err) {
    logger.error('backup', 'getAutoBackupStatus crashed', err)
    return { failed: true, error: err instanceof Error ? err.message : String(err) }
  }
}

export function getBackupInfo(): BackupInfo {
  const autoBackups = listAutoBackups()
  const status = getAutoBackupStatus()
  return {
    layer1: {
      count: autoBackups.length,
      newest: autoBackups[0] || null,
      oldest: autoBackups[autoBackups.length - 1] || null,
      dir: getBackupDir()
    },
    lastAutoBackup: autoBackups[0] || null,
    lastAutoBackupFailed: status.failed,
    lastAutoBackupError: status.error
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// New computer / lost credentials
// ──────────────────────────────────────────────────────────────────────────────

/**
 * If a database file already exists where a NEW one is about to be created,
 * move it (and its WAL/SHM) aside instead of letting a fresh key clobber it.
 * The orphan can still be recovered later with a backup's key envelope.
 * Returns the new path, or null if there was nothing to move.
 */
export function moveAsideExistingDatabase(dbPath: string): string | null {
  if (!existsSync(dbPath) || statSync(dbPath).size === 0) return null
  const dest = join(dirname(dbPath), `pulse-orphaned-${nowTimestamp()}.db`)
  renameSync(dbPath, dest)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) {
      try { renameSync(dbPath + suffix, dest + suffix) } catch (err) { logNonFatal('backup', `move aside ${suffix}`, err) }
    }
  }
  return dest
}

/**
 * Restore a .pulse-backup on a computer that has no usable Pulse credentials
 * (fresh install, or the data folder was copied from another machine).
 * The backup's key envelope is unlocked with the old password or recovery key,
 * the database is verified, installed, and re-protected with `newPassword`.
 */
export async function restoreBackupOnNewInstall(opts: {
  backupPath: string
  secret: string
  newPassword: string
  hint: string
}): Promise<{ schemaVersion: number }> {
  const { backupPath, secret, newPassword, hint } = opts
  if (!backupPath.endsWith('.pulse-backup')) throw new Error('Choose a .pulse-backup file')
  if (!existsSync(backupPath)) throw new Error('Backup file not found')
  if (statSync(backupPath).size > maxBackupBytes()) throw new Error(tooBigToRestore())

  const dataDir = getPortableDataDir()
  mkdirSync(dataDir, { recursive: true })
  const tmpDir = join(dataDir, `restore-tmp-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 })

  let zip: OpenZipResult | null = null
  let dbKey: Buffer | null = null
  try {
    zip = await openZip(backupPath)
    const totalUncompressed = zip.entries.reduce((sum, e) => sum + e.uncompressedSize, 0)
    if (totalUncompressed > maxBackupBytes()) throw new Error(tooBigToRestore())

    const dbEntry = zip.entries.find(e => isSafeDbEntryName(e.entryName))
    if (!dbEntry) throw new Error('This file doesn\'t contain a Pulse database')
    if (!zip.entries.some(e => e.entryName === KEY_ENVELOPE_ENTRY)) {
      throw new Error('This backup was made by an older version of Pulse and can only be restored on the computer that created it.')
    }
    let envelope: unknown
    try { envelope = JSON.parse((await zip.readEntry(KEY_ENVELOPE_ENTRY)).toString('utf8')) } catch { envelope = null }
    if (!isValidKeyEnvelope(envelope)) throw new Error('The backup\'s key information is damaged')

    dbKey = await unwrapKeyEnvelope(envelope, secret)

    const extractedPath = join(tmpDir, dbEntry.entryName)
    assertPathWithin(extractedPath, tmpDir)
    await zip.extractEntry(dbEntry.entryName, extractedPath)

    if (zip.entries.some(e => e.entryName === 'backup-meta.json')) {
      try {
        const meta = JSON.parse((await zip.readEntry('backup-meta.json')).toString('utf8')) as { dbSha256?: string }
        if (meta.dbSha256 && (await streamHash(extractedPath)) !== meta.dbSha256) {
          throw new Error('Database file hash mismatch — backup may be corrupted')
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('hash mismatch')) throw err
        logger.warn('backup', 'Could not read backup-meta.json — skipping hash check', err)
      }
    }

    // Prove the key opens this exact database before touching anything on disk
    const info = readEncryptedDbInfo(extractedPath, dbKey.toString('hex'))

    const dbPath = resolveDatabasePath()
    const orphaned = moveAsideExistingDatabase(dbPath)
    if (orphaned) logger.warn('backup', `Existing database moved aside before restore: ${orphaned}`)
    try {
      removeWalFiles(dbPath)
      atomicCopyFileSync(extractedPath, dbPath)
      if (process.platform !== 'win32') {
        try { chmodSync(dbPath, 0o600) } catch (err) { logNonFatal('backup', 'chmod restored DB', err) }
      }
      await adoptRestoredDbKey(dbKey, envelope, newPassword, hint, dbPath)
    } catch (err) {
      // Put the database that was there back, so a failed restore changes nothing on disk
      if (orphaned) {
        try {
          removeWalFiles(dbPath)
          if (existsSync(dbPath)) unlinkSync(dbPath)
          renameSync(orphaned, dbPath)
          for (const suffix of ['-wal', '-shm']) {
            if (existsSync(orphaned + suffix)) renameSync(orphaned + suffix, dbPath + suffix)
          }
        } catch (rollbackErr) { logger.error('backup', `Could not put the previous database back; it is at ${orphaned}`, rollbackErr) }
      }
      throw err
    }
    logger.info('backup', 'Backup restored on new install', { schemaVersion: info.schemaVersion })
    return { schemaVersion: info.schemaVersion }
  } finally {
    if (dbKey) dbKey.fill(0)
    zip?.close()
    // Extracted DB is encrypted, but don't leave copies lying around
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch (err) { logNonFatal('backup', 'cleanup restore temp dir', err) }
  }
}

/**
 * Settings → Backup → Restore, for a backup made by another Pulse (another
 * computer, or this one before a reinstall). This install's key can't open it,
 * so it is unlocked with the password or recovery key it was made with, and
 * protected with `newPassword` from now on.
 *
 * The current data is first saved as a .pulse-backup carrying the current key
 * envelope, so it can be brought back the same way with the current password.
 * The caller must reopen the database afterwards, whether this succeeds or not.
 */
export async function restoreOtherPulseBackup(opts: {
  backupPath: string
  secret: string
  newPassword: string
  hint: string
}): Promise<{ safetyPath: string; schemaVersion: number }> {
  const dbPath = getStoredDbPath()
  if (!dbPath || !existsSync(dbPath)) throw new Error('No active database path found')
  const safetyDir = getBackupDir()
  mkdirSync(safetyDir, { recursive: true, mode: 0o700 })
  const safetyPath = join(safetyDir, `pulse-pre-restore-${nowTimestamp()}.pulse-backup`)
  await createPulseBackup(dbPath, safetyPath, 'pre-restore')
  closeDatabaseIfOpen()
  const { schemaVersion } = await restoreBackupOnNewInstall(opts)
  logger.info('backup', 'Backup from another Pulse restored', { schemaVersion })
  return { safetyPath, schemaVersion }
}
