/**
 * key-switch.ts — "Change password and re-encrypt" (P-001): give the database a
 * new random key, so an old password, a revoked recovery key or an old backup's
 * key envelope no longer opens today's data.
 *
 * Crash safety. The order is:
 *   1. pending slot: the new key wrapped by the new password, saved next to the
 *      current slot in one credential-file write (auth.beginKeySwitch)
 *   2. PRAGMA rekey (database.rekeyDatabase): one rollback-journal transaction
 *   3. pending becomes current in one write (auth.finishKeySwitch)
 * Unlock tries the current slot's key, then the pending one's
 * (openWithUnlockKeys), and settles whichever opened the file. So after a crash:
 *   - before 2 or during 2: the file has the old key (a hot journal from an
 *     interrupted rekey is rolled back by the old key) and the old password opens it
 *   - after 2, before 3: the file has the new key and the new password opens it,
 *     which also finishes step 3
 * Steps 2 and 3 run in the same synchronous stretch, so no other code in this
 * process (a backup reading the key envelope, say) sees the file and the
 * credentials disagree.
 */

import { randomBytes } from 'node:crypto'
import { logger } from './logger'
import { logNonFatal } from './ipc/ipc-utils'
import { checkNewPassword } from '../shared/passwordPolicy'
import {
  openDatabase,
  closeDatabase,
  getDb,
  rekeyDatabase,
  databaseOpensWithKey,
  rekeyDatabaseFile,
  DatabaseOpenError,
} from './database'
import {
  verifyAndUnlock,
  getDbKey,
  getPasswordHint,
  beginKeySwitch,
  finishKeySwitch,
  abandonKeySwitch,
  tryNextUnlockKey,
  settleUnlockedKey,
  lockApp,
} from './auth'
import { runAutoBackup } from './backup'

/** Shown when the rekey failed and everything was put back as it was */
export const REENCRYPT_FAILED_UNCHANGED =
  "Your data couldn't be re-encrypted, so nothing was changed: your password is still the old one. Check that the disk has free space, then try again."

/** Shown when Pulse had to lock after a failed rekey (the slots that may open the file are kept for the next unlock) */
export const REENCRYPT_FAILED_LOCKED =
  "Pulse couldn't finish re-encrypting your data and has locked. Unlock again with your new password, or with your old one if the new one isn't accepted."

/**
 * Open the database after an unlock, trying each key the password unwrapped:
 * the current slot's first, then the pending slot's. Once one opens, a re-encrypt
 * cut short by a crash is finished or dropped. When none opens, the most useful
 * error is thrown: one about a file that opened but couldn't be upgraded beats a
 * wrong-key "unreadable".
 */
export function openWithUnlockKeys(open: () => void = openDatabase): void {
  let firstErr: unknown = null
  let informativeErr: unknown = null
  for (;;) {
    try {
      open()
      settleUnlockedKey()
      return
    } catch (err) {
      firstErr ??= err
      if (!(err instanceof DatabaseOpenError && err.kind === 'unreadable')) informativeErr ??= err
      if (!tryNextUnlockKey()) throw informativeErr ?? firstErr
    }
  }
}

export interface KeySwitchOptions {
  /** The rekey step; tests swap it to make it fail. Defaults to rekeying the open database. */
  rekey?: (newHexKey: string) => void
}

export type KeySwitchResult = 'switched' | 'locked'

/** Change the password and give the database a new key. Throws 'Incorrect password' for a wrong current password. */
export async function changePasswordAndReencrypt(oldPassword: string, newPassword: string, newHint: string, opts: KeySwitchOptions = {}): Promise<KeySwitchResult> {
  const check = checkNewPassword(newPassword ?? '')
  if (!check.ok) throw new Error(check.message)
  await verifyAndUnlock(oldPassword)
  return switchDatabaseKey(newPassword, newHint, opts)
}

/**
 * Revoke the recovery key by giving the database a new key wrapped by the
 * current password only: the old recovery key then opens only old backups.
 */
export async function revokeRecoveryKeyAndReencrypt(currentPassword: string, opts: KeySwitchOptions = {}): Promise<KeySwitchResult> {
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) throw new Error('Enter your current password to continue')
  await verifyAndUnlock(currentPassword)
  return switchDatabaseKey(currentPassword, getPasswordHint(), opts)
}

async function switchDatabaseKey(newPassword: string, newHint: string, opts: KeySwitchOptions): Promise<KeySwitchResult> {
  const database = getDb()
  const oldHex = getDbKey().toString('hex')
  const newKey = randomBytes(32)
  try {
    const newHex = newKey.toString('hex')
    await beginKeySwitch(newKey, newPassword, newHint)

    // Pulse may have locked during the slow key work above (auto-lock, sleep):
    // nothing has touched the file, so the pending slot just goes
    if (!database.open || !sameLiveKey(oldHex)) {
      abandonKeySwitch()
      throw new Error('Pulse locked before your data could be re-encrypted. Nothing was changed; unlock and try again.')
    }

    const rekey = opts.rekey ?? ((hex: string) => rekeyDatabase(hex, database))
    try {
      rekey(newHex)
    } catch (err) {
      logger.error('key-switch', 'Rekey failed; checking which key the file has', err)
      return recoverFromFailedRekey(oldHex, newKey)
    }
    finishKeySwitch(newKey)
    logger.info('key-switch', 'Password changed and database re-encrypted')
    freshLocalBackup()
    return 'switched'
  } finally {
    newKey.fill(0)
  }
}

function sameLiveKey(hex: string): boolean {
  try { return getDbKey().toString('hex') === hex } catch { return false }
}

/**
 * The rekey threw. Find out which key the file has, on a connection of its own
 * (the old key first, which also rolls back an interrupted rekey's journal), and
 * put things back so the old password opens it. The pending slot is dropped only
 * once the old key is proven to open the file.
 */
function recoverFromFailedRekey(oldHex: string, newKey: Buffer): KeySwitchResult {
  const newHex = newKey.toString('hex')
  try { closeDatabase() } catch (err) { logNonFatal('key-switch', 'close database after failed rekey', err) }

  let onKey: 'old' | 'new' | 'neither' = databaseOpensWithKey(oldHex) ? 'old' : databaseOpensWithKey(newHex) ? 'new' : 'neither'
  if (onKey === 'new') {
    try {
      rekeyDatabaseFile(newHex, oldHex)
      if (databaseOpensWithKey(oldHex)) onKey = 'old'
    } catch (err) {
      logger.error('key-switch', 'Could not put the old key back after a failed rekey', err)
    }
  }

  if (onKey === 'old') {
    abandonKeySwitch()
    if (!reopenOrLock()) return 'locked'
    throw new Error(REENCRYPT_FAILED_UNCHANGED)
  }
  if (onKey === 'new') {
    // The file kept the new key and it couldn't be undone: make the credentials match it
    finishKeySwitch(newKey)
    logger.warn('key-switch', 'Rekey reported an error but the new key took effect; kept it')
    if (!reopenOrLock()) return 'locked'
    freshLocalBackup()
    return 'switched'
  }
  // Neither key opens it right now (a disk error?). Keep both slots for the next unlock.
  lockApp()
  logger.error('key-switch', 'Neither key opens the database after a failed rekey; locked with both credential slots kept')
  return 'locked'
}

/** Reopen with the live key; if that fails, lock so the next unlock tries again. */
function reopenOrLock(): boolean {
  try {
    openDatabase()
    return true
  } catch (err) {
    logger.error('key-switch', 'Could not reopen the database after a failed rekey; locking', err)
    lockApp()
    return false
  }
}

/**
 * Local restore points made before now hold the old key and no key envelope, so
 * this install can't open them any more: make one that it can, straight away.
 */
function freshLocalBackup(): void {
  runAutoBackup().catch(err => logNonFatal('key-switch', 'auto-backup after re-encrypt', err))
}
