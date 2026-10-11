/** Background mode (W11 §3–4): close-to-tray, the tooltip's counts, and the sign-in entry. */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prefs: {} as Record<string, unknown>,
  order: [] as string[],
  closeHooks: [] as Array<() => void>,
  tooltip: '' as string,
  loginCalls: [] as unknown[],
  openedAtLogin: false,
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, quit: () => {}, setLoginItemSettings: (o: unknown) => { h.loginCalls.push(o) }, getLoginItemSettings: () => ({ wasOpenedAtLogin: h.openedAtLogin }) },
  Menu: { buildFromTemplate: (t: unknown) => t },
  Tray: class { on() {} setToolTip(s: string) { h.tooltip = s } setContextMenu() {} destroy() {} },
  nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
}))
vi.mock('../src/main/prefs', () => ({ prefs: () => ({ get: (k: string, d: unknown) => (k in h.prefs ? h.prefs[k] : d), set: (k: string, v: unknown) => { h.prefs[k] = v } }) }))
vi.mock('../src/main/database', () => ({ registerCloseHook: (fn: () => void) => { h.closeHooks.push(fn) } }))
vi.mock('../src/main/backup', () => ({ runAutoBackup: async () => { h.order.push('backup') }, recordAutoBackupFailure: () => {}, describeBackupError: () => 'The backup couldn\'t be saved.' }))
vi.mock('../src/main/reminders', () => ({ snapshotForLock: () => null, setLockedSnapshot: () => {} }))
vi.mock('../src/main/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }))
vi.mock('../src/main/ipc/ipc-utils', () => ({ logNonFatal: () => {} }))

import { trayTooltip, closeToTray, initTray, isTrayMode, setTrayMode } from '../src/main/tray'
import { loginItemOptions, startedHidden, HIDDEN_FLAG } from '../src/main/login-item'

const win = () => ({ hide: () => { h.order.push('hide') } }) as unknown as import('electron').BrowserWindow

beforeEach(() => { h.prefs = {}; h.order = []; h.loginCalls = []; h.tooltip = ''; h.openedAtLogin = false })

describe('the tray tooltip', () => {
  it('shows counts only, and just the name when unlocked', () => {
    const snap = { counts: { dueToday: 3, overdue: 1, appointments: 2 } }
    expect(trayTooltip(snap, true)).not.toMatch(/due/)
    expect(trayTooltip(snap, false)).toMatch(/locked\): 3 due today, 1 overdue$/)
    expect(trayTooltip(null, false)).toMatch(/\(locked\)$/)
    expect(trayTooltip({ counts: { dueToday: 0, overdue: 0, appointments: 4 } }, false)).toMatch(/\(locked\)$/)
  })
})

describe('closing the window in background mode', () => {
  it('hides, backs up, then locks', async () => {
    let unlocked = true
    initTray({ window: () => null, isUnlocked: () => unlocked, lock: () => { h.order.push('lock'); unlocked = false } })
    await closeToTray(win())
    expect(h.order).toEqual(['hide', 'backup', 'lock'])
  })

  it('does not lock or back up again when already locked', async () => {
    initTray({ window: () => null, isUnlocked: () => false, lock: () => { h.order.push('lock') } })
    await closeToTray(win())
    expect(h.order).toEqual(['hide'])
  })

  it('is off until turned on, and the choice is remembered', () => {
    expect(isTrayMode()).toBe(false)
    setTrayMode(true)
    expect(isTrayMode()).toBe(true)
    setTrayMode(false)
    expect(isTrayMode()).toBe(false)
  })
})

describe('open when I sign in', () => {
  const platform = process.platform
  const set = (p: string) => Object.defineProperty(process, 'platform', { value: p })
  beforeEach(() => { delete process.env.PORTABLE_EXECUTABLE_FILE })

  it('starts hidden only in background mode', () => {
    set('win32')
    expect(loginItemOptions(true, true)).toEqual({ openAtLogin: true, args: [HIDDEN_FLAG] })
    expect(loginItemOptions(true, false)).toEqual({ openAtLogin: true })
    expect(loginItemOptions(false, true)).toEqual({ openAtLogin: false })
    set(platform)
  })

  it('points a portable copy at the real exe', () => {
    set('win32'); process.env.PORTABLE_EXECUTABLE_FILE = 'D:\\Pulse\\Pulse.exe'
    expect(loginItemOptions(true, false).path).toBe('D:\\Pulse\\Pulse.exe')
    set(platform)
  })

  it('only counts as a hidden start when both choices are on and the flag is there', () => {
    expect(startedHidden([HIDDEN_FLAG])).toBe(false)
    h.prefs.trayMode = true; h.prefs.openAtLogin = true
    expect(startedHidden([HIDDEN_FLAG])).toBe(true)
    expect(startedHidden([])).toBe(false)
    h.prefs.openAtLogin = false
    expect(startedHidden([HIDDEN_FLAG])).toBe(false)
  })

  it('on a Mac, a start by the sign-in item counts as hidden (macOS 13+ has no hidden login items)', () => {
    set('darwin')
    h.prefs.trayMode = true; h.prefs.openAtLogin = true
    expect(startedHidden([])).toBe(false)
    h.openedAtLogin = true
    expect(startedHidden([])).toBe(true)
    h.prefs.trayMode = false
    expect(startedHidden([])).toBe(false)
    set(platform)
  })
})
