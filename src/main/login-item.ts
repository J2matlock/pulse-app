/**
 * login-item.ts — "Open Pulse when I sign in" (generalization W11 §4).
 * Hidden start-up only makes sense in background mode: with it off, signing in
 * shows the lock screen as usual.
 */
import { app } from 'electron'
import { prefs } from './prefs'
import { isTrayMode } from './tray'
import { logNonFatal } from './ipc/ipc-utils'

/** Windows and Linux can't tell a hidden start from the system, so we pass this */
export const HIDDEN_FLAG = '--hidden'

/** Linux has no login-item API in Electron */
export function loginItemSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

/** A portable Windows copy runs from wherever it was put, possibly a USB drive */
export function isPortableCopy(): boolean {
  return !!process.env.PORTABLE_EXECUTABLE_FILE
}

export function wantsOpenAtLogin(): boolean {
  try { return prefs().get('openAtLogin', false) === true } catch { return false }
}

/** The system entry for the current choices; portable copies point at the real exe, not the temp unpack */
export function loginItemOptions(openAtLogin: boolean, tray: boolean): Electron.Settings {
  const opts: Electron.Settings = { openAtLogin, openAsHidden: tray && openAtLogin }
  if (process.platform === 'win32') {
    if (process.env.PORTABLE_EXECUTABLE_FILE) opts.path = process.env.PORTABLE_EXECUTABLE_FILE
    if (tray && openAtLogin) opts.args = [HIDDEN_FLAG]
  }
  return opts
}

/** Write the system entry (keeps it in step when background mode changes) */
export function applyLoginItem(): void {
  if (!loginItemSupported()) return
  try {
    app.setLoginItemSettings(loginItemOptions(wantsOpenAtLogin(), isTrayMode()))
  } catch (err) { logNonFatal('login-item', 'set login item', err) }
}

export function setOpenAtLogin(on: boolean): void {
  prefs().set('openAtLogin', on)
  applyLoginItem()
}

/** Started by the system at sign-in, in background mode: stay in the tray until opened */
export function startedHidden(argv: string[] = process.argv): boolean {
  if (!isTrayMode() || !wantsOpenAtLogin()) return false
  if (argv.includes(HIDDEN_FLAG)) return true
  try { return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAsHidden } catch { return false }
}
