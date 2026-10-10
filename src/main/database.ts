/**
 * database.ts — SQLCipher connection, migrations, and query helpers.
 *
 * Uses better-sqlite3-multiple-ciphers (synchronous API, SQLCipher 4 compatible).
 * All DB access happens here — the renderer NEVER touches SQLite directly.
 */

import BetterSqlite3 from 'better-sqlite3-multiple-ciphers'
import type { Database as BetterSqlite3DB } from 'better-sqlite3'
import { logger } from './logger'
import { join } from 'path'
import { mkdirSync, chmodSync, existsSync, unlinkSync } from 'fs'
import Store from 'electron-store'
import { getDbKey, setStoredDbPath, isPasswordSetup } from './auth'
import { clearContactsStmtCache } from './contacts'
import { logNonFatal } from './ipc/ipc-utils'
import { detectCloudSyncService } from '../shared/cloudSync'
import { runPreMigrationBackup, setDatabaseBridge } from './backup'
import { up as migration001 } from './migrations/001_initial_schema'
import { up as migration002 } from './migrations/002_cell_formats'
import { up as migration003 } from './migrations/003_alert_interval'
import { up as migration004 } from './migrations/004_cond_format_rules'
import { up as migration005 } from './migrations/005_grid_position'
import { up as migration006 } from './migrations/006_contacts'
import { up as migration007 } from './migrations/007_task_position'
import { up as migration008 } from './migrations/008_manual_contacts'
import { up as migration009 } from './migrations/009_case_log_edit_history'
import { up as migration010 } from './migrations/010_case_log_void'
import { up as migration011 } from './migrations/011_acuity'
import { up as migration012 } from './migrations/012_soft_delete'
import { up as migration013 } from './migrations/013_perf_indexes'
import { up as migration014 } from './migrations/014_fk_constraints'
import { up as migration015 } from './migrations/015_perf_compound_indexes'
import { up as migration016 } from './migrations/016_perf_phase2'
import { up as migration017 } from './migrations/017_perf_phase3'
import { up as migration018 } from './migrations/018_perf_phase4'
import { up as migration019 } from './migrations/019_perf_phase5'
import { up as migration020 } from './migrations/020_perf_phase6'
import { up as migration021 } from './migrations/021_perf_phase7'
import { up as migration022 } from './migrations/022_dashboard_indexes'
import { up as migration023 } from './migrations/023_provider_link_index'
import { up as migration024 } from './migrations/024_fix_display_name'
import { up as migration025 } from './migrations/025_dashboard_perf_indexes'
import { up as migration026 } from './migrations/026_dashboard_completion_index'
import { up as migration027 } from './migrations/027_document_storage'
import { up as migration028 } from './migrations/028_checklist_groups'
import { up as migration029 } from './migrations/029_reference_board'
import { up as migration030 } from './migrations/030_task_groups'
import { up as migration031 } from './migrations/031_remove_docs_and_refboard'
import { up as migration032 } from './migrations/032_case_log_edits'
import { up as migration033 } from './migrations/033_rule_calendar_intervals'
import { up as migration034 } from './migrations/034_contact_requirements'
import { up as migration035 } from './migrations/035_case_log_time_mileage'
import { up as migration036 } from './migrations/036_workspace'
import { up as migration037 } from './migrations/037_activity_types'
import { up as migration038 } from './migrations/038_deadline_engine'
import { up as migration039 } from './migrations/039_links'
import { up as migration040 } from './migrations/040_appointments'
import { up as migration041 } from './migrations/041_forms'
import { up as migration042 } from './migrations/042_attachments'
import { up as migration043 } from './migrations/043_report_definitions'
import { up as migration044 } from './migrations/044_note_occurred_at'
import { linkColumnSpecs, linkSelectSql, linkSpecKey, type LinkColumnSpec } from '../shared/links'
import { fileCountColumnIds } from '../shared/attachments'

/**
 * Validate and set the SQLCipher encryption key on a database connection.
 * Validates hex format before interpolation (defense-in-depth).
 */
export function setEncryptionKey(database: BetterSqlite3DB, hexKey: string): void {
  if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error('Invalid database key format')
  database.pragma(`key='${hexKey}'`)
}

let db: BetterSqlite3DB | null = null
let cleanupTimer: ReturnType<typeof setTimeout> | null = null

// ── Prepared statement cache ─────────────────────────────────────────────────
// Avoids re-compiling SQL on every call. Invalidated when the DB connection changes.
const stmtCache = new Map<string, import('better-sqlite3').Statement>()
const STMT_CACHE_MAX = 128
const CELL_HISTORY_MAX_PER_CELL = 50
const TRASH_PURGE_DAYS = 30
const DEFERRED_CLEANUP_DELAY_MS = 15_000

export function cachedStmt(key: string, sql: string): import('better-sqlite3').Statement {
  const existing = stmtCache.get(key)
  if (existing) {
    // Collision assertion: same key must always map to same SQL
    if (existing.source !== sql) {
      throw new Error(`Stmt cache collision: key="${key}"`)
    }
    // Move to end (most recently used) — Map insertion order trick for LRU
    stmtCache.delete(key)
    stmtCache.set(key, existing)
    return existing
  }
  const stmt = getDb().prepare(sql)
  if (stmtCache.size >= STMT_CACHE_MAX) {
    // Evict least recently used (first in Map)
    const firstKey = stmtCache.keys().next().value
    if (firstKey !== undefined) stmtCache.delete(firstKey)
  }
  stmtCache.set(key, stmt)
  return stmt
}

function clearStmtCache(): void {
  stmtCache.clear()
}

// Close hooks — allow other modules to register cleanup without circular imports.
// E.g. ipc-cell.ts registers its column metadata cache clear here.
const _closeHooks: Array<() => void> = []
export function registerCloseHook(fn: () => void): void { _closeHooks.push(fn) }

/** Invalidate cached prepared statements (e.g. after column create/delete).
 *  Clears the entire cache because pivot query keys embed column IDs
 *  and column schema changes are rare enough that full rebuild is cheap. */
export function invalidateGridStmtCache(): void {
  stmtCache.clear()
}

// Provide database functions to backup.ts (avoids circular require that breaks in bundled builds)
setDatabaseBridge({
  closeDatabase: () => {
    clearStmtCache()
    if (db && db.open) db.close()
    db = null
  },
  getDb: () => {
    if (!db || !db.open) throw new Error('Database is not open')
    return db
  }
})

// Lives in data-dir.ts so the logger can use it without an import cycle
export { getPortableDataDir } from './data-dir'
import { getPortableDataDir } from './data-dir'

/**
 * Determine the database file path.
 * Packaged builds: <exeDir>/PulseData/pulse.db (portable, no installer)
 * Dev builds: <userData>/pulse.db (standard Electron location)
 */
export function resolveDatabasePath(): string {
  const dataDir = getPortableDataDir()
  mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'pulse.db')
}

/** Warn if the DB is in a cloud sync folder (corrupts SQLite) */
export function checkCloudSyncPath(dbPath: string): string | null {
  return detectCloudSyncService(dbPath)
}

/**
 * Open the database with SQLCipher encryption.
 * Must be called after the user has unlocked (liveDbKey is set).
 */
function openEncryptedDatabase(dbPath: string): BetterSqlite3DB {
  const keyBuf = getDbKey()  // throws if locked
  const rawDbKey = keyBuf.toString('hex')

  // Set restrictive umask before creating any files (DB, WAL, SHM).
  // This ensures all files created by SQLite inherit owner-only permissions.
  // IMPORTANT: This code path must remain synchronous — umask is process-global,
  // so any async work between set/restore would affect unrelated file operations.
  const prevUmask = process.platform !== 'win32' ? process.umask(0o077) : null

  const isNewFile = !existsSync(dbPath)
  const database = new BetterSqlite3(dbPath) as BetterSqlite3DB
  // Restrict DB file to owner read/write only on Unix — the file contains encrypted
  // sensitive data and should not be readable by other users on a shared system.
  if (isNewFile && process.platform !== 'win32') {
    try { chmodSync(dbPath, 0o600) } catch (err) { logNonFatal('database', 'chmod new DB file', err) }
  }

  // SQLCipher 4 settings — must be set before any other operations
  database.pragma(`cipher='sqlcipher'`)
  // INTENTIONAL: key is interpolated into pragma because better-sqlite3 pragma()
  // doesn't support parameterized values. setEncryptionKey validates hex format
  // (/^[0-9a-f]{64}$/) before interpolation as defense-in-depth.
  try {
    setEncryptionKey(database, rawDbKey)
  } catch (err) {
    database.close()
    if (prevUmask !== null) process.umask(prevUmask)
    throw err instanceof Error && err.message === 'Invalid database key format'
      ? err
      : new Error('Failed to set database encryption key')
  }
  database.pragma("kdf_iter=256000")
  database.pragma("cipher_page_size=4096")
  database.pragma("cipher_hmac_algorithm=HMAC_SHA512")
  database.pragma("cipher_kdf_algorithm=PBKDF2_HMAC_SHA512")

  // Verify the key is correct (will throw if wrong key / corrupt DB)
  try {
    database.pragma('schema_version')
  } catch (err) {
    logNonFatal('database', 'schema_version check failed (wrong key or corrupt DB)', err)
    database.close()
    if (isNewFile) {
      // Clean up the unencrypted DB file and WAL/SHM companions so no
      // partially-initialized, potentially unencrypted data persists on disk.
      try { unlinkSync(dbPath) } catch (err) { logNonFatal('database', 'cleanup failed DB file', err) }
      try { unlinkSync(dbPath + '-wal') } catch (err) { logNonFatal('database', 'cleanup WAL file', err) }
      try { unlinkSync(dbPath + '-shm') } catch (err) { logNonFatal('database', 'cleanup SHM file', err) }
    }
    if (prevUmask !== null) process.umask(prevUmask)
    const walPath = dbPath + '-wal'
    const shmPath = dbPath + '-shm'
    if (existsSync(walPath) || existsSync(shmPath)) {
      logger.error('database', 'DB open failed with WAL files present', { walExists: existsSync(walPath), shmExists: existsSync(shmPath) })
      throw new Error('Database may be corrupted. WAL recovery files exist. Try restoring from a backup, or contact support.')
    }
    throw new Error('Incorrect password or database is corrupt')
  }

  database.pragma('foreign_keys = ON')
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = NORMAL')
  database.pragma('cache_size = -32000')  // 32MB page cache for large caseloads
  database.pragma('busy_timeout = 5000')   // retry for 5s before SQLITE_BUSY

  // Restore previous umask now that DB and WAL/SHM files are created
  if (prevUmask !== null) process.umask(prevUmask)

  return database
}

/**
 * initDatabase is called once at app startup, AFTER the password system
 * has been initialized. If no password is set yet, we skip opening the DB
 * (the lock screen will handle setup).
 */
export async function initDatabase(): Promise<void> {
  if (!isPasswordSetup()) {
    // First launch — DB will be opened after password setup
    return
  }

  // If the app auto-opens (no lock screen required on first launch after setup),
  // we'd open here. But since every launch requires password, we open in auth flow.
  // This function is a no-op until auth completes.
}

/**
 * Prune cell_history to keep at most 50 entries per (row_id, column_id) pair.
 * Deliberately NOT age-based: case work can need a multi-year audit trail of who
 * changed what, and users can still compact explicitly (CELL_HISTORY_COMPACT).
 * Runs deferred after unlock so it never blocks startup.
 */
function pruneOldCellHistory(): void {
  try {
    if (!db || !db.open) return
    const result = db.prepare(`
      DELETE FROM cell_history WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY row_id, column_id ORDER BY changed_at DESC) as rn
          FROM cell_history
        ) WHERE rn <= ?
      )
    `).run(CELL_HISTORY_MAX_PER_CELL)
    logger.info('database', 'Cell history pruned', { deleted: result.changes })
  } catch (err) {
    logger.info('database', 'Cell history pruning skipped', err)
  }
}

/** Auto-purge soft-deleted rows older than 30 days. Runs on DB open. */
function purgeExpiredTrash(): void {
  try {
    if (!db || !db.open) return
    // Files in the trash go after the same time as records (W09 §3)
    try {
      const files = db.prepare(`DELETE FROM attachments WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-' || ? || ' days')`).run(TRASH_PURGE_DAYS).changes
      if (files) logger.info('database', `Purged ${files} files from the trash`)
    } catch (err) { logNonFatal('database', 'attachment purge', err) }
    // 1. Find rows being purged
    const expiredRows = db.prepare(
      `SELECT id FROM rows WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-' || ? || ' days')`
    ).all(TRASH_PURGE_DAYS) as Array<{ id: number }>
    if (expiredRows.length === 0) return
    // 2. Delete the rows
    const deleteStmt = db.prepare('DELETE FROM rows WHERE id = ?')
    const runDelete = db.transaction(() => {
      for (const row of expiredRows) {
        deleteStmt.run(row.id)
      }
    })
    runDelete()
    logger.info('database', `Purged ${expiredRows.length} expired trash rows`)
  } catch (err) {
    logger.info('database', 'Trash purge skipped', err)
  }
}

/**
 * Called by the auth system after successful password verification.
 * Opens the database and runs pending migrations.
 */
export function openDatabase(): void {
  if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null }
  const dbPath = resolveDatabasePath()
  mkdirSync(join(dbPath, '..'), { recursive: true })
  // Keep the stored path in sync so backup.ts always has the current location,
  // even if the portable folder has been moved since initial setup.
  setStoredDbPath(dbPath)

  db = openEncryptedDatabase(dbPath)
  try {
    runMigrations()
  } catch (err) {
    logger.error('database', 'Migration failed — closing database', { error: err instanceof Error ? err.message : String(err) })
    try { db.close() } catch (err) { logNonFatal('database', 'close DB after migration failure', err) }
    db = null
    throw err
  }
  // Remove leftover system alert rules from earlier app versions (migration cleanup)
  try { db.prepare('DELETE FROM alert_rules WHERE is_system = 1').run() } catch (err) { logNonFatal('database', 'delete system alert rules', err) }
  // Defer non-critical cleanup so unlock is not blocked on large databases
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null
    pruneOldCellHistory()
    purgeExpiredTrash()
    // Reclaim freed pages so the DB file doesn't grow monotonically
    try { if (db && db.open) db.pragma('incremental_vacuum(200)') } catch (err) { logNonFatal('database', 'incremental vacuum', err) }
  }, DEFERRED_CLEANUP_DELAY_MS)
}

/**
 * Close the database — called on lock or quit.
 */
export function closeDatabase(): void {
  if (cleanupTimer) { clearTimeout(cleanupTimer); cleanupTimer = null }
  clearStmtCache()
  clearContactsStmtCache()
  for (const cb of _closeHooks) { try { cb() } catch { /* best effort */ } }
  if (db && db.open) {
    try { db.pragma('optimize') } catch (err) { logNonFatal('database', 'pragma optimize on close', err) }
    db.close()
  }
  db = null
}

/** Get the live database connection — throws if locked */
export function getDb(): BetterSqlite3DB {
  if (!db || !db.open) {
    throw new Error('Database is not open. Please unlock the app first.')
  }
  return db
}

// ── Migration system ──────────────────────────────────────────────────────────
//
// IMPORTANT: Every migration MUST end with:
//   db.prepare("UPDATE app_meta SET value = '<VERSION>' WHERE key = 'schema_version'").run()
// Without this, the migration re-runs on next launch and ALTER TABLE / CREATE TABLE
// statements fail on the second run, which kills openDatabase() and makes the app
// appear to reject the user's password. (See migration 030 incident.)
//
// Also: ALTER TABLE ADD COLUMN has no IF NOT EXISTS — guard with pragma_table_info.

const migrations: Array<{ version: number; up: (db: BetterSqlite3DB) => void; noTransaction?: boolean }> = [
  { version: 1, up: migration001 },
  { version: 2, up: migration002 },
  { version: 3, up: migration003 },
  { version: 4, up: migration004 },
  { version: 5, up: migration005 },
  { version: 6, up: migration006 },
  { version: 7, up: migration007 },
  { version: 8, up: migration008 },
  { version: 9, up: migration009 },
  { version: 10, up: migration010 },
  { version: 11, up: migration011 },
  { version: 12, up: migration012 },
  { version: 13, up: migration013 },
  { version: 14, up: migration014 },
  { version: 15, up: migration015 },
  { version: 16, up: migration016, noTransaction: true },  // contains VACUUM
  { version: 17, up: migration017 },
  { version: 18, up: migration018 },
  { version: 19, up: migration019 },
  { version: 20, up: migration020 },
  { version: 21, up: migration021 },
  { version: 22, up: migration022 },
  { version: 23, up: migration023 },
  { version: 24, up: migration024 },
  { version: 25, up: migration025 },
  { version: 26, up: migration026 },
  { version: 27, up: migration027 },
  { version: 28, up: migration028 },
  { version: 29, up: migration029 },
  { version: 30, up: migration030 },
  { version: 31, up: migration031 },
  { version: 32, up: migration032 },
  { version: 33, up: migration033 },
  { version: 34, up: migration034 },
  { version: 35, up: migration035 },
  { version: 36, up: migration036 },
  { version: 37, up: migration037 },
  { version: 38, up: migration038 },
  { version: 39, up: migration039 },
  { version: 40, up: migration040 },
  { version: 41, up: migration041 },
  { version: 42, up: migration042 },
  { version: 43, up: migration043 },
  { version: 44, up: migration044 },
]

// ── Migration failure tracking ────────────────────────────────────────────────
// Persists in electron-store so the renderer can warn on next launch.
interface MigrationStatusStore {
  migrationFailedAt: { version: number; error: string; timestamp: string } | null
}

let _migrationStatusStore: Store<MigrationStatusStore> | null = null

function getMigrationStatusStore(): Store<MigrationStatusStore> {
  if (!_migrationStatusStore) {
    _migrationStatusStore = new Store<MigrationStatusStore>({
      name: 'pulse-migration-status',
      cwd: getPortableDataDir()
    })
  }
  return _migrationStatusStore
}

function clearMigrationFailure(): void {
  try { getMigrationStatusStore().set('migrationFailedAt', null) } catch (err) { logNonFatal('database', 'clear migration failure flag', err) }
}

/** Check if a migration failure was recorded. Used by the renderer to warn the user. */
export function getMigrationFailure(): { version: number; error: string; timestamp: string } | null {
  try {
    return getMigrationStatusStore().get('migrationFailedAt', null) as { version: number; error: string; timestamp: string } | null
  } catch (err) { logNonFatal('database', 'read migration failure status', err); return null }
}

/** Clear a previously recorded migration failure (after user acknowledges). */
export function clearMigrationFailureFlag(): void {
  clearMigrationFailure()
}

function runMigrations(): void {
  const database = getDb()

  // Ensure app_meta exists (migration 1 creates it, but we need it before running migrations)
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  const currentVersion = getSchemaVersion()
  const latestVersion = migrations[migrations.length - 1]!.version

  // Guard against opening a database created by a newer app version.
  // Running old migrations against a newer schema could corrupt data.
  if (currentVersion > latestVersion) {
    throw new Error(
      `This database was created by a newer version of Pulse (schema version ${currentVersion}, ` +
      `but this app only supports up to version ${latestVersion}). ` +
      `Please update the app to open this database.`
    )
  }

  if (currentVersion > 0 && currentVersion < latestVersion) {
    // Snapshot the DB before touching it — user can restore if a migration goes wrong.
    // Skip on fresh install (version 0) since there's no existing data to protect.
    runPreMigrationBackup(currentVersion, latestVersion, resolveDatabasePath(), database)
  }

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      try {
        if (migration.noTransaction) {
          // Some migrations (e.g. VACUUM) cannot run inside a transaction.
          // WARNING: noTransaction migrations cannot be rolled back — if they fail
          // partway through, the DB may be in an inconsistent state.
          migration.up(database)
        } else {
          const runMigration = database.transaction(() => {
            migration.up(database)
          })
          runMigration()
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        logger.error('database', `Migration ${migration.version} failed: ${errMsg}`)

        // Record the failure so the app can warn the user on next launch.
        // Recovery path: restore from the pre-migration backup created above,
        // which is stored in the backups directory as pulse-pre-migration-vN-to-vM-*.db.
        try {
          getMigrationStatusStore().set('migrationFailedAt', {
            version: migration.version,
            error: errMsg,
            timestamp: new Date().toISOString()
          })
        } catch (err) { logNonFatal('database', 'record migration failure status', err) }

        // Do NOT continue with subsequent migrations — later migrations may
        // depend on schema changes from this one and would likely fail or
        // corrupt data.
        throw new Error(
          `Migration to version ${migration.version} failed: ${errMsg}. ` +
          `Restore from the pre-migration backup in the backups directory.`
        )
      }
    }
  }

  // All migrations succeeded — clear any previous failure flag
  clearMigrationFailure()

  // Clear prepared statement cache after migrations — schema may have changed
  clearStmtCache()
}

function getSchemaVersion(): number {
  const database = getDb()
  const row = database
    .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined
  return row ? parseInt(row.value, 10) : 0
}

// ── Grid query helpers ────────────────────────────────────────────────────────

/** Shared SELECT columns for row queries */
const ROW_BASE_COLUMNS = `
      r.id AS row_id,
      r.position,
      r.is_active,
      r.is_starred,
      r.acuity_level_id,
      r.deleted_at,
      r.created_at,
      r.updated_at`

/** Validate and build pivot CASE expressions for column values */
function buildColumnCases(columnIds: number[]): { safeIds: number[]; cases: string } {
  const safeIds = columnIds.map(id => {
    const n = Math.trunc(Number(id))
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid column ID: ${id}`)
    return n
  })
  const cases = safeIds
    .map(id => `MAX(CASE WHEN c.column_id = ${id} THEN c.value END) AS col_${id}`)
    .join(',\n    ')
  return { safeIds, cases }
}

/** Pivot cases for cell columns plus subqueries for link columns */
function columnSelects(columnIds: number[], links: LinkColumnSpec[], fileCounts: number[] = []): { safeIds: number[]; select: string } {
  const skip = new Set([...links.map(l => l.columnId), ...fileCounts])
  const { safeIds, cases } = buildColumnCases(columnIds.filter(id => !skip.has(Math.trunc(Number(id)))))
  // How many files each record has (W09), counted here so the grid stays one query
  const counts = fileCounts.map(id => `(SELECT COUNT(*) FROM attachments a WHERE a.row_id = r.id AND a.deleted_at IS NULL) AS col_${Math.trunc(id)}`).join(',\n      ')
  const select = [cases, linkSelectSql(links), counts].filter(Boolean).join(',\n      ')
  return { safeIds, select: select || 'NULL AS no_columns' }
}

/**
 * Build the pivot query for loading an entire grid in one shot.
 * NEVER use N+1 queries. One query returns one wide row per client.
 */
export function buildGridQuery(columnIds: number[], includeArchived = false, links: LinkColumnSpec[] = [], fileCounts: number[] = []): string {
  const { select: cases } = columnSelects(columnIds, links, fileCounts)

  const activeFilter = includeArchived
    ? 'AND r.deleted_at IS NULL'
    : 'AND r.is_active = 1 AND r.deleted_at IS NULL'

  return `
    SELECT
${ROW_BASE_COLUMNS},
      ${cases}
    FROM rows r
    LEFT JOIN cells c ON c.row_id = r.id
    WHERE r.grid_id = ? ${activeFilter}
    GROUP BY r.id
    ORDER BY r.position
  `
}

/**
 * Load a single row for the profile view.
 * Returns the row with all its cell values (pivot pattern, not N+1).
 */
export function getRow(gridId: number, rowId: number): Record<string, unknown> | null {
  const columns = cachedStmt('getRow_cols', 'SELECT id, column_type, config FROM columns WHERE grid_id = ? ORDER BY position')
    .all(gridId) as Array<{ id: number; column_type: string; config: string | null }>
  if (columns.length === 0) return null

  const links = linkColumnSpecs(columns)
  const fileCounts = fileCountColumnIds(columns)
  const { safeIds, select: cases } = columnSelects(columns.map(c => c.id), links, fileCounts)

  const query = `
    SELECT
${ROW_BASE_COLUMNS},
      ${cases}
    FROM rows r
    LEFT JOIN cells c ON c.row_id = r.id
    WHERE r.grid_id = ? AND r.id = ? AND r.deleted_at IS NULL
    GROUP BY r.id
  `
  // Cache keyed by grid + column IDs (different grids with same column count have different queries)
  const cacheKey = `getRow_${gridId}_${safeIds.join('|')}_${linkSpecKey(links)}_${fileCounts.join('|')}`
  const row = cachedStmt(cacheKey, query).get(gridId, rowId) as Record<string, unknown> | undefined
  return row ?? null
}

/**
 * Cell upsert — inserts or updates a single cell value.
 */
export function upsertCell(rowId: number, columnId: number, value: string | null): void {
  cachedStmt('upsertCell', `
    INSERT INTO cells (row_id, column_id, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(row_id, column_id)
    DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(rowId, columnId, value)
}
