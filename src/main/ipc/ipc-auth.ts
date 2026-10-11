/**
 * ipc-auth.ts — AUTH_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { logger } from '../logger'
import { secureWrap, ok, fail, withCorrelation, assertSafePath } from './ipc-utils'
import { checkNewPassword } from '../../shared/passwordPolicy'
import { openDatabase, closeDatabase, resolveDatabasePath, checkCloudSyncPath, getDb } from '../database'
import { moveAsideExistingDatabase, restoreBackupOnNewInstall, runAutoBackupOnLock } from '../backup'
import { describeRestoreError } from '../restore-errors'
import { stopScheduledBackup, startScheduledBackup } from '../index'
import { ensureMaterialized } from '../appointments'
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
      openDatabase()
      startScheduledBackup()
      logger.info('ipc-auth', `[${corrId}] password setup complete, DB opened`)
      return ok({ cloudWarning: cloudService })
    })
  })

  secureWrap(IPC.AUTH_VERIFY_PASSWORD, 'ipc-auth', async (_e, password: string) => {
    try {
      if (typeof password !== 'string' || password.length === 0 || password.length > 1024) return fail('Invalid password')
      const { failedAttempts } = await verifyAndUnlock(password)
      openDatabase()
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
      throw err // let wrapHandler log unexpected errors
    }
  })

  secureWrap(IPC.AUTH_VERIFY_RECOVERY_KEY, 'ipc-auth', async (_e, recoveryKey: string) => {
    try {
      if (typeof recoveryKey !== 'string' || recoveryKey.length === 0 || recoveryKey.length > 512) return fail('Invalid recovery key')
      await verifyAndUnlockRecovery(recoveryKey)
      openDatabase()
      startScheduledBackup()
      return ok(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recovery key verification failed'
      if (msg === 'Incorrect recovery key' || msg.startsWith('Too many failed attempts')) {
        logger.warn('auth', 'Authentication failed — invalid recovery key')
        return fail(msg)
      }
      throw err // let wrapHandler log unexpected errors
    }
  })

  // True when this computer can't decrypt the saved credentials (data folder copied
  // from another machine/account). The lock screen then offers "Restore from a backup".
  secureWrap(IPC.AUTH_CREDENTIALS_UNREADABLE, 'ipc-auth', () => ok(areCredentialsUnreadable()))

  secureWrap(IPC.AUTH_RESTORE_FROM_BACKUP, 'ipc-auth', async (_e, backupPath: string, secret: string, newPassword: string, hint: string) => {
    return withCorrelation('auth-restore-from-backup', async (corrId) => {
      // Only when there are no usable credentials — otherwise this would let anyone
      // at a locked screen replace the user's data and password.
      if (isPasswordSetup() && !areCredentialsUnreadable()) {
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
      openDatabase()
      startScheduledBackup()
      logger.info('ipc-auth', `[${corrId}] restored from backup on new install`)
      return ok({ cloudWarning: checkCloudSyncPath(resolveDatabasePath()) })
    })
  })

  secureWrap(IPC.AUTH_CHANGE_PASSWORD, 'ipc-auth', async (_e, oldPassword: string, newPassword: string, newHint: string) => {
    return withCorrelation('auth-change-password', async (corrId) => {
      try {
        if (typeof newPassword !== 'string' || newPassword.length > 1024) return fail('Invalid password')
      { const check = checkNewPassword(newPassword); if (!check.ok) return fail(check.message ?? 'Choose a stronger password') }
        if (typeof newHint !== 'string' || newHint.length > 512) return fail('Hint too long')
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

  secureWrap(IPC.AUTH_REVOKE_RECOVERY_KEY, 'ipc-auth', async (_e, currentPassword?: string) => {
    if (currentPassword !== undefined && (typeof currentPassword !== 'string' || currentPassword.length > 1024)) return fail('Invalid password')
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
