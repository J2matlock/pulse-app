/**
 * ipc-export.ts — EXPORT_*, BACKUP_*, IMPORT_*, SETUP_TEMPLATE_*, LETTER_TEMPLATE_* IPC handlers
 */

import { dialog, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { logger } from '../logger'
import { secureWrap, ok, fail, assertSafePath, validId, enforceWritable, logNonFatal, withCorrelation } from './ipc-utils'
import { openDatabase, getDb, resolveDatabasePath, closeDatabase, setEncryptionKey } from '../database'
import { getProvider } from '../contacts'
import {
  listAutoBackupsRich, runManualBackup,
  restoreFromDb, restoreFromPulseBackup, getBackupInfo,
  verifyBackup, getScheduledConfig, setScheduledConfig, withBackupDbFile, runScheduledBackupNow,
  describeBackupError, getBackupHealth, getBackupMadeInfo, restoreOtherPulseBackup,
  type PersistentScheduledConfig
} from '../backup'
import { getDbKey } from '../auth'
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
import { safeFileName } from '../../shared/fileName'

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

export function registerExportHandlers(): void {
  // ── Backup (Auto listing) ──────────────────────────────────────────────────
  secureWrap(IPC.BACKUP_AUTO_LIST, 'ipc-export', () => {
    return ok(listAutoBackupsRich())
  })

  // ── Backup (Layers 2 & 3) ──────────────────────────────────────────────────
  secureWrap(IPC.BACKUP_GET_INFO, 'ipc-export', () => {
    const info = getBackupInfo()
    const dbPath = resolveDatabasePath()
    let dbSize = 0
    try {
      dbSize = statSync(dbPath).size
    } catch (err) { logNonFatal('ipc-export', 'stat db file for size', err) }
    let totalClients = 0
    try {
      // Records in deleted lists aren't active (X-11)
      const row = getDb().prepare('SELECT COUNT(*) as cnt FROM rows r JOIN grids g ON g.id = r.grid_id AND g.is_active = 1 WHERE r.is_active = 1 AND r.deleted_at IS NULL').get() as { cnt: number }
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
  secureWrap(IPC.BACKUP_SCHEDULED_RUN_NOW, 'ipc-export', async () => {
    return ok(await runScheduledBackupNow())
  })

  secureWrap(IPC.BACKUP_MANUAL_CREATE, 'ipc-export', async (_e, destPath: string) => {
    assertSafePath(destPath)
    try {
      return ok(await runManualBackup(destPath))
    } catch (err) {
      logger.error('ipc-export', 'Manual backup failed', err)
      return fail(describeBackupError(err))
    }
  })

  secureWrap(IPC.BACKUP_RESTORE_AUTO, 'ipc-export', async (_e, backupDbPath: string) => {
    return withCorrelation('backup-restore-auto', async (corrId) => {
      assertSafePath(backupDbPath)
      logger.info('ipc-export', `[${corrId}] restoring from auto backup: ${backupDbPath}`)
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
  })

  secureWrap(IPC.BACKUP_RESTORE_FILE, 'ipc-export', async (_e, backupPath: string) => {
    return withCorrelation('backup-restore-file', async (corrId) => {
      assertSafePath(backupPath)
      logger.info('ipc-export', `[${corrId}] restoring from file: ${backupPath}`)
      const isPulseBak = backupPath.endsWith('.pulse-backup')
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
  })

  // A backup made by another Pulse: unlocked with that Pulse's password or recovery key
  secureWrap(IPC.BACKUP_RESTORE_OTHER, 'ipc-export', async (_e, backupPath: string, secret: string, newPassword: string, hint: string) => {
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
        return fail('The backup was restored, but Pulse couldn\'t open it. Close Pulse, open it again and sign in with your new password.')
      }
      logger.info('ipc-export', `[${corrId}] restored another Pulse's backup, safety copy at ${result.safetyPath}`)
      return ok({ safetyPath: result.safetyPath })
    })
  })

  secureWrap(IPC.BACKUP_VERIFY, 'ipc-export', async (_e, backupPath: string) => {
    assertSafePath(backupPath)
    const result = await verifyBackup(backupPath)
    return ok(result)
  })

  secureWrap(IPC.BACKUP_SCHEDULED_GET_CONFIG, 'ipc-export', () => {
    return ok(getScheduledConfig())
  })

  secureWrap(IPC.BACKUP_SCHEDULED_SET_CONFIG, 'ipc-export', (_e, config: PersistentScheduledConfig) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!config || typeof config !== 'object') return fail('Invalid config')
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
  })

  // ── Backup Status (Finding 1.9) ────────────────────────────────────────────
  secureWrap(IPC.BACKUP_GET_STATUS, 'ipc-export', () => {
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
  secureWrap(IPC.BACKUP_VALIDATE_DESTINATION, 'ipc-export', async (_e, destPath: string) => {
    if (typeof destPath !== 'string' || destPath.length === 0) return ok({ valid: false, error: 'No path provided' })
    try {
      assertSafePath(destPath)
    } catch {
      return ok({ valid: false, error: 'Invalid path' })
    }
    if (!existsSync(destPath)) return ok({ valid: false, error: 'Folder does not exist' })

    const tmpFile = join(destPath, `.pulse-write-test-${Date.now()}.tmp`)
    // 2 second timeout for the write operation
    const writePromise = writeFile(tmpFile, 'pulse-write-test', 'utf-8')
      .then(() => unlink(tmpFile))
      .then(() => ({ valid: true as const }))
      .catch(() => ({ valid: false as const, error: 'Permission denied' }))

    const timeoutPromise = new Promise<{ valid: false; error: string }>((resolve) => {
      setTimeout(() => resolve({ valid: false, error: 'Write timed out' }), 2000)
    })

    try {
      const result = await Promise.race([writePromise, timeoutPromise])
      return ok(result)
    } finally {
      // Clean up temp file if timeout won and writePromise left it behind
      unlink(tmpFile).catch(() => {})
    }
  })

  // ── Backup Preview (Finding 2.13) ─────────────────────────────────────────
  secureWrap(IPC.BACKUP_PREVIEW, 'ipc-export', async (_e, backupPath: string) => {
    if (typeof backupPath !== 'string' || backupPath.length === 0) return fail('No path provided')
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

        const gridCount = (db.prepare("SELECT COUNT(*) as n FROM grids WHERE is_active = 1").get() as { n: number }).n
        // Records of lists in the Trash keep is_active = 1, so count only active lists (as BACKUP_GET_INFO does)
        const rowCount = (db.prepare("SELECT COUNT(*) as n FROM rows r JOIN grids g ON g.id = r.grid_id AND g.is_active = 1 WHERE r.is_active = 1 AND r.deleted_at IS NULL").get() as { n: number }).n
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
  secureWrap(IPC.EXPORT_ALL_CSV, 'ipc-export', async (_e, destFolder: string) => {
    if (typeof destFolder !== 'string' || destFolder.length === 0) return fail('No folder provided')
    assertSafePath(destFolder)
    if (!existsSync(destFolder)) {
      mkdirSync(destFolder, { recursive: true })
    }

    const db = getDb()
    const grids = db.prepare('SELECT id, name FROM grids WHERE is_active = 1 ORDER BY position, id').all() as Array<{ id: number; name: string }>

    let exported = 0
    const errors: string[] = []
    // Two lists with the same name get two files, and nothing overwrites the notes file (X-21)
    const used = new Set<string>(['notes'])

    for (const grid of grids) {
      try {
        // Sanitize grid name for filesystem: replace unsafe chars with _
        const base = grid.name.replace(/[/\\:*?"<>|]/g, '_').trim() || `grid_${grid.id}`
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
        })
        exported++
      } catch (err) {
        errors.push(`${grid.name}: ${err instanceof Error ? err.message : 'Export failed'}`)
      }
    }

    let notes = 0
    try { notes = await exportNotesCsv(join(destFolder, 'notes.csv')) } catch (err) {
      errors.push(`Notes: ${err instanceof Error ? err.message : 'Export failed'}`)
    }

    return ok({ exported, errors, notes })
  })

  // ── Export ─────────────────────────────────────────────────────────────────
  secureWrap(IPC.EXPORT_CSV, 'ipc-export', async (_e, options: CsvExportOptions) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    if (!validIdList(options.columnIds) || !validIdList(options.activeRowIds)) return fail('Invalid export choice')
    await exportCsv(options)
    return ok(true)
  })

  secureWrap(IPC.EXPORT_PDF_GRID, 'ipc-export', async (_e, options: PdfGridOptions) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    if (!validIdList(options.columnIds) || !validIdList(options.activeRowIds)) return fail('Invalid export choice')
    await exportPdfGrid(options)
    return ok(true)
  })

  secureWrap(IPC.EXPORT_PDF_PROFILE, 'ipc-export', async (_e, options: PdfProfileOptions) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    if (!validId(options.rowId)) return fail('Invalid row ID')
    if (!options.includeSections || typeof options.includeSections !== 'object') return fail('Invalid includeSections')
    await exportPdfProfile(options)
    return ok(true)
  })

  secureWrap(IPC.EXPORT_SUPERVISOR_REPORT, 'ipc-export', async (_e, options: SupervisorReportOptions) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    await exportSupervisorReport(options)
    return ok(true)
  })

  secureWrap(IPC.EXPORT_PDF_CONTACT, 'ipc-export', async (_e, providerId: number) => {
    if (!validId(providerId)) return fail('Invalid ID')
    const provider = getProvider(providerId)
    const defaultName = provider ? safeFileName(provider.name) : 'contact'
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Contact as PDF',
      defaultPath: `${defaultName}-profile.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    await exportContactPdf(providerId, filePath)
    return ok(filePath)
  })

  secureWrap(IPC.EXPORT_PDF_DIRECTORY, 'ipc-export', async (_e, filterParams: Record<string, unknown>) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: `Export ${word('contact', { cap: true })} directory as PDF`,
      defaultPath: 'contact-directory.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    await exportDirectoryPdf(filterParams, filePath)
    return ok(filePath)
  })

  secureWrap(IPC.EXPORT_WEEKLY_PLANNER, 'ipc-export', async (_e, weekStart: string) => {
    if (typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return fail('Invalid week')
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Weekly Planner',
      defaultPath: `weekly-planner-${weekStart}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    const nameRow = getDb().prepare("SELECT value FROM settings WHERE key = 'profile_name'").get() as { value: string } | undefined
    await exportWeeklyPlanner(weekStart, filePath, nameRow?.value || undefined)
    return ok(filePath)
  })

  secureWrap(IPC.EXPORT_AUDIT_REPORT, 'ipc-export', async (_e, scope: AuditScope) => {
    const ymd = (v: unknown) => v == null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
    if (typeof scope !== 'object' || scope === null) return fail('Invalid report options')
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
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Audit Trail',
      defaultPath: `audit-trail-${localDateString()}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    const nameRow = db.prepare("SELECT value FROM settings WHERE key = 'profile_name'").get() as { value: string } | undefined
    const summary = await exportAuditReport({ rowId: scope.rowId, gridId: scope.gridId, from: scope.from, to: scope.to }, filePath, label, nameRow?.value || undefined)
    return ok({ filePath, ...summary })
  })

  secureWrap(IPC.EXPORT_HANDOFF_PACKET, 'ipc-export', async (_e, opts: HandoffOptions) => {
    if (typeof opts !== 'object' || opts === null || !validId(opts.rowId) || !validId(opts.gridId)) return fail('Invalid ID')
    const text = (v: unknown, max: number) => v == null || (typeof v === 'string' && v.length <= max)
    if (!text(opts.receiving, 500) || !text(opts.summary, 20_000)) return fail('That text is too long')
    const row = getDb().prepare('SELECT grid_id FROM rows WHERE id = ?').get(opts.rowId) as { grid_id: number } | undefined
    if (!row || row.grid_id !== opts.gridId) return fail(`We couldn't find that ${word('record')}.`)
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Handoff Packet',
      defaultPath: `handoff-packet-${localDateString()}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    await exportHandoffPacket({ rowId: opts.rowId, gridId: opts.gridId, receiving: opts.receiving, summary: opts.summary, includePictures: opts.includePictures === true, includeScratchPad: opts.includeScratchPad === true }, filePath)
    return ok(filePath)
  })

  secureWrap(IPC.EXPORT_ICS, 'ipc-export', async (_e, opts?: { fullNames?: boolean }) => {
    const fullNames = opts?.fullNames === true
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Calendar File',
      defaultPath: `pulse-calendar-${localDateString()}.ics`,
      filters: [{ name: 'Calendar', extensions: ['ics'] }]
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    const count = await exportIcs(filePath, { fullNames })
    return ok({ filePath, count })
  })

  secureWrap(IPC.LETTER_TEMPLATE_EXPORT_PDF, 'ipc-export', async (_e, opts: { text: string }) => {
    if (typeof opts?.text !== 'string') return fail('Text must be a string')
    if (opts.text.length > 500_000) return fail('Text too large (max 500,000 characters)')
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Letter as PDF',
      defaultPath: `letter-${localDateString()}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    await exportLetterPdf(opts.text, filePath)
    return ok(filePath)
  })

  // ── Import ─────────────────────────────────────────────────────────────────
  secureWrap(IPC.IMPORT_FILE_PREVIEW, 'ipc-export', async (_e, filePath: string, sheetIndex?: number, headerRowIndex?: number) => {
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

  secureWrap(IPC.IMPORT_DETECT_COLUMNS, 'ipc-export', (_e, gridId: number, headers: string[]) => {
    if (!validId(gridId)) return fail('Invalid grid ID')
    if (!Array.isArray(headers)) return fail('Headers must be an array')
    if (headers.length > 200) return fail('Too many headers (max 200)')
    const mappings = autoMatchColumns(gridId, headers)
    return ok(mappings)
  })

  secureWrap(IPC.IMPORT_FILE, 'ipc-export', async (_e, options: ImportOptions) => {
    const guard = enforceWritable(); if (guard) return guard
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
    const result = await executeImport({ ...options, createMissingLinks: options.createMissingLinks === true }, preview, onProgress)
    return ok(result)
  })

  // "Undo this import": the records it added go to Trash, where they can still be restored
  secureWrap(IPC.IMPORT_UNDO, 'ipc-export', (_e, gridId: number, rowIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid list')
    if (!Array.isArray(rowIds) || rowIds.length === 0 || rowIds.length > 50_000 || !rowIds.every(validId)) return fail('Nothing to undo')
    const db = getDb()
    const stmt = db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND grid_id = ? AND deleted_at IS NULL")
    let moved = 0
    db.transaction(() => { for (const id of rowIds) moved += stmt.run(id, gridId).changes })()
    return ok({ moved })
  })

  // ── Setup Templates (.pulse) ────────────────────────────────────────────────
  secureWrap(IPC.SETUP_TEMPLATE_GET_ALL, 'ipc-export', () => {
    return ok(getSetupTemplates())
  })

  secureWrap(IPC.SETUP_TEMPLATE_DELETE, 'ipc-export', (_e, id: number) => {
    if (!validId(id)) return fail('Invalid template ID')
    const guard = enforceWritable(); if (guard) return guard
    deleteSetupTemplate(id)
    return ok(true)
  })

  secureWrap(IPC.SETUP_TEMPLATE_EXPORT, 'ipc-export', async (_e, gridId: number, destPath: string) => {
    if (!validId(gridId)) return fail('Invalid grid ID')
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
  secureWrap(IPC.SETUP_TEMPLATE_EXPORT_SAVED, 'ipc-export', (_e, templateId: number, destPath: string) => {
    if (!validId(templateId)) return fail('Invalid template')
    if (typeof destPath !== 'string' || destPath.length === 0) return fail('Choose where to save it')
    assertSafePath(destPath)
    const row = getDb().prepare('SELECT template_data FROM setup_templates WHERE id = ?').get(templateId) as { template_data: string } | undefined
    if (!row) return fail("That template doesn't exist any more.")
    writePulseFile(validatePulseJson(row.template_data), destPath)
    return ok(true)
  })

  secureWrap(IPC.SETUP_TEMPLATE_IMPORT, 'ipc-export', async (_e, filePath: string) => {
    assertSafePath(filePath)
    const { pulse, preview } = await parsePulseFile(filePath)
    return ok({ pulse, preview })
  })

  secureWrap(IPC.SETUP_TEMPLATE_APPLY, 'ipc-export', (_e, pulseJson: string, mode: 'new' | 'existing', gridId?: number, saveToLibrary?: boolean) => {
    const guard = enforceWritable(); if (guard) return guard
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
  })

  // ── Letter Templates ────────────────────────────────────────────────────────
  secureWrap(IPC.LETTER_TEMPLATE_GET_ALL, 'ipc-export', () => {
    return ok(getLetterTemplates())
  })

  secureWrap(IPC.LETTER_TEMPLATE_CREATE, 'ipc-export', (_e, name: string, description: string | null, content: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 500) return fail('Template name required (max 500 chars)')
    if (typeof content !== 'string' || content.length > 500_000) return fail('Content too large (max 500K chars)')
    if (description !== null && (typeof description !== 'string' || description.length > 2000)) return fail('Description too long')
    const id = createLetterTemplate(name, description, content)
    return ok(id)
  })

  secureWrap(IPC.LETTER_TEMPLATE_UPDATE, 'ipc-export', (_e, id: number, updates: { name?: string; description?: string | null; content?: string }) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.trim().length === 0 || updates.name.length > 500)) return fail('Invalid name')
    if (updates.content !== undefined && (typeof updates.content !== 'string' || updates.content.length > 500_000)) return fail('Content too large')
    if (updates.description !== undefined && updates.description !== null && (typeof updates.description !== 'string' || updates.description.length > 2000)) return fail('Description too long')
    updateLetterTemplate(id, updates)
    return ok(true)
  })

  secureWrap(IPC.LETTER_TEMPLATE_DELETE, 'ipc-export', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    deleteLetterTemplate(id)
    return ok(true)
  })

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

  secureWrap(IPC.DOC_BATCH, 'ipc-export', async (_e, templateId: unknown, target: unknown, page: unknown) => {
    const t = docTarget(target)
    if (!validId(templateId) || !t || (page !== 'letter' && page !== 'postcard')) return fail('Invalid request')
    let built: ReturnType<typeof buildBatchPdf>
    try { built = buildBatchPdf(templateId, t, page) } catch (err) { if (err instanceof DocumentError) return fail(err.message); throw err }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save documents', defaultPath: `${page === 'postcard' ? 'postcards' : 'documents'}-${localDateString()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    await atomicWriteFileAsync(filePath, Buffer.from(built.pdf.output('arraybuffer')))
    return ok({ filePath, count: built.count, unknown: built.unknown })
  })

  secureWrap(IPC.DOC_BATCH_PREVIEW, 'ipc-export', (_e, templateId: unknown, target: unknown) => {
    const t = docTarget(target)
    if (!t || (templateId !== null && !validId(templateId))) return fail('Invalid request')
    return ok(previewBatch(templateId as number | null, t))
  })

  secureWrap(IPC.DOC_LABELS, 'ipc-export', async (_e, target: unknown, addressColumnId: unknown, layout: unknown) => {
    const t = docTarget(target)
    if (!t || !validId(addressColumnId) || (layout !== 'avery-5160' && layout !== 'avery-5163')) return fail('Invalid request')
    let built: ReturnType<typeof buildLabelsPdf>
    try { built = buildLabelsPdf(t, addressColumnId, layout) } catch (err) { if (err instanceof DocumentError) return fail(err.message); throw err }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save address labels', defaultPath: `labels-${localDateString()}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    await atomicWriteFileAsync(filePath, Buffer.from(built.pdf.output('arraybuffer')))
    return ok({ filePath, count: built.count, skipped: built.skipped })
  })

  secureWrap(IPC.PLACEHOLDER_FIELDS, 'ipc-export', (_e, gridId: number) => {
    if (!validId(gridId)) return fail('Invalid ID')
    return ok(placeholderFields(gridId))
  })

  secureWrap(IPC.LETTER_TEMPLATE_GENERATE, 'ipc-export', (_e, templateId: number, rowId: number, gridId: number) => {
    if (!validId(templateId) || !validId(rowId) || !validId(gridId)) return fail('Invalid ID')
    const result = generateLetter(templateId, rowId, gridId)
    return ok(result)
  })
}
