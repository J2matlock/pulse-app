/**
 * "Change password and re-encrypt" (P-001, F-037): the database gets a new key,
 * and a crash at any point leaves a file that opens with the old or the new
 * password. Real auth.ts, database.ts, backup.ts and key-switch.ts against real
 * SQLCipher files; only Electron, electron-store (an in-memory file per store
 * name) and the logger are faked.
 *
 * A "crash" is simulated by copying the data folder (database, WAL, SHM,
 * journal) and the credential file at the crash point, then starting a fresh
 * copy of the modules on that copy: exactly what a killed process leaves behind.
 * The crash during the rekey is a real one: a child process rekeying the file
 * is killed with SIGKILL while its rollback journal is being written.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync, copyFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { createRequire } from 'module'

const h = vi.hoisted(() => {
  // auth.ts creates its data folder at import time, so it must exist before imports run
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'), os = require('os'), path = require('path')
  return {
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-keyswitch-')) as string,
    // One object per store name; a write replaces the object, like conf rewriting the file
    stores: new Map<string, Record<string, unknown>>(),
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => h.dir, getVersion: () => '9.9.9', on: () => {} },
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  clipboard: { clear: () => {} },
  dialog: { showMessageBoxSync: () => 0 },
}))

vi.mock('electron-store', () => ({
  default: class {
    private name: string
    constructor(opts?: { name?: string }) {
      this.name = opts?.name ?? 'config'
      if (!h.stores.has(this.name)) h.stores.set(this.name, {})
    }
    private get data(): Record<string, unknown> { return h.stores.get(this.name) as Record<string, unknown> }
    private write(next: Record<string, unknown>): void { h.stores.set(this.name, next) }
    get(k: string, d?: unknown) { return k in this.data ? this.data[k] : d }
    set(k: string | Record<string, unknown>, v?: unknown) {
      this.write(typeof k === 'object' ? { ...this.data, ...k } : { ...this.data, [k]: v })
    }
    has(k: string) { return k in this.data }
    delete(k: string) { const next = { ...this.data }; delete next[k]; this.write(next) }
    clear() { this.write({}) }
    get store() { return { ...this.data } }
    set store(v: Record<string, unknown>) { this.write({ ...v }) }
    get path() { return undefined }
  },
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

interface Mods {
  auth: typeof import('../src/main/auth')
  db: typeof import('../src/main/database')
  ks: typeof import('../src/main/key-switch')
  backup: typeof import('../src/main/backup')
}

const OLD_PWD = 'Old-Correct-Horse-1'
const NEW_PWD = 'New-Battery-Staple-2'
const SECURE = 'pulse-secure'

let m: Mods
const dirs: string[] = []

/** A fresh copy of the main-process modules: a newly started Pulse on the current data folder */
async function boot(): Promise<Mods> {
  if (m) { try { m.db.closeDatabase() } catch { /* already closed */ } }
  vi.resetModules()
  m = {
    auth: await import('../src/main/auth'),
    db: await import('../src/main/database'),
    ks: await import('../src/main/key-switch'),
    backup: await import('../src/main/backup'),
  }
  return m
}

function newDataDir(): string {
  h.dir = mkdtempSync(join(tmpdir(), 'pulse-keyswitch-'))
  dirs.push(h.dir)
  return h.dir
}

const dbPath = () => join(h.dir, 'pulse.db')
const SUFFIXES = ['', '-wal', '-shm', '-journal']

interface Disk { files: Map<string, Buffer>; secure: Record<string, unknown> }

/** What a process killed right now would leave on disk */
function captureDisk(): Disk {
  const files = new Map<string, Buffer>()
  for (const s of SUFFIXES) if (existsSync(dbPath() + s)) files.set(s, readFileSync(dbPath() + s))
  return { files, secure: structuredClone(h.stores.get(SECURE) ?? {}) }
}

/** Start Pulse again on a copy of what the crash left */
async function restartFrom(disk: Disk): Promise<Mods> {
  if (m) { try { m.db.closeDatabase() } catch { /* already closed */ } m.auth.lockApp() }
  newDataDir()
  for (const [s, buf] of disk.files) writeFileSync(dbPath() + s, buf)
  h.stores = new Map([[SECURE, structuredClone(disk.secure)]])
  return boot()
}

/** The unlock path the lock screen takes: password, then open with each key it unwrapped */
async function unlock(pw: string): Promise<string> {
  try { await m.auth.verifyAndUnlock(pw) } catch (err) { return (err as Error).message }
  try {
    m.ks.openWithUnlockKeys(m.db.openDatabase)
    return 'opened'
  } catch (err) {
    m.auth.lockApp()
    return err instanceof m.db.DatabaseOpenError ? `open failed (${err.kind})` : String(err)
  }
}

function lock(): void {
  m.db.closeDatabase()
  m.auth.lockApp()
}

const marker = () => (m.db.getDb().prepare("SELECT value FROM app_meta WHERE key = 'p001'").get() as { value: string } | undefined)?.value
const setMarker = (v: string) => m.db.getDb().prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('p001', ?)").run(v)

/** Set up Pulse with OLD_PWD and a recovery key, open the data, and write a marker */
async function setUp(): Promise<{ oldHex: string; recoveryKey: string }> {
  await m.auth.setupPassword(OLD_PWD, 'old hint', dbPath())
  m.db.openDatabase()
  const recoveryKey = await m.auth.generateRecoveryKey()
  setMarker('kept')
  return { oldHex: m.auth.getDbKey().toString('hex'), recoveryKey }
}

beforeEach(async () => {
  h.stores = new Map()
  newDataDir()
  await boot()
})

afterEach(() => {
  try { m.db.closeDatabase() } catch { /* closed */ }
  m.auth.lockApp()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('change password and re-encrypt (P-001)', () => {
  it('gives the data a new key: the new password opens it, the old password, old key and recovery key do not', async () => {
    const { oldHex, recoveryKey } = await setUp()
    expect(await m.ks.changePasswordAndReencrypt(OLD_PWD, NEW_PWD, 'new hint')).toBe('switched')
    // Still open and usable straight away, now on the new key
    expect(marker()).toBe('kept')
    expect(m.db.getDb().pragma('journal_mode', { simple: true })).toBe('wal')
    const newHex = m.auth.getDbKey().toString('hex')
    expect(newHex).not.toBe(oldHex)
    expect(m.auth.hasPendingKeySwitch()).toBe(false)
    // The recovery slot wrapped the old key, so it is gone (the screen offers a new one)
    expect(m.auth.hasRecoveryKey()).toBe(false)
    expect(m.auth.getPasswordHint()).toBe('new hint')

    lock()
    expect(m.db.databaseOpensWithKey(oldHex)).toBe(false)
    expect(m.db.databaseOpensWithKey(newHex)).toBe(true)
    expect(await unlock(OLD_PWD)).toBe('Incorrect password')
    await expect(m.auth.verifyAndUnlockRecovery(recoveryKey)).rejects.toThrow('No recovery key configured')
    expect(await unlock(NEW_PWD)).toBe('opened')
    expect(marker()).toBe('kept')
    expect(m.db.getDb().pragma('integrity_check', { simple: true })).toBe('ok')
  }, 60_000)

  it('refuses a wrong current password and changes nothing', async () => {
    const { oldHex } = await setUp()
    await expect(m.ks.changePasswordAndReencrypt('Not-The-Password-9', NEW_PWD, '')).rejects.toThrow('Incorrect password')
    expect(m.auth.hasPendingKeySwitch()).toBe(false)
    expect(m.auth.getDbKey().toString('hex')).toBe(oldHex)
    lock()
    expect(await unlock(OLD_PWD)).toBe('opened')
  }, 60_000)

  it('revoking the recovery key with re-encrypt keeps the password and hint but changes the key', async () => {
    const { oldHex, recoveryKey } = await setUp()
    expect(await m.ks.revokeRecoveryKeyAndReencrypt(OLD_PWD)).toBe('switched')
    expect(m.auth.hasRecoveryKey()).toBe(false)
    expect(m.auth.getPasswordHint()).toBe('old hint')
    lock()
    expect(m.db.databaseOpensWithKey(oldHex)).toBe(false)
    await expect(m.auth.verifyAndUnlockRecovery(recoveryKey)).rejects.toThrow('No recovery key configured')
    expect(await unlock(OLD_PWD)).toBe('opened')
    expect(marker()).toBe('kept')
  }, 60_000)
})

describe('a failed rekey is rolled back (P-001)', () => {
  it('a rekey that throws before changing anything: old password, old key and recovery key all still work', async () => {
    const { oldHex, recoveryKey } = await setUp()
    await expect(m.ks.changePasswordAndReencrypt(OLD_PWD, NEW_PWD, '', { rekey: () => { throw new Error('disk I/O error') } }))
      .rejects.toThrow(m.ks.REENCRYPT_FAILED_UNCHANGED)
    // Reopened on the old key, nothing pending, the recovery key kept
    expect(marker()).toBe('kept')
    expect(m.auth.getDbKey().toString('hex')).toBe(oldHex)
    expect(m.auth.hasPendingKeySwitch()).toBe(false)
    expect(m.auth.hasRecoveryKey()).toBe(true)
    lock()
    expect(await unlock(NEW_PWD)).toBe('Incorrect password')
    expect(await unlock(OLD_PWD)).toBe('opened')
    lock()
    await m.auth.verifyAndUnlockRecovery(recoveryKey)
    m.ks.openWithUnlockKeys(m.db.openDatabase)
    expect(marker()).toBe('kept')
  }, 60_000)

  it('a rekey that changed the file and then threw is undone: the file is back on the old key', async () => {
    const { oldHex } = await setUp()
    const rekey = (hex: string) => { m.db.rekeyDatabase(hex); throw new Error('reported failure after the rekey') }
    await expect(m.ks.changePasswordAndReencrypt(OLD_PWD, NEW_PWD, '', { rekey })).rejects.toThrow(m.ks.REENCRYPT_FAILED_UNCHANGED)
    expect(marker()).toBe('kept')
    expect(m.auth.hasPendingKeySwitch()).toBe(false)
    lock()
    expect(m.db.databaseOpensWithKey(oldHex)).toBe(true)
    expect(await unlock(OLD_PWD)).toBe('opened')
    expect(m.db.getDb().pragma('integrity_check', { simple: true })).toBe('ok')
  }, 60_000)

  it('when neither key opens the file afterwards, Pulse locks and keeps both credential slots', async () => {
    await setUp()
    const stranger = 'f'.repeat(64)
    const rekey = () => { m.db.rekeyDatabase(stranger); throw new Error('lost track of the key') }
    expect(await m.ks.changePasswordAndReencrypt(OLD_PWD, NEW_PWD, '', { rekey })).toBe('locked')
    expect(() => m.auth.getDbKey()).toThrow('Database is locked')
    expect(m.auth.hasPendingKeySwitch()).toBe(true)
    expect(m.auth.isPasswordSetup()).toBe(true)
  }, 60_000)
})

describe('a crash at any point leaves data that opens with the old or the new password (P-001)', () => {
  it('killed after the pending slot was saved, before the rekey: the old password opens it and the pending slot goes', async () => {
    await setUp()
    const at: { disk?: Disk } = {}
    // The crash point: the rekey step is reached, so the pending slot is on disk
    await expect(m.ks.changePasswordAndReencrypt(OLD_PWD, NEW_PWD, '', { rekey: () => { at.disk = captureDisk(); throw new Error('killed') } })).rejects.toThrow()
    if (!at.disk) throw new Error('the rekey step was never reached')
    expect(at.disk.secure.pending_wrapped_db_key_password).toBeTruthy()

    await restartFrom(at.disk)
    // The new password unwraps the pending key, which doesn't open the file: refused, nothing harmed
    expect(await unlock(NEW_PWD)).toBe('open failed (unreadable)')
    expect(await unlock(OLD_PWD)).toBe('opened')
    expect(marker()).toBe('kept')
    expect(m.auth.hasPendingKeySwitch()).toBe(false)
    expect(m.auth.hasRecoveryKey()).toBe(true)
    lock()
    expect(await unlock(NEW_PWD)).toBe('Incorrect password')
    expect(await unlock(OLD_PWD)).toBe('opened')
  }, 60_000)

  it('killed after the rekey, before pending became current: the new password opens it and finishes the switch', async () => {
    const { oldHex, recoveryKey } = await setUp()
    const at: { disk?: Disk } = {}
    const rekey = (hex: string) => { m.db.rekeyDatabase(hex); at.disk = captureDisk() }
    expect(await m.ks.changePasswordAndReencrypt(OLD_PWD, NEW_PWD, 'new hint', { rekey })).toBe('switched')
    if (!at.disk) throw new Error('the rekey step was never reached')

    await restartFrom(at.disk)
    expect(m.auth.hasPendingKeySwitch()).toBe(true)
    // The old password still matches the current slot, but its key no longer opens the file
    expect(await unlock(OLD_PWD)).toBe('open failed (unreadable)')
    expect(await unlock(NEW_PWD)).toBe('opened')
    expect(marker()).toBe('kept')
    // Settled: pending is now current, and the recovery slot (old key) is gone
    expect(m.auth.hasPendingKeySwitch()).toBe(false)
    expect(m.auth.hasRecoveryKey()).toBe(false)
    expect(m.auth.getPasswordHint()).toBe('new hint')
    lock()
    expect(m.db.databaseOpensWithKey(oldHex)).toBe(false)
    expect(await unlock(OLD_PWD)).toBe('Incorrect password')
    await expect(m.auth.verifyAndUnlockRecovery(recoveryKey)).rejects.toThrow('No recovery key configured')
    expect(await unlock(NEW_PWD)).toBe('opened')
  }, 60_000)

  it('killed during the rekey (SIGKILL with the journal half written): the old key rolls it back and the old password opens it', async () => {
    await setUp()
    // Enough data that the rekey takes long enough to be interrupted
    const d = m.db.getDb()
    d.exec('CREATE TABLE filler (b BLOB)')
    const fill = d.prepare('INSERT INTO filler (b) VALUES (randomblob(4000))')
    d.transaction(() => { for (let i = 0; i < 4000; i++) fill.run() })()
    const fillerRows = 4000

    const at: { disk?: Disk; newHex?: string } = {}
    await expect(m.ks.changePasswordAndReencrypt(OLD_PWD, NEW_PWD, '', {
      rekey: (hex) => { at.newHex = hex; at.disk = captureDisk(); throw new Error('killed') },
    })).rejects.toThrow()
    const atPending = at.disk, newHex = at.newHex
    if (!atPending || !newHex) throw new Error('the rekey step was never reached')
    const oldHex = m.auth.getDbKey().toString('hex')
    lock()

    // Start from the state at the pending write, and kill a real rekey of that file part way
    let interrupted = false
    for (let attempt = 0; attempt < 5 && !interrupted; attempt++) {
      await restartFrom(atPending)
      interrupted = await killMidRekey(dbPath(), oldHex, newHex)
    }
    expect(interrupted).toBe(true)
    expect(existsSync(dbPath() + '-journal')).toBe(true)

    // Worst order first: the new password's key meets the hot journal, and must not harm it
    expect(await unlock(NEW_PWD)).toBe('open failed (unreadable)')
    expect(await unlock(OLD_PWD)).toBe('opened')
    expect(marker()).toBe('kept')
    expect((m.db.getDb().prepare('SELECT COUNT(*) AS n FROM filler').get() as { n: number }).n).toBe(fillerRows)
    expect(m.db.getDb().pragma('integrity_check', { simple: true })).toBe('ok')
    expect(m.auth.hasPendingKeySwitch()).toBe(false)
    lock()
    expect(m.db.databaseOpensWithKey(oldHex)).toBe(true)
  }, 120_000)
})

/**
 * Rekey `path` from `fromHex` to `toHex` in a child process (the steps rekeyDatabase
 * takes) and SIGKILL it once its rollback journal has data in it. True when it was
 * killed with the journal still there, i.e. part way through the rekey.
 */
async function killMidRekey(path: string, fromHex: string, toHex: string): Promise<boolean> {
  const driver = createRequire(import.meta.url).resolve('better-sqlite3-multiple-ciphers')
  const script = join(h.dir, 'rekey-child.cjs')
  writeFileSync(script, `
    const B = require(${JSON.stringify(driver)})
    const db = new B(${JSON.stringify(path)})
    db.pragma("cipher='sqlcipher'")
    db.pragma("key='${fromHex}'")
    db.pragma('schema_version')
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.pragma('journal_mode = DELETE')
    process.stdout.write('ready\\n')
    db.pragma("rekey='${toHex}'")
  `)
  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'ignore'] })
  const exited = new Promise<void>(resolve => child.on('exit', () => resolve()))
  await new Promise<void>(resolve => child.stdout.once('data', () => resolve()))
  const journal = path + '-journal'
  const deadline = Date.now() + 20_000
  // Busy-wait (no awaits) so the kill lands while the journal is being written
  while (Date.now() < deadline) {
    if (existsSync(journal)) {
      try { if (statSync(journal).size > 256 * 1024) break } catch { /* just deleted */ }
    }
    if (child.exitCode !== null) break
  }
  child.kill('SIGKILL')
  await exited
  rmSync(script, { force: true })
  return existsSync(journal)
}

describe('old backups after a re-encrypt (P-001)', () => {
  it('an old backup still restores on a new computer with the old password or recovery key; the live data does not open with them', async () => {
    const { oldHex, recoveryKey } = await setUp()
    const usb = mkdtempSync(join(tmpdir(), 'pulse-keyswitch-usb-'))
    dirs.push(usb)
    const { destPath: oldBackup } = await m.backup.runManualBackup(join(usb, 'before'))
    setMarker('changed after the backup')

    expect(await m.ks.changePasswordAndReencrypt(OLD_PWD, NEW_PWD, '')).toBe('switched')
    // This install no longer opens the old backup with its own key: it's "another Pulse's" now
    const verified = await m.backup.verifyBackup(oldBackup)
    expect(verified.valid).toBe(false)
    expect(verified.otherPulse).toBe(true)
    lock()
    expect(m.db.databaseOpensWithKey(oldHex)).toBe(false)
    expect(await unlock(OLD_PWD)).toBe('Incorrect password')
    await expect(m.auth.verifyAndUnlockRecovery(recoveryKey)).rejects.toThrow('No recovery key configured')

    // A fresh computer: the old backup opens with the old password...
    for (const secret of [OLD_PWD, recoveryKey]) {
      h.stores = new Map()
      newDataDir()
      await boot()
      const copy = join(h.dir, 'before.pulse-backup')
      mkdirSync(h.dir, { recursive: true })
      copyFileSync(oldBackup, copy)
      await m.backup.restoreBackupOnNewInstall({ backupPath: copy, secret, newPassword: 'Third-Computer-Pass-3', hint: '' })
      m.db.openDatabase()
      expect(marker()).toBe('kept')
      lock()
    }
  }, 120_000)
})
