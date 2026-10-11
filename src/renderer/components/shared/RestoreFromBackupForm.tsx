import React, { useState } from 'react'
import { FolderOpen, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { PasswordStrength } from './PasswordStrength'
import { checkNewPassword } from '../../../shared/passwordPolicy'

interface RestoreFromBackupFormProps {
  onCancel: () => void
  onRestored: (info: { safetyPath?: string }) => void
  /**
   * 'new-install' (default): no usable Pulse sign-in on this computer.
   * 'replace': Pulse is set up and unlocked; the backup came from another
   * Pulse, and the current data is kept as a safety copy first.
   */
  mode?: 'new-install' | 'replace'
  initialBackupPath?: string
}

/**
 * Restore a .pulse-backup on a computer with no usable Pulse sign-in data
 * (new computer, reinstalled Windows, or a data folder copied from elsewhere).
 * The backup is unlocked with the password or recovery key it was made with,
 * then protected with a password for this computer.
 */
export function RestoreFromBackupForm({ onCancel, onRestored, mode = 'new-install', initialBackupPath = '' }: RestoreFromBackupFormProps): React.ReactElement {
  const [backupPath, setBackupPath] = useState(initialBackupPath)
  const [secret, setSecret] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [hint, setHint] = useState('')
  const [showSecrets, setShowSecrets] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const passwordsMatch = password === confirm
  const isValid = backupPath !== '' && secret !== '' && checkNewPassword(password).ok && passwordsMatch

  async function chooseFile() {
    const res = await safeInvoke(IPC.APP_SHOW_FILE_DIALOG, {
      title: 'Choose a Pulse backup',
      properties: ['openFile'],
      filters: [{ name: 'Pulse backup', extensions: ['pulse-backup'] }],
    })
    if (res.ok && !res.data.canceled && res.data.filePaths[0]) {
      setBackupPath(res.data.filePaths[0])
      setError(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    try {
      let info: { safetyPath?: string } = {}
      if (mode === 'replace') {
        const res = await safeInvoke(IPC.BACKUP_RESTORE_OTHER, backupPath, secret, password, hint)
        if (!res.ok) { setError(res.error); return }
        info = { safetyPath: res.data.safetyPath }
      } else {
        const res = await safeInvoke(IPC.AUTH_RESTORE_FROM_BACKUP, backupPath, secret, password, hint)
        if (!res.ok) { setError(res.error); return }
        if (res.data.cloudWarning) {
          toast(`Warning: Your data folder is inside ${res.data.cloudWarning}. Cloud sync can corrupt encrypted databases.`, { duration: 10000, icon: '⚠️' })
        }
        toast.success('Your backup has been restored.')
      }
      setSecret('')
      setPassword('')
      setConfirm('')
      onRestored(info)
    } catch {
      setError("We couldn't restore that backup. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const fileName = backupPath.split(/[\\/]/).pop()

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">1. Backup file</p>
        <button type="button" className="btn-secondary w-full justify-start gap-2" style={{ minHeight: 44 }} onClick={chooseFile}>
          <FolderOpen className="w-5 h-5 flex-shrink-0" />
          <span className="truncate">{fileName || 'Choose a .pulse-backup file…'}</span>
        </button>
      </div>

      <div>
        <label htmlFor="restore-secret" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">
          2. Password or recovery key for this backup
        </label>
        <div className="relative">
          <input
            id="restore-secret"
            type={showSecrets ? 'text' : 'password'}
            className="input pr-12"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            placeholder="Password or recovery key"
            aria-describedby="restore-secret-help"
            autoComplete="off"
          />
          <button
            type="button"
            className="hit-44 absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            onClick={() => setShowSecrets(v => !v)}
            title={showSecrets ? 'Hide' : 'Show'}
            aria-label={showSecrets ? 'Hide password' : 'Show password'}
          >
            {showSecrets ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>
        <p id="restore-secret-help" className="text-sm text-slate-600 dark:text-slate-300 mt-1">
          Use the password you had when this backup was made.
        </p>
      </div>

      <div>
        <label htmlFor="restore-new-password" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">
          {mode === 'replace' ? '3. Your Pulse password from now on' : '3. Password for this computer'}
        </label>
        <input
          id="restore-new-password"
          type={showSecrets ? 'text' : 'password'}
          className="input"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="At least 12 characters"
          aria-describedby="restore-new-password-help"
          autoComplete="new-password"
        />
        <PasswordStrength password={password} id="restore-new-password-help" />
        <input
          type={showSecrets ? 'text' : 'password'}
          className="input mt-3"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="Re-enter password"
          aria-label="Confirm password"
          autoComplete="new-password"
        />
        {confirm.length > 0 && !passwordsMatch && <p className="text-red-600 dark:text-red-400 text-base mt-1">Passwords do not match</p>}
        <input
          type="text"
          className="input mt-3"
          value={hint}
          onChange={e => setHint(e.target.value)}
          placeholder="Password hint (optional)"
          aria-label="Password hint"
          autoComplete="off"
        />
      </div>

      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-3 text-base text-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button type="button" className="btn-secondary flex-1" onClick={onCancel} disabled={isSubmitting}>Cancel</button>
        <button type="submit" className="btn-primary flex-1" disabled={!isValid || isSubmitting}>
          {isSubmitting ? 'Restoring…' : 'Restore backup'}
        </button>
      </div>
    </form>
  )
}
