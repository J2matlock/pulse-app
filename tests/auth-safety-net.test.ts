/**
 * Auth safety net (sweep plan 1.5): long passwords and the SHA-256 prehash,
 * lockout across a restart, a password change that fails partway, and the
 * recovery key after a reset. Real auth.ts, with Electron and electron-store faked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as nodeCrypto from 'crypto'
import bcrypt from 'bcryptjs'

vi.mock('electron', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os'), path = require('path'), fs = require('fs')
  const dir = path.join(os.tmpdir(), 'pulse-test-auth-safety-net')
  fs.mkdirSync(dir, { recursive: true })
  return {
    app: { isPackaged: false, getPath: () => dir },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
    dialog: { showMessageBoxSync: () => 0 },
    clipboard: { clear: () => {} },
  }
})

const store = vi.hoisted(() => ({ data: new Map<string, unknown>(), failNextSet: false }))

vi.mock('electron-store', () => ({
  default: class {
    get(k: string, d?: unknown) { return store.data.has(k) ? store.data.get(k) : d }
    set(k: string | Record<string, unknown>, v?: unknown) {
      if (store.failNextSet) { store.failNextSet = false; throw new Error('ENOSPC: no space left on device') }
      if (typeof k === 'object') for (const [key, val] of Object.entries(k)) store.data.set(key, val)
      else store.data.set(k, v)
    }
    has(k: string) { return store.data.has(k) }
    delete(k: string) { store.data.delete(k) }
    clear() { store.data.clear() }
  },
}))

import {
  setupPassword, verifyAndUnlock, verifyAndUnlockRecovery, generateRecoveryKey, changePassword,
  resetPasswordAfterRecovery, lockApp, getDbKey, normalizePassword,
} from '../src/main/auth'

const DB_PATH = '/tmp/pulse-auth-safety-net.db'

beforeEach(() => {
  lockApp()
  store.data.clear()
  store.failNextSet = false
})

/** Two passwords that are the same for their first 72 bytes and differ after */
const LONG_A = 'correct horse battery staple '.repeat(3) + 'A-tail-1'
const LONG_B = 'correct horse battery staple '.repeat(3) + 'B-tail-2'

describe('Passwords longer than 72 bytes', () => {
  it('a long password sets up and unlocks, counting bytes, not characters', async () => {
    // 29 characters, 74 bytes: over bcrypt's limit only when counted in UTF-8
    const pwd = 'ñandú-ü€-' + '€'.repeat(20)
    expect(pwd.length).toBeLessThan(72)
    expect(Buffer.byteLength(pwd, 'utf8')).toBeGreaterThan(72)
    expect(normalizePassword(pwd)).not.toBe(pwd)
    await setupPassword(pwd, '', DB_PATH)
    const key = getDbKey().toString('hex')
    lockApp()
    await verifyAndUnlock(pwd)
    expect(getDbKey().toString('hex')).toBe(key)
  })

  it('two long passwords that differ only after byte 72 do not both open the data', async () => {
    expect(Buffer.from(LONG_A).subarray(0, 72).equals(Buffer.from(LONG_B).subarray(0, 72))).toBe(true)
    await setupPassword(LONG_A, '', DB_PATH)
    lockApp()
    await expect(verifyAndUnlock(LONG_B)).rejects.toThrow('Incorrect password')
    expect(store.data.get('failed_attempts')).toBe(1)
    await verifyAndUnlock(LONG_A)
  })

  it('the prehash given to bcrypt is SHA-256 as hex text, never the raw digest (a 0x00 byte would cut it short)', async () => {
    // Find a password whose raw SHA-256 digest has a 0x00 byte near the start
    let pwd = ''
    for (let i = 0; i < 100_000; i++) {
      const candidate = `${'x'.repeat(70)}-${i}`
      const digest = nodeCrypto.createHash('sha256').update(candidate).digest()
      if (digest.subarray(0, 4).includes(0)) { pwd = candidate; break }
    }
    expect(pwd).not.toBe('')
    const pre = normalizePassword(pwd)
    expect(pre).toMatch(/^[0-9a-f]{64}$/)
    expect(pre).toBe(nodeCrypto.createHash('sha256').update(pwd).digest('hex'))

    await setupPassword(pwd, '', DB_PATH)
    const hash = store.data.get('password_hash') as string
    expect(await bcrypt.compare(pre, hash)).toBe(true)
    // The raw bytes up to the 0x00 are not what was hashed
    const raw = nodeCrypto.createHash('sha256').update(pwd).digest()
    expect(await bcrypt.compare(raw.subarray(0, raw.indexOf(0)).toString('latin1'), hash)).toBe(false)
  })

  it('a pre-1.1.7 (unhashed) credential does not accept a password that only shares its first 72 bytes (A24-09)', async () => {
    // Credentials as v1.1.6 wrote them: bcrypt and PBKDF2 over the raw long password
    const dbKey = nodeCrypto.randomBytes(32)
    const salt = nodeCrypto.randomBytes(32)
    const wrapKey = nodeCrypto.pbkdf2Sync(LONG_A, salt, 600_000, 32, 'sha256')
    const iv = nodeCrypto.randomBytes(12)
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', wrapKey, iv)
    const ct = Buffer.concat([cipher.update(dbKey.toString('hex'), 'utf8'), cipher.final()])
    store.data.set('password_hash', await bcrypt.hash(LONG_A, 4))
    store.data.set('salt_password', salt.toString('hex'))
    store.data.set('wrapped_db_key_password', [iv.toString('hex'), cipher.getAuthTag().toString('hex'), ct.toString('hex')].join(':'))
    store.data.set('failed_attempts', 2)

    await expect(verifyAndUnlock(LONG_B)).rejects.toThrow('Incorrect password')
    expect(store.data.get('failed_attempts')).toBe(3)
    expect(() => getDbKey()).toThrow('Database is locked')

    await verifyAndUnlock(LONG_A)
    expect(getDbKey().toString('hex')).toBe(dbKey.toString('hex'))
    expect(store.data.get('failed_attempts')).toBe(0)
  })
})

describe('Lockout', () => {
  it('starts after 5 wrong passwords, survives a restart, and clears on the next good unlock', async () => {
    await setupPassword('Lockout-Test-Pass-1', '', DB_PATH)
    lockApp()
    for (let i = 0; i < 5; i++) await expect(verifyAndUnlock('Wrong-Password-99')).rejects.toThrow('Incorrect password')
    await expect(verifyAndUnlock('Lockout-Test-Pass-1')).rejects.toThrow(/Too many failed attempts/)

    // A restart: the module is loaded again over the same saved credential file
    vi.resetModules()
    const fresh = await import('../src/main/auth')
    expect(fresh.getLoginLockoutRemaining()).toBeGreaterThan(0)
    await expect(fresh.verifyAndUnlock('Lockout-Test-Pass-1')).rejects.toThrow(/Too many failed attempts/)

    // Once the wait is over, the right password works and the count starts again
    store.data.set('lockout_until', Date.now() - 1)
    await fresh.verifyAndUnlock('Lockout-Test-Pass-1')
    expect(store.data.get('failed_attempts')).toBe(0)
    expect(fresh.getLoginLockoutRemaining()).toBe(0)
    fresh.lockApp()
  })
})

describe('A password change that fails partway', () => {
  const OLD = 'Old-Password-1234'
  const NEW = 'New-Password-5678'

  /** Exactly one of the two passwords opens the data, and it unwraps the same key */
  async function onePasswordStillWorks(key: string, expected: 'old' | 'new'): Promise<void> {
    lockApp()
    const [works, fails] = expected === 'old' ? [OLD, NEW] : [NEW, OLD]
    await expect(verifyAndUnlock(fails)).rejects.toThrow('Incorrect password')
    await verifyAndUnlock(works)
    expect(getDbKey().toString('hex')).toBe(key)
  }

  it.each([
    ['hashing the new password', () => vi.spyOn(bcrypt, 'hash').mockImplementationOnce(async () => { throw new Error('out of memory') })],
    ['saving the new credentials', () => { store.failNextSet = false; return vi.spyOn(bcrypt, 'hash').mockImplementationOnce(async (s: string, r: number | string) => { store.failNextSet = true; return bcrypt.hashSync(s, r) }) }],
  ])('a throw while %s leaves the old password working', async (_step, inject) => {
    await setupPassword(OLD, 'old hint', DB_PATH)
    const key = getDbKey().toString('hex')
    lockApp()
    const spy = inject()
    try {
      await expect(changePassword(OLD, NEW, 'new hint')).rejects.toThrow()
    } finally { spy.mockRestore() }
    await onePasswordStillWorks(key, 'old')
  })

  it('a change that completes leaves only the new password working', async () => {
    await setupPassword(OLD, '', DB_PATH)
    const key = getDbKey().toString('hex')
    await changePassword(OLD, NEW, '')
    await onePasswordStillWorks(key, 'new')
  })
})

describe('The recovery key after a password reset', () => {
  it('keeps working, as the spec says ("Recovery key unaffected"), and the reset password works too', async () => {
    await setupPassword('Forgotten-Pass-123', '', DB_PATH)
    const key = getDbKey().toString('hex')
    const recoveryKey = await generateRecoveryKey()
    lockApp()

    await verifyAndUnlockRecovery(recoveryKey)
    await resetPasswordAfterRecovery('Reset-Password-456', '')
    lockApp()

    await expect(verifyAndUnlock('Forgotten-Pass-123')).rejects.toThrow('Incorrect password')
    await verifyAndUnlock('Reset-Password-456')
    expect(getDbKey().toString('hex')).toBe(key)
    lockApp()
    await verifyAndUnlockRecovery(recoveryKey)
    expect(getDbKey().toString('hex')).toBe(key)
  })

  it('a reset is refused without a recovery-key unlock first', async () => {
    await setupPassword('Some-Password-789', '', DB_PATH)
    lockApp()
    await verifyAndUnlock('Some-Password-789')
    await expect(resetPasswordAfterRecovery('Reset-Password-456', '')).rejects.toThrow(/only available after unlocking with your recovery key/)
  })
})
