/**
 * Q-001 / F-015: electron-store's conf writes its files 0o666 by default, so
 * the credential file (password hash, salts, wrapped keys) became readable and
 * writable by every local account after the first write. Real auth.ts, prefs,
 * backup and database stores over the real electron-store; only Electron is faked.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'), os = require('os'), path = require('path')
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-file-modes-'))
  // An older version left the data folder open to other accounts
  fs.chmodSync(d, 0o755)
  process.env.PULSE_DATA_DIR = d
  return d as string
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => dir, getVersion: () => '0.0.0-test' },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
  clipboard: { clear: () => {} },
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const posix = process.platform !== 'win32'
const mode = (p: string): number => statSync(p).mode & 0o777

afterAll(() => {
  delete process.env.PULSE_DATA_DIR
  rmSync(dir, { recursive: true, force: true })
})

describe.runIf(posix)('Files Pulse keeps outside the database are owner-only', () => {
  beforeAll(() => {
    // An older version's prefs file, left world-writable
    writeFileSync(join(dir, 'pulse-prefs.json'), JSON.stringify({ trayMode: false }))
    chmodSync(join(dir, 'pulse-prefs.json'), 0o666)
  })

  it('the credential file stays 0600 through setup, unlock and a password change, and the data folder is 0700', async () => {
    const auth = await import('../src/main/auth')
    expect(mode(dir)).toBe(0o700)
    const secure = join(dir, 'pulse-secure.json')
    await auth.setupPassword('first-password-123', '', join(dir, 'pulse.db'))
    expect(mode(secure)).toBe(0o600)
    auth.lockApp()
    await expect(auth.verifyAndUnlock('wrong-password-123')).rejects.toThrow()
    expect(mode(secure)).toBe(0o600)
    await auth.verifyAndUnlock('first-password-123')
    expect(mode(secure)).toBe(0o600)
    await auth.changePassword('first-password-123', 'second-password-456', '')
    expect(mode(secure)).toBe(0o600)
    auth.lockApp()
  })

  it('prefs, backup settings, backup status and migration status are written 0600', async () => {
    const { prefs } = await import('../src/main/prefs')
    // Tightened on open, before anything changes
    prefs()
    expect(mode(join(dir, 'pulse-prefs.json'))).toBe(0o600)
    prefs().set('trayMode', true)
    expect(mode(join(dir, 'pulse-prefs.json'))).toBe(0o600)

    const backup = await import('../src/main/backup')
    backup.setScheduledConfig({ ...backup.getScheduledConfig() })
    backup.recordAutoBackupSuccess()
    expect(mode(join(dir, 'pulse-backup-config.json'))).toBe(0o600)
    expect(mode(join(dir, 'pulse-backup-status.json'))).toBe(0o600)

    const database = await import('../src/main/database')
    database.clearMigrationFailureFlag()
    expect(mode(join(dir, 'pulse-migration-status.json'))).toBe(0o600)
  })

  it('the helpers tighten a folder and file an older version left open', async () => {
    const { ensurePrivateDir, makeFilePrivate } = await import('../src/main/private-files')
    const other = mkdtempSync(join(tmpdir(), 'pulse-file-modes-other-'))
    try {
      chmodSync(other, 0o777)
      ensurePrivateDir(other)
      expect(mode(other)).toBe(0o700)
      const f = join(other, 'x.json')
      writeFileSync(f, '{}')
      chmodSync(f, 0o666)
      makeFilePrivate(f)
      expect(mode(f)).toBe(0o600)
      makeFilePrivate(join(other, 'missing.json'))
      expect(existsSync(join(other, 'missing.json'))).toBe(false)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})
