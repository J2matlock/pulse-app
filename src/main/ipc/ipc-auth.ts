/**
 * ipc-auth.ts — AUTH_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { logger } from '../logger'
import { secureWrap, ok, fail, withCorrelation, assertSafePath, enforceWritable, logNonFatal } from './ipc-utils'
import { checkNewPassword } from '../../shared/passwordPolicy'
import { openDatabase, closeDatabase, resolveDatabasePath, checkCloudSyncPath, getDb, DatabaseOpenError } from '../database'
import { dbOpenFailedCode } from '../../shared/dbOpen'
import { KEYRING_UNAVAILABLE } from '../../shared/authErrors'
import { moveAsideExistingDatabase, restoreBackupOnNewInstall, runAutoBackupOnLock } from '../backup'
import { describeRestoreError } from '../restore-errors'
import { stopScheduledBackup, startScheduledBackup } from '../index'
import { ensureMaterialized } from '../appointments'
import { openWithUnlockKeys, changePasswordAndReencrypt, revokeRecoveryKeyAndReencrypt, REENCRYPT_FAILED_LOCKED, type KeySwitchResult } from '../key-switch'
import {
  isPasswordSetup,
  setupPassword,
  verifyAndUnlock,
  verifyAndUnlockRecovery,
  changePassword,
  resetPasswordAfterRecovery,
  generateRecoveryKey,
  revokeRecoveryKey,
  lockApp,
  getPasswordHint,
  hasRecoveryKey,
  getLoginLockoutRemaining,
  setStoredDbPath,
  areCredentialsUnreadable
} from '../auth'

function databaseIsOpen(): boolean {
  try { getDb(); return true } catch { return false }
}

// Set when the password (or recovery key) was right but the data couldn't be
// opened. Until the next good unlock, the lock screen may offer "Restore from a
// backup" (AUDIT-003): the person has just proved they own this data.
let openFailedAfterUnlock = false

/**
 * Open the database after a successful unlock; on failure, lock again and say why.
 * Tries every key the password unwrapped and settles a re-encrypt a crash cut short (P-001).
 */
function openAfterUnlock(): ReturnType<typeof fail> | null {
  try {
    openWithUnlockKeys(openDatabase)
    openFailedAfterUnlock = false
    return null
  } catch (err) {
    const kind = err instanceof DatabaseOpenError ? err.kind : 'unreadable'
    logger.error('ipc-auth', `Password accepted but the database could not be opened (${kind})`, err)
    // Nothing is open, so don't keep the key in memory either
    lockApp()
    openFailedAfterUnlock = true
    return fail(dbOpenFailedCode(kind))
  }
}

/**
 * After a re-encrypt: 'locked' means a failed rekey left Pulse locked (both
 * credential slots kept), so the lock screen comes up as after a failed open.
 */
function afterKeySwitch(e: Electron.IpcMainInvokeEvent, result: KeySwitchResult): ReturnType<typeof ok<true>> | ReturnType<typeof fail> {
  if (result === 'switched') return ok(true)
  closeDatabase()
  try { e.sender.send(IPC.AUTH_FORCE_LOCK) } catch (err) { logNonFatal('ipc-auth', 'send force-lock after a failed re-encrypt', err) }
  return fail(REENCRYPT_FAILED_LOCKED)
}

export function registerAuthHandlers(): void {
  secureWrap(IPC.AUTH_IS_SETUP, 'ipc-auth', () => ok(isPasswordSetup()))

  secureWrap(IPC.AUTH_GET_HINT, 'ipc-auth', () => ok(getPasswordHint()))

  secureWrap(IPC.AUTH_HAS_RECOVERY_KEY, 'ipc-auth', () => ok(hasRecoveryKey()))

  // Seconds left in a wrong-password lockout, so the lock screen can count down (audit F-27)
  secureWrap(IPC.AUTH_LOCKOUT_REMAINING, 'ipc-auth', () => ok(getLoginLockoutRemaining()))

  secureWrap(IPC.AUTH_SETUP_PASSWORD, 'ipc-auth', async (_e, password: string, hint: string) => {
    return withCorrelation('auth-setup-password', async (corrId) => {
      if (isPasswordSetup()) return fail('Password is already configured')
      if (typeof password !== 'string' || password.length > 1024) return fail('Invalid password')
      { const check = checkNewPassword(password); if (!check.ok) return fail(check.message ?? 'Choose a stronger password') }
      if (typeof hint !== 'string' || hint.length > 512) return fail('Hint too long')
      const dbPath = resolveDatabasePath()
      setStoredDbPath(dbPath)

      // Check for cloud sync path before creating DB
      const cloudService = checkCloudSyncPath(dbPath)
      if (cloudService) {
        logger.info('ipc-auth', `[${corrId}] cloud sync path detected: ${cloudService}`)
      }

      // A DB file without credentials can only be opened with its original key
      // (via "Restore from a backup"). Never let a fresh key overwrite it.
      const orphaned = moveAsideExistingDatabase(dbPath)
      if (orphaned) logger.warn('ipc-auth', `[${corrId}] existing database moved aside before setup: ${orphaned}`)

      await setupPassword(password, hint, dbPath)
      // Like an unlock: if the new data won't open, say why and don't keep the key (F-031)
      const openFailure = openAfterUnlock()
      if (openFailure) return openFailure
      startScheduledBackup()
      logger.info('ipc-auth', `[${corrId}] password setup complete, DB opened`)
      return ok({ cloudWarning: cloudService })
    })
  })

  secureWrap(IPC.AUTH_VERIFY_PASSWORD, 'ipc-auth', async (_e, password: string) => {
    try {
      if (typeof password !== 'string' || password.length === 0 || password.length > 1024) return fail('Invalid password')
      const { failedAttempts } = await verifyAndUnlock(password)
      const openFailure = openAfterUnlock()
      if (openFailure) return openFailure
      startScheduledBackup()
      // Recurring appointments are made six months ahead (W07 §3)
      try { ensureMaterialized() } catch (err) { logger.warn('ipc-auth', 'appointment series not extended', err) }
      const cloudWarning = checkCloudSyncPath(resolveDatabasePath())
      return ok({ cloudWarning, failedAttempts })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed'
      if (msg === 'Incorrect password' || msg.startsWith('Too many failed attempts')) {
        logger.warn('auth', 'Authentication failed — invalid credentials')
        return fail(msg)
      }
      // Not a wrong password: the OS password vault isn't ready (AUDIT-021)
      if (msg === KEYRING_UNAVAILABLE) return fail(KEYRING_UNAVAILABLE)
      throw err // let wrapHandler log unexpected errors
    }
  })

  secureWrap(IPC.AUTH_VERIFY_RECOVERY_KEY, 'ipc-auth', async (_e, recoveryKey: string) => {
    try {
      if (typeof recoveryKey !== 'string' || recoveryKey.length === 0 || recoveryKey.length > 512) return fail('Invalid recovery key')
      await verifyAndUnlockRecovery(recoveryKey)
      const openFailure = openAfterUnlock()
      if (openFailure) return openFailure
      startScheduledBackup()
      return ok(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recovery key verification failed'
      if (msg === 'Incorrect recovery key' || msg.startsWith('Too many failed attempts')) {
        logger.warn('auth', 'Authentication failed — invalid recovery key')
        return fail(msg)
      }
      if (msg === KEYRING_UNAVAILABLE) return fail(KEYRING_UNAVAILABLE)
      throw err // let wrapHandler log unexpected errors
    }
  })

  // True when this computer can't decrypt the saved credentials (data folder copied
  // from another machine/account). The lock screen then offers "Restore from a backup".
  secureWrap(IPC.AUTH_CREDENTIALS_UNREADABLE, 'ipc-auth', () => ok(areCredentialsUnreadable()))

  secureWrap(IPC.AUTH_RESTORE_FROM_BACKUP, 'ipc-auth', async (_e, backupPath: string, secret: string, newPassword: string, hint: string) => {
    return withCorrelation('auth-restore-from-backup', async (corrId) => {
      // Only when there are no usable credentials, or the right password was just
      // typed but the data wouldn't open. Otherwise this would let anyone at a
      // locked screen replace the user's data and password.
      if (isPasswordSetup() && !areCredentialsUnreadable() && !openFailedAfterUnlock) {
        return fail('Pulse is already set up on this computer. Unlock it, then use Settings → Backup to restore.')
      }
      if (typeof backupPath !== 'string' || backupPath.length === 0 || backupPath.length > 4096) return fail('Choose a backup file')
      if (typeof secret !== 'string' || secret.length === 0 || secret.length > 1024) return fail('Enter the password or recovery key used with this backup')
      if (typeof newPassword !== 'string' || newPassword.length > 1024) return fail('Invalid password')
      { const check = checkNewPassword(newPassword); if (!check.ok) return fail(check.message ?? 'Choose a stronger password') }
      if (typeof hint !== 'string' || hint.length > 512) return fail('Hint too long')
      assertSafePath(backupPath)

      try {
        await restoreBackupOnNewInstall({ backupPath, secret, newPassword, hint })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Restore failed'
        logger.warn('ipc-auth', `[${corrId}] restore from backup failed: ${msg}`)
        return fail(describeRestoreError(err))
      }
      // The restored data may not open (an update to how it's stored failed): one of the
      // three plain messages, and the key isn't kept, as after an unlock (F-031)
      const openFailure = openAfterUnlock()
      if (openFailure) return openFailure
      startScheduledBackup()
      logger.info('ipc-auth', `[${corrId}] restored from backup on new install`)
      return ok({ cloudWarning: checkCloudSyncPath(resolveDatabasePath()) })
    })
  })

  secureWrap(IPC.AUTH_CHANGE_PASSWORD, 'ipc-auth', async (e, oldPassword: string, newPassword: string, newHint: string, opts?: { reencrypt?: boolean }) => {
    return withCorrelation('auth-change-password', async (corrId) => {
      try {
        if (typeof oldPassword !== 'string' || oldPassword.length > 1024) return fail('Invalid password')
        if (typeof newPassword !== 'string' || newPassword.length > 1024) return fail('Invalid password')
      { const check = checkNewPassword(newPassword); if (!check.ok) return fail(check.message ?? 'Choose a stronger password') }
        if (typeof newHint !== 'string' || newHint.length > 512) return fail('Hint too long')
        if (opts !== undefined && (opts === null || typeof opts !== 'object')) return fail('Invalid options')
        if (opts?.reencrypt === true) {
          // A new key for the data (P-001): it writes every page, so the read-only gate applies
          const guard = enforceWritable(); if (guard) return guard
          const result = await changePasswordAndReencrypt(oldPassword, newPassword, newHint)
          logger.info('ipc-auth', `[${corrId}] password change with re-encrypt: ${result}`)
          return afterKeySwitch(e, result)
        }
        await changePassword(oldPassword, newPassword, newHint)
        logger.info('ipc-auth', `[${corrId}] password changed successfully`)
        return ok(true)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Password change failed'
        if (msg === 'Incorrect password' || msg.startsWith('Too many failed attempts')) {
          logger.warn('auth', `[${corrId}] Password change failed — invalid current password`)
          return fail(msg)
        }
        throw err // let wrapHandler log unexpected errors
      }
    })
  })

  secureWrap(IPC.AUTH_LOCK, 'ipc-auth', () => {
    stopScheduledBackup()
    // Back up while the database is still open: many people lock and never quit.
    // Already locked (Ctrl+L on the lock screen): nothing to back up, and trying
    // would record a false "backup failed".
    if (databaseIsOpen()) runAutoBackupOnLock()
    lockApp()
    closeDatabase()
    return ok(true)
  })

  secureWrap(IPC.AUTH_GENERATE_RECOVERY_KEY, 'ipc-auth', async (_e, currentPassword?: string) => {
    if (currentPassword !== undefined && (typeof currentPassword !== 'string' || currentPassword.length > 1024)) return fail('Invalid password')
    const key = await generateRecoveryKey(currentPassword)
    return ok(key)
  })

  secureWrap(IPC.AUTH_REVOKE_RECOVERY_KEY, 'ipc-auth', async (e, currentPassword?: string, opts?: { reencrypt?: boolean }) => {
    if (currentPassword !== undefined && (typeof currentPassword !== 'string' || currentPassword.length > 1024)) return fail('Invalid password')
    if (opts !== undefined && (opts === null || typeof opts !== 'object')) return fail('Invalid options')
    if (opts?.reencrypt === true) {
      // Revoke by giving the data a new key wrapped by the current password only (P-001)
      const guard = enforceWritable(); if (guard) return guard
      if (typeof currentPassword !== 'string' || currentPassword.length === 0) return fail('Enter your current password to continue')
      try {
        return afterKeySwitch(e, await revokeRecoveryKeyAndReencrypt(currentPassword))
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg === 'Incorrect password' || msg.startsWith('Too many failed attempts')) return fail(msg)
        throw err
      }
    }
    await revokeRecoveryKey(currentPassword)
    return ok(true)
  })

  secureWrap(IPC.AUTH_RESET_PASSWORD_AFTER_RECOVERY, 'ipc-auth', async (_e, newPassword: string, newHint: string) => {
    if (typeof newPassword !== 'string' || newPassword.length > 1024) return fail('Invalid password')
      { const check = checkNewPassword(newPassword); if (!check.ok) return fail(check.message ?? 'Choose a stronger password') }
    if (typeof newHint !== 'string' || newHint.length > 512) return fail('Hint too long')
    await resetPasswordAfterRecovery(newPassword, newHint)
    return ok(true)
  })
}
