import React, { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import toast from 'react-hot-toast'
import { RecoveryKeyDisplayModal } from '../shared/RecoveryKeyDisplayModal'
import { SecurityCheckup } from './SecurityCheckup'
import { PasswordStrength } from '../shared/PasswordStrength'
import { FieldError, fieldErrorProps } from '../shared/FieldError'
import { checkNewPassword } from '../../../shared/passwordPolicy'
import { modHelp } from '../../utils/keys'
import { saveBackupArchive } from '../../utils/saveBackupArchive'

/** What "Also re-encrypt my data" does, in plain words (P-001) */
const REENCRYPT_HELP =
  "Gives your data a new key, so your old password can't open it any more, even together with an old backup. Backups made before now still open with your old password or recovery key, so keep them safe or delete them, and save a new backup afterwards."

interface SecuritySectionProps {
  saveSetting: (key: string, value: string) => Promise<void>
  /** Jump to another Settings section (used by the security checkup) */
  onGoToSection?: (section: 'backup') => void
}

export function SecuritySection({ saveSetting, onGoToSection }: SecuritySectionProps): React.ReactElement {
  const autoLockMinutes = useSettingsStore(s => s.autoLockMinutes)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '', hint: '' })
  // Which box the error is about, so that box can point at it (audit A06-14)
  const [pwError, setPwError] = useState<{ text: string; field: 'current' | 'next' | 'confirm' | null } | null>(null)
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
  // "Also re-encrypt my data" (P-001): a new key for the data, on change password or revoke
  const [pwReencrypt, setPwReencrypt] = useState(false)
  const [revokeReencrypt, setRevokeReencrypt] = useState(false)
  // Shown after a re-encrypt: older backups need the old password, so offer a new backup
  const [reencrypted, setReencrypted] = useState(false)
  const [recoveryRemoved, setRecoveryRemoved] = useState(false)
  const [savingBackup, setSavingBackup] = useState(false)

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
    setRevokeReencrypt(false)
  }

  async function handleSaveBackup() {
    if (savingBackup) return
    setSavingBackup(true)
    try {
      const res = await saveBackupArchive()
      if (res.status === 'saved') { toast.success('Backup saved.'); setReencrypted(false); setRecoveryRemoved(false) }
      else if (res.status === 'failed') toast.error(friendlyError(res.error, "The backup couldn't be saved. Try again, or choose a different folder."))
    } finally {
      setSavingBackup(false)
    }
  }

  async function handleKeyAction(e: React.FormEvent) {
    e.preventDefault()
    if (!pendingKeyAction || !keyActionPassword || keyActionBusy) return
    setKeyActionBusy(true)
    setKeyActionError(null)
    try {
      if (pendingKeyAction === 'generate') {
        const res = await safeInvoke(IPC.AUTH_GENERATE_RECOVERY_KEY, keyActionPassword)
        if (!res.ok) { setKeyActionError(res.error === 'Incorrect password' ? 'That password is incorrect.' : friendlyError(res.error, "That didn't work. Please try again.")); return }
        closeKeyAction()
        setGeneratedRecoveryKey(res.data)
        setShowRecoveryKeyModal(true)
      } else {
        const reencrypt = revokeReencrypt
        const res = reencrypt
          ? await safeInvoke(IPC.AUTH_REVOKE_RECOVERY_KEY, keyActionPassword, { reencrypt: true })
          : await safeInvoke(IPC.AUTH_REVOKE_RECOVERY_KEY, keyActionPassword)
        if (!res.ok) { setKeyActionError(res.error === 'Incorrect password' ? 'That password is incorrect.' : friendlyError(res.error, "That didn't work. Please try again.")); return }
        closeKeyAction()
        setHasRecovery(false)
        if (reencrypt) setReencrypted(true)
        toast.success(reencrypt ? 'Recovery key revoked and your data re-encrypted.' : 'Recovery key revoked.')
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

  const confirmMismatch = !!pwForm.next && !!pwForm.confirm && pwForm.next !== pwForm.confirm && 'Passwords do not match'

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (pwSaving) return
    setPwError(null)
    const check = checkNewPassword(pwForm.next)
    if (!check.ok) { setPwError({ text: check.message ?? 'Choose a stronger password.', field: 'next' }); return }
    if (pwForm.next !== pwForm.confirm) { setPwError({ text: 'Passwords do not match.', field: 'confirm' }); return }
    setPwSaving(true)
    try {
      const reencrypt = pwReencrypt
      // The option is only sent when ticked, so a plain change stays exactly as before
      const res = reencrypt
        ? await safeInvoke(IPC.AUTH_CHANGE_PASSWORD, pwForm.current, pwForm.next, pwForm.hint, { reencrypt: true })
        : await safeInvoke(IPC.AUTH_CHANGE_PASSWORD, pwForm.current, pwForm.next, pwForm.hint)
      if (!res.ok) {
        const wrong = res.error === 'Incorrect password'
        setPwError({ text: wrong ? 'Your current password is incorrect.' : friendlyError(res.error, "Your password couldn't be changed. Please try again."), field: wrong ? 'current' : null })
        return
      }
      setPwForm({ current: '', next: '', confirm: '', hint: '' })
      setIsChangingPassword(false)
      setPwReencrypt(false)
      if (reencrypt) {
        toast.success('Password changed and your data re-encrypted.')
        setReencrypted(true)
        // The recovery key wrapped the old key, so Pulse removed it: offer a new one straight away
        if (hasRecovery) { setHasRecovery(false); setRecoveryRemoved(true); setPendingKeyAction('generate') }
      } else {
        toast.success('Password changed successfully.')
      }
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
        <p className="text-sm text-slate-500 dark:text-slate-400">Automatically lock the app after a period of inactivity</p>
        <select
          id="settings-auto-lock"
          className="input"
          style={{ minHeight: 44, fontSize: 15 }}
          value={autoLockMinutes}
          onChange={e => void handleAutoLockChange(Number(e.target.value))}
        >
          <option value={5}>5 minutes</option>
          <option value={15}>15 minutes (recommended)</option>
          <option value={30}>30 minutes</option>
          <option value={60}>1 hour</option>
          <option value={120}>2 hours</option>
        </select>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Pulse also locks when your computer sleeps or you lock your screen. Press {modHelp('Ctrl+L')} to lock immediately.
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
              <p id="settings-pw-error" role="alert" className="text-sm text-red-600 dark:text-red-400 font-medium">{pwError.text}</p>
            )}
            <div>
              <label htmlFor="settings-pw-current" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Current password</label>
              <input id="settings-pw-current" type="password" autoFocus className="input w-full" style={{ minHeight: 44 }}
                aria-invalid={pwError?.field === 'current' || undefined} aria-describedby={pwError?.field === 'current' ? 'settings-pw-error' : undefined}
                value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} required />
            </div>
            <div>
              <label htmlFor="settings-pw-new" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">New password</label>
              <input id="settings-pw-new" type="password" className="input w-full" style={{ minHeight: 44 }}
                aria-invalid={pwError?.field === 'next' || undefined} aria-describedby={pwError?.field === 'next' ? 'settings-pw-strength settings-pw-error' : 'settings-pw-strength'}
                value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} required minLength={12} />
              <PasswordStrength password={pwForm.next} id="settings-pw-strength" />
            </div>
            <div>
              <label htmlFor="settings-pw-confirm" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm new password</label>
              <input id="settings-pw-confirm" type="password" className="input w-full" style={{ minHeight: 44 }}
                value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} required
                {...fieldErrorProps('settings-pw-confirm', confirmMismatch, pwError?.field === 'confirm' ? 'settings-pw-error' : undefined)}
                aria-invalid={confirmMismatch || pwError?.field === 'confirm' ? true : undefined} />
              <FieldError fieldId="settings-pw-confirm" error={confirmMismatch} announce={false} />
            </div>
            <div>
              <label htmlFor="settings-pw-hint" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                Password hint <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
              </label>
              <input id="settings-pw-hint" type="text" className="input w-full" style={{ minHeight: 44 }}
                value={pwForm.hint} onChange={e => setPwForm(f => ({ ...f, hint: e.target.value }))}
                placeholder="A hint shown on the lock screen (not your password)" />
            </div>
            <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
              <input id="settings-pw-reencrypt" type="checkbox" className="mt-1 w-5 h-5 flex-shrink-0"
                checked={pwReencrypt} onChange={e => setPwReencrypt(e.target.checked)}
                aria-describedby="settings-pw-reencrypt-help" />
              <span>
                <span className="block text-base font-medium text-slate-700 dark:text-slate-300">Also re-encrypt my data</span>
                <span id="settings-pw-reencrypt-help" className="block text-base text-slate-600 dark:text-slate-400">
                  {REENCRYPT_HELP} Your recovery key stops working too, so you'll make a new one. This can take a minute if you have a lot of data.
                </span>
              </span>
            </label>
            <button type="submit" className="btn-primary w-full" style={{ minHeight: 44 }}
              disabled={pwSaving || (pwForm.next.length > 0 && pwForm.confirm.length > 0 && pwForm.next !== pwForm.confirm)}>
              {pwSaving ? (pwReencrypt ? 'Re-encrypting…' : 'Saving…') : 'Save new password'}
            </button>
          </form>
        )}
      </div>

      {reencrypted && (
        <div role="status" className="space-y-3 p-4 rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30">
          <p className="text-base font-medium text-slate-800 dark:text-slate-100">Your data has a new key. Save a new backup now.</p>
          <p className="text-base text-slate-700 dark:text-slate-300">
            Backups made before now still open only with your old password or old recovery key. Save a new backup so you have one that opens with the password you use today.
          </p>
          {recoveryRemoved && (
            <p className="text-base text-slate-700 dark:text-slate-300">
              Your old recovery key no longer unlocks Pulse. Create a new one below and keep it somewhere safe.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-primary" style={{ minHeight: 44 }} disabled={savingBackup} onClick={() => void handleSaveBackup()}>
              {savingBackup ? 'Saving…' : 'Save a new backup now'}
            </button>
            <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={() => { setReencrypted(false); setRecoveryRemoved(false) }}>Later</button>
          </div>
        </div>
      )}

      {/* Recovery Key Management (the recovery-key reminder's "Save it now" scrolls here) */}
      <div id="settings-recovery-key" className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
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
              <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400" />
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
            {/* The data's key isn't changed, only how it's locked: say what the old key still opens (F-032) */}
            {pendingKeyAction === 'revoke'
              ? 'Without a recovery key, a forgotten password means permanent data loss. Revoking stops this key from unlocking Pulse, but backups made before now still open with it, so keep them safe.'
              : hasRecovery
                ? 'Your current recovery key will no longer unlock Pulse. Backups made before now still open with the old key, so keep them safe.'
                : 'You will see the key once — print it or write it down and keep it somewhere safe.'}
          </p>
          {pendingKeyAction === 'revoke' && (
            <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
              <input id="revoke-reencrypt" type="checkbox" className="mt-1 w-5 h-5 flex-shrink-0"
                checked={revokeReencrypt} onChange={e => setRevokeReencrypt(e.target.checked)}
                aria-describedby="revoke-reencrypt-help" />
              <span>
                <span className="block text-base font-medium text-slate-700 dark:text-slate-300">Also re-encrypt my data</span>
                <span id="revoke-reencrypt-help" className="block text-base text-slate-600 dark:text-slate-400">
                  Gives your data a new key, so this recovery key can't open anything from now on, even together with an old backup. Old backups still open with it. Save a new backup afterwards.
                </span>
              </span>
            </label>
          )}
          <label htmlFor="key-action-password" className="block text-base text-slate-700 dark:text-slate-300">Enter your current password to continue</label>
          <input
            id="key-action-password"
            type="password"
            className="input"
            value={keyActionPassword}
            onChange={e => setKeyActionPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            {...fieldErrorProps('key-action-password', keyActionError)}
          />
          <FieldError fieldId="key-action-password" error={keyActionError} className="text-base text-red-600 dark:text-red-400" />
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={closeKeyAction}>Cancel</button>
            <button
              type="submit"
              className={pendingKeyAction === 'revoke' ? 'btn-danger' : 'btn-primary'}
              style={{ minHeight: 44 }}
              disabled={!keyActionPassword || keyActionBusy}
            >
              {keyActionBusy ? (pendingKeyAction === 'revoke' && revokeReencrypt ? 'Re-encrypting…' : 'Checking…') : pendingKeyAction === 'revoke' ? 'Revoke recovery key' : 'Create recovery key'}
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
