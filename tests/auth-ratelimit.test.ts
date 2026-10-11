/**
 * Auth rate-limiting / lockout tests.
 *
 * The auth module (src/main/auth.ts) implements brute-force protection via:
 *   - LOCKOUT_THRESHOLDS: 5 failures → 30s lockout, 10 → 60s, 15 → 5min
 *   - MAX_LOCKOUT_MS: 30 minutes cap
 *   - State persisted in electron-store (failed_attempts, lockout_until)
 *   - checkAndApplyLockout() blocks attempts during lockout
 *   - recordFailedAttempt() increments counter and sets lockout_until
 *   - resetFailedAttempts() clears on successful auth
 *
 * Since verifyAndUnlock() depends on bcrypt hashes, electron-store, safeStorage,
 * and the full key-wrapping infrastructure, we mock the module boundaries and
 * test the lockout logic by calling the real auth functions through a controlled
 * setup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-memory mock for electron-store — simulates persistent state across calls
const storeData: Record<string, unknown> = {}

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/pulse-test-auth',
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

vi.mock('../src/main/database', () => ({
  getPortableDataDir: () => '/tmp/pulse-test-auth',
}))

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

// Import after mocks are set up
import {
  setupPassword,
  verifyAndUnlock,
  getLoginLockoutRemaining,
  isPasswordSetup,
} from '../src/main/auth'

const TEST_PASSWORD = 'correct-password-12345678'
const WRONG_PASSWORD = 'wrong-password-xxxxxxxxx'

beforeEach(() => {
  // Clear all store data between tests
  for (const key of Object.keys(storeData)) {
    delete storeData[key]
  }
})

describe('Auth Rate Limiting', () => {
  it('wrong password is rejected without lockout on first attempts', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')

    // First wrong attempt should just throw "Incorrect password"
    await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    expect(getLoginLockoutRemaining()).toBe(0) // no lockout yet
  })

  it('correct password succeeds after a few wrong attempts (below threshold)', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')

    // 4 wrong attempts (below the 5-attempt threshold)
    for (let i = 0; i < 4; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }

    // Correct password should still work
    await expect(verifyAndUnlock(TEST_PASSWORD)).resolves.toHaveProperty('failedAttempts')
  })

  it('lockout activates after 5 failed attempts', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')

    // 5 wrong attempts to trigger the first lockout threshold (30 seconds)
    for (let i = 0; i < 5; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }

    // Now we should be locked out
    const remaining = getLoginLockoutRemaining()
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThanOrEqual(30) // 30-second lockout

    // Even correct password should be rejected during lockout
    await expect(verifyAndUnlock(TEST_PASSWORD)).rejects.toThrow('Too many failed attempts')
  })

  it('lockout message includes remaining seconds', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')

    for (let i = 0; i < 5; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }

    await expect(verifyAndUnlock(TEST_PASSWORD)).rejects.toThrow(/Too many failed attempts.*Try again in \d+ second/)
  })

  it('lockout escalates with more failures (10 attempts → 60s)', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')

    // Simulate 10 failures by directly setting store state
    // (avoids waiting for the first lockout to expire)
    storeData['failed_attempts'] = 9
    storeData['lockout_until'] = 0 // clear any lockout so the 10th attempt goes through

    await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')

    // After 10 failures, lockout should be ~60 seconds
    const remaining = getLoginLockoutRemaining()
    expect(remaining).toBeGreaterThan(30) // more than the 30s from 5-attempt threshold
    expect(remaining).toBeLessThanOrEqual(60)
  })

  it('successful login resets failed attempt counter', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')

    // 3 wrong attempts
    for (let i = 0; i < 3; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }

    // Successful login
    await verifyAndUnlock(TEST_PASSWORD)

    // Counter should be reset — 4 more wrong attempts should not trigger lockout
    // (would have been 7 total without reset, which is above the 5-attempt threshold)
    for (let i = 0; i < 4; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }

    // Still no lockout (only 4 since reset)
    expect(getLoginLockoutRemaining()).toBe(0)
  })

  it('correct password works after lockout expires', async () => {
    await setupPassword(TEST_PASSWORD, '', '/tmp/test.db')

    // Trigger lockout
    for (let i = 0; i < 5; i++) {
      await expect(verifyAndUnlock(WRONG_PASSWORD)).rejects.toThrow('Incorrect password')
    }

    // Simulate lockout expiry by setting lockout_until to the past
    storeData['lockout_until'] = Date.now() - 1000

    // Now correct password should work
    await expect(verifyAndUnlock(TEST_PASSWORD)).resolves.toHaveProperty('failedAttempts')
  })

  it('password too short is rejected during setup', async () => {
    await expect(setupPassword('short', '', '/tmp/test.db')).rejects.toThrow('at least 12 characters')
  })

  it('empty password is rejected during setup', async () => {
    await expect(setupPassword('', '', '/tmp/test.db')).rejects.toThrow('cannot be empty')
  })
})
