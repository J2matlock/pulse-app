/**
 * ipc-app.ts — APP_* and CLIPBOARD_WRITE handlers
 * App info, clipboard, file dialogs, factory reset, update checks, integrity, relaunch.
 */

import { app, BrowserWindow, shell, dialog, clipboard } from 'electron'
import { existsSync, unlinkSync, readdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import Store from 'electron-store'
import { privateStoreOptions } from '../private-files'
import { IPC } from '../../shared/ipc-channels'
import { logger } from '../logger'
import { secureWrap, logNonFatal, ok, fail, rememberUserChosenPaths } from './ipc-utils'
import { resolveDatabasePath, closeDatabase, getDb, getPortableDataDir, getMigrationFailure, clearMigrationFailureFlag } from '../database'
import { verifyAndUnlock, lockApp } from '../auth'
import { stopScheduledBackup } from '../index'
import { isLicenseDoc, licenseFilePath } from '../license-files'
import { isAppLink } from '../external-links'

/** Returns true if `remote` is a higher semver than `current` (X.Y.Z format). */
function isNewerVersion(remote: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
  const rParts = parse(remote)
  const cParts = parse(current)
  const rMaj = rParts[0] ?? 0, rMin = rParts[1] ?? 0, rPat = rParts[2] ?? 0
  const cMaj = cParts[0] ?? 0, cMin = cParts[1] ?? 0, cPat = cParts[2] ?? 0
  if (rMaj !== cMaj) return rMaj > cMaj
  if (rMin !== cMin) return rMin > cMin
  return rPat > cPat
}

/** The automatic update check is on unless switched off; unreadable means off */
function automaticUpdateCheckAllowed(): boolean {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'auto_update_check'").get() as { value: string } | undefined
    return row?.value !== 'false'
  } catch (err) {
    logNonFatal('ipc-app', 'read auto_update_check', err)
    return false
  }
}

/**
 * Whether first-run setup is finished, read the way ONBOARDING_CHECK reads it: the
 * app_meta flag, or (an install from before the flag) any list existing. Setup asks
 * about the automatic update check, so nothing is checked until it's answered (AUDIT-087).
 */
function setupFinished(): boolean {
  try {
    const db = getDb()
    const meta = db.prepare("SELECT value FROM app_meta WHERE key = 'onboarding_complete'").get() as { value: string } | undefined
    if (meta) return meta.value === '1'
    return !!db.prepare('SELECT 1 FROM grids WHERE is_active = 1 LIMIT 1').get()
  } catch (err) {
    logNonFatal('ipc-app', 'read onboarding_complete', err)
    return false
  }
}

export function registerAppHandlers(): void {
  // ── Clipboard ───────────────────────────────────────────────────────────
  secureWrap(IPC.CLIPBOARD_WRITE, 'ipc-app', async (_e, text: string) => {
    if (typeof text !== 'string' || text.length > 1_000_000) return fail("That's too much text to copy at once.")
    // Electron 44 made clipboard writes async; await so a failure reaches secureWrap's catch
    await clipboard.writeText(text)
    return ok(true)
  })

  // ── App utilities ─────────────────────────────────────────────────────────
  secureWrap(IPC.APP_GET_INFO, 'ipc-app', () => {
    const dbPath = resolveDatabasePath()
    return ok({
      version: app.getVersion(),
      dbExists: existsSync(dbPath),
      backupDir: '',
      isPortable: app.isPackaged,
      platform: process.platform
    })
  })

  secureWrap(IPC.APP_OPEN_EXTERNAL, 'ipc-app', (_e, url: string) => {
    // Pulse's own https pages only (F-035): parsed, so userinfo tricks (https://github.com@evil) don't pass
    if (typeof url === 'string' && isAppLink(url)) {
      void Promise.resolve(shell.openExternal(new URL(url).href)).catch(err => logNonFatal('ipc-app', 'APP_OPEN_EXTERNAL', err))
      return ok(true)
    }
    return fail("That link can't be opened from here. Pulse only opens its own https pages.")
  })

  // The license texts ship inside the app, so they open offline (the GPL link needs a browser and a connection)
  secureWrap(IPC.APP_OPEN_LICENSE, 'ipc-app', async (_e, which: unknown) => {
    if (!isLicenseDoc(which)) return fail('Unknown license file')
    const file = licenseFilePath(which, app.isPackaged, process.resourcesPath, app.getAppPath())
    if (!existsSync(file)) return fail("We couldn't find the license file in this copy of Pulse.")
    const error = await shell.openPath(file)
    if (error) {
      logNonFatal('ipc-app', 'APP_OPEN_LICENSE openPath', error)
      return fail("We couldn't open the license file. Your computer may not have an app for text files.")
    }
    return ok(true)
  })

  secureWrap(IPC.APP_SHOW_FILE_DIALOG, 'ipc-app', async (_e, options: Electron.OpenDialogOptions) => {
    // Sanitize: only allow safe dialog properties from the renderer
    const safeProps: Electron.OpenDialogOptions['properties'] =
      (options.properties ?? []).filter(p =>
        ['openFile', 'openDirectory', 'multiSelections'].includes(p)
      ) as Electron.OpenDialogOptions['properties']
    const safeOptions: Electron.OpenDialogOptions = {
      title: typeof options.title === 'string' ? options.title.slice(0, 200) : undefined,
      properties: safeProps,
      filters: Array.isArray(options.filters)
        ? options.filters.slice(0, 10).map(f => ({
            name: String(f.name).slice(0, 100),
            extensions: (f.extensions ?? []).slice(0, 20).map(e => String(e).replace(/[^a-zA-Z0-9*.-]/g, '').slice(0, 20))
          }))
        : undefined,
      defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : undefined,
    }
    const result = await dialog.showOpenDialog(safeOptions)
    // The person picked these, so later handlers may use them wherever they are
    if (!result.canceled) rememberUserChosenPaths(result.filePaths)
    return ok(result)
  })

  secureWrap(IPC.APP_SHOW_SAVE_DIALOG, 'ipc-app', async (_e, options: Electron.SaveDialogOptions) => {
    // Sanitize: only allow safe dialog properties from the renderer
    const safeOptions: Electron.SaveDialogOptions = {
      title: typeof options.title === 'string' ? options.title.slice(0, 200) : undefined,
      defaultPath: typeof options.defaultPath === 'string' ? options.defaultPath : undefined,
      filters: Array.isArray(options.filters)
        ? options.filters.slice(0, 10).map(f => ({
            name: String(f.name).slice(0, 100),
            extensions: (f.extensions ?? []).slice(0, 20).map(e => String(e).replace(/[^a-zA-Z0-9*.-]/g, '').slice(0, 20))
          }))
        : undefined,
    }
    const result = await dialog.showSaveDialog(safeOptions)
    // A save choice also vouches for its folder: handlers may add an extension (.pulse-backup)
    if (!result.canceled && result.filePath) rememberUserChosenPaths([dirname(result.filePath)])
    return ok(result)
  })

  secureWrap(IPC.APP_FACTORY_RESET, 'ipc-app', async (_e, password: string) => {
    // Verify password before allowing destructive action
    if (!password || typeof password !== 'string') return fail('Enter your password to confirm.')
    try {
      await verifyAndUnlock(password)
    } catch (err) {
      logNonFatal('ipc-app', 'APP_FACTORY_RESET password verify', err)
      // What matters most at this moment is that nothing was erased
      const msg = err instanceof Error ? err.message : ''
      if (msg.startsWith('Too many failed attempts')) return fail(`${msg} Nothing was erased.`)
      if (msg === 'Incorrect password') return fail("That password didn't work. Nothing was erased.")
      return fail("Pulse couldn't check your password, so nothing was erased.")
    }
    // Zero the in-memory DB key immediately, then close the DB connection
    lockApp()
    closeDatabase()
    const dbPath = resolveDatabasePath()
    if (existsSync(dbPath)) unlinkSync(dbPath)
    // Remove WAL/SHM files that can contain unencrypted page data
    for (const suffix of ['-wal', '-shm']) {
      const p = dbPath + suffix
      if (existsSync(p)) try { unlinkSync(p) } catch (err) { logNonFatal('ipc-app', `APP_FACTORY_RESET delete ${suffix}`, err) }
    }
    // Clear all electron-store credentials (wrapped keys, password hash, backup config)
    const dataDir = getPortableDataDir()
    // pulse-license is left over from versions that had a paid license
    for (const storeName of ['pulse-secure', 'pulse-prefs', 'pulse-backup-config', 'pulse-backup-status', 'pulse-license']) {
      try { new Store(privateStoreOptions(storeName, dataDir)).clear() } catch (err) { logNonFatal('ipc-app', `APP_FACTORY_RESET clear store ${storeName}`, err) }
    }
    // "Permanently deletes all data" must include every local copy that, together
    // with the old password, could reopen it: the credential backup copy, any
    // quarantined credential files, databases moved aside, and the local backups
    // folder (auto, pre-migration, pre-restore). Backups the user saved elsewhere
    // (USB, other folders) are theirs to keep and are not touched.
    const leftovers = /^(pulse-secure\.backup\.json|pulse-secure\.corrupt-.*\.json|pulse-orphaned-.*\.db(-wal|-shm)?|restore-tmp-.*)$/
    try {
      for (const name of readdirSync(dataDir)) {
        if (leftovers.test(name)) {
          try { rmSync(join(dataDir, name), { recursive: true, force: true }) } catch (err) { logNonFatal('ipc-app', `APP_FACTORY_RESET delete ${name}`, err) }
        }
      }
    } catch (err) { logNonFatal('ipc-app', 'APP_FACTORY_RESET list data dir', err) }
    try { rmSync(join(dataDir, 'logs'), { recursive: true, force: true }) } catch (err) { logNonFatal('ipc-app', 'APP_FACTORY_RESET delete logs', err) }
    // Copies of attached files opened for viewing (normally already wiped by the close hook)
    try { rmSync(join(dataDir, 'tmp-open'), { recursive: true, force: true }) } catch (err) { logNonFatal('ipc-app', 'APP_FACTORY_RESET delete opened files', err) }
    try { rmSync(join(dataDir, 'backups'), { recursive: true, force: true }) } catch (err) { logNonFatal('ipc-app', 'APP_FACTORY_RESET delete local backups', err) }
    return ok(true)
  })

  // { manual: true } is the "Check for updates" button, which always runs. Any
  // other call is automatic and obeys Settings → About, read here in main so no
  // caller can skip it; if the setting can't be read, the automatic check stays off.
  secureWrap(IPC.APP_CHECK_FOR_UPDATES, 'ipc-app', async (_e, opts?: { manual?: boolean }) => {
    // End-to-end runs (NODE_ENV=test outside vitest) stay offline, so no update banner shifts their screens
    if (process.env.NODE_ENV === 'test' && !process.env.VITEST) return ok({ available: false })
    const manual = !!opts && typeof opts === 'object' && opts.manual === true
    if (!manual && !automaticUpdateCheckAllowed()) return ok({ available: false })
    // Not before setup has asked about it; the caller may try again once setup is done
    if (!manual && !setupFinished()) return ok({ available: false, setupPending: true })
    const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/J2matlock/pulse-releases/main/latest.json'
    const UPDATE_ALLOWED_URL_PREFIX = 'https://github.com/J2matlock/pulse-releases/'
    let data: { version?: string; downloadUrl?: string; downloads?: Partial<Record<'win' | 'mac' | 'linux', string>>; releaseNotes?: string }
    // Couldn't find out: the button says so instead of "You have the latest version" (F-036);
    // the automatic check stays silent, as before
    const unknown = () => ok(manual ? { available: false, unreachable: true } : { available: false })
    try {
      const res = await fetch(UPDATE_CHECK_URL, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return unknown()
      data = await res.json() as typeof data
    } catch (err) {
      // Offline, timed out or a proxy in the way: normal for an offline app, not an error
      logger.info('ipc-app', 'Update check could not reach the release page', { error: err instanceof Error ? err.message : String(err) })
      return unknown()
    }
    if (!data || typeof data !== 'object') return unknown()
    if (!data.version) return unknown()
    // Per-platform links when the release lists them (older files have only downloadUrl)
    const platformKey = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
    const platformUrl = data.downloads && typeof data.downloads === 'object' ? data.downloads[platformKey] : undefined
    // Validate downloadUrl: must be HTTPS and match the expected repo prefix
    let safeDownloadUrl = typeof platformUrl === 'string' ? platformUrl : data.downloadUrl
    if (safeDownloadUrl) {
      try {
        const parsed = new URL(safeDownloadUrl)
        if (parsed.protocol !== 'https:' || !safeDownloadUrl.startsWith(UPDATE_ALLOWED_URL_PREFIX)) {
          safeDownloadUrl = undefined
        }
      } catch (err) { logNonFatal('ipc-app', 'APP_CHECK_FOR_UPDATES URL parse', err); safeDownloadUrl = undefined }
    }
    if (typeof data.releaseNotes === 'string') {
      data.releaseNotes = data.releaseNotes.slice(0, 10000)
    }
    const available = isNewerVersion(data.version, app.getVersion())
    return ok({ available, version: data.version, downloadUrl: safeDownloadUrl, releaseNotes: data.releaseNotes })
  })

  secureWrap(IPC.APP_INTEGRITY_CHECK, 'ipc-app', () => {
    const result = getDb().prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    return ok(result.integrity_check === 'ok')
  })

  secureWrap(IPC.APP_MIGRATION_STATUS, 'ipc-app', (_e, clearFlag?: boolean) => {
    if (clearFlag) {
      clearMigrationFailureFlag()
      return ok(null)
    }
    // The stored error is raw SQL text for the log; the screen gets a sentence (Q-054)
    const failure = getMigrationFailure()
    return ok(failure && {
      ...failure,
      error: `Pulse couldn't finish updating your data to the new version (step ${failure.version}). Your data was left as it was before the update. Restore the backup Pulse made just before it, in Settings → Backup.`,
    })
  })

  secureWrap(IPC.APP_RELAUNCH, 'ipc-app', () => {
    // Reload the renderer instead of full process restart.
    // Full app.relaunch() + app.exit(0) can fail in dev mode because
    // the relaunched Electron process loses the Vite dev server URL.
    // Lock properly, as AUTH_LOCK does, so the reloaded renderer starts at the
    // lock screen with the database closed: left open, every data handler would
    // still answer, and the next unlock would orphan this connection.
    stopScheduledBackup()
    lockApp()
    closeDatabase()
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      wins[0]!.webContents.reloadIgnoringCache()
    } else {
      app.relaunch()
      app.exit(0)
    }
  })
}
