/**
 * The OS-keychain path in auth.ts (AUDIT-017): on most installs safeStorage is
 * available (Windows DPAPI, macOS Keychain, a Linux keyring), so the password
 * hash and wrapped DB keys are stored as `enc:` values. Every other auth test
 * runs with safeStorage turned off; these run with a reversible fake turned on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const ks = vi.hoisted(() => ({
  available: true,
  // decryptString fails, as it does when the data folder came from another computer or account
  broken: false,
  data: new Map<string, unknown>(),
}))

// Reversible stand-in for the OS keystore: XOR with a fixed byte, so stored values aren't the plain text
const xor = (b: Buffer) => Buffer.from(b.map(x => x ^ 0x5a))

vi.mock('electron', async () => {
  const { tmpdir } = await import('os')
  return {
    app: { isPackaged: false, getPath: () => tmpdir() },
    safeStorage: {
      isEncryptionAvailable: () => ks.available,
      encryptString: (s: string) => xor(Buffer.from(s, 'utf8')),
      decryptString: (b: Buffer) => {
        if (ks.broken) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
        return xor(b).toString('utf8')
      },
    },
    dialog: { showMessageBoxSync: () => 0 },
    clipboard: { clear: () => {} },
  }
})

vi.mock('electron-store', () => ({
  default: class {
    get(k: string, d?: unknown) { return ks.data.has(k) ? ks.data.get(k) : d }
    set(k: string | Record<string, unknown>, v?: unknown) {
      if (typeof k === 'object') for (const [key, val] of Object.entries(k)) ks.data.set(key, val)
      else ks.data.set(k, v)
    }
    has(k: string) { return ks.data.has(k) }
    delete(k: string) { ks.data.delete(k) }
    clear() { ks.data.clear() }
  },
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

import {
  setupPassword,
  verifyAndUnlock,
  verifyAndUnlockRecovery,
  generateRecoveryKey,
  changePassword,
  lockApp,
  getDbKey,
  getPasswordHint,
  isPasswordSetup,
  getKeyEnvelope,
  unwrapKeyEnvelope,
  areCredentialsUnreadable,
  CREDENTIALS_UNREADABLE,
  getLoginLockoutRemaining,
} from '../src/main/auth'
import { KEYRING_UNAVAILABLE } from '../src/shared/authErrors'

const PWD = 'Keychain-Test-Pass-1'
const DB_PATH = '/tmp/pulse-keychain-test.db'
const stored = (k: string) => ks.data.get(k) as string
const ENCRYPTED_KEYS = ['password_hash', 'password_hint', 'wrapped_db_key_password']

beforeEach(() => {
  lockApp()
  ks.data.clear()
  ks.available = true
  ks.broken = false
})

describe('auth with the OS keychain available', () => {
  it('stores the password hash, hint and wrapped key as enc: values, and unlocks with them', async () => {
    await setupPassword(PWD, 'test hint', DB_PATH)
    const key = getDbKey().toString('hex')
    for (const k of ENCRYPTED_KEYS) {
      expect(stored(k), k).toMatch(/^enc:/)
    }
    // The wrapped key isn't readable without the keychain; salts are public by design
    expect(stored('wrapped_db_key_password')).not.toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/)
    expect(stored('salt_password')).toMatch(/^[0-9a-f]{64}$/)
    expect(getPasswordHint()).toBe('test hint')

    lockApp()
    await verifyAndUnlock(PWD)
    expect(getDbKey().toString('hex')).toBe(key)
    await expect(verifyAndUnlock('Wrong-Password-123')).rejects.toThrow('Incorrect password')
  })

  it('a recovery key and a password change work through the keychain too', async () => {
    await setupPassword(PWD, '', DB_PATH)
    const key = getDbKey().toString('hex')
    const recovery = await generateRecoveryKey()
    expect(stored('recovery_key_hash')).toMatch(/^enc:/)
    expect(stored('wrapped_db_key_recovery')).toMatch(/^enc:/)

    lockApp()
    await verifyAndUnlockRecovery(recovery)
    expect(getDbKey().toString('hex')).toBe(key)

    lockApp()
    await verifyAndUnlock(PWD)
    await changePassword(PWD, 'Changed-Test-Pass-2', 'new hint')
    expect(stored('wrapped_db_key_password')).toMatch(/^enc:/)
    lockApp()
    await expect(verifyAndUnlock(PWD)).rejects.toThrow('Incorrect password')
    await verifyAndUnlock('Changed-Test-Pass-2')
    expect(getDbKey().toString('hex')).toBe(key)
  })

  it('puts the key in backups without the keychain layer, so another computer can open them', async () => {
    await setupPassword(PWD, '', DB_PATH)
    const key = getDbKey().toString('hex')
    const recovery = await generateRecoveryKey()
    const env = getKeyEnvelope()
    expect(env).not.toBeNull()
    if (!env) return
    expect(env.wrapped_db_key_password).not.toMatch(/^enc:/)
    expect(env.wrapped_db_key_recovery).not.toMatch(/^enc:/)
    expect(env.recovery_key_hash).not.toMatch(/^enc:/)
    expect((await unwrapKeyEnvelope(env, PWD)).toString('hex')).toBe(key)
    expect((await unwrapKeyEnvelope(env, recovery)).toString('hex')).toBe(key)
  })

  it('still reads credentials saved before the keychain was available', async () => {
    ks.available = false
    await setupPassword(PWD, 'plain hint', DB_PATH)
    const key = getDbKey().toString('hex')
    expect(stored('password_hash')).not.toMatch(/^enc:/)

    ks.available = true
    lockApp()
    expect(areCredentialsUnreadable()).toBe(false)
    expect(getPasswordHint()).toBe('plain hint')
    await verifyAndUnlock(PWD)
    expect(getDbKey().toString('hex')).toBe(key)
  })
})

describe("when this computer can't read the saved sign-in data", () => {
  it('says so in plain words and leaves the credentials in place', async () => {
    await setupPassword(PWD, '', DB_PATH)
    await generateRecoveryKey()
    lockApp()
    const before = new Map(ks.data)
    ks.broken = true

    expect(isPasswordSetup()).toBe(true)
    expect(areCredentialsUnreadable()).toBe(true)
    await expect(verifyAndUnlock(PWD)).rejects.toThrow(CREDENTIALS_UNREADABLE)
    await expect(verifyAndUnlockRecovery('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG')).rejects.toThrow(CREDENTIALS_UNREADABLE)
    expect(getKeyEnvelope()).toBeNull()
    expect(() => getDbKey()).toThrow()

    // Nothing was deleted or rewritten; the wrapped keys are the only way back to the data
    for (const k of [...ENCRYPTED_KEYS, 'salt_password', 'recovery_key_hash', 'wrapped_db_key_recovery']) {
      expect(ks.data.get(k), k).toBe(before.get(k))
    }

    // The same folder on the computer that made it still opens
    ks.broken = false
    expect(areCredentialsUnreadable()).toBe(false)
    await verifyAndUnlock(PWD)
  })
})

describe("when the computer's password vault isn't available yet (AUDIT-021)", () => {
  it('says so with its own code, never counts it as a wrong password, and erases nothing', async () => {
    await setupPassword(PWD, 'secret hint', DB_PATH)
    const key = getDbKey().toString('hex')
    await generateRecoveryKey()
    lockApp()
    const before = new Map(ks.data)
    // e.g. Linux keyring not unlocked yet, or Pulse started at sign-in before it was ready
    ks.available = false

    for (let i = 0; i < 7; i++) {
      await expect(verifyAndUnlock(PWD)).rejects.toThrow(KEYRING_UNAVAILABLE)
    }
    await expect(verifyAndUnlockRecovery('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG')).rejects.toThrow(KEYRING_UNAVAILABLE)
    expect(ks.data.get('failed_attempts') ?? 0).toBe(0)
    expect(getLoginLockoutRemaining()).toBe(0)
    expect(() => getDbKey()).toThrow()

    // Not a folder from another computer, so no restore offer; and no "enc:..." hint
    expect(areCredentialsUnreadable()).toBe(false)
    expect(getPasswordHint()).toBe('')

    for (const [k, v] of before) expect(ks.data.get(k), k).toBe(v)

    // Once the vault is up, the same password opens the same data
    ks.available = true
    await verifyAndUnlock(PWD)
    expect(getDbKey().toString('hex')).toBe(key)
    expect(getPasswordHint()).toBe('secret hint')
  })
})
