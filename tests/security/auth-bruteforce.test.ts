/**
 * Auth brute-force protection tests — extends auth-ratelimit.test.ts with
 * additional coverage for lockout escalation, edge cases, and MAX_LOCKOUT_MS cap.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-memory mock for electron-store
const storeData: Record<string, unknown> = {}

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pulse-test-auth-bf',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  dialog: { showMessageBoxSync: () => 0 },
}))

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      get(k: string, def?: unknown): unknown { return storeData[k] ?? def }
      set(kOrObj: string | Record<string, unknown>, v?: unknown): void {
        if (typeof kOrObj === 'object') {
          Object.assign(storeData, kOrObj)
        } else {
          storeData[kOrObj] = v
        }
      }
      has(k: string): boolean { return k in storeData }
      delete(k: string): void { delete storeData[k] }
    },
  }
})

vi.mock('../../src/main/database', () => ({
  getPortableDataDir: () => '/tmp/pulse-test-auth-bf',
}))

vi.mock('../../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

import {
  setupPassword,
  verifyAndUnlock,
  getLoginLockoutRemaining,
} from '../../src/main/auth'

const TEST_PASSWORD = 'correct-password-12345678'
const WRONG_PASSWORD = 'wrong-password-xxxxxxxxx'

beforeEach(() => {
  for (const key of Object.keys(storeData)) {
    delete storeData[key]
  }
})

describe('Lockout escalation thresholds', () => {
  it('no lockout before 5 failures', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    for (let i = 0; i < 4; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }
    expect(getLoginLockoutRemaining()).toBe(0)
  })

  it('30-second lockout after 5 failures', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    for (let i = 0; i < 5; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }
    const remaining = getLoginLockoutRemaining()
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(30)
  })

  it('60-second lockout after 10 failures', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    // Set state to 9 failures, clear lockout so 10th goes through
    storeData['failed_attempts'] = 9
    storeData['lockout_until'] = 0
    await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    const remaining = getLoginLockoutRemaining()
    expect(remaining).toBeGreaterThan(30)
    expect(remaining).toBeLessThanOrEqual(60)
  })

  it('5-minute lockout after 15 failures', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    storeData['failed_attempts'] = 14
    storeData['lockout_until'] = 0
    await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    const remaining = getLoginLockoutRemaining()
    expect(remaining).toBeGreaterThan(60)
    expect(remaining).toBeLessThanOrEqual(300)
  })
})

describe('Lockout recovery', () => {
  it('correct password works after lockout expires', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    for (let i = 0; i < 5; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }
    // Simulate lockout expiry
    storeData['lockout_until'] = Date.now() - 1000
    await expect(verifyAndUnlock(TEST_PASSWORD)).resolves.toHaveProperty('failedAttempts')
  })

  it('counter resets on success, subsequent failures start fresh', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    // 4 failures
    for (let i = 0; i < 4; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }
    // Success resets
    await verifyAndUnlock(TEST_PASSWORD)
    // 4 more failures should still not lock out (counter reset)
    for (let i = 0; i < 4; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }
    expect(getLoginLockoutRemaining()).toBe(0)
  })

  it('even correct password is rejected during active lockout', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    for (let i = 0; i < 5; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }
    expect(getLoginLockoutRemaining()).toBeGreaterThan(0)
    await expect(verifyAndUnlock(TEST_PASSWORD)).rejects.toThrow('Too many failed attempts')
  })
})

describe('MAX_LOCKOUT_MS cap', () => {
  it('lockout_until is capped at 30 minutes from now', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    // Set a corrupted lockout far in the future (simulates clock skew or data corruption)
    storeData['lockout_until'] = Date.now() + 999_999_999
    const remaining = getLoginLockoutRemaining()
    // Should be capped at 30 minutes (1800 seconds)
    expect(remaining).toBeLessThanOrEqual(1800)
  })
})

describe('Edge cases', () => {
  it('lockout_until in the past means no lockout', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    storeData['lockout_until'] = Date.now() - 60_000
    expect(getLoginLockoutRemaining()).toBe(0)
    await expect(verifyAndUnlock(TEST_PASSWORD)).resolves.toHaveProperty('failedAttempts')
  })

  it('failed_attempts persists across multiple setup calls', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    storeData['failed_attempts'] = 4
    storeData['lockout_until'] = 0
    // One more failure should trigger lockout
    await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    expect(getLoginLockoutRemaining()).toBeGreaterThan(0)
  })

  it('empty password rejected at setup', async () => {
    await expect(setupPassword('', '', '/tmp/test.db')).rejects.toThrow('cannot be empty')
  })

  it('short password rejected at setup', async () => {
    await expect(setupPassword('short', '', '/tmp/test.db')).rejects.toThrow('at least 12 characters')
  })

  it('11-char password rejected at setup', async () => {
    await expect(setupPassword('abcdefgh-11', '', '/tmp/test.db')).rejects.toThrow('at least 12 characters')
  })

  it('12-char password accepted at setup', async () => {
    await expect(setupPassword('abcdefgh-123', '', '/tmp/test.db')).resolves.toBeUndefined()
  })

  it('lockout message format includes seconds', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')
    for (let i = 0; i < 5; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }
    try {
      await verifyAndUnlock(WRONG_PASSWORD)
    } catch (e) {
      expect((e as Error).message).toMatch(/Try again in \d+ second/)
    }
  })
})
