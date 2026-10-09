/**
 * Disaster-recovery round trip: a .pulse-backup made on one computer must open
 * on a fresh install using only the old password or recovery key.
 * Uses the real auth.ts + backup.ts with a real SQLCipher database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, existsSync, rmSync, readdirSync, writeFileSync } from 'fs'
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
import { setupPassword, generateRecoveryKey, getDbKey, lockApp, isPasswordSetup, verifyAndUnlock } from '../src/main/auth'
import { runManualBackup, restoreBackupOnNewInstall, moveAsideExistingDatabase, withBackupDbFile } from '../src/main/backup'

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

async function makeBackupOnOldComputer(): Promise<{ backupPath: string; keyHex: string; recoveryKey: string }> {
  const dbPath = join(state.dir, 'pulse.db')
  await setupPassword(PWD, 'old hint', dbPath)
  const recoveryKey = await generateRecoveryKey()
  const keyHex = getDbKey().toString('hex')
  const db = openWithKey(dbPath, keyHex)
  db.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
           INSERT INTO app_meta VALUES ('schema_version', '31');
           CREATE TABLE clients (name TEXT); INSERT INTO clients VALUES ('Jane Doe');`)
  db.close()
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

describe('Restore on a new computer', () => {
  it('opens a backup with the recovery key and re-protects it with a new password', async () => {
    const { backupPath, keyHex, recoveryKey } = await makeBackupOnOldComputer()
    wipeToFreshInstall()
    expect(isPasswordSetup()).toBe(false)

    await restoreBackupOnNewInstall({ backupPath, secret: recoveryKey, newPassword: 'New-Computer-Pass', hint: '' })

    expect(getDbKey().toString('hex')).toBe(keyHex)
    const db = openWithKey(join(state.dir, 'pulse.db'), keyHex)
    expect(db.prepare('SELECT name FROM clients').get()).toEqual({ name: 'Jane Doe' })
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
      try { return (db.prepare('SELECT COUNT(*) AS n FROM clients').get() as { n: number }).n } finally { db.close() }
    })
    expect(count).toBe(1)
    expect(readdirSync(join(state.dir, 'backups')).filter(f => f.startsWith('preview-tmp-'))).toEqual([])
  })
})
