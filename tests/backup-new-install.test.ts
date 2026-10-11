/**
 * Disaster-recovery round trip: a .pulse-backup made on one computer must open
 * on a fresh install using only the old password or recovery key.
 * Uses the real auth.ts + backup.ts with a real SQLCipher database.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, existsSync, rmSync, readdirSync, writeFileSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const state = vi.hoisted(() => {
  // auth.ts creates its data dir at import time, so this must exist before imports run
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'), os = require('os'), path = require('path')
  return { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-newinstall-')) as string, stores: new Map<string, Map<string, unknown>>() }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => state.dir, getVersion: () => '9.9.9' },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
  clipboard: { clear: () => {} },
}))

vi.mock('electron-store', () => ({
  default: class {
    private data: Map<string, unknown>
    constructor(opts?: { name?: string }) {
      const name = opts?.name ?? 'config'
      if (!state.stores.has(name)) state.stores.set(name, new Map())
      this.data = state.stores.get(name)!
    }
    get(k: string, d?: unknown) { return this.data.has(k) ? this.data.get(k) : d }
    set(k: string | Record<string, unknown>, v?: unknown) {
      if (typeof k === 'object') for (const [key, val] of Object.entries(k)) this.data.set(key, val)
      else this.data.set(k, v)
    }
    has(k: string) { return this.data.has(k) }
    delete(k: string) { this.data.delete(k) }
    clear() { this.data.clear() }
  },
}))

vi.mock('../src/main/database', () => ({
  getPortableDataDir: () => state.dir,
  resolveDatabasePath: () => join(state.dir, 'pulse.db'),
  latestSchemaVersion: () => LATEST_SCHEMA,
  setEncryptionKey: (db: { pragma: (s: string) => unknown }, hex: string) => {
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('Invalid database key format')
    db.pragma(`key='${hex}'`)
  },
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BetterSqlite3 = require('better-sqlite3-multiple-ciphers')
import { setupPassword, generateRecoveryKey, getDbKey, lockApp, isPasswordSetup, verifyAndUnlock, changePassword } from '../src/main/auth'
import { allMigrations, seedGrid } from './helpers'
import { createProdFormatDb } from './backupTestUtils'
import { runManualBackup, restoreBackupOnNewInstall, moveAsideExistingDatabase, withBackupDbFile, runScheduledBackupNow, setScheduledConfig, getScheduledConfig, describeBackupError, getBackupHealth, checkAndRunScheduled, runAutoBackupOnLock, setMaxBackupBytesForTests, MAX_BACKUP_BYTES, verifyBackup, restoreOtherPulseBackup, getBackupMadeInfo } from '../src/main/backup'

function openWithKey(path: string, hex: string) {
  const db = new BetterSqlite3(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma(`key='${hex}'`)
  db.pragma('kdf_iter=256000')
  db.pragma('cipher_page_size=4096')
  db.pragma('cipher_hmac_algorithm=HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm=PBKDF2_HMAC_SHA512')
  return db
}

const PWD = 'Old-Computer-Pass-1'

const LATEST_SCHEMA = allMigrations[allMigrations.length - 1]?.version ?? 0

/** A real, fully migrated Pulse database (not a toy schema) holding one record named `person` */
function makeRealDb(dbPath: string, keyHex: string, person: string, schemaVersion?: string): void {
  const db = createProdFormatDb(dbPath, { hexKey: keyHex })
  const { rowIds, columnIds } = seedGrid(db, { rowCount: 1, columnCount: 2 })
  db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], person)
  if (schemaVersion) db.prepare("UPDATE app_meta SET value = ? WHERE key = 'schema_version'").run(schemaVersion)
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()
}

/** The record names in the seeded list */
function personNames(db: { prepare: (sql: string) => { all: () => unknown[] } }): string[] {
  return (db.prepare(`SELECT c.value FROM cells c JOIN rows r ON r.id = c.row_id JOIN grids g ON g.id = r.grid_id
    WHERE g.name = 'Test Caseload' ORDER BY c.id`).all() as Array<{ value: string }>).map(r => r.value)
}

async function makeBackupOnOldComputer(schemaVersion?: string): Promise<{ backupPath: string; keyHex: string; recoveryKey: string }> {
  const dbPath = join(state.dir, 'pulse.db')
  await setupPassword(PWD, 'old hint', dbPath)
  const recoveryKey = await generateRecoveryKey()
  const keyHex = getDbKey().toString('hex')
  makeRealDb(dbPath, keyHex, 'Jane Doe', schemaVersion)
  const { destPath } = await runManualBackup(join(state.dir, 'usb', 'caseload'))
  return { backupPath: destPath, keyHex, recoveryKey }
}

function wipeToFreshInstall(): void {
  lockApp()
  for (const m of state.stores.values()) m.clear()
  for (const f of readdirSync(state.dir)) {
    if (f !== 'usb') rmSync(join(state.dir, f), { recursive: true, force: true })
  }
}

beforeEach(() => {
  lockApp()
  for (const m of state.stores.values()) m.clear()
  state.dir = mkdtempSync(join(tmpdir(), 'pulse-newinstall-'))
})

describe('Restore on a new computer', { timeout: 60_000 }, () => {
  it('opens a backup with the recovery key and re-protects it with a new password', async () => {
    const { backupPath, keyHex, recoveryKey } = await makeBackupOnOldComputer()
    wipeToFreshInstall()
    expect(isPasswordSetup()).toBe(false)

    await restoreBackupOnNewInstall({ backupPath, secret: recoveryKey, newPassword: 'New-Computer-Pass', hint: '' })

    expect(getDbKey().toString('hex')).toBe(keyHex)
    const db = openWithKey(join(state.dir, 'pulse.db'), keyHex)
    expect(personNames(db)).toEqual(['Jane Doe'])
    db.close()

    lockApp()
    await verifyAndUnlock('New-Computer-Pass')
    expect(getDbKey().toString('hex')).toBe(keyHex)
  })

  it('opens a backup with the old password', async () => {
    const { backupPath, keyHex } = await makeBackupOnOldComputer()
    wipeToFreshInstall()
    await restoreBackupOnNewInstall({ backupPath, secret: PWD, newPassword: 'New-Computer-Pass', hint: '' })
    expect(getDbKey().toString('hex')).toBe(keyHex)
  })

  it('rejects a wrong secret without touching disk state', async () => {
    const { backupPath } = await makeBackupOnOldComputer()
    wipeToFreshInstall()
    await expect(
      restoreBackupOnNewInstall({ backupPath, secret: 'not it', newPassword: 'New-Computer-Pass', hint: '' })
    ).rejects.toThrow('Incorrect password or recovery key')
    expect(existsSync(join(state.dir, 'pulse.db'))).toBe(false)
    expect(isPasswordSetup()).toBe(false)
    expect(readdirSync(state.dir).filter(f => f.startsWith('restore-tmp-'))).toEqual([])
  })

  it('a backup made before a password change still restores with the OLD password (the key is re-wrapped, not changed)', async () => {
    const { backupPath, keyHex } = await makeBackupOnOldComputer()
    await changePassword(PWD, 'Changed-Password-22', '')
    expect(getDbKey().toString('hex')).toBe(keyHex)
    wipeToFreshInstall()

    await expect(restoreBackupOnNewInstall({ backupPath, secret: 'Changed-Password-22', newPassword: 'New-Computer-Pass', hint: '' }))
      .rejects.toThrow('Incorrect password or recovery key')
    expect(existsSync(join(state.dir, 'pulse.db'))).toBe(false)

    await restoreBackupOnNewInstall({ backupPath, secret: PWD, newPassword: 'New-Computer-Pass', hint: '' })
    expect(getDbKey().toString('hex')).toBe(keyHex)
    const db = openWithKey(join(state.dir, 'pulse.db'), keyHex)
    expect(personNames(db)).toEqual(['Jane Doe'])
    db.close()
  })

  it('a backup made after a password change restores with the NEW password, not the old one', async () => {
    const { keyHex } = await makeBackupOnOldComputer()
    await changePassword(PWD, 'Changed-Password-22', '')
    const { destPath: backupPath } = await runManualBackup(join(state.dir, 'usb', 'after-change'))
    wipeToFreshInstall()

    await expect(restoreBackupOnNewInstall({ backupPath, secret: PWD, newPassword: 'New-Computer-Pass', hint: '' }))
      .rejects.toThrow('Incorrect password or recovery key')
    await restoreBackupOnNewInstall({ backupPath, secret: 'Changed-Password-22', newPassword: 'New-Computer-Pass', hint: '' })
    expect(getDbKey().toString('hex')).toBe(keyHex)
  })

  it('moves an existing database aside instead of overwriting it', () => {
    const dbPath = join(state.dir, 'pulse.db')
    writeFileSync(dbPath, 'not empty')
    const moved = moveAsideExistingDatabase(dbPath)
    expect(moved).toMatch(/pulse-orphaned-.*\.db$/)
    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(moved!)).toBe(true)
  })

  it('can read the database inside a .pulse-backup for previews, then cleans up', async () => {
    const { backupPath, keyHex } = await makeBackupOnOldComputer()
    const count = await withBackupDbFile(backupPath, (dbFile) => {
      const db = openWithKey(dbFile, keyHex)
      try { return personNames(db).length } finally { db.close() }
    })
    expect(count).toBe(1)
    expect(readdirSync(join(state.dir, 'backups')).filter(f => f.startsWith('preview-tmp-'))).toEqual([])
  })
})

describe('Scheduled backup "Run now"', { timeout: 60_000 }, () => {
  it('writes a backup to the chosen folder, records the run, and that backup restores', async () => {
    const { keyHex, recoveryKey } = await makeBackupOnOldComputer()
    const dest = join(state.dir, 'usb', 'scheduled')
    setScheduledConfig({ enabled: true, intervalHours: 24, destinationDir: dest, lastRunISO: null })

    const res = await runScheduledBackupNow()
    expect(res.ran).toBe(true)
    expect(res.destPath).toMatch(/pulse-scheduled-.*\.pulse-backup$/)
    expect(existsSync(res.destPath!)).toBe(true)
    expect(getScheduledConfig().lastRunISO).toBe(res.lastRunISO)
    expect(getScheduledConfig().destinationDir).toBe(dest)

    // A backup made by "Run now" must restore on a new computer too
    const backupPath = res.destPath!
    wipeToFreshInstall()
    await restoreBackupOnNewInstall({ backupPath, secret: recoveryKey, newPassword: 'New-Computer-Pass', hint: '' })
    const db = openWithKey(join(state.dir, 'pulse.db'), keyHex)
    expect(personNames(db)).toEqual(['Jane Doe'])
    db.close()
  })

  it('reports a plain reason when the folder is unavailable, and keeps the last run', async () => {
    await makeBackupOnOldComputer()
    const blocker = join(state.dir, 'not-a-folder')
    writeFileSync(blocker, 'x')
    setScheduledConfig({ enabled: true, intervalHours: 24, destinationDir: join(blocker, 'backups'), lastRunISO: '2026-01-01T00:00:00.000Z' })
    const res = await runScheduledBackupNow()
    expect(res.ran).toBe(false)
    expect(res.error).toMatch(/can't be found|isn't allowed|couldn't be saved/)
    expect(res.error).not.toMatch(/ENOTDIR|EEXIST/)
    expect(getScheduledConfig().lastRunISO).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('Knowing whether backups are happening', () => {
  it('counts a backup saved outside the Pulse folder as a copy somewhere else', async () => {
    await makeBackupOnOldComputer() // saved under the data folder: doesn't count
    expect(getBackupHealth().lastOffsiteISO).toBeNull()
    const usb = mkdtempSync(join(tmpdir(), 'pulse-usb-'))
    try {
      await runManualBackup(join(usb, 'caseload'))
      expect(getBackupHealth().lastOffsiteISO).not.toBeNull()
    } finally { rmSync(usb, { recursive: true, force: true }) }
  })

  it('records why scheduled backups fail and flags them after two missed runs', async () => {
    await makeBackupOnOldComputer()
    const blocker = join(state.dir, 'not-a-folder')
    writeFileSync(blocker, 'x')
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString()
    setScheduledConfig({ enabled: true, intervalHours: 24, destinationDir: join(blocker, 'b'), lastRunISO: threeDaysAgo })
    await checkAndRunScheduled()
    const cfg = getScheduledConfig()
    expect(cfg.lastError).toBeTruthy()
    expect(cfg.lastAttemptISO).toBeTruthy()
    expect(cfg.lastRunISO).toBe(threeDaysAgo)
    expect(getBackupHealth().scheduled.overdue).toBe(true)

    // Fixing the folder clears the warning
    setScheduledConfig({ ...getScheduledConfig(), destinationDir: join(state.dir, 'usb', 'ok') })
    await checkAndRunScheduled()
    expect(getScheduledConfig().lastError).toBeNull()
    expect(getBackupHealth().scheduled.overdue).toBe(false)
  })

  it('makes an auto-backup on lock, at most once an hour', async () => {
    await makeBackupOnOldComputer()
    const autoFiles = () => (existsSync(join(state.dir, 'backups')) ? readdirSync(join(state.dir, 'backups')).filter(f => f.startsWith('pulse-auto-')) : [])
    expect(autoFiles()).toHaveLength(0)
    runAutoBackupOnLock()
    expect(autoFiles()).toHaveLength(1)
    runAutoBackupOnLock()
    expect(autoFiles()).toHaveLength(1)
  })
})

describe('Backup size limit', () => {
  afterEach(() => setMaxBackupBytesForTests(null))

  it('allows backups far bigger than the old 200 MB limit', () => {
    expect(MAX_BACKUP_BYTES).toBeGreaterThan(4000 * 1024 * 1024)
  })

  it('refuses to write a backup that restore would reject, and says why', async () => {
    const { backupPath } = await makeBackupOnOldComputer()
    setMaxBackupBytesForTests(1024)
    const dest = join(state.dir, 'usb', 'too-big')
    await expect(runManualBackup(dest)).rejects.toThrow(/more than a backup can hold/)
    expect(existsSync(dest + '.pulse-backup')).toBe(false)
    // And restore applies the same limit
    wipeToFreshInstall()
    await expect(restoreBackupOnNewInstall({ backupPath, secret: PWD, newPassword: 'New-Computer-Pass', hint: '' }))
      .rejects.toThrow(/larger than/)
  })
})

describe('Restoring another Pulse\'s backup from Settings', { timeout: 60_000 }, () => {
  const NEW_PWD = 'New-Computer-Pass-1'

  /** The new computer is already set up, with its own data, when the old backup is picked */
  async function setUpNewComputerWithData(): Promise<string> {
    const dbPath = join(state.dir, 'pulse.db')
    await setupPassword(NEW_PWD, '', dbPath)
    const keyHex = getDbKey().toString('hex')
    makeRealDb(dbPath, keyHex, 'Sam New')
    return keyHex
  }

  it('recognises a backup from another Pulse instead of calling it invalid', async () => {
    const { backupPath } = await makeBackupOnOldComputer()
    wipeToFreshInstall()
    await setUpNewComputerWithData()
    const res = await verifyBackup(backupPath)
    expect(res.valid).toBe(false)
    expect(res.otherPulse).toBe(true)
  })

  it('restores it with the old password, keeps the current data as a safety copy, and both still open', async () => {
    const { backupPath, keyHex: oldKey } = await makeBackupOnOldComputer()
    wipeToFreshInstall()
    const newKey = await setUpNewComputerWithData()

    const { safetyPath } = await restoreOtherPulseBackup({ backupPath, secret: PWD, newPassword: 'Chosen-After-Restore-1', hint: '' })
    expect(getDbKey().toString('hex')).toBe(oldKey)
    const db = openWithKey(join(state.dir, 'pulse.db'), oldKey)
    expect(personNames(db)).toEqual(['Jane Doe'])
    db.close()
    lockApp()
    await verifyAndUnlock('Chosen-After-Restore-1')
    expect(getDbKey().toString('hex')).toBe(oldKey)

    // The safety copy is a normal backup that opens with the password the user had before
    expect(safetyPath).toMatch(/pulse-pre-restore-.*\.pulse-backup$/)
    const safetyCount = await withBackupDbFile(safetyPath, (dbFile) => {
      const s = openWithKey(dbFile, newKey)
      try { return personNames(s).filter(n => n === 'Sam New').length } finally { s.close() }
    })
    expect(safetyCount).toBe(1)
    const usbCopy = join(state.dir, 'usb', 'safety.pulse-backup')
    copyFileSync(safetyPath, usbCopy)
    wipeToFreshInstall()
    await restoreBackupOnNewInstall({ backupPath: usbCopy, secret: NEW_PWD, newPassword: 'Third-Password-123', hint: '' })
    expect(getDbKey().toString('hex')).toBe(newKey)
  })

  it('refuses a backup from a newer Pulse before changing the data or the password (S4)', async () => {
    const { backupPath } = await makeBackupOnOldComputer(String(LATEST_SCHEMA + 1))
    wipeToFreshInstall()
    const newKey = await setUpNewComputerWithData()
    await expect(restoreOtherPulseBackup({ backupPath, secret: PWD, newPassword: 'Chosen-After-Restore-1', hint: '' }))
      .rejects.toThrow('made by a newer version of Pulse')
    expect(getDbKey().toString('hex')).toBe(newKey)
    const db = openWithKey(join(state.dir, 'pulse.db'), newKey)
    expect(personNames(db)).toEqual(['Sam New'])
    db.close()
    expect(readdirSync(state.dir).filter(f => f.startsWith('pulse-orphaned-'))).toEqual([])
    lockApp()
    await verifyAndUnlock(NEW_PWD)
  })

  it('changes nothing when the password is wrong', async () => {
    const { backupPath } = await makeBackupOnOldComputer()
    wipeToFreshInstall()
    const newKey = await setUpNewComputerWithData()
    await expect(restoreOtherPulseBackup({ backupPath, secret: 'wrong', newPassword: 'Chosen-After-Restore-1', hint: '' }))
      .rejects.toThrow('Incorrect password or recovery key')
    expect(getDbKey().toString('hex')).toBe(newKey)
    const db = openWithKey(join(state.dir, 'pulse.db'), newKey)
    expect(personNames(db)).toEqual(['Sam New'])
    db.close()
    expect(readdirSync(state.dir).filter(f => f.startsWith('pulse-orphaned-'))).toEqual([])
    lockApp()
    await verifyAndUnlock(NEW_PWD)
  })
})

describe('getBackupMadeInfo', () => {
  it('reads when a .pulse-backup was made and by which Pulse', async () => {
    const before = Date.now()
    const { backupPath } = await makeBackupOnOldComputer()
    const info = await getBackupMadeInfo(backupPath)
    expect(info.appVersion).toBe('9.9.9')
    expect(Date.parse(info.madeAt!)).toBeGreaterThanOrEqual(before - 1000)
  })

  it('reads the time from a local backup\'s file name', async () => {
    const p = join(state.dir, 'pulse-auto-20260102-030405.db')
    writeFileSync(p, 'x')
    const info = await getBackupMadeInfo(p)
    const d = new Date(info.madeAt!)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 0, 2, 3, 4])
  })
})

describe('describeBackupError', () => {
  it('turns system error codes into plain words', () => {
    const e = (code: string) => Object.assign(new Error('x'), { code })
    expect(describeBackupError(e('ENOENT'))).toMatch(/USB drive or network folder/)
    expect(describeBackupError(e('EACCES'))).toMatch(/isn't allowed/)
    expect(describeBackupError(e('ENOSPC'))).toMatch(/full/)
    expect(describeBackupError(new Error('weird'))).toMatch(/couldn't be saved/)
  })
})
