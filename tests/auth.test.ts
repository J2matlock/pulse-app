/**
 * Auth Round-Trip Tests — tests password setup, lock/unlock, recovery key, and password change.
 * Mocks electron and electron-store before importing auth.ts. No Electron runtime needed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// The electron mock uses tmpdir for getPath — ensure the directory exists
const mockDataDir = join(tmpdir(), 'pulse-test-electron-mock')
mkdirSync(mockDataDir, { recursive: true })

// Must mock electron before importing auth.ts (top-level app.isPackaged access)
// Cannot reference mockDataDir in vi.mock factory (hoisted above const declarations)
vi.mock('electron', () => {
  const os = require('os')
  const path = require('path')
  const dir = path.join(os.tmpdir(), 'pulse-test-electron-mock')
  return {
    app: {
      isPackaged: false,
      getPath: () => dir,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString(),
    },
    dialog: { showMessageBoxSync: () => 0 },
    clipboard: { clear: () => {} },
  }
})

// vi.hoisted() ensures mockStoreData is initialized before any mocked module
// code runs (auth.ts calls store.get() at module scope, which runs during import).
const mockStoreData = vi.hoisted(() => new Map<string, unknown>())

vi.mock('electron-store', () => ({
  default: class {
    constructor(_opts?: unknown) {}
    get(k: string, d?: unknown) { return mockStoreData.has(k) ? mockStoreData.get(k) : d }
    set(k: string | Record<string, unknown>, v?: unknown) {
      if (typeof k === 'object') {
        for (const [key, val] of Object.entries(k)) mockStoreData.set(key, val)
      } else {
        mockStoreData.set(k, v)
      }
    }
    has(k: string) { return mockStoreData.has(k) }
    delete(k: string) { mockStoreData.delete(k) }
    clear() { mockStoreData.clear() }
  },
}))

import {
  setupPassword,
  verifyAndUnlock,
  verifyAndUnlockRecovery,
  generateRecoveryKey,
  changePassword,
  revokeRecoveryKey,
  lockApp,
  getDbKey,
  getPasswordHint,
  isPasswordSetup,
  hasRecoveryKey,
  resetPasswordAfterRecovery,
  getKeyEnvelope,
  unwrapKeyEnvelope,
  adoptRestoredDbKey,
  isValidKeyEnvelope,
} from '../src/main/auth'
import * as nodeCrypto from 'crypto'
import bcrypt from 'bcryptjs'

beforeEach(() => {
  lockApp()
  mockStoreData.clear()
})

describe('Auth', () => {
  const TEST_PWD = 'MyStr0ngP@ssword!'
  const TEST_HINT = 'Strong one'
  const TEST_DB_PATH = '/tmp/test-pulse.db'

  it('setupPassword sets up key accessible via getDbKey', async () => {
    await setupPassword(TEST_PWD, TEST_HINT, TEST_DB_PATH)
    const key = getDbKey()
    expect(key.toString('hex')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verifyAndUnlock with correct password restores the same key', async () => {
    await setupPassword(TEST_PWD, TEST_HINT, TEST_DB_PATH)
    const setupKeyHex = getDbKey().toString('hex') // clone before lockApp zeroes the buffer
    lockApp()
    await verifyAndUnlock(TEST_PWD)
    expect(getDbKey().toString('hex')).toBe(setupKeyHex)
  })

  it('verifyAndUnlock with wrong password throws', async () => {
    await setupPassword(TEST_PWD, TEST_HINT, TEST_DB_PATH)
    lockApp()
    await expect(verifyAndUnlock('wrong-password')).rejects.toThrow('Incorrect password')
  })

  it('generateRecoveryKey returns XXXX-XXXX-... formatted string (29 chars)', async () => {
    await setupPassword(TEST_PWD, TEST_HINT, TEST_DB_PATH)
    const recoveryKey = await generateRecoveryKey()
    // Format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX = 28 chars + 6 dashes = 34
    expect(recoveryKey).toHaveLength(34)
    expect(recoveryKey).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){6}$/)
  })

  it('verifyAndUnlockRecovery restores same DB key', async () => {
    await setupPassword(TEST_PWD, TEST_HINT, TEST_DB_PATH)
    const setupKeyHex = getDbKey().toString('hex') // clone before lockApp zeroes the buffer
    const recoveryKey = await generateRecoveryKey()
    lockApp()
    await verifyAndUnlockRecovery(recoveryKey)
    expect(getDbKey().toString('hex')).toBe(setupKeyHex)
  })

  it('changePassword: new password works, old fails', async () => {
    await setupPassword(TEST_PWD, TEST_HINT, TEST_DB_PATH)
    const setupKeyHex = getDbKey().toString('hex') // clone before lockApp zeroes the buffer
    const NEW_PWD = 'NewP@ss2024!'
    await changePassword(TEST_PWD, NEW_PWD, 'New hint')
    lockApp()

    // New password should work
    await verifyAndUnlock(NEW_PWD)
    expect(getDbKey().toString('hex')).toBe(setupKeyHex)

    // Old password should fail
    lockApp()
    await expect(verifyAndUnlock(TEST_PWD)).rejects.toThrow('Incorrect password')
  })

  it('revokeRecoveryKey: recovery unlock throws after revocation', async () => {
    await setupPassword(TEST_PWD, TEST_HINT, TEST_DB_PATH)
    const recoveryKey = await generateRecoveryKey()
    await revokeRecoveryKey()
    lockApp()
    await expect(verifyAndUnlockRecovery(recoveryKey)).rejects.toThrow('No recovery key configured')
  })

  it('lockApp: getDbKey() throws "Database is locked"', async () => {
    await setupPassword(TEST_PWD, TEST_HINT, TEST_DB_PATH)
    expect(() => getDbKey()).not.toThrow() // unlocked after setup
    lockApp()
    expect(() => getDbKey()).toThrow('Database is locked')
  })

  it('password hint stored and retrieved', async () => {
    await setupPassword(TEST_PWD, TEST_HINT, TEST_DB_PATH)
    expect(getPasswordHint()).toBe(TEST_HINT)
  })

  it('empty string password rejects', async () => {
    await expect(setupPassword('', 'hint', TEST_DB_PATH)).rejects.toThrow()
  })

  it('unicode-only password (emoji, CJK) succeeds', async () => {
    const unicodePwd = '🔐密码🗝️安全测试密钥很长'
    await setupPassword(unicodePwd, 'emoji', TEST_DB_PATH)
    const keyHex = getDbKey().toString('hex')
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/)
    lockApp()
    await verifyAndUnlock(unicodePwd)
    expect(getDbKey().toString('hex')).toBe(keyHex)
  })

  it('very long password (>512 chars) succeeds', async () => {
    const longPwd = 'A'.repeat(600) + '!1a'
    await setupPassword(longPwd, 'long', TEST_DB_PATH)
    const keyHex = getDbKey().toString('hex')
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/)
    lockApp()
    await verifyAndUnlock(longPwd)
    expect(getDbKey().toString('hex')).toBe(keyHex)
  })
})

describe('Legacy long passwords (pre-normalization credentials)', () => {
  it('unlocks credentials created with a raw >72-byte password and migrates them', async () => {
    const longPwd = 'correct horse battery staple '.repeat(4) // 116 bytes
    const dbKey = nodeCrypto.randomBytes(32)
    // Build credentials exactly as v1.1.6 did: bcrypt + PBKDF2 over the RAW password
    const salt = nodeCrypto.randomBytes(32)
    const wrapKey = nodeCrypto.pbkdf2Sync(longPwd, salt, 600_000, 32, 'sha256')
    const iv = nodeCrypto.randomBytes(12)
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', wrapKey, iv)
    const ct = Buffer.concat([cipher.update(dbKey.toString('hex'), 'utf8'), cipher.final()])
    mockStoreData.set('password_hash', await bcrypt.hash(longPwd, 4))
    mockStoreData.set('salt_password', salt.toString('hex'))
    mockStoreData.set('wrapped_db_key_password', [iv.toString('hex'), cipher.getAuthTag().toString('hex'), ct.toString('hex')].join(':'))

    await verifyAndUnlock(longPwd)
    expect(getDbKey().toString('hex')).toBe(dbKey.toString('hex'))

    // Migrated: the salt changed and the same password still unlocks
    expect(mockStoreData.get('salt_password')).not.toBe(salt.toString('hex'))
    lockApp()
    await verifyAndUnlock(longPwd)
    expect(getDbKey().toString('hex')).toBe(dbKey.toString('hex'))
  })
})

describe('Recovery-key changes require the current password', () => {
  const PWD = 'MyStr0ngP@ssword!'

  it('allows generating right after setup without re-entering the password', async () => {
    await setupPassword(PWD, '', '/tmp/x.db')
    await expect(generateRecoveryKey()).resolves.toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){6}$/)
  })

  it('requires the password after a normal unlock', async () => {
    await setupPassword(PWD, '', '/tmp/x.db')
    lockApp()
    await verifyAndUnlock(PWD)
    await expect(generateRecoveryKey()).rejects.toThrow('Enter your current password')
    await expect(generateRecoveryKey('wrong-password')).rejects.toThrow('Incorrect password')
    await expect(generateRecoveryKey(PWD)).resolves.toMatch(/^[A-Z0-9]{4}-/)
    await expect(revokeRecoveryKey()).rejects.toThrow('Enter your current password')
    await revokeRecoveryKey(PWD)
    expect(hasRecoveryKey()).toBe(false)
  })

  it('only allows password reset after a recovery-key unlock', async () => {
    await setupPassword(PWD, '', '/tmp/x.db')
    const rk = await generateRecoveryKey()
    lockApp()
    await verifyAndUnlock(PWD)
    await expect(resetPasswordAfterRecovery('Another-Pass-1', '')).rejects.toThrow('recovery key')
    lockApp()
    await verifyAndUnlockRecovery(rk)
    await resetPasswordAfterRecovery('Another-Pass-1', '')
    lockApp()
    await expect(verifyAndUnlock('Another-Pass-1')).resolves.toHaveProperty('failedAttempts')
  })
})

describe('Portable key envelope (restore on a new computer)', () => {
  const PWD = 'MyStr0ngP@ssword!'

  it('unwraps with the password or the recovery key, and rejects anything else', async () => {
    await setupPassword(PWD, '', '/tmp/x.db')
    const keyHex = getDbKey().toString('hex')
    const rk = await generateRecoveryKey()
    const env = getKeyEnvelope()
    expect(isValidKeyEnvelope(env)).toBe(true)
    lockApp()
    expect((await unwrapKeyEnvelope(env!, PWD)).toString('hex')).toBe(keyHex)
    // Recovery key typed lowercase without dashes still works
    expect((await unwrapKeyEnvelope(env!, rk.replace(/-/g, '').toLowerCase())).toString('hex')).toBe(keyHex)
    await expect(unwrapKeyEnvelope(env!, 'not-the-password')).rejects.toThrow('Incorrect password or recovery key')
  })

  it('adopting a restored key on a fresh install keeps the old recovery key working', async () => {
    await setupPassword(PWD, '', '/tmp/x.db')
    const keyHex = getDbKey().toString('hex')
    const rk = await generateRecoveryKey()
    const env = getKeyEnvelope()!
    const recovered = await unwrapKeyEnvelope(env, PWD)

    // New computer: nothing stored
    lockApp()
    mockStoreData.clear()
    await adoptRestoredDbKey(recovered, env, 'New-Computer-Pass', 'hint', '/tmp/new.db')
    expect(getDbKey().toString('hex')).toBe(keyHex)

    lockApp()
    await verifyAndUnlock('New-Computer-Pass')
    expect(getDbKey().toString('hex')).toBe(keyHex)
    lockApp()
    await verifyAndUnlockRecovery(rk)
    expect(getDbKey().toString('hex')).toBe(keyHex)
  })

  it('rejects malformed envelopes', () => {
    expect(isValidKeyEnvelope(null)).toBe(false)
    expect(isValidKeyEnvelope({ v: 2 })).toBe(false)
    expect(isValidKeyEnvelope({ v: 1, salt_password: 'zz', wrapped_db_key_password: 'x' })).toBe(false)
  })
})

describe('In-memory key copies are wiped when replaced (AUDIT-098)', () => {
  const PWD = 'MyStr0ngP@ssword!'
  const zeroed = (b: Buffer) => b.every(x => x === 0)

  it('zeroes the old key Buffer on every replacement and on lock, and keeps working with the new one', async () => {
    await setupPassword(PWD, '', '/tmp/x.db')
    const keyHex = getDbKey().toString('hex')
    const env = getKeyEnvelope()
    expect(env).not.toBeNull()
    if (!env) return

    // Change password unlocks again while already unlocked
    const first = getDbKey()
    await changePassword(PWD, 'Changed-Pass-123', '')
    expect(zeroed(first)).toBe(true)
    const second = getDbKey()
    expect(second).not.toBe(first)
    expect(second.toString('hex')).toBe(keyHex)

    // Factory reset re-checks the password the same way
    await verifyAndUnlock('Changed-Pass-123')
    expect(zeroed(second)).toBe(true)
    const third = getDbKey()
    expect(third.toString('hex')).toBe(keyHex)

    // Restoring another backup while unlocked swaps in that key
    const recovered = await unwrapKeyEnvelope(env, PWD)
    await adoptRestoredDbKey(recovered, env, 'Restored-Pass-123', '', '/tmp/x.db')
    expect(zeroed(third)).toBe(true)
    const fourth = getDbKey()
    expect(fourth.toString('hex')).toBe(keyHex)
    // The caller's own copy isn't the live one, so it isn't wiped behind their back
    expect(recovered.toString('hex')).toBe(keyHex)

    lockApp()
    expect(zeroed(fourth)).toBe(true)
    expect(() => getDbKey()).toThrow('Database is locked')
  })
})

describe('Failed-attempt notice', () => {
  it('reports wrong attempts since the last unlock, then resets', async () => {
    const PWD = 'MyStr0ngP@ssword!'
    await setupPassword(PWD, '', '/tmp/x.db')
    lockApp()
    await expect(verifyAndUnlock('wrong-password-1')).rejects.toThrow('Incorrect password')
    await expect(verifyAndUnlock('wrong-password-2')).rejects.toThrow('Incorrect password')
    expect(await verifyAndUnlock(PWD)).toEqual({ failedAttempts: 2 })
    lockApp()
    expect(await verifyAndUnlock(PWD)).toEqual({ failedAttempts: 0 })
  })
})

describe('New-password rules', () => {
  it('rejects short and common passwords when setting one', async () => {
    await expect(setupPassword('short-pass', '', '/tmp/x.db')).rejects.toThrow('at least 12')
    await expect(setupPassword('password1234', '', '/tmp/x.db')).rejects.toThrow('too common')
  })
})

