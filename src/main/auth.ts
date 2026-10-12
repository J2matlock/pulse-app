/**
 * auth.ts — Password hashing, key derivation, and key wrapping.
 *
 * Key wrapping pattern (same as BitLocker/FileVault/LUKS):
 *   1. Random 256-bit DB encryption key is generated once.
 *   2. User's password derives a wrapping key via PBKDF2.
 *   3. The wrapping key encrypts the DB key → stored in electron-store.
 *   4. Optional recovery key does the same, stored as a second wrapped copy.
 *   5. On unlock: either password or recovery key unwraps the DB key.
 *   6. A plain password change only re-wraps the stored key. "Change password and
 *      re-encrypt" (P-001) gives the DB a new random key: the new key is first saved,
 *      wrapped by the new password, in a pending slot next to the current one; then
 *      the DB is rekeyed; then pending replaces current in one write. Unlock tries
 *      current, then pending, so a crash at any point leaves a DB that opens with
 *      the old or the new password (see key-switch.ts).
 */

import * as crypto from 'crypto'
import bcrypt from 'bcryptjs'
import Store from 'electron-store'
import { safeStorage, dialog, clipboard } from 'electron'
import { existsSync, renameSync, copyFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { getPortableDataDir } from './data-dir'
import { ensurePrivateDir, privateStoreOptions, tightenStore } from './private-files'
import { logger } from './logger'
import { logNonFatal } from './ipc/ipc-utils'
import { checkNewPassword } from '../shared/passwordPolicy'
import { KEYRING_UNAVAILABLE } from '../shared/authErrors'

/**
 * bcrypt silently truncates passwords at 72 bytes. Pre-hash with SHA-256 for longer
 * passwords. Standard "bcrypt + prehash" pattern (Dropbox et al.).
 */
export function normalizePassword(password: string): string {
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return crypto.createHash('sha256').update(password).digest('hex')
  }
  return password
}

/** Enforce the new-password policy (only when a password is being set, never on unlock). */
function assertNewPasswordOk(password: string): void {
  const check = checkNewPassword(password ?? '')
  if (!check.ok) throw new Error(check.message)
}

/**
 * Forms of a user-typed password to try when verifying. Credentials created
 * before normalization existed (<= v1.1.6) used the raw >72-byte password, so
 * those users must still be able to unlock; they're migrated on success.
 */
function passwordCandidates(password: string): Array<{ value: string; legacy: boolean }> {
  const normalized = normalizePassword(password)
  return normalized === password
    ? [{ value: password, legacy: false }]
    : [{ value: normalized, legacy: false }, { value: password, legacy: true }]
}

// We store everything security-related in electron-store (outside the encrypted DB)
interface SecureStore {
  password_hash: string        // bcrypt hash for quick pre-validation
  password_hint: string        // user-set hint (optional)
  salt_password: string        // hex — salt for password PBKDF2
  wrapped_db_key_password: string  // hex — DB key encrypted by password-derived key
  salt_recovery: string        // hex — salt for recovery key PBKDF2 (if enabled)
  wrapped_db_key_recovery: string  // hex — DB key encrypted by recovery-derived key (if enabled)
  recovery_key_hash: string    // bcrypt hash of recovery key for pre-validation
  // Pending slot (P-001): the new DB key wrapped by the new password, present only
  // while a re-encrypt is in progress or was cut short by a crash
  pending_password_hash: string
  pending_password_hint: string
  pending_salt_password: string
  pending_wrapped_db_key_password: string
  db_path: string
}

const HEX64 = /^[0-9a-f]{64}$/

const PENDING_FIELDS = ['pending_password_hash', 'pending_password_hint', 'pending_salt_password', 'pending_wrapped_db_key_password'] as const
const RECOVERY_FIELDS = ['recovery_key_hash', 'salt_recovery', 'wrapped_db_key_recovery'] as const

const dataDir = getPortableDataDir()
ensurePrivateDir(dataDir)

const SECURE_STORE_NAME = 'pulse-secure'
const secureStorePath = join(dataDir, `${SECURE_STORE_NAME}.json`)
// Last-known-good copy, refreshed after every credential write. Holds the same
// (safeStorage-wrapped) values as the live file, so it adds no new exposure.
const secureStoreBackupPath = join(dataDir, `${SECURE_STORE_NAME}.backup.json`)

/**
 * Move an unreadable credential file aside. NEVER delete it: it holds the only
 * wrapped copy of the DB key, and deleting it makes the database and every
 * backup permanently unreadable.
 */
function quarantineSecureStore(): void {
  try {
    if (existsSync(secureStorePath)) renameSync(secureStorePath, join(dataDir, `${SECURE_STORE_NAME}.corrupt-${Date.now()}.json`))
  } catch (err) { logNonFatal('auth', 'Failed to quarantine corrupt pulse-secure.json', err) }
}

const store = (() => {
  try {
    return tightenStore(new Store<SecureStore>(privateStoreOptions(SECURE_STORE_NAME, dataDir)))
  } catch (err) {
    logger.error('auth', 'pulse-secure.json is unreadable — quarantining and trying the backup copy', err)
    quarantineSecureStore()
    if (existsSync(secureStoreBackupPath)) {
      try {
        copyFileSync(secureStoreBackupPath, secureStorePath)
        return tightenStore(new Store<SecureStore>(privateStoreOptions(SECURE_STORE_NAME, dataDir)))
      } catch (restoreErr) {
        logger.error('auth', 'Backup copy of pulse-secure.json is also unreadable', restoreErr)
        quarantineSecureStore()
      }
    }
    return tightenStore(new Store<SecureStore>(privateStoreOptions(SECURE_STORE_NAME, dataDir)))
  }
})()

/** Refresh the last-known-good copy of the credential file (atomic tmp + rename). */
function snapshotSecureStore(): void {
  try {
    if (!existsSync(secureStorePath)) return
    const tmp = secureStoreBackupPath + '.tmp'
    copyFileSync(secureStorePath, tmp)
    renameSync(tmp, secureStoreBackupPath)
    try { chmodSync(secureStoreBackupPath, 0o600) } catch { /* expected on Windows */ }
  } catch (err) { logNonFatal('auth', 'Failed to snapshot pulse-secure.json', err) }
}

/** Plain words (audit F-36): what's missing, what it means, and that the data is still safe */
export const KEYRING_MISSING_MESSAGE =
  "This computer doesn't offer its own password vault, so Pulse's lock is a little weaker here. " +
  'Your data is still encrypted. If someone who looks after this computer can turn on a password vault ' +
  '(on Linux, a "keyring"), Pulse will use it.'

// Check OS-level credential encryption after app is ready.
// Must be called from index.ts inside app.whenReady() — calling safeStorage
// before ready returns false on Windows even though DPAPI is available.
export function checkSafeStorageAvailability(): void {
  // Skip dialog in E2E test mode to avoid blocking the test runner
  if (process.env.NODE_ENV === 'test') return
  if (!safeStorage.isEncryptionAvailable() && !store.get('safeStorage_warning_shown' as never)) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'A note about your lock',
      message: KEYRING_MISSING_MESSAGE,
    })
    store.set('safeStorage_warning_shown' as never, true as never)
  }
}

// OS-level encryption helpers — encrypts sensitive values using the OS keychain
// (macOS Keychain, Windows DPAPI, Linux libsecret/kwallet).
// Backward-compatible: plaintext values are read as-is; only new writes are encrypted.
const ENC_PREFIX = 'enc:'

/** Prepare a value for secure storage (encrypt if available) without writing. */
function secureValue(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value)
    return `${ENC_PREFIX}${encrypted.toString('base64')}`
  }
  return value
}

function secureGet(key: keyof SecureStore, fallback = ''): string {
  const raw = store.get(key, fallback as never) as string
  if (typeof raw === 'string' && raw.startsWith(ENC_PREFIX)) {
    // The value was encrypted by the OS vault, which isn't available right now
    // (e.g. the Linux keyring isn't unlocked yet). Handing back the "enc:..." text
    // would make the right password look wrong and count toward lockout (AUDIT-021).
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn('auth', `OS password vault unavailable; can't read ${key}`)
      throw new Error(KEYRING_UNAVAILABLE)
    }
    try {
      const buf = Buffer.from(raw.slice(ENC_PREFIX.length), 'base64')
      return safeStorage.decryptString(buf)
    } catch (err) {
      logger.error('auth', 'safeStorage.decryptString failed', err)
      throw new Error(CREDENTIALS_UNREADABLE)
    }
  }
  return raw
}

export const CREDENTIALS_UNREADABLE =
  "This computer can't read Pulse's saved sign-in data. This happens when the data folder was copied from another computer or another computer account. Use \"Restore from a backup\" to open a .pulse-backup file with your password or recovery key."

/** True when credentials exist but this machine's OS keystore can't decrypt them. */
export function areCredentialsUnreadable(): boolean {
  if (!isPasswordSetup()) return false
  try {
    secureGet('wrapped_db_key_password')
    return false
  } catch (err) {
    // A vault that isn't ready yet is not a folder from another computer: don't offer a restore
    return !(err instanceof Error && err.message === KEYRING_UNAVAILABLE)
  }
}

// Keys that get OS-level encryption (password_hash, wrapped keys, recovery hash)
// Salts and hints don't need encryption (salts are public by design).

// The live DB key, held in memory only while the app is unlocked.
// Stored as a Buffer so it can be zeroed on lock (strings are immutable in JS).
let liveDbKey: Buffer | null = null

/**
 * The only way to replace liveDbKey: the old Buffer is zeroed first, so an unlock
 * while already unlocked (change password, factory reset) or a restore doesn't
 * leave an extra copy of the key for GC (AUDIT-098). Callers of getDbKey() turn it
 * into hex straight away and never keep the Buffer, so zeroing it is safe.
 */
function setLiveKey(next: Buffer | null): void {
  if (liveDbKey && liveDbKey !== next) liveDbKey.fill(0)
  liveDbKey = next
}

/**
 * Which stored slot the live key came from, and the other keys the typed password
 * unwrapped (P-001). After a re-encrypt cut short by a crash the password can open
 * both the current slot (old key) and the pending one (new key), and only opening
 * the database tells which key it has: the caller tries the live key, then
 * tryNextUnlockKey(), then settles with settleUnlockedKey().
 */
type KeySlot = 'current' | 'pending' | 'recovery'
let liveKeySlot: KeySlot | null = null
let spareUnlockKeys: Array<{ slot: KeySlot; key: Buffer }> = []

function clearSpareUnlockKeys(): void {
  for (const s of spareUnlockKeys) s.key.fill(0)
  spareUnlockKeys = []
}

// Set right after first-run setup or a recovery-key unlock, cleared on lock.
// Lets those flows create a recovery key / reset the password without asking
// for a password the user just typed (or has forgotten). Everywhere else,
// changing recovery credentials requires re-entering the current password.
// The setup grace only covers the setup step itself (A24-10): someone at the
// machine later in that first session can't revoke or replace the recovery key.
// The recovery grace ends once the new password is set.
let credentialGrace: 'setup' | 'recovery' | null = null
let setupGraceUntil = 0
export const SETUP_GRACE_MS = 10 * 60 * 1000

function hasCredentialGrace(): boolean {
  if (credentialGrace === 'recovery') return true
  return credentialGrace === 'setup' && Date.now() < setupGraceUntil
}

// Brute-force protection: persist failed attempt state across restarts
const MAX_LOCKOUT_MS = 30 * 60 * 1000 // 30 minutes max (prevents permanent lockout from corrupted state)
const LOCKOUT_THRESHOLDS = [
  { attempts: 5, delayMs: 30_000 },   // 30 seconds after 5 failures
  { attempts: 10, delayMs: 60_000 },  // 1 minute after 10
  { attempts: 15, delayMs: 300_000 }, // 5 minutes after 15
]

function _getFailedAttempts(): number { return store.get('failed_attempts' as never, 0 as never) as number }
function _getLockoutUntil(): number {
  const v = store.get('lockout_until' as never, 0 as never) as number
  // Safety cap: never lock out beyond 30 minutes from now
  return Math.min(v, Date.now() + MAX_LOCKOUT_MS)
}

export function getLoginLockoutRemaining(): number {
  const lockoutUntil = _getLockoutUntil()
  if (lockoutUntil <= Date.now()) return 0
  return Math.ceil((lockoutUntil - Date.now()) / 1000)
}

function checkAndApplyLockout(): string | null {
  const lockoutUntil = _getLockoutUntil()
  if (lockoutUntil > Date.now()) {
    const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000)
    return `Too many failed attempts. Try again in ${remaining} second${remaining !== 1 ? 's' : ''}.`
  }
  return null
}

function recordFailedAttempt(): void {
  const failedAttempts = _getFailedAttempts() + 1
  store.set('failed_attempts' as never, failedAttempts as never)
  for (let i = LOCKOUT_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = LOCKOUT_THRESHOLDS[i]!
    if (failedAttempts >= threshold.attempts) {
      store.set('lockout_until' as never, (Date.now() + threshold.delayMs) as never)
      break
    }
  }
}

function resetFailedAttempts(): void {
  store.set('failed_attempts' as never, 0 as never)
  store.set('lockout_until' as never, 0 as never)
}

// NOTE: Callers convert the returned Buffer to a hex string for SQLCipher pragma.
// JS strings are immutable and cannot be zeroed from memory. The hex string will persist
// until GC. This is an inherent limitation of the JS runtime and is mitigated by:
// 1. The string is only created during unlock (not stored in a variable long-term)
// 2. Locking the app clears the Buffer reference (lockApp zeros liveDbKey)
// 3. Exploiting this requires local memory access (physical machine compromise)
export function getDbKey(): Buffer {
  if (!liveDbKey) throw new Error('Database is locked')
  return liveDbKey
}

export function isPasswordSetup(): boolean {
  return store.has('password_hash')
}

export function hasRecoveryKey(): boolean {
  return store.has('recovery_key_hash')
}

// Known limitation: when safeStorage.isEncryptionAvailable() is false (e.g., Linux
// without gnome-keyring/kwallet), the password hint is stored as plaintext in the
// electron-store JSON file. The checkSafeStorageAvailability() dialog warns users
// about this on first launch.
export function getPasswordHint(): string {
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn('auth', 'Password hint retrieved without OS-level encryption — hint is stored in plaintext')
  }
  try {
    return secureGet('password_hint', '')
  } catch (err) {
    // Still encrypted: show no hint rather than "enc:..." or an error
    if (err instanceof Error && err.message === KEYRING_UNAVAILABLE) return ''
    throw err
  }
}


/**
 * First-time setup: create password, generate random DB key, wrap and store everything.
 * Returns the raw DB key so the caller can immediately open the database.
 */
export async function setupPassword(
  password: string,
  hint: string,
  dbPath: string
): Promise<void> {
  if (!password) {
    throw new Error('Password cannot be empty')
  }
  assertNewPasswordOk(password)

  // Generate the random 256-bit DB encryption key
  await writePasswordCredentials(crypto.randomBytes(32), password, hint, dbPath)
  logger.info('auth', 'Password setup complete')
}

/**
 * Wrap `dbKey` with a (raw, user-typed) password and persist a fresh credential
 * set. Used by first-run setup and by restoring a backup on a new computer,
 * where the DB key comes from the backup's key envelope instead.
 */
async function writePasswordCredentials(
  dbKey: Buffer,
  password: string,
  hint: string,
  dbPath: string,
  recovery?: { salt: string; wrapped: string; hash: string }
): Promise<void> {
  commitPasswordCredentials(dbKey, await preparePasswordCredentials(dbKey, password, hint, dbPath, recovery))
}

/**
 * Work out every stored value for a credential set without writing anything.
 * The slow and fallible steps (bcrypt, PBKDF2, the OS vault) all happen here,
 * so a caller can finish them before it clears the credentials it replaces.
 */
async function preparePasswordCredentials(
  dbKey: Buffer,
  password: string,
  hint: string,
  dbPath: string,
  recovery?: { salt: string; wrapped: string; hash: string }
): Promise<Partial<SecureStore>> {
  const normalized = normalizePassword(password)
  // Hash password for quick validation (bcrypt, 12 rounds)
  const passwordHash = await bcrypt.hash(normalized, 12)
  // Derive wrapping key from password via PBKDF2, then wrap the DB key
  const saltPassword = crypto.randomBytes(32)
  const wrapKey = await deriveWrappingKey(normalized, saltPassword)
  const wrappedDbKey = wrapKey256(dbKey.toString('hex'), wrapKey)
  return {
    password_hash: secureValue(passwordHash),
    password_hint: secureValue(hint),
    salt_password: saltPassword.toString('hex'),
    wrapped_db_key_password: secureValue(wrappedDbKey),
    db_path: dbPath,
    ...(recovery ? {
      recovery_key_hash: secureValue(recovery.hash),
      salt_recovery: recovery.salt,
      wrapped_db_key_recovery: secureValue(recovery.wrapped),
    } : {}),
  }
}

function commitPasswordCredentials(dbKey: Buffer, values: Partial<SecureStore>): void {
  // Atomic write: batch all credential keys into a single store.set() call
  // to prevent inconsistent state if the app crashes mid-write.
  store.set(values)

  // Restrict file permissions so wrapped key material isn't world-readable (0600 = owner only)
  if (process.platform !== 'win32' && existsSync(secureStorePath)) {
    try { chmodSync(secureStorePath, 0o600) } catch (err) { logNonFatal('auth', 'chmod 0600 on secure store failed', err) }
  }
  snapshotSecureStore()

  setLiveKey(Buffer.from(dbKey))
  clearSpareUnlockKeys()
  liveKeySlot = 'current'
  credentialGrace = 'setup'
  setupGraceUntil = Date.now() + SETUP_GRACE_MS
}

/** Re-check the current password without touching liveDbKey (for sensitive settings changes). */
async function confirmCurrentPassword(password: unknown): Promise<void> {
  if (hasCredentialGrace()) return
  if (typeof password !== 'string' || password.length === 0) throw new Error('Enter your current password to continue')
  const lockoutMsg = checkAndApplyLockout()
  if (lockoutMsg) throw new Error(lockoutMsg)
  const hash = secureGet('password_hash')
  for (const candidate of passwordCandidates(password)) {
    if (await bcrypt.compare(candidate.value, hash)) { resetFailedAttempts(); return }
  }
  recordFailedAttempt()
  throw new Error('Incorrect password')
}

/**
 * Verify password and unlock: unwrap the DB key.
 */
/**
 * Verify password and unlock. Returns how many wrong attempts happened since the
 * last successful unlock, so the user can spot someone guessing their password.
 */
export async function verifyAndUnlock(password: string): Promise<{ failedAttempts: number }> {
  const lockoutMsg = checkAndApplyLockout()
  if (lockoutMsg) {
    logger.warn('auth', 'Account locked', { failedAttempts: _getFailedAttempts() })
    throw new Error(lockoutMsg)
  }

  const hash = secureGet('password_hash')
  if (!hash) throw new Error('No password set')

  let match: { value: string; legacy: boolean } | undefined
  for (const candidate of passwordCandidates(password)) {
    if (await bcrypt.compare(candidate.value, hash)) { match = candidate; break }
  }
  // A re-encrypt cut short (P-001): the new password opens the pending slot
  const pendingKey = hasPendingKeySwitch() ? await unwrapPendingSlot(password) : null
  if (!match && !pendingKey) {
    recordFailedAttempt()
    const attempts = _getFailedAttempts()
    logger.warn('auth', 'Unlock failed: invalid password', { failedAttempts: attempts })
    throw new Error('Incorrect password')
  }

  const failedAttempts = _getFailedAttempts()
  let currentKey: Buffer | null = null
  if (match) {
    try {
      currentKey = await unwrapCurrentSlot(match.value)
    } catch (err) {
      if (!pendingKey) {
        // A pre-1.1.7 hash is bcrypt over the raw password, which only looks at its
        // first 72 bytes: a different password sharing them passes bcrypt, and only
        // the key unwrap tells them apart. That's a wrong password, not an error (A24-09).
        if (!match.legacy || isSaltError(err)) throw err
        recordFailedAttempt()
        logger.warn('auth', 'Unlock failed: invalid password', { failedAttempts: _getFailedAttempts() })
        throw new Error('Incorrect password')
      }
      logNonFatal('auth', 'current slot did not unwrap; trying the pending slot', err)
    }
  }
  resetFailedAttempts()

  // Current first: if the rekey never finished, opening with the old key also rolls back its journal
  const candidates: Array<{ slot: KeySlot; key: Buffer }> = []
  if (currentKey) candidates.push({ slot: 'current', key: currentKey })
  if (pendingKey) candidates.push({ slot: 'pending', key: pendingKey })
  const [first, ...rest] = candidates
  if (!first) throw new Error('Incorrect password')
  clearSpareUnlockKeys()
  setLiveKey(first.key)
  liveKeySlot = first.slot
  spareUnlockKeys = rest
  if (!existsSync(secureStoreBackupPath)) snapshotSecureStore()
  logger.info('auth', 'Unlock successful')

  if (match?.legacy && liveKeySlot === 'current') {
    // Re-wrap under the normalized form so future unlocks take the fast path
    try {
      await rewrapPassword(password, secureGet('password_hint', ''))
      logger.info('auth', 'Migrated long-password credentials to normalized form')
    } catch (err) { logNonFatal('auth', 'legacy long-password migration', err) }
  }
  return { failedAttempts }
}

const SALT_CORRUPT = 'Stored password salt is missing or corrupted. Restore from backup or use your recovery key.'

function isSaltError(err: unknown): boolean {
  return err instanceof Error && err.message === SALT_CORRUPT
}

/** Unwrap the current slot's DB key with a password form that passed bcrypt. */
async function unwrapCurrentSlot(passwordForm: string): Promise<Buffer> {
  const saltHex = store.get('salt_password') as string
  if (!saltHex || !/^[0-9a-f]{64}$/.test(saltHex)) {
    logger.error('auth', 'Password salt missing or corrupted')
    throw new Error(SALT_CORRUPT)
  }
  const wrapKey = await deriveWrappingKey(passwordForm, Buffer.from(saltHex, 'hex'))
  return Buffer.from(unwrapKey256(secureGet('wrapped_db_key_password'), wrapKey), 'hex')
}

// ── Re-encrypt key switch (P-001) ────────────────────────────────────────────

export function hasPendingKeySwitch(): boolean {
  return store.has('pending_wrapped_db_key_password')
}

/** The pending slot's DB key if `password` opens it, else null (never counts as a failed attempt by itself). */
async function unwrapPendingSlot(password: string): Promise<Buffer | null> {
  try {
    // Written by this version only, so always the normalized form
    const normalized = normalizePassword(password)
    const hash = secureGet('pending_password_hash')
    if (!hash || !(await bcrypt.compare(normalized, hash))) return null
    const saltHex = store.get('pending_salt_password') as string
    if (!saltHex || !HEX64.test(saltHex)) return null
    const wrapKey = await deriveWrappingKey(normalized, Buffer.from(saltHex, 'hex'))
    const rawDbKey = unwrapKey256(secureGet('pending_wrapped_db_key_password'), wrapKey)
    return HEX64.test(rawDbKey) ? Buffer.from(rawDbKey, 'hex') : null
  } catch (err) {
    if (err instanceof Error && err.message === KEYRING_UNAVAILABLE) throw err
    logNonFatal('auth', 'unwrap pending credential slot', err)
    return null
  }
}

/**
 * Replace the whole credential file in one write (atomic temp + rename in conf),
 * so a crash can't leave half a slot: electron-store's delete() writes once per key.
 */
function replaceSecureStore(edit: (values: Record<string, unknown>) => void): void {
  const next = { ...(store.store as unknown as Record<string, unknown>) }
  edit(next)
  store.store = next as unknown as SecureStore
  snapshotSecureStore()
}

/**
 * The live key didn't open the database: switch to the next key the password
 * unwrapped. False when there is none left.
 */
export function tryNextUnlockKey(): boolean {
  const next = spareUnlockKeys.shift()
  if (!next) return false
  setLiveKey(next.key)
  liveKeySlot = next.slot
  return true
}

/**
 * The database is open with the live key: finish or drop a re-encrypt that a
 * crash cut short. Opened with the pending key → the rekey finished, so pending
 * becomes current (and the recovery slot, which wraps the old key, goes). Opened
 * with the current or recovery key → the rekey never happened (or was rolled
 * back), so the pending slot is dropped.
 */
export function settleUnlockedKey(): void {
  clearSpareUnlockKeys()
  if (!hasPendingKeySwitch()) return
  if (liveKeySlot === 'pending') {
    promotePendingSlot()
    logger.warn('auth', 'Finished a re-encrypt that was cut short: the new password is now the one in use')
  } else {
    abandonKeySwitch()
    logger.warn('auth', 'Dropped a re-encrypt that was cut short before the data changed')
  }
}

/**
 * Step 1 of a re-encrypt: save `newKey` wrapped by `newPassword` in the pending
 * slot, next to the current one, in one write. All the slow and fallible work
 * (bcrypt, PBKDF2, the OS vault) happens before that write. The caller checks
 * the password policy (revoking with re-encrypt keeps the current password).
 */
export async function beginKeySwitch(newKey: Buffer, newPassword: string, newHint: string): Promise<void> {
  if (!liveDbKey) throw new Error('Database is locked')
  if (newKey.length !== 32) throw new Error('Invalid database key format')
  const normalized = normalizePassword(newPassword)
  const passwordHash = await bcrypt.hash(normalized, 12)
  const saltPassword = crypto.randomBytes(32)
  const wrapKey = await deriveWrappingKey(normalized, saltPassword)
  const wrapped = wrapKey256(newKey.toString('hex'), wrapKey)
  store.set({
    pending_password_hash: secureValue(passwordHash),
    pending_password_hint: secureValue(newHint),
    pending_salt_password: saltPassword.toString('hex'),
    pending_wrapped_db_key_password: secureValue(wrapped),
  })
  snapshotSecureStore()
}

function promotePendingSlot(): void {
  replaceSecureStore(v => {
    v.password_hash = v.pending_password_hash
    v.password_hint = v.pending_password_hint
    v.salt_password = v.pending_salt_password
    v.wrapped_db_key_password = v.pending_wrapped_db_key_password
    for (const k of PENDING_FIELDS) delete v[k]
    // The recovery slot wraps the old key, which no longer opens anything
    for (const k of RECOVERY_FIELDS) delete v[k]
  })
  liveKeySlot = 'current'
}

/** Step 3: the database now has `newKey`; pending becomes current in one write. */
export function finishKeySwitch(newKey: Buffer): void {
  if (!hasPendingKeySwitch()) throw new Error('No re-encrypt in progress')
  promotePendingSlot()
  setLiveKey(Buffer.from(newKey))
  logger.info('auth', 'Database re-encrypted with a new key')
}

/** The database still has the current key: drop the pending slot (one write). */
export function abandonKeySwitch(): void {
  if (!hasPendingKeySwitch()) return
  replaceSecureStore(v => { for (const k of PENDING_FIELDS) delete v[k] })
}

/** Re-wrap the live DB key under a (raw, user-typed) password. Recovery key unaffected. */
async function rewrapPassword(newPassword: string, newHint: string): Promise<void> {
  if (!liveDbKey) throw new Error('Database is locked')
  const normalized = normalizePassword(newPassword)
  const passwordHash = await bcrypt.hash(normalized, 12)
  const saltPassword = crypto.randomBytes(32)
  const wrapKey = await deriveWrappingKey(normalized, saltPassword)
  const wrappedDbKey = wrapKey256(liveDbKey.toString('hex'), wrapKey)

  // Atomic write: batch all credential keys into a single store.set() call
  // to prevent inconsistent state if the app crashes mid-write.
  store.set({
    password_hash: secureValue(passwordHash) as never,
    password_hint: secureValue(newHint) as never,
    salt_password: saltPassword.toString('hex') as never,
    wrapped_db_key_password: secureValue(wrappedDbKey) as never,
  })
  snapshotSecureStore()
}

/**
 * Generate a recovery key, wrap the DB key with it, and store.
 * Returns the recovery key string for display (never stored).
 */
export async function generateRecoveryKey(currentPassword?: string): Promise<string> {
  if (!liveDbKey) throw new Error('Database is locked')
  await confirmCurrentPassword(currentPassword)

  const recoveryKey = generateRecoveryKeyString()
  const recoveryHash = await bcrypt.hash(recoveryKey, 12)

  const saltRecovery = crypto.randomBytes(32)
  const wrapKey = await deriveWrappingKey(recoveryKey, saltRecovery)
  const wrappedDbKey = wrapKey256(liveDbKey.toString('hex'), wrapKey)

  // Atomic write: batch all recovery credential keys into a single store.set() call
  store.set({
    recovery_key_hash: secureValue(recoveryHash) as never,
    salt_recovery: saltRecovery.toString('hex') as never,
    wrapped_db_key_recovery: secureValue(wrappedDbKey) as never,
  })
  snapshotSecureStore()

  logger.info('auth', 'Recovery key generated')
  return recoveryKey
}

/**
 * Unlock via recovery key. On success, prompts user for new password (caller's responsibility).
 * Returns the raw DB key.
 */
export async function verifyAndUnlockRecovery(recoveryKey: string): Promise<void> {
  const lockoutMsg = checkAndApplyLockout()
  if (lockoutMsg) {
    logger.warn('auth', 'Account locked during recovery attempt', { failedAttempts: _getFailedAttempts() })
    throw new Error(lockoutMsg)
  }

  const hash = secureGet('recovery_key_hash')
  if (!hash) throw new Error('No recovery key configured')

  const valid = await bcrypt.compare(recoveryKey, hash)
  if (!valid) {
    recordFailedAttempt()
    logger.warn('auth', 'Recovery unlock failed: invalid recovery key', { failedAttempts: _getFailedAttempts() })
    throw new Error('Incorrect recovery key')
  }
  resetFailedAttempts()

  const saltHex = store.get('salt_recovery') as string
  if (!saltHex || !/^[0-9a-f]{64}$/.test(saltHex)) {
    logger.error('auth', 'Recovery salt missing or corrupted')
    throw new Error('Stored recovery salt is missing or corrupted. Contact support.')
  }
  const salt = Buffer.from(saltHex, 'hex')
  const wrapKey = await deriveWrappingKey(recoveryKey, salt)
  const wrapped = secureGet('wrapped_db_key_recovery')
  const rawDbKey = unwrapKey256(wrapped, wrapKey)

  clearSpareUnlockKeys()
  setLiveKey(Buffer.from(rawDbKey, 'hex'))
  liveKeySlot = 'recovery'
  credentialGrace = 'recovery'
  logger.info('auth', 'Recovery unlock successful')
}

/**
 * Change password: unwrap with old, re-wrap with new. Recovery key unaffected.
 */
export async function changePassword(oldPassword: string, newPassword: string, newHint: string): Promise<void> {
  assertNewPasswordOk(newPassword)

  // Verify old password
  await verifyAndUnlock(oldPassword)

  await rewrapPassword(newPassword, newHint)
  logger.info('auth', 'Password changed')
}

/**
 * Reset password after recovery unlock — re-wraps liveDbKey with new password
 * WITHOUT verifying the old password. Only safe because liveDbKey is already in
 * memory from verifyAndUnlockRecovery().
 */
export async function resetPasswordAfterRecovery(newPassword: string, newHint: string): Promise<void> {
  assertNewPasswordOk(newPassword)
  if (!liveDbKey) throw new Error('Database is locked — recovery unlock must happen first')
  // Without this, any unlocked session could replace the password without knowing it
  if (credentialGrace !== 'recovery') throw new Error('Password reset is only available after unlocking with your recovery key')

  await rewrapPassword(newPassword, newHint)
  // The person knows a password again, so later changes ask for it
  credentialGrace = null
  logger.info('auth', 'Password reset via recovery key')
}

/**
 * Revoke the recovery key — password-only access from here on.
 */
export async function revokeRecoveryKey(currentPassword?: string): Promise<void> {
  await confirmCurrentPassword(currentPassword)
  store.delete('recovery_key_hash')
  store.delete('salt_recovery')
  store.delete('wrapped_db_key_recovery')
  snapshotSecureStore()
}

/**
 * Lock the app — wipe the in-memory DB key.
 */
export function lockApp(): void {
  clipboard.clear()
  setLiveKey(null)
  clearSpareUnlockKeys()
  liveKeySlot = null
  credentialGrace = null
  logger.info('auth', 'App locked')
}

export function getStoredDbPath(): string {
  return store.get('db_path', '')
}

export function setStoredDbPath(dbPath: string): void {
  store.set('db_path', dbPath)
}

// ── Portable key envelope (backups) ──────────────────────────────────────────
//
// Backups are encrypted with the DB key, so a backup alone is useless on a new
// computer. Each .pulse-backup therefore carries the DB key wrapped by the
// password and (if set) the recovery key — WITHOUT the OS keystore layer, which
// is tied to one machine/account. A stolen backup still requires the password
// or recovery key (PBKDF2-600k + AES-256-GCM), like any password-protected archive.

export interface KeyEnvelope {
  v: 1
  salt_password: string
  wrapped_db_key_password: string
  salt_recovery?: string
  wrapped_db_key_recovery?: string
  recovery_key_hash?: string
}

/** Current credentials as a portable envelope, or null if unavailable (locked-out keystore, no setup). */
export function getKeyEnvelope(): KeyEnvelope | null {
  try {
    const saltPassword = store.get('salt_password', '') as string
    const wrappedPassword = secureGet('wrapped_db_key_password')
    if (!saltPassword || !wrappedPassword) return null
    const env: KeyEnvelope = { v: 1, salt_password: saltPassword, wrapped_db_key_password: wrappedPassword }
    if (hasRecoveryKey()) {
      env.salt_recovery = store.get('salt_recovery', '') as string
      env.wrapped_db_key_recovery = secureGet('wrapped_db_key_recovery')
      env.recovery_key_hash = secureGet('recovery_key_hash')
    }
    return env
  } catch (err) {
    logNonFatal('auth', 'build key envelope', err)
    return null
  }
}

export function isValidKeyEnvelope(x: unknown): x is KeyEnvelope {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  if (e.v !== 1 || typeof e.salt_password !== 'string' || !HEX64.test(e.salt_password)) return false
  if (typeof e.wrapped_db_key_password !== 'string' || e.wrapped_db_key_password.length > 512) return false
  if (e.salt_recovery !== undefined && (typeof e.salt_recovery !== 'string' || !HEX64.test(e.salt_recovery))) return false
  if (e.wrapped_db_key_recovery !== undefined && (typeof e.wrapped_db_key_recovery !== 'string' || e.wrapped_db_key_recovery.length > 512)) return false
  if (e.recovery_key_hash !== undefined && typeof e.recovery_key_hash !== 'string') return false
  return true
}

/**
 * Unwrap a backup's DB key with the user's old password or recovery key.
 * Tries each form of the password, then the recovery key. Throws 'Incorrect
 * password or recovery key' if nothing matches (GCM auth tag verifies).
 */
export async function unwrapKeyEnvelope(env: KeyEnvelope, secret: string): Promise<Buffer> {
  const attempts: Array<{ salt: string; wrapped: string; value: string }> = []
  for (const c of passwordCandidates(secret)) {
    attempts.push({ salt: env.salt_password, wrapped: env.wrapped_db_key_password, value: c.value })
  }
  if (env.salt_recovery && env.wrapped_db_key_recovery) {
    // Recovery keys are typed with or without dashes/lowercase
    const clean = secret.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    const formatted = clean.replace(/(.{4})(?=.)/g, '$1-')
    attempts.push({ salt: env.salt_recovery, wrapped: env.wrapped_db_key_recovery, value: formatted })
  }
  for (const a of attempts) {
    try {
      const hex = unwrapKey256(a.wrapped, await deriveWrappingKey(a.value, Buffer.from(a.salt, 'hex')))
      if (HEX64.test(hex)) return Buffer.from(hex, 'hex')
    } catch { /* wrong secret for this slot — try the next */ }
  }
  throw new Error('Incorrect password or recovery key')
}

/**
 * Adopt a DB key recovered from a backup as this install's key: wrap it with a
 * new password and carry over the old recovery key (so the printed key keeps
 * working). Any existing, unreadable credential file is quarantined, not deleted.
 */
export async function adoptRestoredDbKey(dbKey: Buffer, env: KeyEnvelope, newPassword: string, hint: string, dbPath: string): Promise<void> {
  assertNewPasswordOk(newPassword)
  const recovery = env.salt_recovery && env.wrapped_db_key_recovery && env.recovery_key_hash
    ? { salt: env.salt_recovery, wrapped: env.wrapped_db_key_recovery, hash: env.recovery_key_hash }
    : undefined
  // Everything that can fail runs before the working credentials are touched: the
  // restore puts the old database back on failure, and its password must still open it (A24-02)
  const values = await preparePasswordCredentials(dbKey, newPassword, hint, dbPath, recovery)
  if (isPasswordSetup()) {
    // Credentials unreadable, or Settings is restoring another Pulse's backup:
    // the old credential file is moved aside, never deleted
    quarantineSecureStore()
    store.clear()
  }
  resetFailedAttempts()
  commitPasswordCredentials(dbKey, values)
  logger.info('auth', 'Credentials rebuilt from backup key envelope', { recoveryCarried: !!recovery })
}

// ── Key derivation helpers ────────────────────────────────────────────────────

async function deriveWrappingKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  // PBKDF2 with SHA-256, 600,000 iterations per NIST SP 800-132 (2023) guidance
  // Async to avoid blocking the main process (~1.5s on mid-range hardware)
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(passphrase, salt, 600_000, 32, 'sha256', (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

function wrapKey256(rawKey: string, wrapKey: Buffer): string {
  // AES-256-GCM encrypt: outputs iv:authTag:ciphertext as hex
  try {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', wrapKey, iv)
    const encrypted = Buffer.concat([cipher.update(rawKey, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
  } finally {
    // Zero the wrapping key from memory after use
    crypto.randomFillSync(wrapKey)
  }
}

function unwrapKey256(wrapped: string, wrapKey: Buffer): string {
  try {
    const parts = wrapped.split(':')
    const ivHex = parts[0] ?? ''
    const authTagHex = parts[1] ?? ''
    const encryptedHex = parts[2] ?? ''
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const encrypted = Buffer.from(encryptedHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-gcm', wrapKey, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString('utf8')
  } finally {
    // Zero the wrapping key from memory after use
    crypto.randomFillSync(wrapKey)
  }
}

function generateRecoveryKeyString(): string {
  // 28 chars, grouped XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (~134 bits entropy)
  // Unambiguous charset: no 0/O, 1/l/I
  const charset = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // length=31
  const limit = 31 * Math.floor(256 / 31) // = 248; reject bytes >= limit to eliminate modulo bias
  let key = ''
  let i = 0
  while (i < 28) {
    const byte = crypto.randomBytes(1)[0]!
    if (byte >= limit) continue
    if (i > 0 && i % 4 === 0) key += '-'
    key += charset[byte % 31]!
    i++
  }
  return key
}
