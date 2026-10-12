/**
 * single-instance.test.ts — a second launch must stop before it touches anything (Q-028).
 *
 * app.quit() is asynchronous: the second process kept running, app.whenReady()
 * still fired, and it opened the database, registered IPC, made a window,
 * wiped the running copy's opened-file copies and started backups and reminders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let gotLock = false
const calls = {
  exit: vi.fn(), quit: vi.fn(), initDatabase: vi.fn(), registerIpcHandlers: vi.fn(),
  window: vi.fn(), wipeOpenedFiles: vi.fn(), startReminders: vi.fn(), initTray: vi.fn(),
  showErrorBox: vi.fn(),
}

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    commandLine: { appendSwitch: () => {}, hasSwitch: () => true },
    setName: () => {}, setPath: () => {}, getPath: () => '/tmp', getName: () => 'Pulse', getVersion: () => '0.0.0-test',
    requestSingleInstanceLock: () => gotLock,
    quit: (...a: unknown[]) => calls.quit(...a),
    exit: (...a: unknown[]) => calls.exit(...a),
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  BrowserWindow: class { constructor() { calls.window() } static getAllWindows() { return [] } static getFocusedWindow() { return null } },
  dialog: { showErrorBox: (...a: unknown[]) => calls.showErrorBox(...a) },
  shell: {}, session: {}, net: {}, clipboard: {}, powerMonitor: { on: () => {} }, Menu: {}, screen: {},
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
}))
vi.mock('../src/main/database', () => ({
  initDatabase: async () => { calls.initDatabase(); throw new Error('stop here') },
  closeDatabase: () => {}, getDb: () => null,
}))
vi.mock('../src/main/ipc-handlers', () => ({ registerIpcHandlers: () => calls.registerIpcHandlers() }))
vi.mock('../src/main/backup', () => ({
  runAutoBackup: async () => {}, checkAndRunScheduled: async () => {}, recordAutoBackupFailure: () => {},
  runAutoBackupOnLock: async () => {}, describeBackupError: () => '',
}))
vi.mock('../src/main/reminders', () => ({ startReminders: () => calls.startReminders(), stopReminders: () => {} }))
vi.mock('../src/main/tray', () => ({ initTray: () => calls.initTray(), isTrayMode: () => false, closeToTray: async () => {}, refreshTray: () => {} }))
vi.mock('../src/main/prefs', () => ({ prefs: () => ({ get: () => undefined, set: () => {} }) }))
vi.mock('../src/main/login-item', () => ({ applyLoginItem: () => {}, startedHidden: () => false }))
vi.mock('../src/main/attachment-files', () => ({ wipeOpenedFiles: () => calls.wipeOpenedFiles() }))
vi.mock('../src/main/file-association', () => ({ extractPulseFileFromArgv: () => null, handleFileOpen: () => {} }))
vi.mock('../src/main/auth', () => ({ checkSafeStorageAvailability: () => {}, getDbKey: () => null, lockApp: () => {} }))
vi.mock('../src/main/import', () => ({ clearImportCache: () => {} }))
vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} }, formatForwardedLogData: (d: unknown) => d,
}))
vi.mock('../src/main/ipc/ipc-utils', () => ({ secureWrap: () => {}, logNonFatal: () => {} }))

async function launch(lock: boolean): Promise<void> {
  gotLock = lock
  for (const fn of Object.values(calls)) fn.mockClear()
  vi.resetModules()
  await import('../src/main/index')
  // Let app.whenReady().then(...) and its awaits run
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
}

describe('single-instance lock', () => {
  beforeEach(() => { vi.spyOn(process, 'on').mockImplementation(() => process) })

  it('a second launch exits at once and never opens the database, IPC, a window, the wipe, backups or reminders', async () => {
    await launch(false)
    expect(calls.exit).toHaveBeenCalledWith(0)
    expect(calls.initDatabase).not.toHaveBeenCalled()
    expect(calls.registerIpcHandlers).not.toHaveBeenCalled()
    expect(calls.window).not.toHaveBeenCalled()
    expect(calls.wipeOpenedFiles).not.toHaveBeenCalled()
    expect(calls.startReminders).not.toHaveBeenCalled()
    expect(calls.initTray).not.toHaveBeenCalled()
    expect(calls.showErrorBox).not.toHaveBeenCalled()
  })

  it('the first launch still starts up (opens the database)', async () => {
    await launch(true)
    expect(calls.initDatabase).toHaveBeenCalledTimes(1)
    expect(calls.exit).not.toHaveBeenCalledWith(0)
  })
})
