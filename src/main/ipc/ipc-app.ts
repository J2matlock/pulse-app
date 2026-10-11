/**
 * ipc-app.ts — APP_* and CLIPBOARD_WRITE handlers
 * App info, clipboard, file dialogs, factory reset, update checks, integrity, relaunch.
 */

import { app, BrowserWindow, shell, dialog, clipboard } from 'electron'
import { existsSync, unlinkSync, readdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import Store from 'electron-store'
import { IPC } from '../../shared/ipc-channels'
import { secureWrap, logNonFatal, ok, fail, rememberUserChosenPaths } from './ipc-utils'
import { resolveDatabasePath, closeDatabase, getDb, getPortableDataDir, getMigrationFailure, clearMigrationFailureFlag } from '../database'
import { verifyAndUnlock, lockApp } from '../auth'

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

export function registerAppHandlers(): void {
  // ── Clipboard ───────────────────────────────────────────────────────────
  secureWrap(IPC.CLIPBOARD_WRITE, 'ipc-app', (_e, text: string) => {
    if (typeof text !== 'string' || text.length > 1_000_000) return fail('Clipboard content too large')
    clipboard.writeText(text)
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
    // Only allow http/https URLs — parse to prevent bypass via userinfo (e.g. http://evil@legit.com)
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(parsed.href)
        return ok(true)
      }
    } catch (err) { logNonFatal('ipc-app', 'APP_OPEN_EXTERNAL URL parse', err) }
    return fail('Only http/https URLs are allowed')
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
    if (!password || typeof password !== 'string') return fail('Password required')
    try {
      await verifyAndUnlock(password)
    } catch (err) {
      logNonFatal('ipc-app', 'APP_FACTORY_RESET password verify', err)
      return fail('Password verification failed')
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
      try { new Store({ name: storeName, cwd: dataDir }).clear() } catch (err) { logNonFatal('ipc-app', `APP_FACTORY_RESET clear store ${storeName}`, err) }
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

  secureWrap(IPC.APP_CHECK_FOR_UPDATES, 'ipc-app', async () => {
    // End-to-end runs (NODE_ENV=test outside vitest) stay offline, so no update banner shifts their screens
    if (process.env.NODE_ENV === 'test' && !process.env.VITEST) return ok({ available: false })
    const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/J2matlock/pulse-releases/main/latest.json'
    const UPDATE_ALLOWED_URL_PREFIX = 'https://github.com/J2matlock/pulse-releases/'
    const res = await fetch(UPDATE_CHECK_URL, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return ok({ available: false })
    const data = await res.json() as { version?: string; downloadUrl?: string; downloads?: Partial<Record<'win' | 'mac' | 'linux', string>>; releaseNotes?: string }
    if (!data.version) return ok({ available: false })
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
    return ok(getMigrationFailure())
  })

  secureWrap(IPC.APP_RELAUNCH, 'ipc-app', () => {
    // Reload the renderer instead of full process restart.
    // Full app.relaunch() + app.exit(0) can fail in dev mode because
    // the relaunched Electron process loses the Vite dev server URL.
    // Clear auth state so the reloaded renderer starts at the lock screen
    lockApp()
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      wins[0]!.webContents.reloadIgnoringCache()
    } else {
      app.relaunch()
      app.exit(0)
    }
  })
}
