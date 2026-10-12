/**
 * ipc-export.ts — EXPORT_*, BACKUP_*, IMPORT_*, SETUP_TEMPLATE_*, LETTER_TEMPLATE_* IPC handlers
 */

import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { logger } from '../logger'
import { secureWrap, ok, fail, assertSafePath, validId, enforceWritable, logNonFatal, withCorrelation, pickSavePath } from './ipc-utils'
import { handlersFor, idArg, idListArg, textArg } from './ipc-define'
import { openDatabase, getDb, resolveDatabasePath, closeDatabase, setEncryptionKey, latestSchemaVersion, DatabaseOpenError } from '../database'
import { dbOpenFailedCode } from '../../shared/dbOpen'
import { getProvider } from '../contacts'
import {
  listAutoBackupsRich, runManualBackup,
  restoreFromDb, restoreFromPulseBackup, getBackupInfo,
  verifyBackup, getScheduledConfig, setScheduledConfig, withBackupDbFile, runScheduledBackupNow,
  describeBackupError, getBackupHealth, getBackupMadeInfo, restoreOtherPulseBackup, NEWER_BACKUP,
  type PersistentScheduledConfig
} from '../backup'
import { getDbKey, lockApp } from '../auth'
import { LIVE_GRID, LIVE_ROW, NOT_TRASHED_ROW, liveGrid } from '../../shared/liveRecords'
const BetterSqlite3 = require('better-sqlite3-multiple-ciphers') as typeof import('better-sqlite3')
import { exportCsv, exportPdfGrid, exportPdfProfile, exportLetterPdf, exportSupervisorReport, exportContactPdf, exportDirectoryPdf, type CsvExportOptions, type PdfGridOptions, type PdfProfileOptions, type SupervisorReportOptions } from '../export'
import { parseImportFile, autoMatchColumns, executeImport, type ImportOptions } from '../import'
import { exportNotesCsv } from '../export-csv'
import { exportWeeklyPlanner } from '../export-planner'
import { exportAuditReport, type AuditScope } from '../export-audit'
import { exportHandoffPacket, type HandoffOptions } from '../export-handoff'
import { exportIcs } from '../export-ics'
import {
  getSetupTemplates, createSetupTemplate, deleteSetupTemplate,
  exportGridAsPulse, writePulseFile, parsePulseFile, applyPulseToNewGrid, applyPulseToExistingGrid,
  validatePulseJson,
  getLetterTemplates, createLetterTemplate, updateLetterTemplate, deleteLetterTemplate, generateLetter,
} from '../templates'
import { statSync, copyFileSync, existsSync, mkdirSync } from 'fs'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { checkNewPassword } from '../../shared/passwordPolicy'
import { localDateString } from '../../shared/dates'
import { MS_PER_DAY } from '../../shared/constants'
import { word } from '../vocab'
import { placeholderFields } from '../placeholders'
import { buildBatchPdf, buildLabelsPdf, previewBatch, DocumentError, MAX_BATCH, type DocTarget } from '../export-documents'
import { atomicWriteFileAsync } from '../export-shared'
import { describeRestoreError } from '../restore-errors'
import { fileWord, safeFileName } from '../../shared/fileName'

/** Row and column choices for an export: whole positive ids, and not absurdly many */
function validIdList(v: unknown): v is number[] {
  return Array.isArray(v) && v.length <= 100_000 && v.every(id => Number.isInteger(id) && id > 0)
}

/**
 * A restore that failed before the backup replaced anything: the restore put the
 * current data back but left the database closed, so reopen it and carry on.
 */
function failedBeforeReplace(corrId: string, err: unknown) {
  logger.warn('ipc-export', `[${corrId}] restore failed: ${err instanceof Error ? err.message : String(err)}`)
  try { openDatabase() } catch (openErr) { logger.error('ipc-export', `[${corrId}] could not reopen the database after a failed restore`, openErr) }
  return fail(describeRestoreError(err))
}

/**
 * A record exported on its own (profile PDF, handoff packet, letter) must be in
 * that list, and neither it nor its list may be in the Trash (A16-06). The
 * screens can't normally ask for one, but a stale window could.
 */
function refuseUnavailableRecord(rowId: number, gridId: number): ReturnType<typeof fail> | null {
  const live = getDb().prepare(`SELECT 1 FROM rows r JOIN grids g ON g.id = r.grid_id
    WHERE r.id = ? AND r.grid_id = ? AND ${NOT_TRASHED_ROW} AND ${LIVE_GRID}`).get(rowId, gridId)
  return live ? null : fail(`We couldn't find that ${word('record', {}, gridId)}. It may have been moved to the Trash.`)
}

/**
 * Check a backup made by this Pulse before it replaces anything: it must open with
 * this install's key, every page must read back (a cut-off or damaged .db backup
 * has no hash to catch it, A24-04), and it can't be from a newer Pulse (A24-03).
 * Returns a plain failure, or null when it's safe to restore.
 */
async function refuseUnusableBackup(backupPath: string): Promise<ReturnType<typeof fail> | null> {
  const check = await verifyBackup(backupPath)
  if (!check.valid) {
    const reason = check.error === 'File not found' ? 'Backup file not found' : (check.error ?? 'not a database')
    return fail(describeRestoreError(new Error(reason)))
  }
  if ((check.schemaVersion ?? 0) > latestSchemaVersion()) return fail(NEWER_BACKUP)
  return null
}

/**
 * Open the database a restore just put in place. openDatabase() runs migrations
 * on the restored (possibly older) data; they are idempotent, so that's safe.
 * If it won't open, copy the safety backup made before the restore back over it.
 * Returns a plain failure to send to the renderer, or null when all is well.
 */
function openRestoredOrRollBack(corrId: string, safetyPath: string): ReturnType<typeof fail> | null {
  try {
    openDatabase()
    return null
  } catch (openErr) {
    logger.error('ipc-export', `[${corrId}] Failed to open restored database, rolling back to safety backup`, openErr)
  }
  if (!existsSync(safetyPath)) {
    return fail("That backup couldn't be opened. Close Pulse and open it again. If your data is missing, restore a different backup from Settings → Backup.")
  }
  try {
    closeDatabase()
    copyFileSync(safetyPath, resolveDatabasePath())
    openDatabase()
  } catch (rollbackErr) {
    logger.error('ipc-export', `[${corrId}] Safety backup rollback also failed`, rollbackErr)
    return fail(`That backup couldn't be opened, and Pulse couldn't put your previous data back on its own. A copy of it is saved at ${safetyPath}. Close Pulse, open it again, and restore that copy from Settings → Backup.`)
  }
  return fail("That backup couldn't be opened, so Pulse put your previous data back. Nothing was lost.")
}

const define = handlersFor('ipc-export')

export function registerExportHandlers(): void {
  // ── Backup (Auto listing) ──────────────────────────────────────────────────
  define(IPC.BACKUP_AUTO_LIST, [], () => {
    return ok(listAutoBackupsRich())
  })

  // ── Backup (Layers 2 & 3) ──────────────────────────────────────────────────
  define(IPC.BACKUP_GET_INFO, [], () => {
    const info = getBackupInfo()
    const dbPath = resolveDatabasePath()
    let dbSize = 0
    try {
      dbSize = statSync(dbPath).size
    } catch (err) { logNonFatal('ipc-export', 'stat db file for size', err) }
    let totalClients = 0
    try {
      // Records in deleted lists aren't active (X-11)
      const row = getDb().prepare(`SELECT COUNT(*) as cnt FROM rows r JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID} WHERE ${LIVE_ROW}`).get() as { cnt: number }
      totalClients = row.cnt
    } catch (err) { logNonFatal('ipc-export', 'count active clients', err) }
    return ok({
      ...info,
      dbSize,
      totalClients,
      dbPath,
      autoBackupCount: info.layer1.count
    })
  })

  // "Run now" runs entirely in main, so the renderer never fakes a config to trigger it
  define(IPC.BACKUP_SCHEDULED_RUN_NOW, [], async () => {
    return ok(await runScheduledBackupNow())
  })

  // assertSafePath checks the path (and throws) in the body, as before
  define(IPC.BACKUP_MANUAL_CREATE, [z.custom<string>()], async (destPath) => {
    assertSafePath(destPath)
    try {
      return ok(await runManualBackup(destPath))
    } catch (err) {
      logger.error('ipc-export', 'Manual backup failed', err)
      return fail(describeBackupError(err))
    }
  })

  // A restore replaces every piece of data, so it is the first write a
  // read-only mode (e.g. viewing a backup) must stop; leave that mode first
  define(IPC.BACKUP_RESTORE_AUTO, [z.custom<string>()], async (backupDbPath) => {
    return withCorrelation('backup-restore-auto', async (corrId) => {
      assertSafePath(backupDbPath)
      logger.info('ipc-export', `[${corrId}] restoring from auto backup: ${backupDbPath}`)
      const unusable = await refuseUnusableBackup(backupDbPath)
      if (unusable) return unusable
      let safetyPath: string
      try {
        safetyPath = await restoreFromDb(backupDbPath)
      } catch (err) {
        return failedBeforeReplace(corrId, err)
      }
      const openFailure = openRestoredOrRollBack(corrId, safetyPath)
      if (openFailure) return openFailure
      logger.info('ipc-export', `[${corrId}] restore complete, safety backup at ${safetyPath}`)
      return ok({ safetyPath })
    })
  }, { write: true })

  // A restore replaces every piece of data, so it is the first write a
  // read-only mode (e.g. viewing a backup) must stop; leave that mode first
  define(IPC.BACKUP_RESTORE_FILE, [z.custom<string>()], async (backupPath) => {
    return withCorrelation('backup-restore-file', async (corrId) => {
      assertSafePath(backupPath)
      logger.info('ipc-export', `[${corrId}] restoring from file: ${backupPath}`)
      const isPulseBak = backupPath.endsWith('.pulse-backup')
      const unusable = await refuseUnusableBackup(backupPath)
      if (unusable) return unusable
      let safetyPath: string
      try {
        safetyPath = isPulseBak ? await restoreFromPulseBackup(backupPath) : await restoreFromDb(backupPath)
      } catch (err) {
        return failedBeforeReplace(corrId, err)
      }
      const openFailure = openRestoredOrRollBack(corrId, safetyPath)
      if (openFailure) return openFailure
      logger.info('ipc-export', `[${corrId}] restore complete, safety backup at ${safetyPath}`)
      return ok({ safetyPath })
    })
  }, { write: true })

  // A backup made by another Pulse: unlocked with that Pulse's password or recovery key.
  // Stays on secureWrap: it sends AUTH_FORCE_LOCK back through the event's sender (D-047)
  secureWrap(IPC.BACKUP_RESTORE_OTHER, 'ipc-export', async (_e, backupPath: string, secret: string, newPassword: string, hint: string) => {
    const guard = enforceWritable(); if (guard) return guard
    return withCorrelation('backup-restore-other', async (corrId) => {
      if (typeof backupPath !== 'string' || backupPath.length === 0 || backupPath.length > 4096) return fail('Choose a backup file')
      if (typeof secret !== 'string' || secret.length === 0 || secret.length > 1024) return fail('Enter the password or recovery key used with this backup')
      if (typeof newPassword !== 'string' || newPassword.length > 1024) return fail('Invalid password')
      { const check = checkNewPassword(newPassword); if (!check.ok) return fail(check.message ?? 'Choose a stronger password') }
      if (typeof hint !== 'string' || hint.length > 512) return fail('Hint too long')
      assertSafePath(backupPath)
      let result: { safetyPath: string }
      try {
        result = await restoreOtherPulseBackup({ backupPath, secret, newPassword, hint })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Restore failed'
        logger.warn('ipc-export', `[${corrId}] restore of another Pulse's backup failed: ${msg}`)
        // Nothing was replaced; carry on with the current data
        try { openDatabase() } catch (openErr) { logger.error('ipc-export', `[${corrId}] could not reopen the database after a failed restore`, openErr) }
        return fail(describeRestoreError(err))
      }
      try {
        openDatabase()
      } catch (openErr) {
        logger.error('ipc-export', `[${corrId}] restored another Pulse's backup but could not open it`, openErr)
        // Nothing is open: don't keep the key, and go to the lock screen, where signing in
        // with the new password says what's wrong and offers a restore (F-031)
        const kind = openErr instanceof DatabaseOpenError ? openErr.kind : 'unreadable'
        lockApp()
        try { _e.sender.send(IPC.AUTH_FORCE_LOCK) } catch (sendErr) { logNonFatal('ipc-export', 'send force-lock after a failed open', sendErr) }
        return fail(dbOpenFailedCode(kind))
      }
      logger.info('ipc-export', `[${corrId}] restored another Pulse's backup, safety copy at ${result.safetyPath}`)
      return ok({ safetyPath: result.safetyPath })
    })
  })

  define(IPC.BACKUP_VERIFY, [z.custom<string>()], async (backupPath) => {
    assertSafePath(backupPath)
    const result = await verifyBackup(backupPath)
    return ok(result)
  })

  define(IPC.BACKUP_SCHEDULED_GET_CONFIG, [], () => {
    return ok(getScheduledConfig())
  })

  // The config's fields are checked in the body, in order, as before
  define(IPC.BACKUP_SCHEDULED_SET_CONFIG, [
    z.custom<PersistentScheduledConfig>(v => !!v && typeof v === 'object', 'Invalid config'),
  ], (config) => {
    if (typeof config.enabled !== 'boolean') return fail('Invalid enabled flag')
    if (typeof config.intervalHours !== 'number' || config.intervalHours < 1 || config.intervalHours > 720) return fail('Invalid interval (must be 1-720 hours)')
    // Main owns the run history; the renderer only changes the settings
    const current = getScheduledConfig()
    if (config.destinationDir !== undefined && config.destinationDir !== null) {
      if (typeof config.destinationDir !== 'string') return fail('Invalid destination directory')
      // The folder already saved was checked when it was chosen; re-checking it
      // would refuse a network folder picked in an earlier session
      if (config.destinationDir !== current.destinationDir) assertSafePath(config.destinationDir)
    }
    setScheduledConfig({ ...current, enabled: config.enabled, intervalHours: config.intervalHours, destinationDir: config.destinationDir ?? current.destinationDir })
    return ok(true)
  }, { write: true })

  // ── Backup Status (Finding 1.9) ────────────────────────────────────────────
  define(IPC.BACKUP_GET_STATUS, [], () => {
    const info = getBackupInfo()
    const backups = listAutoBackupsRich()
    // Reminders are on unless switched off, and count only copies kept somewhere else
    let reminderEnabled = true
    let remindAfterDays = 7
    try {
      const rows = getDb().prepare("SELECT key, value FROM settings WHERE key IN ('backup_reminder_enabled', 'backup_reminder_days')").all() as Array<{ key: string; value: string }>
      for (const r of rows) {
        if (r.key === 'backup_reminder_enabled') reminderEnabled = r.value !== 'false'
        if (r.key === 'backup_reminder_days') remindAfterDays = Math.max(1, Math.min(365, Number(r.value) || 7))
      }
    } catch (err) { logNonFatal('ipc-export', 'read backup reminder settings', err) }
    const health = getBackupHealth()
    const lastOffsiteMs = Date.parse(health.lastOffsiteISO ?? health.trackingSinceISO)
    return ok({
      lastAutoBackup: backups.length > 0 ? backups[0]!.timestamp.toISOString() : null,
      lastAutoBackupSuccess: !info.lastAutoBackupFailed,
      lastAutoBackupError: info.lastAutoBackupError,
      ...health,
      reminderEnabled,
      remindAfterDays,
      offsiteOverdue: reminderEnabled && Date.now() - lastOffsiteMs >= remindAfterDays * MS_PER_DAY,
    })
  })

  // ── Backup Validate Destination (Finding 2.12) ────────────────────────────
  // Every problem answers ok({ valid: false, error }) for the folder picker, so the checks stay in the body
  define(IPC.BACKUP_VALIDATE_DESTINATION, [z.unknown()], async (destPath) => {
    // Shown as they are under the folder picker, so each is a sentence a person can act on (Q-054)
    if (typeof destPath !== 'string' || destPath.length === 0) return ok({ valid: false, error: 'Choose a folder for your backups.' })
    try {
      assertSafePath(destPath)
    } catch {
      return ok({ valid: false, error: "Pulse can't use that folder. Choose a different one." })
    }
    if (!existsSync(destPath)) return ok({ valid: false, error: "That folder doesn't exist any more. Choose a different one." })

    const tmpFile = join(destPath, `.pulse-write-test-${Date.now()}.tmp`)
    // 2 second timeout for the write operation
    const writePromise = writeFile(tmpFile, 'pulse-write-test', 'utf-8')
      .then(() => unlink(tmpFile))
      .then(() => ({ valid: true as const }))
      .catch(() => ({ valid: false as const, error: "Pulse isn't allowed to save files in that folder. Choose a different one." }))

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<{ valid: false; error: string }>((resolve) => {
      timer = setTimeout(() => resolve({ valid: false, error: "That folder took too long to answer. If it's on a USB drive or network folder, check that it's connected, or choose a different one." }), 2000)
    })

    try {
      const result = await Promise.race([writePromise, timeoutPromise])
      return ok(result)
    } finally {
      clearTimeout(timer)
      // Clean up temp file if timeout won and writePromise left it behind
      unlink(tmpFile).catch(() => {})
    }
  })

  // ── Backup Preview (Finding 2.13) ─────────────────────────────────────────
  define(IPC.BACKUP_PREVIEW, [textArg('No path provided', { min: 1 })], async (backupPath) => {
    assertSafePath(backupPath)
    if (!existsSync(backupPath)) return fail('Backup file not found')

    const rawKey = getDbKey().toString('hex')
    // Validate key format BEFORE opening the DB or running any pragma
    if (!/^[0-9a-f]{64}$/.test(rawKey)) return fail('Invalid database key')

    // .pulse-backup files are zips; preview the database inside (it used to try
    // to open the zip itself as a database, so previews never worked for them)
    // When the backup was made, not when the first list in it was
    const made = await getBackupMadeInfo(backupPath)
    const counts = await withBackupDbFile(backupPath, (dbFile) => {
      let db: InstanceType<typeof BetterSqlite3> | null = null
      try {
        db = new BetterSqlite3(dbFile, { readonly: true })
        db.pragma(`cipher='sqlcipher'`)
        try {
          setEncryptionKey(db, rawKey)
        } catch (err) {
          logNonFatal('ipc-export', 'decrypt backup for preview', err)
          return fail('Could not decrypt backup')
        }
        db.pragma("kdf_iter=256000")
        db.pragma("cipher_page_size=4096")
        db.pragma("cipher_hmac_algorithm=HMAC_SHA512")
        db.pragma("cipher_kdf_algorithm=PBKDF2_HMAC_SHA512")

        const gridCount = (db.prepare(`SELECT COUNT(*) as n FROM grids WHERE ${liveGrid('')}`).get() as { n: number }).n
        // Records of lists in the Trash keep is_active = 1, so count only active lists (as BACKUP_GET_INFO does)
        const rowCount = (db.prepare(`SELECT COUNT(*) as n FROM rows r JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID} WHERE ${LIVE_ROW}`).get() as { n: number }).n
        // app_meta.schema_version is the app's migration level (PRAGMA schema_version is SQLite's internal cookie)
        const versionRow = db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string } | undefined
        const schemaVersion = versionRow ? parseInt(versionRow.value, 10) : 0

        return ok({ gridCount, rowCount, schemaVersion })
      } finally {
        try { db?.close() } catch (err) { logNonFatal('ipc-export', 'close backup preview db', err) }
      }
    })
    if (!counts.ok) return counts
    return ok({ ...counts.data, madeAt: made.madeAt, appVersion: made.appVersion })
  })

  // ── Export All CSV (Finding 3.24) ─────────────────────────────────────────
  define(IPC.EXPORT_ALL_CSV, [textArg('No folder provided', { min: 1 })], async (destFolder) => {
    assertSafePath(destFolder)
    if (!existsSync(destFolder)) {
      mkdirSync(destFolder, { recursive: true })
    }

    const db = getDb()
    const grids = db.prepare(`SELECT id, name FROM grids WHERE ${liveGrid('')} ORDER BY position, id`).all() as Array<{ id: number; name: string }>

    let exported = 0
    const errors: string[] = []
    // Two lists with the same name get two files, and nothing overwrites the notes file (X-21)
    const used = new Set<string>(['notes'])

    for (const grid of grids) {
      try {
        const base = listFileBase(grid.name) || `${word('list', { cap: true }, grid.id)} ${grid.id}`
        let safeName = base
        for (let n = 2; used.has(safeName.toLowerCase()); n++) safeName = `${base} (${n})`
        used.add(safeName.toLowerCase())
        const csvPath = join(destFolder, `${safeName}.csv`)
        // Everything comes out: hidden columns and archived records too, dates as the setting says
        await exportCsv({
          gridId: grid.id,
          columnIds: [],
          activeRowIds: [],
          destPath: csvPath,
          includeHidden: true,
          includeArchived: true,
          storedDeadlineDates: true,
        })
        exported++
      } catch (err) {
        // The raw error ("EINVAL: open …") means nothing to the person reading the results
        logger.error('ipc-export', 'Export All list failed', { gridId: grid.id, error: err instanceof Error ? err.message : String(err) })
        errors.push(`${grid.name}: we couldn't save this file. Try a different folder.`)
      }
    }

    let notes = 0
    try { notes = await exportNotesCsv(join(destFolder, 'notes.csv')) } catch (err) {
      // As for a list above: the raw error goes to the log, a sentence to the results (Q-054)
      logger.error('ipc-export', 'Export All notes failed', { error: err instanceof Error ? err.message : String(err) })
      errors.push(`${word('activity', { many: true, cap: true })}: we couldn't save this file. Try a different folder.`)
    }

    return ok({ exported, errors, notes })
  })

  // ── Export ─────────────────────────────────────────────────────────────────
  // The save path is checked first (and throws), then the choices, in the body as before
  define(IPC.EXPORT_CSV, [z.custom<CsvExportOptions>()], async (options) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    if (!validIdList(options.columnIds) || !validIdList(options.activeRowIds)) return fail('Invalid export choice')
    await exportCsv(options)
    return ok(true)
  })

  define(IPC.EXPORT_PDF_GRID, [z.custom<PdfGridOptions>()], async (options) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    if (!validIdList(options.columnIds) || !validIdList(options.activeRowIds)) return fail('Invalid export choice')
    await exportPdfGrid(options)
    return ok(true)
  })

  define(IPC.EXPORT_PDF_PROFILE, [z.custom<PdfProfileOptions>()], async (options) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    if (!validId(options.rowId)) return fail('Invalid row ID')
    if (!options.includeSections || typeof options.includeSections !== 'object') return fail('Invalid includeSections')
    const unavailable = refuseUnavailableRecord(options.rowId, options.gridId)
    if (unavailable) return unavailable
    await exportPdfProfile(options)
    return ok(true)
  })

  define(IPC.EXPORT_SUPERVISOR_REPORT, [z.custom<SupervisorReportOptions>()], async (options) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    await exportSupervisorReport(options)
    return ok(true)
  })

  define(IPC.EXPORT_PDF_CONTACT, [idArg()], async (providerId) => {
    const provider = getProvider(providerId)
    const defaultName = safeFileName(provider?.name ?? '', fileWord(word('contact'), 'contact'))
    const filePath = await pickSavePath({
      title: `Export ${word('contact', { cap: true })} as PDF`,
      defaultPath: `${defaultName}-profile.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    await exportContactPdf(providerId, filePath)
    return ok(filePath)
  })

  define(IPC.EXPORT_PDF_DIRECTORY, [z.custom<Record<string, unknown>>()], async (filterParams) => {
    const filePath = await pickSavePath({
      title: `Export ${word('contact', { cap: true })} directory as PDF`,
      defaultPath: `${fileWord(word('contact'), 'contact')}-directory.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    await exportDirectoryPdf(filterParams, filePath)
    return ok(filePath)
  })

  define(IPC.EXPORT_WEEKLY_PLANNER, [
    z.string('Invalid week').regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid week'),
  ], async (weekStart) => {
    const filePath = await pickSavePath({
      title: 'Save Weekly Planner',
      defaultPath: `weekly-planner-${weekStart}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    const nameRow = getDb().prepare("SELECT value FROM settings WHERE key = 'profile_name'").get() as { value: string } | undefined
    await exportWeeklyPlanner(weekStart, filePath, nameRow?.value || undefined)
    return ok(filePath)
  })

  // The scope's ids and dates are checked in the body, as before
  define(IPC.EXPORT_AUDIT_REPORT, [
    z.custom<AuditScope>(v => typeof v === 'object' && v !== null, 'Invalid report options'),
  ], async (scope) => {
    const ymd = (v: unknown) => v == null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
    if ((scope.rowId != null && !validId(scope.rowId)) || (scope.gridId != null && !validId(scope.gridId))) return fail('Invalid ID')
    if (!ymd(scope.from) || !ymd(scope.to)) return fail('Invalid date range')
    const db = getDb()
    const label = scope.rowId != null
      ? (db.prepare("SELECT COALESCE(NULLIF(display_name, ''), ?) AS n FROM rows WHERE id = ?").get(`Unnamed ${word('record')}`, scope.rowId) as { n: string } | undefined)?.n
      : scope.gridId != null
        ? (db.prepare('SELECT name AS n FROM grids WHERE id = ?').get(scope.gridId) as { n: string } | undefined)?.n
        : `All ${word('list', { many: true })}`
    if (!label) return fail(`We couldn't find that ${word('record')} or ${word('list')}.`)
    // The file name stays generic: client names don't belong in file names
    const filePath = await pickSavePath({
      title: 'Save Audit Trail',
      defaultPath: `audit-trail-${localDateString()}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    const nameRow = db.prepare("SELECT value FROM settings WHERE key = 'profile_name'").get() as { value: string } | undefined
    const summary = await exportAuditReport({ rowId: scope.rowId, gridId: scope.gridId, from: scope.from, to: scope.to }, filePath, label, nameRow?.value || undefined)
    return ok({ filePath, ...summary })
  })

  define(IPC.EXPORT_HANDOFF_PACKET, [z.custom<HandoffOptions>()], async (opts) => {
    if (typeof opts !== 'object' || opts === null || !validId(opts.rowId) || !validId(opts.gridId)) return fail('Invalid ID')
    const text = (v: unknown, max: number) => v == null || (typeof v === 'string' && v.length <= max)
    if (!text(opts.receiving, 500) || !text(opts.summary, 20_000)) return fail('That text is too long')
    const unavailable = refuseUnavailableRecord(opts.rowId, opts.gridId)
    if (unavailable) return unavailable
    const filePath = await pickSavePath({
      title: 'Save Handoff Packet',
      defaultPath: `handoff-packet-${localDateString()}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    await exportHandoffPacket({ rowId: opts.rowId, gridId: opts.gridId, receiving: opts.receiving, summary: opts.summary, includePictures: opts.includePictures === true, includeScratchPad: opts.includeScratchPad === true }, filePath)
    return ok(filePath)
  })

  define(IPC.EXPORT_ICS, [z.custom<{ fullNames?: boolean } | undefined>()], async (opts) => {
    const fullNames = opts?.fullNames === true
    const filePath = await pickSavePath({
      title: 'Save Calendar File',
      defaultPath: `pulse-calendar-${localDateString()}.ics`,
      filters: [{ name: 'Calendar', extensions: ['ics'] }]
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    const count = await exportIcs(filePath, { fullNames })
    return ok({ filePath, count })
  })

  define(IPC.LETTER_TEMPLATE_EXPORT_PDF, [z.custom<{ text: string }>()], async (opts) => {
    if (typeof opts?.text !== 'string') return fail('Text must be a string')
    if (opts.text.length > 500_000) return fail('Text too large (max 500,000 characters)')
    const filePath = await pickSavePath({
      title: 'Export Letter as PDF',
      defaultPath: `letter-${localDateString()}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    await exportLetterPdf(opts.text, filePath)
    return ok(filePath)
  })

  // ── Import ─────────────────────────────────────────────────────────────────
  // The path is checked first (and throws), then the header row, in the body as before
  define(IPC.IMPORT_FILE_PREVIEW, [
    z.custom<string>(), z.custom<number | undefined>(), z.custom<number | undefined>(),
  ], async (filePath, sheetIndex, headerRowIndex) => {
    assertSafePath(filePath)
    // Validate headerRowIndex if provided
    if (headerRowIndex !== undefined && headerRowIndex !== null) {
      if (!Number.isInteger(headerRowIndex) || headerRowIndex < 0 || headerRowIndex >= 100) {
        return fail('Invalid header row index')
      }
    }
    const preview = await parseImportFile(filePath, sheetIndex ?? 0, headerRowIndex)
    return ok(preview)
  })

  define(IPC.IMPORT_DETECT_COLUMNS, [
    idArg('Invalid grid ID'), z.array(z.custom<string>(), 'Headers must be an array').max(200, 'Too many headers (max 200)'),
  ], (gridId, headers) => {
    const mappings = autoMatchColumns(gridId, headers)
    return ok(mappings)
  })

  // The options are checked in the body, in order, as before
  define(IPC.IMPORT_FILE, [
    z.custom<ImportOptions>(v => !!v && typeof v === 'object', 'Invalid import options'),
  ], async (options) => {
    // The rest of the options, checked here rather than deep inside the import (Q-056)
    if (options.duplicateStrategy !== undefined && !['none', 'by_name', 'by_column', 'name_and_dob'].includes(options.duplicateStrategy)) return fail('Invalid import options')
    if (options.duplicateColumnId != null && !validId(options.duplicateColumnId)) return fail('Invalid import options')
    if (options.headerRowIndex != null && (!Number.isInteger(options.headerRowIndex) || options.headerRowIndex < 0 || options.headerRowIndex >= 100)) return fail('Invalid import options')
    for (const flag of ['cleanData', 'flipLastFirst', 'createMissingLinks', 'skipHiddenRows'] as const) {
      if (options[flag] !== undefined && typeof options[flag] !== 'boolean') return fail('Invalid import options')
    }
    assertSafePath(options.filePath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    if (!Array.isArray(options.columnMappings) || options.columnMappings.length > 200) return fail('Invalid or too many column mappings (max 200)')
    const win = BrowserWindow.getAllWindows()[0]
    const onProgress = (imported: number, total: number) => {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.IMPORT_PROGRESS, { imported, total })
    }
    if (options.sheetName !== undefined && (typeof options.sheetName !== 'string' || options.sheetName.length > 255)) return fail('Invalid sheet')
    // Preview of the chosen sheet (types and name flipping come from it)
    const preview = await parseImportFile(options.filePath, 0, options.headerRowIndex, options.sheetName)
    const result = await executeImport({ ...options, createMissingLinks: options.createMissingLinks === true, skipHiddenRows: options.skipHiddenRows === true }, preview, onProgress)
    return ok(result)
  }, { write: true })

  // "Undo this import": the records it added go to Trash, where they can still be restored
  define(IPC.IMPORT_UNDO, [
    idArg('Invalid list'), idListArg('Nothing to undo', 'Nothing to undo', { min: 1, max: 50_000 }),
  ], (gridId, rowIds) => {
    const db = getDb()
    const stmt = db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND grid_id = ? AND deleted_at IS NULL")
    let moved = 0
    db.transaction(() => { for (const id of rowIds) moved += stmt.run(id, gridId).changes })()
    return ok({ moved })
  }, { write: true })

  // ── Setup Templates (.pulse) ────────────────────────────────────────────────
  define(IPC.SETUP_TEMPLATE_GET_ALL, [], () => {
    return ok(getSetupTemplates())
  })

  // The id is checked before the read-only gate here, so the gate stays in the body
  define(IPC.SETUP_TEMPLATE_DELETE, [idArg('Invalid template ID')], (id) => {
    const guard = enforceWritable(); if (guard) return guard
    deleteSetupTemplate(id)
    return ok(true)
  })

  // The id is checked before the read-only gate here, so the gate stays in the body
  define(IPC.SETUP_TEMPLATE_EXPORT, [idArg('Invalid grid ID'), z.custom<string>()], async (gridId, destPath) => {
    const guard = enforceWritable(); if (guard) return guard
    assertSafePath(destPath)
    const pulse = exportGridAsPulse(gridId)
    writePulseFile(pulse, destPath)
    // Also save to setup_templates library for reuse
    createSetupTemplate(pulse.name, pulse.description ?? null, JSON.stringify(pulse))
    return ok(true)
  })

  // A template from the library (Templates page → Export): write what's stored.
  // SETUP_TEMPLATE_EXPORT takes a list id, so this used to fail with "Invalid grid ID".
  define(IPC.SETUP_TEMPLATE_EXPORT_SAVED, [
    idArg('Invalid template'), textArg('Choose where to save it', { min: 1 }),
  ], (templateId, destPath) => {
    assertSafePath(destPath)
    const row = getDb().prepare('SELECT template_data FROM setup_templates WHERE id = ?').get(templateId) as { template_data: string } | undefined
    if (!row) return fail("That template doesn't exist any more.")
    writePulseFile(validatePulseJson(row.template_data), destPath)
    return ok(true)
  })

  define(IPC.SETUP_TEMPLATE_IMPORT, [z.custom<string>()], async (filePath) => {
    assertSafePath(filePath)
    const { pulse, preview } = await parsePulseFile(filePath)
    return ok({ pulse, preview })
  })

  // validatePulseJson checks the template (and throws) in the body, as before
  define(IPC.SETUP_TEMPLATE_APPLY, [
    z.custom<string>(), z.custom<'new' | 'existing'>(), z.custom<number | undefined>(), z.custom<boolean | undefined>(),
  ], (pulseJson, mode, gridId, saveToLibrary) => {
    const pulse = validatePulseJson(pulseJson)
    if (mode === 'new') {
      const newGridId = applyPulseToNewGrid(pulse)
      if (saveToLibrary) createSetupTemplate(pulse.name, pulse.description ?? null, pulseJson)
      return ok(newGridId)
    } else if (mode === 'existing' && validId(gridId)) {
      applyPulseToExistingGrid(pulse, gridId)
      if (saveToLibrary) createSetupTemplate(pulse.name, pulse.description ?? null, pulseJson)
      return ok(gridId)
    }
    return fail('Invalid apply mode or missing gridId')
  }, { write: true })

  // ── Letter Templates ────────────────────────────────────────────────────────
  define(IPC.LETTER_TEMPLATE_GET_ALL, [], () => {
    return ok(getLetterTemplates())
  })

  // The description (second) is checked after the content (third), so its check stays in the body
  define(IPC.LETTER_TEMPLATE_CREATE, [
    textArg('Template name required (max 500 chars)', { max: 500, notBlank: true }),
    z.custom<string | null>(),
    textArg('Content too large (max 500K chars)', { max: 500_000 }),
  ], (name, description, content) => {
    if (description !== null && (typeof description !== 'string' || description.length > 2000)) return fail('Description too long')
    const id = createLetterTemplate(name, description, content)
    return ok(id)
  }, { write: true })

  define(IPC.LETTER_TEMPLATE_UPDATE, [idArg(), z.custom<{ name?: string; description?: string | null; content?: string }>()], (id, updates) => {
    if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.trim().length === 0 || updates.name.length > 500)) return fail('Invalid name')
    if (updates.content !== undefined && (typeof updates.content !== 'string' || updates.content.length > 500_000)) return fail('Content too large')
    if (updates.description !== undefined && updates.description !== null && (typeof updates.description !== 'string' || updates.description.length > 2000)) return fail('Description too long')
    updateLetterTemplate(id, updates)
    return ok(true)
  }, { write: true })

  define(IPC.LETTER_TEMPLATE_DELETE, [idArg()], (id) => {
    deleteLetterTemplate(id)
    return ok(true)
  }, { write: true })

  // Batch documents and address labels (W10 §3.1–3.2): built first, so problems show before the save dialog
  const docTarget = (t: unknown): DocTarget | null => {
    if (!t || typeof t !== 'object') return null
    const o = t as Record<string, unknown>
    if (!validId(o.gridId)) return null
    if (o.rowIds != null && (!Array.isArray(o.rowIds) || o.rowIds.length > MAX_BATCH || !o.rowIds.every(validId))) return null
    let deadline: DocTarget['deadline']
    if (o.deadline != null) {
      const d = o.deadline as Record<string, unknown>
      const ymd = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
      if (!validId(d.columnId) || !ymd(d.from) || !ymd(d.to)) return null
      deadline = { columnId: d.columnId as number, from: d.from as string, to: d.to as string }
    }
    return { gridId: o.gridId as number, ...(o.rowIds ? { rowIds: o.rowIds as number[] } : {}), ...(deadline ? { deadline } : {}) }
  }

  // One message ('Invalid request') answers any bad argument, checked together in the body
  define(IPC.DOC_BATCH, [z.unknown(), z.unknown(), z.unknown()], async (templateId, target, page) => {
    const t = docTarget(target)
    if (!validId(templateId) || !t || (page !== 'letter' && page !== 'postcard')) return fail('Invalid request')
    let built: ReturnType<typeof buildBatchPdf>
    try { built = buildBatchPdf(templateId, t, page) } catch (err) { if (err instanceof DocumentError) return fail(err.message); throw err }
    const filePath = await pickSavePath({
      title: 'Save documents', defaultPath: `${page === 'postcard' ? 'postcards' : 'documents'}-${localDateString()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    await atomicWriteFileAsync(filePath, Buffer.from(built.pdf.output('arraybuffer')))
    return ok({ filePath, count: built.count, unknown: built.unknown })
  })

  define(IPC.DOC_BATCH_PREVIEW, [z.unknown(), z.unknown()], (templateId, target) => {
    const t = docTarget(target)
    if (!t || (templateId !== null && !validId(templateId))) return fail('Invalid request')
    return ok(previewBatch(templateId as number | null, t))
  })

  define(IPC.DOC_LABELS, [z.unknown(), z.unknown(), z.unknown()], async (target, addressColumnId, layout) => {
    const t = docTarget(target)
    if (!t || !validId(addressColumnId) || (layout !== 'avery-5160' && layout !== 'avery-5163')) return fail('Invalid request')
    let built: ReturnType<typeof buildLabelsPdf>
    try { built = buildLabelsPdf(t, addressColumnId, layout) } catch (err) { if (err instanceof DocumentError) return fail(err.message); throw err }
    const filePath = await pickSavePath({
      title: 'Save address labels', defaultPath: `labels-${localDateString()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    await atomicWriteFileAsync(filePath, Buffer.from(built.pdf.output('arraybuffer')))
    return ok({ filePath, count: built.count, skipped: built.skipped })
  })

  define(IPC.PLACEHOLDER_FIELDS, [idArg()], (gridId) => {
    return ok(placeholderFields(gridId))
  })

  define(IPC.LETTER_TEMPLATE_GENERATE, [idArg(), idArg(), idArg()], (templateId, rowId, gridId) => {
    const unavailable = refuseUnavailableRecord(rowId, gridId)
    if (unavailable) return unavailable
    const result = generateLetter(templateId, rowId, gridId)
    return ok(result)
  })
}

/**
 * A list name as a file name for Export All: characters no system allows become
 * "_", trailing dots and spaces go (Windows drops them), and names Windows keeps
 * for devices ("Con", "PRN", "Aux", "Nul", "COM1", "LPT1", also before a dot)
 * get a "_" so the file can be written there.
 */
export function listFileBase(name: string): string {
  const base = name.replace(/[/\\:*?"<>|]/g, '_').trim().replace(/[. ]+$/, '')
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(base) ? base.replace(/^([^.]*)/, '$1_') : base
}
