import React, { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import toast from 'react-hot-toast'
import { RecoveryKeyDisplayModal } from '../shared/RecoveryKeyDisplayModal'
import { SecurityCheckup } from './SecurityCheckup'
import { PasswordStrength } from '../shared/PasswordStrength'
import { checkNewPassword } from '../../../shared/passwordPolicy'

interface SecuritySectionProps {
  saveSetting: (key: string, value: string) => Promise<void>
  /** Jump to another Settings section (used by the security checkup) */
  onGoToSection?: (section: 'backup') => void
}

export function SecuritySection({ saveSetting, onGoToSection }: SecuritySectionProps): React.ReactElement {
  const autoLockMinutes = useSettingsStore(s => s.autoLockMinutes)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '', hint: '' })
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSaving, setPwSaving] = useState(false)
  const [hasRecovery, setHasRecovery] = useState<boolean | null>(null)
  const [showRecoveryKeyModal, setShowRecoveryKeyModal] = useState(false)
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState('')
  // Recovery-key changes need the current password (someone at an unlocked
  // computer shouldn't be able to mint or revoke a recovery key)
  const [pendingKeyAction, setPendingKeyAction] = useState<'generate' | 'revoke' | null>(null)
  const [keyActionPassword, setKeyActionPassword] = useState('')
  const [keyActionError, setKeyActionError] = useState<string | null>(null)
  const [keyActionBusy, setKeyActionBusy] = useState(false)

  // Clear sensitive data on unmount
  useEffect(() => {
    return () => {
      setPwForm({ current: '', next: '', confirm: '', hint: '' })
      setGeneratedRecoveryKey('')
      setKeyActionPassword('')
    }
  }, [])

  function closeKeyAction() {
    setPendingKeyAction(null)
    setKeyActionPassword('')
    setKeyActionError(null)
  }

  async function handleKeyAction(e: React.FormEvent) {
    e.preventDefault()
    if (!pendingKeyAction || !keyActionPassword || keyActionBusy) return
    setKeyActionBusy(true)
    setKeyActionError(null)
    try {
      if (pendingKeyAction === 'generate') {
        const res = await safeInvoke(IPC.AUTH_GENERATE_RECOVERY_KEY, keyActionPassword)
        if (!res.ok) { setKeyActionError(res.error === 'Incorrect password' ? 'That password is incorrect.' : res.error); return }
        closeKeyAction()
        setGeneratedRecoveryKey(res.data)
        setShowRecoveryKeyModal(true)
      } else {
        const res = await safeInvoke(IPC.AUTH_REVOKE_RECOVERY_KEY, keyActionPassword)
        if (!res.ok) { setKeyActionError(res.error === 'Incorrect password' ? 'That password is incorrect.' : res.error); return }
        closeKeyAction()
        setHasRecovery(false)
        toast.success('Recovery key revoked.')
      }
    } finally {
      setKeyActionBusy(false)
    }
  }

  // Load recovery key status
  useEffect(() => {
    async function loadRecoveryStatus() {
      const res = await safeInvoke(IPC.AUTH_HAS_RECOVERY_KEY)
      if (res.ok) setHasRecovery(res.data)
    }
    loadRecoveryStatus()
  }, [])

  async function handleAutoLockChange(minutes: number) {
    useSettingsStore.setState({ autoLockMinutes: minutes })
    await saveSetting('auto_lock_minutes', String(minutes))
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (pwSaving) return
    setPwError(null)
    const check = checkNewPassword(pwForm.next)
    if (!check.ok) { setPwError(check.message ?? 'Choose a stronger password.'); return }
    if (pwForm.next !== pwForm.confirm) { setPwError('Passwords do not match.'); return }
    setPwSaving(true)
    try {
      const res = await safeInvoke(IPC.AUTH_CHANGE_PASSWORD, pwForm.current, pwForm.next, pwForm.hint)
      if (!res.ok) { setPwError(res.error === 'Incorrect password' ? 'Your current password is incorrect.' : (res.error ?? 'Current password is incorrect.')); return }
      toast.success('Password changed successfully.')
      setPwForm({ current: '', next: '', confirm: '', hint: '' })
      setIsChangingPassword(false)
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Security</h2>
      <SecurityCheckup hasRecovery={hasRecovery} onGoToBackup={onGoToSection ? () => onGoToSection('backup') : undefined} />

      <div className="space-y-2">
        <label htmlFor="settings-auto-lock" className="block text-base font-medium text-slate-700 dark:text-slate-300">
          Auto-lock after inactivity
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">Automatically lock the app after a period of inactivity</p>
        <select
          id="settings-auto-lock"
          className="input"
          style={{ minHeight: 44, fontSize: 15 }}
          value={autoLockMinutes}
          onChange={e => void handleAutoLockChange(Number(e.target.value))}
        >
          <option value={5}>5 minutes (recommended)</option>
          <option value={15}>15 minutes</option>
          <option value={30}>30 minutes (default)</option>
          <option value={60}>1 hour</option>
          <option value={120}>2 hours</option>
        </select>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Pulse also locks when your computer sleeps or you lock your screen. Press Ctrl+L to lock immediately.
        </p>
      </div>

      <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700" data-tour="settings-change-password">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-medium text-slate-700 dark:text-slate-300">Password</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Change the password you use to unlock Pulse</p>
          </div>
          <button
            onClick={() => { setIsChangingPassword(v => !v); setPwError(null) }}
            className="btn-secondary"
            style={{ minHeight: 44 }}
          >
            {isChangingPassword ? 'Cancel' : 'Change…'}
          </button>
        </div>

        {isChangingPassword && (
          <form onSubmit={e => void handleChangePassword(e)} className="space-y-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            {pwError && (
              <p className="text-sm text-red-600 dark:text-red-400 font-medium">{pwError}</p>
            )}
            <div>
              <label htmlFor="settings-pw-current" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Current password</label>
              <input id="settings-pw-current" type="password" autoFocus className="input w-full" style={{ minHeight: 44 }}
                value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} required />
            </div>
            <div>
              <label htmlFor="settings-pw-new" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">New password</label>
              <input id="settings-pw-new" type="password" className="input w-full" style={{ minHeight: 44 }}
                value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} required minLength={12} />
              <PasswordStrength password={pwForm.next} />
            </div>
            <div>
              <label htmlFor="settings-pw-confirm" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm new password</label>
              <input id="settings-pw-confirm" type="password" className="input w-full" style={{ minHeight: 44 }}
                value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} required />
              {pwForm.next && pwForm.confirm && pwForm.next !== pwForm.confirm && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">Passwords do not match</p>
              )}
            </div>
            <div>
              <label htmlFor="settings-pw-hint" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                Password hint <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
              </label>
              <input id="settings-pw-hint" type="text" className="input w-full" style={{ minHeight: 44 }}
                value={pwForm.hint} onChange={e => setPwForm(f => ({ ...f, hint: e.target.value }))}
                placeholder="A hint shown on the lock screen (not your password)" />
            </div>
            <button type="submit" className="btn-primary w-full" style={{ minHeight: 44 }}
              disabled={pwSaving || (pwForm.next.length > 0 && pwForm.confirm.length > 0 && pwForm.next !== pwForm.confirm)}>
              {pwSaving ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}
      </div>

      {/* Recovery Key Management */}
      <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
        <div>
          <p className="text-base font-medium text-slate-700 dark:text-slate-300">Recovery Key</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            A recovery key lets you unlock your data if you forget your password.
          </p>
        </div>

        {hasRecovery === null ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : hasRecovery ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg">
              <div className="w-2 h-2 bg-green-500 rounded-full" />
              <span className="text-sm font-medium text-green-700 dark:text-green-300">Recovery key active</span>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPendingKeyAction('generate')}
                className="btn-secondary"
                style={{ minHeight: 44 }}
              >
                Regenerate
              </button>
              <button
                type="button"
                onClick={() => setPendingKeyAction('revoke')}
                className="btn-secondary text-red-600 dark:text-red-400 border-red-200 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/30"
                style={{ minHeight: 44 }}
              >
                Revoke
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-sm text-amber-700 dark:text-amber-300">No recovery key set. If you forget your password, your data cannot be recovered.</span>
            </div>
            <button
              type="button"
              onClick={() => setPendingKeyAction('generate')}
              className="btn-primary"
              style={{ minHeight: 44 }}
            >
              Generate Recovery Key
            </button>
          </>
        )}
      </div>

      {pendingKeyAction && (
        <form onSubmit={handleKeyAction} className="mt-4 space-y-3 p-4 rounded-lg border-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800">
          <p className="text-base font-medium text-slate-800 dark:text-slate-100">
            {pendingKeyAction === 'revoke'
              ? 'Revoke your recovery key?'
              : hasRecovery ? 'Create a new recovery key?' : 'Create a recovery key'}
          </p>
          <p className="text-base text-slate-600 dark:text-slate-400">
            {pendingKeyAction === 'revoke'
              ? 'Without a recovery key, a forgotten password means permanent data loss.'
              : hasRecovery
                ? 'Your current recovery key will stop working. Backups you already made still open with the old key.'
                : 'You will see the key once — print it or write it down and keep it somewhere safe.'}
          </p>
          <label htmlFor="key-action-password" className="block text-base text-slate-700 dark:text-slate-300">Enter your current password to continue</label>
          <input
            id="key-action-password"
            type="password"
            className="input"
            value={keyActionPassword}
            onChange={e => setKeyActionPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
          />
          {keyActionError && <p role="alert" className="text-base text-red-600 dark:text-red-400">{keyActionError}</p>}
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={closeKeyAction}>Cancel</button>
            <button
              type="submit"
              className={pendingKeyAction === 'revoke' ? 'btn-danger' : 'btn-primary'}
              style={{ minHeight: 44 }}
              disabled={!keyActionPassword || keyActionBusy}
            >
              {keyActionBusy ? 'Checking…' : pendingKeyAction === 'revoke' ? 'Revoke recovery key' : 'Create recovery key'}
            </button>
          </div>
        </form>
      )}

      {showRecoveryKeyModal && (
        <RecoveryKeyDisplayModal
          open={true}
          recoveryKey={generatedRecoveryKey}
          onClose={() => {
            setShowRecoveryKeyModal(false)
            setHasRecovery(true)
          }}
        />
      )}

    </>
  )
}
