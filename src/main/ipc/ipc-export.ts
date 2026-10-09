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
  listAutoBackupsRich, runScheduledBackup, runManualBackup,
  restoreFromDb, restoreFromPulseBackup, getBackupInfo,
  verifyBackup, getScheduledConfig, setScheduledConfig, withBackupDbFile,
  type ScheduledBackupConfig, type PersistentScheduledConfig
} from '../backup'
import { getDbKey } from '../auth'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3-multiple-ciphers') as typeof import('better-sqlite3')
import { exportCsv, exportPdfGrid, exportPdfProfile, exportPdfBatch, exportLetterPdf, exportSupervisorReport, exportContactPdf, exportDirectoryPdf, type CsvExportOptions, type PdfGridOptions, type PdfProfileOptions, type SupervisorReportOptions } from '../export'
import { parseImportFile, autoMatchColumns, executeImport, type ImportOptions } from '../import'
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
import { localDateString } from '../../shared/dates'
import { word } from '../vocab'
import { placeholderFields } from '../placeholders'
import { buildBatchPdf, buildLabelsPdf, DocumentError, MAX_BATCH, type DocTarget } from '../export-documents'
import { atomicWriteFileAsync } from '../export-shared'

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
      const row = getDb().prepare('SELECT COUNT(*) as cnt FROM rows WHERE is_active = 1 AND deleted_at IS NULL').get() as { cnt: number }
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

  secureWrap(IPC.BACKUP_SCHEDULED_RUN, 'ipc-export', async (_e, config: ScheduledBackupConfig) => {
    if (typeof config.enabled !== 'boolean') throw new Error('Invalid backup config: enabled must be boolean')
    if (!Number.isInteger(config.intervalDays) || config.intervalDays < 1 || config.intervalDays > 365)
      throw new Error('Invalid backup config: intervalDays must be 1-365')
    if (config.lastRunDate !== null && config.lastRunDate !== undefined) {
      const d = new Date(config.lastRunDate)
      if (isNaN(d.getTime())) throw new Error('Invalid backup config: lastRunDate must be ISO date string or null')
    }
    if (config.destinationDir) assertSafePath(config.destinationDir)
    const result = await runScheduledBackup(config)
    return ok(result)
  })

  secureWrap(IPC.BACKUP_MANUAL_CREATE, 'ipc-export', async (_e, destPath: string) => {
    assertSafePath(destPath)
    const result = await runManualBackup(destPath)
    return ok(result)
  })

  secureWrap(IPC.BACKUP_RESTORE_AUTO, 'ipc-export', async (_e, backupDbPath: string) => {
    return withCorrelation('backup-restore-auto', async (corrId) => {
      assertSafePath(backupDbPath)
      logger.info('ipc-export', `[${corrId}] restoring from auto backup: ${backupDbPath}`)
      const safetyPath = await restoreFromDb(backupDbPath)
      // openDatabase() will run migrations on the restored (possibly older) DB.
      // Migrations are designed to be idempotent (IF NOT EXISTS / column-exists checks),
      // so upgrading a restored older DB to the current schema is safe.
      try {
        openDatabase()
      } catch (openErr) {
        logger.error('ipc-export', `[${corrId}] Failed to open restored database, rolling back to safety backup`, openErr)
        // Roll back: copy the safety backup back over the broken restored DB
        const dbPath = resolveDatabasePath()
        if (existsSync(safetyPath)) {
          try {
            closeDatabase()
            copyFileSync(safetyPath, dbPath)
            openDatabase()
          } catch (rollbackErr) {
            logger.error('ipc-export', `[${corrId}] Safety backup rollback also failed`, rollbackErr)
            return fail('Restore failed: could not open the restored database, and recovery from the safety backup also failed. Your safety backup is preserved at: ' + safetyPath)
          }
          return fail('Restore failed: could not open the restored database. Your previous data has been preserved.')
        }
        return fail('Restore failed: could not open the restored database and no safety backup was available.')
      }
      logger.info('ipc-export', `[${corrId}] restore complete, safety backup at ${safetyPath}`)
      return ok({ safetyPath })
    })
  })

  secureWrap(IPC.BACKUP_RESTORE_FILE, 'ipc-export', async (_e, backupPath: string) => {
    return withCorrelation('backup-restore-file', async (corrId) => {
      assertSafePath(backupPath)
      logger.info('ipc-export', `[${corrId}] restoring from file: ${backupPath}`)
      const isPulseBak = backupPath.endsWith('.pulse-backup')
      const safetyPath = isPulseBak
        ? await restoreFromPulseBackup(backupPath)
        : await restoreFromDb(backupPath)
      // openDatabase() will run migrations on the restored (possibly older) DB.
      // Migrations are designed to be idempotent (IF NOT EXISTS / column-exists checks),
      // so upgrading a restored older DB to the current schema is safe.
      try {
        openDatabase()
      } catch (openErr) {
        logger.error('ipc-export', `[${corrId}] Failed to open restored database, rolling back to safety backup`, openErr)
        const dbPath = resolveDatabasePath()
        if (existsSync(safetyPath)) {
          try {
            closeDatabase()
            copyFileSync(safetyPath, dbPath)
            openDatabase()
          } catch (rollbackErr) {
            logger.error('ipc-export', `[${corrId}] Safety backup rollback also failed`, rollbackErr)
            return fail('Restore failed: could not open the restored database, and recovery from the safety backup also failed. Your safety backup is preserved at: ' + safetyPath)
          }
          return fail('Restore failed: could not open the restored database. Your previous data has been preserved.')
        }
        return fail('Restore failed: could not open the restored database and no safety backup was available.')
      }
      logger.info('ipc-export', `[${corrId}] restore complete, safety backup at ${safetyPath}`)
      return ok({ safetyPath })
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
    if (config.destinationDir !== undefined && config.destinationDir !== null) {
      if (typeof config.destinationDir !== 'string') return fail('Invalid destination directory')
      assertSafePath(config.destinationDir)
    }
    setScheduledConfig(config)
    return ok(true)
  })

  // ── Backup Status (Finding 1.9) ────────────────────────────────────────────
  secureWrap(IPC.BACKUP_GET_STATUS, 'ipc-export', () => {
    const info = getBackupInfo()
    const backups = listAutoBackupsRich()
    return ok({
      lastAutoBackup: backups.length > 0 ? backups[0]!.timestamp.toISOString() : null,
      lastAutoBackupSuccess: !info.lastAutoBackupFailed,
      lastAutoBackupError: info.lastAutoBackupError
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
    return withBackupDbFile(backupPath, (dbFile) => {
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
        const rowCount = (db.prepare("SELECT COUNT(*) as n FROM rows WHERE is_active = 1 AND deleted_at IS NULL").get() as { n: number }).n
        // app_meta.schema_version is the app's migration level (PRAGMA schema_version is SQLite's internal cookie)
        const versionRow = db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string } | undefined
        const schemaVersion = versionRow ? parseInt(versionRow.value, 10) : 0

        let createdAt: string | null = null
        try {
          const earliest = db.prepare("SELECT MIN(created_at) as ca FROM grids").get() as { ca: string | null }
          createdAt = earliest?.ca ?? null
        } catch (err) { logNonFatal('ipc-export', 'read earliest grid created_at from backup', err) }

        return ok({ gridCount, rowCount, schemaVersion, createdAt })
      } finally {
        try { db?.close() } catch (err) { logNonFatal('ipc-export', 'close backup preview db', err) }
      }
    })
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

    for (const grid of grids) {
      try {
        // Sanitize grid name for filesystem: replace unsafe chars with _
        const safeName = grid.name.replace(/[/\\:*?"<>|]/g, '_').trim() || `grid_${grid.id}`
        const csvPath = join(destFolder, `${safeName}.csv`)
        await exportCsv({
          gridId: grid.id,
          columnIds: [],
          activeRowIds: [],
          destPath: csvPath,
          dateFormat: 'iso'
        })
        exported++
      } catch (err) {
        errors.push(`${grid.name}: ${err instanceof Error ? err.message : 'Export failed'}`)
      }
    }

    return ok({ exported, errors })
  })

  // ── Export ─────────────────────────────────────────────────────────────────
  secureWrap(IPC.EXPORT_CSV, 'ipc-export', async (_e, options: CsvExportOptions) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    await exportCsv(options)
    return ok(true)
  })

  secureWrap(IPC.EXPORT_PDF_GRID, 'ipc-export', async (_e, options: PdfGridOptions) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    await exportPdfGrid(options)
    return ok(true)
  })

  secureWrap(IPC.EXPORT_PDF_PROFILE, 'ipc-export', async (_e, options: PdfProfileOptions) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    if (!validId(options.rowId)) return fail('Invalid row ID')
    await exportPdfProfile(options)
    return ok(true)
  })

  secureWrap(IPC.EXPORT_PDF_BATCH, 'ipc-export', async (_e, options: {
    rowIds: number[]; gridId: number; destPath: string
    sortOrder: 'grid' | 'alpha' | 'urgency'
    includeSections: { deadlines: boolean; checklist: boolean; caseLog: boolean; scratchPad: boolean; contactInfo: boolean; gridData: boolean }
  }) => {
    assertSafePath(options.destPath)
    if (!validId(options.gridId)) return fail('Invalid grid ID')
    if (!Array.isArray(options.rowIds) || options.rowIds.length > 1000) return fail('Invalid or too many row IDs (max 1000)')
    if (!options.rowIds.every(id => validId(id))) return fail('All row IDs must be positive integers')
    const validSortOrders = ['grid', 'alpha', 'urgency']
    if (typeof options.sortOrder !== 'string' || !validSortOrders.includes(options.sortOrder)) return fail('Invalid sort order')
    if (!options.includeSections || typeof options.includeSections !== 'object') return fail('Invalid includeSections')
    await exportPdfBatch(options)
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
    const defaultName = provider ? provider.name.replace(/[^a-zA-Z0-9 ]/g, '') : 'contact'
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
    await exportHandoffPacket({ rowId: opts.rowId, gridId: opts.gridId, receiving: opts.receiving, summary: opts.summary, includePictures: opts.includePictures === true }, filePath)
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
    // Get preview first (needed for type detection during import)
    const preview = await parseImportFile(options.filePath, 0, options.headerRowIndex)
    const result = await executeImport({ ...options, createMissingLinks: options.createMissingLinks === true }, preview, onProgress)
    return ok(result)
  })

  // ── Setup Templates (.pulse) ────────────────────────────────────────────────
  secureWrap(IPC.SETUP_TEMPLATE_GET_ALL, 'ipc-export', () => {
    return ok(getSetupTemplates())
  })

  secureWrap(IPC.SETUP_TEMPLATE_CREATE, 'ipc-export', (_e, name: string, description: string | null, pulseJson: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 500) return fail('Template name required (max 500 chars)')
    if (typeof pulseJson !== 'string' || pulseJson.length > 10_000_000) return fail('Template data too large (max 10 MB)')
    if (description !== null && (typeof description !== 'string' || description.length > 2000)) return fail('Description too long')
    const id = createSetupTemplate(name, description, pulseJson)
    return ok(id)
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
