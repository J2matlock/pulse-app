// Must stay the first import: pins the data folder and key-store name before anything reads them
import './app-identity'
import { isOpenableExternal } from './external-links'
import { app, shell, BrowserWindow, dialog, session, protocol, net, clipboard, powerMonitor, Menu, screen } from 'electron'
import { buildMacMenuTemplate } from './app-menu'
import { windowStateToSave, restorableWindowState, type SavedWindowState } from './window-state'
import { join, normalize, resolve, sep } from 'path'
import { pathToFileURL } from 'url'
import { initDatabase, closeDatabase, getDb } from './database'
import { registerIpcHandlers } from './ipc-handlers'
import { runAutoBackup, checkAndRunScheduled, recordAutoBackupFailure, runAutoBackupOnLock, describeBackupError } from './backup'
import { startReminders, stopReminders } from './reminders'
import { initTray, isTrayMode, closeToTray, refreshTray } from './tray'
import { prefs } from './prefs'
import { applyLoginItem, startedHidden } from './login-item'
import { wipeOpenedFiles } from './attachment-files'
import { extractPulseFileFromArgv, handleFileOpen } from './file-association'
import { checkSafeStorageAvailability, getDbKey, lockApp } from './auth'
import { PRODUCT_NAME, normalizeAutoLockMinutes } from '../shared/constants'
import { clearImportCache } from './import'
import { logger, formatForwardedLogData } from './logger'
import { IPC } from '../shared/ipc-channels'
import { secureWrap, logNonFatal } from './ipc/ipc-utils'

process.on('unhandledRejection', (reason) => {
  logger.error('process', 'Unhandled rejection', { reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason) })
})

process.on('uncaughtException', (error) => {
  logger.error('process', 'Uncaught exception', { error: error.message, stack: error.stack })
  // After an uncaught exception, the process is in an undefined state.
  // Continuing risks silent data corruption. Exit immediately.
  app.exit(1)
})

// Linux display compatibility:
// - ozone-platform-hint=auto: enables native Wayland support (Electron defaults to X11)
// - disable-gpu-sandbox: prevents GPU process launch failures on some Wayland compositors
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  // Only disable GPU sandbox on Wayland — X11 doesn't need it
  if (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY) {
    app.commandLine.appendSwitch('disable-gpu-sandbox')
  }
}

const isDev = !app.isPackaged

// Register custom app:// protocol as privileged (security checklist #18).
// Must be called before app.whenReady(). Replaces file:// for renderer loading.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

let mainWindow: BrowserWindow | null = null
let scheduledBackupTimer: ReturnType<typeof setInterval> | null = null

export function stopScheduledBackup(): void {
  if (scheduledBackupTimer) {
    clearInterval(scheduledBackupTimer)
    scheduledBackupTimer = null
  }
}

/** Called on every unlock */
export function startScheduledBackup(): void {
  stopScheduledBackup()
  refreshTray()
  checkAndRunScheduled().catch(err => logger.error('backup', 'Scheduled backup failed', err))
  scheduledBackupTimer = setInterval(() => { checkAndRunScheduled().catch(err => logger.error('backup', 'Scheduled backup failed', err)) }, 15 * 60 * 1000)
}

// ── Main-process auto-lock fallback ──────────────────────────────────────────
// If the renderer freezes/crashes, this ensures the app still locks after the
// configured inactivity timeout. The renderer pings AUTH_ACTIVITY_PING on user
// activity; if no ping arrives within the timeout, main sends AUTH_FORCE_LOCK.

let autoLockTimer: ReturnType<typeof setTimeout> | null = null

function isUnlocked(): boolean {
  try { getDbKey(); return true } catch { return false }
}

/** The user's auto-lock setting lives in the encrypted DB's settings table. */
function currentAutoLockMinutes(): number {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'auto_lock_minutes'").get() as { value: string } | undefined
    return normalizeAutoLockMinutes(row?.value)
  } catch {
    return normalizeAutoLockMinutes(undefined)
  }
}

// ── Saving pending edits before the database closes ─────────────────────────
// A forced lock or a quit closes the database from here. The window may still
// hold edits that haven't gone out (the scratch pad saves after a pause, an open
// cell saves on blur), so ask it to send them first and wait briefly.

const FLUSH_WAIT_MS = 1000
let flushWaiters: Array<() => void> = []

function flushRenderer(): Promise<void> {
  const win = mainWindow
  if (!win || win.isDestroyed() || win.webContents.isCrashed()) return Promise.resolve()
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer)
      flushWaiters = flushWaiters.filter(w => w !== done)
      resolve()
    }
    // A frozen window never answers: lock anyway
    const timer = setTimeout(done, FLUSH_WAIT_MS)
    flushWaiters.push(done)
    try { win.webContents.send(IPC.APP_FLUSH_PENDING) } catch { done() }
  })
}

let lockInFlight: Promise<void> | null = null
let closeFlushed = false

/** Lock in the main process (works even if the renderer has crashed), then tell the window. */
function forceLock(reason: string): Promise<void> {
  if (!isUnlocked()) return Promise.resolve()
  if (lockInFlight) return lockInFlight
  lockInFlight = (async () => {
    try {
      await flushRenderer()
      // The window may have locked itself meanwhile
      if (!isUnlocked()) return
      logger.info('auto-lock', `Locking: ${reason}`)
      // Back up while the database is still open: a sleeping laptop may never quit
      runAutoBackupOnLock()
      try { lockApp() } catch (err) { logger.warn('auto-lock', 'lockApp failed', err) }
      try { closeDatabase() } catch (err) { logger.warn('auto-lock', 'closeDatabase failed', err) }
      stopScheduledBackup()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.AUTH_FORCE_LOCK)
      }
    } finally {
      lockInFlight = null
    }
  })()
  return lockInFlight
}

function resetAutoLockTimer(): void {
  if (autoLockTimer) clearTimeout(autoLockTimer)
  const minutes = currentAutoLockMinutes()
  autoLockTimer = setTimeout(() => forceLock(`${minutes} min inactivity (main-process fallback)`), minutes * 60 * 1000)
}

export function stopAutoLockTimer(): void {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer)
    autoLockTimer = null
  }
}

// ── Single-instance lock ─────────────────────────────────────────────────────
// Prevent multiple instances; if a second launch happens, focus the existing
// window and check for a .pulse file in the new argv.

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const pulsePath = extractPulseFileFromArgv(argv)
    if (pulsePath) handleFileOpen(pulsePath)

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show() // may be hidden in the tray (W11 §3)
      mainWindow.focus()
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.FILE_ASSOC_PENDING_ARRIVED)
      }
    }
  })
}

// ── Window state persistence ─────────────────────────────────────────────────

function getWindowState(): SavedWindowState {
  const saved = prefs().get('windowState', { width: 1280, height: 800, maximized: false }) as SavedWindowState
  try {
    return restorableWindowState(saved, screen.getAllDisplays().map(d => d.workArea))
  } catch (err) {
    logNonFatal('app', 'check saved window position', err)
    return { width: saved.width, height: saved.height, maximized: saved.maximized }
  }
}

function saveWindowState(win: BrowserWindow) {
  if (win.isDestroyed()) return
  // Normal bounds, so a maximized window's "un-maximized" size isn't the whole screen
  prefs().set('windowState', windowStateToSave(win.getNormalBounds(), win.isMaximized()))
}

function createWindow(): void {
  const winState = getWindowState()

  mainWindow = new BrowserWindow({
    width: winState.width,
    height: winState.height,
    ...(winState.x !== undefined && { x: winState.x }),
    ...(winState.y !== undefined && { y: winState.y }),
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: PRODUCT_NAME,
    icon: isDev
      ? join(__dirname, '../../build/icon-256.png')
      : join(process.resourcesPath, 'icon.png'),
    backgroundColor: '#F8FAFC',  // light mode bg, prevents white flash
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,           // ipcRenderer available in sandboxed preload since Electron 20+
      contextIsolation: true,  // renderer cannot access Node.js directly
      nodeIntegration: false,  // renderer is a plain web page
      devTools: isDev           // disable DevTools in production builds
    }
  })

  if (winState.maximized) mainWindow.maximize()

  // Debounce window state saves so resize/move don't hammer disk
  let saveTimer: ReturnType<typeof setTimeout>
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWindowState(mainWindow!), 500)
  }
  mainWindow.on('resize', scheduleSave)
  mainWindow.on('move', scheduleSave)
  mainWindow.on('close', (e) => {
    clearTimeout(saveTimer); saveWindowState(mainWindow!)
    // Background mode (W11 §3): closing locks and hides instead of quitting
    if (!isQuitting && !sessionEnding && isTrayMode()) {
      e.preventDefault()
      void closeToTray(mainWindow!)
      return
    }
    // Closing quits, and the window is gone before 'before-quit' runs: have it
    // send any pending edits first, then close for real
    if (!closeFlushed && isUnlocked()) {
      e.preventDefault()
      closeFlushed = true
      const win = mainWindow!
      void flushRenderer().finally(() => { if (!win.isDestroyed()) win.close() })
    }
  })
  // Signing out or shutting down must not be held up by the tray
  mainWindow.on('session-end', () => { sessionEnding = true })

  mainWindow.on('ready-to-show', () => {
    // Started by the system at sign-in in background mode: wait in the tray, locked (W11 §4)
    if (startedHidden()) return
    mainWindow?.show()
  })

  // Open external links in the system browser (or mail / phone app), not in Electron.
  // Only http, https, mailto and tel are allowed.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isOpenableExternal(url)) shell.openExternal(url).catch(err => logNonFatal('app', 'openExternal failed', err))
    return { action: 'deny' }
  })

  // Prevent renderer from navigating away from the app origin (e.g., via pasted links in TipTap).
  // A navigation to an external URL would retain access to the preload bridge.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const appOrigin = new URL(mainWindow!.webContents.getURL()).origin
      if (new URL(url).origin !== appOrigin) event.preventDefault()
    } catch (err) {
      logNonFatal('app', 'URL parse failed in will-navigate guard', err)
      event.preventDefault()
    }
  })

  // Block DevTools in production builds
  if (!isDev) {
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
        _e.preventDefault()
      }
    })
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    // Use custom app:// protocol instead of file:// (security checklist #18)
    mainWindow.loadURL('app://bundle/index.html')
  }
}

app.whenReady().then(async () => {
  logger.info('app', 'Starting', { version: app.getVersion() })
  try {
    await initDatabase()
    logger.info('app', 'Database opened')
  } catch (err) {
    // DB init failure is fatal — user must see an error
    dialog.showErrorBox(
      'Startup Error',
      `Failed to initialize database:\n${err instanceof Error ? err.message : String(err)}\n\nThe app will exit.`
    )
    app.exit(1)
    return
  }

  checkSafeStorageAvailability()
  registerIpcHandlers()

  // Main-process auto-lock: renderer sends activity pings to reset the timer
  secureWrap(IPC.AUTH_ACTIVITY_PING, 'app', () => {
    resetAutoLockTimer()
  })
  secureWrap(IPC.APP_FLUSH_DONE, 'app', () => {
    for (const done of flushWaiters.slice()) done()
  })
  resetAutoLockTimer()

  // A sleeping or screen-locked laptop is the classic "stolen while open" case:
  // lock immediately instead of waiting for the inactivity timer.
  powerMonitor.on('suspend', () => forceLock('system is going to sleep'))
  powerMonitor.on('lock-screen', () => forceLock('screen locked'))
  powerMonitor.on('user-did-resign-active', () => forceLock('user switched')) // macOS fast user switching

  // Forward renderer logs to structured main-process logger
  const ALLOWED_LOG_LEVELS = new Set(['info', 'warn', 'error'])
  const MAX_LOG_MSG_LEN = 2000
  secureWrap(IPC.LOG_FORWARD, 'app', (_event, payload: { level: string; component: string; msg: string; data?: unknown }) => {
    if (!payload || typeof payload !== 'object') return
    const { level: rawLevel, component, msg } = payload
    if (typeof rawLevel !== 'string' || !ALLOWED_LOG_LEVELS.has(rawLevel)) return
    if (typeof component !== 'string' || component.length > 200) return
    if (typeof msg !== 'string' || msg.length > MAX_LOG_MSG_LEN) return
    const level = rawLevel as 'error' | 'warn' | 'info'
    const fn = logger[level]
    // Scrub as an object first: once stringified, key-based redaction can't see it
    if (fn) fn(`renderer:${component}`, msg, formatForwardedLogData(payload.data))
  })

  // Dev mode needs 'unsafe-inline' for script-src because Vite injects inline HMR preambles.
  // Production script-src intentionally omits 'unsafe-inline' — only 'self' is allowed.
  const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'"
  // style-src 'unsafe-inline' is required in both dev and production because Tailwind CSS,
  // @dnd-kit, motion (framer-motion), and tiptap all inject dynamic inline styles at runtime.
  // A nonce-based approach is impractical since these libraries don't support passing nonces.
  // Accepted risk: this is an offline Electron app with no untrusted content injection vectors.
  const contentSecurityPolicy =
    `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`

  // Serve renderer files via custom app:// protocol instead of file:// (security checklist #18).
  // Prevents file:// from granting broad filesystem access if CSP is misconfigured.
  const rendererDir = resolve(join(__dirname, '../renderer'))
  protocol.handle('app', async (request) => {
    let { pathname } = new URL(request.url)
    pathname = decodeURIComponent(pathname)
    // Resolve against renderer dir and ensure the result stays within it (path traversal guard)
    const target = normalize(join(rendererDir, pathname))
    if (!target.startsWith(rendererDir + sep) && target !== rendererDir) {
      return new Response('Forbidden', { status: 403 })
    }
    // Attach the CSP here: webRequest.onHeadersReceived isn't guaranteed to see
    // custom-protocol responses, and index.html's meta CSP allows inline scripts
    // (needed for dev HMR). Header + meta are both enforced, so this wins.
    const res = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', contentSecurityPolicy)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })

  // Deny all permission requests (camera, mic, geolocation, etc.) — this is an offline app
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  // Also deny synchronous permission checks (clipboard-read, media, etc.)
  session.defaultSession.setPermissionCheckHandler(() => false)

  // Also enforce CSP on http(s) responses (the dev server) — meta tag alone can be stripped in dev mode
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy]
      }
    })
  })

  // Cold-start: check if the app was launched by double-clicking a .pulse file
  const coldStartFile = extractPulseFileFromArgv(process.argv)
  if (coldStartFile) handleFileOpen(coldStartFile)

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMacMenuTemplate(app.getName(), cmd => {
      BrowserWindow.getFocusedWindow()?.webContents.send(IPC.MENU_COMMAND, cmd)
    })))
  } else {
    // Electron's default (hidden) menu still answers Ctrl+R / Ctrl+Shift+R by
    // reloading the page, which looks like a crash and drops unsaved typing
    Menu.setApplicationMenu(null)
  }
  createWindow()
  initTray({ window: () => mainWindow, isUnlocked, lock: forceLock })
  applyLoginItem() // keeps the system entry pointing at this copy

  // Copies of files opened last time (W09 §5) go before anything else opens
  try { wipeOpenedFiles() } catch (err) { logNonFatal('app', 'wipe opened files', err) }

  // Scheduled backup timer (check every 15 minutes)
  startScheduledBackup()
  // Desktop reminders: checked every minute, only while unlocked
  startReminders()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
  })
})

// Auto-backup on close (backup layer 1)
let isQuitting = false
let sessionEnding = false
app.on('before-quit', async (event) => {
  if (isQuitting) return
  isQuitting = true
  logger.info('app', 'Shutting down')
  event.preventDefault()
  try { clipboard.clear() } catch { /* best effort */ }
  stopScheduledBackup()
  stopReminders()
  stopAutoLockTimer()
  clearImportCache()

  try {
    // Quitting while locked: the database is closed (and was backed up when it
    // locked). Trying again would only record a false "backup failed".
    if (!isUnlocked()) return

    // Text typed in the last moments (scratch pad, an open cell) goes in first
    await flushRenderer()

    // Checkpoint WAL first to ensure data durability
    try { getDb()?.pragma('wal_checkpoint(PASSIVE)') } catch (err) { logNonFatal('app', 'WAL checkpoint on quit', err) }

    // Run backup with timeout + grace period to avoid closing DB mid-write
    let backupDone = false
    let backupSucceeded = false
    const backupPromise = runAutoBackup()
      .then(() => { backupSucceeded = true })
      .catch((err) => {
        logNonFatal('app', 'auto-backup on quit failed', err)
        try { recordAutoBackupFailure(describeBackupError(err)) } catch (recErr) { logNonFatal('app', 'Failed to record backup failure', recErr) }
      })
      .finally(() => { backupDone = true })
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, 12000))
    await Promise.race([backupPromise, timeoutPromise])

    if (!backupDone) {
      logger.warn('app', 'Auto-backup timed out — waiting 2s grace period')
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    if (!backupSucceeded) {
      logger.warn('app', 'Auto-backup did not complete before quit (timeout or error)')
    }
  } finally {
    // ALWAYS close the database, even if backup timed out
    try { closeDatabase() } catch (err) { logNonFatal('app', 'close database on quit', err) }
    app.exit(0)
  }
})

app.on('window-all-closed', () => {
  // Ensure timers are cleared even if before-quit doesn't fire (e.g. SIGTERM on Linux)
  stopScheduledBackup()
  stopAutoLockTimer()
  // Quit on every platform, macOS included: Pulse is one window over an
  // encrypted database, and quitting is what closes it and runs the backup
  app.quit()
})
