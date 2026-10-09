/**
 * tray.ts — "Keep running in the background" (generalization W11 §3).
 *
 * When on, closing the window locks (backup, key zeroed, database closed) and
 * hides it instead of quitting; a tray icon offers Open, Lock now and Quit.
 * Reminders keep coming from counts and appointment times captured at lock
 * time and held in memory only (see `snapshotForLock` in reminders.ts).
 */
import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import { join } from 'path'
import { prefs } from './prefs'
import { registerCloseHook } from './database'
import { runAutoBackup, recordAutoBackupFailure } from './backup'
import { snapshotForLock, setLockedSnapshot, type LockedSnapshot } from './reminders'
import { logger } from './logger'
import { logNonFatal } from './ipc/ipc-utils'
import { PRODUCT_NAME } from '../shared/constants'

let tray: Tray | null = null
let pendingLock: Promise<void> | null = null

export function isTrayMode(): boolean {
  try { return prefs().get('trayMode', false) === true } catch { return false }
}

/** "Pulse: 3 due today, 1 overdue" — counts only; the window title when there's nothing */
export function trayTooltip(snap: Pick<LockedSnapshot, 'counts'> | null, unlocked: boolean): string {
  if (unlocked) return PRODUCT_NAME
  const parts: string[] = []
  if (snap && snap.counts.dueToday > 0) parts.push(`${snap.counts.dueToday} due today`)
  if (snap && snap.counts.overdue > 0) parts.push(`${snap.counts.overdue} overdue`)
  return parts.length ? `${PRODUCT_NAME} (locked): ${parts.join(', ')}` : `${PRODUCT_NAME} (locked)`
}

function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon-256.png')
}

interface TrayHooks {
  window: () => BrowserWindow | null
  isUnlocked: () => boolean
  lock: (reason: string) => void
}

let hooks: TrayHooks | null = null

function showWindow(): void {
  const win = hooks?.window()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    // Wait for a lock in progress, so "Open" never shows the unlocked app
    { label: `Open ${PRODUCT_NAME}`, click: () => { void (pendingLock ?? Promise.resolve()).then(showWindow) } },
    { label: 'Lock now', enabled: hooks?.isUnlocked() ?? false, click: () => hooks?.lock('locked from the tray') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])
}

/** Refresh the icon's menu and tooltip (after locking or unlocking) */
export function refreshTray(snap: LockedSnapshot | null = null): void {
  if (!tray) return
  const unlocked = hooks?.isUnlocked() ?? false
  tray.setToolTip(trayTooltip(snap, unlocked))
  tray.setContextMenu(buildMenu())
}

function createTray(): void {
  if (tray) return
  try {
    const image = nativeImage.createFromPath(iconPath()).resize({ width: process.platform === 'darwin' ? 18 : 22 })
    tray = new Tray(image)
    tray.on('click', () => { void (pendingLock ?? Promise.resolve()).then(showWindow) })
    refreshTray()
  } catch (err) {
    logNonFatal('tray', 'create tray icon', err)
    tray = null
  }
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** Called once at startup with how to reach the window and lock */
export function initTray(h: TrayHooks): void {
  hooks = h
  // Any lock while in background mode keeps what reminders need (memory only)
  registerCloseHook(() => {
    if (!isTrayMode()) return
    const snap = snapshotForLock()
    setLockedSnapshot(snap)
    // The database closes right after this hook; refresh once it has
    setImmediate(() => refreshTray(snap))
  })
  if (isTrayMode()) createTray()
}

export function setTrayMode(on: boolean): boolean {
  prefs().set('trayMode', on)
  if (on) createTray(); else destroyTray()
  return on
}

/**
 * The window's close button in background mode: back up, lock and hide.
 * Returns once locked; "Open" from the tray waits for this.
 */
export function closeToTray(win: BrowserWindow): Promise<void> {
  if (pendingLock) return pendingLock
  win.hide()
  pendingLock = (async () => {
    try {
      if (hooks?.isUnlocked()) {
        try {
          await Promise.race([runAutoBackup(), new Promise(resolve => setTimeout(resolve, 12000))])
        } catch (err) {
          logNonFatal('tray', 'auto-backup on close to tray', err)
          try { recordAutoBackupFailure(err instanceof Error ? err.message : String(err)) } catch (recErr) { logNonFatal('tray', 'record backup failure', recErr) }
        }
        hooks.lock('window closed to the tray')
      }
      logger.info('tray', 'Running in the background')
    } finally {
      pendingLock = null
    }
  })()
  return pendingLock
}
