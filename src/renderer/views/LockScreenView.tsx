import React, { useState, useRef, useEffect } from 'react'
import { Lock, Eye, EyeOff, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSettingsStore } from '../stores/settingsStore'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { RestoreFromBackupForm } from '../components/shared/RestoreFromBackupForm'
import { PRODUCT_NAME } from '../../shared/constants'

type LockView = 'password' | 'recovery-key' | 'no-recovery' | 'restore'

/** Strip non-alphanumeric, uppercase, cap at 28 chars, insert dashes every 4 */
function formatRecoveryKey(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 28)
  return clean.replace(/(.{4})(?=.)/g, '$1-')
}

export function LockScreenView(): React.ReactElement {
  const [password, setPassword] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hint, setHint] = useState('')
  const [hasRecovery, setHasRecovery] = useState(false)
  const [view, setView] = useState<LockView>('password')
  // Credentials exist but this computer's keystore can't read them (folder copied from another PC)
  const [credentialsUnreadable, setCredentialsUnreadable] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { setLocked, setRecoverySession, setPasswordSetup } = useSettingsStore()

  useEffect(() => {
    inputRef.current?.focus()

    // Load hint and recovery key status
    async function loadMeta() {
      try {
        const [hintResult, recoveryResult, unreadableResult] = await Promise.all([
          safeInvoke(IPC.AUTH_GET_HINT),
          safeInvoke(IPC.AUTH_HAS_RECOVERY_KEY),
          safeInvoke(IPC.AUTH_CREDENTIALS_UNREADABLE)
        ])
        if (hintResult.ok) setHint(hintResult.data ?? '')
        if (recoveryResult.ok) setHasRecovery(recoveryResult.data)
        if (unreadableResult.ok) setCredentialsUnreadable(unreadableResult.data)
      } catch {
        // Non-fatal
      }
    }
    loadMeta()
  }, [])

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    if (!password || isSubmitting) return

    setIsSubmitting(true)
    try {
      const result = await safeInvoke(IPC.AUTH_VERIFY_PASSWORD, password)
      if (result.ok) {
        if (result.data.cloudWarning) {
          toast(`Warning: Your data folder is inside ${result.data.cloudWarning}. Cloud sync can corrupt encrypted databases.`, { duration: 10000, icon: '⚠️' })
        }
        const failed = result.data.failedAttempts ?? 0
        if (failed > 0) {
          toast(`${failed} wrong password attempt${failed === 1 ? '' : 's'} since you last unlocked Pulse. If that wasn't you, change your password in Settings → Security.`, { duration: 12000, icon: '⚠️' })
        }
        setLocked(false)
      } else {
        // Lockout and unreadable-credential messages are already written for users
        toast.error(result.error === 'Incorrect password' ? 'Incorrect password. Please try again.' : result.error, { duration: 8000 })
        setPassword('')
        inputRef.current?.focus()
      }
    } catch {
      toast.error('Unlock failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRecoveryUnlock(e: React.FormEvent) {
    e.preventDefault()
    if (!recoveryKey || isSubmitting) return

    setIsSubmitting(true)
    try {
      const result = await safeInvoke(IPC.AUTH_VERIFY_RECOVERY_KEY, recoveryKey)
      if (result.ok && result.data) {
        toast.success('Recovery key accepted.')
        setRecoverySession(true)
        setLocked(false)
      } else {
        toast.error('Incorrect recovery key. Please try again.')
        setRecoveryKey('')
      }
    } catch {
      toast.error('Recovery failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen overflow-y-auto items-center-safe justify-center-safe py-8 bg-slate-50 dark:bg-slate-900">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <Shield className="w-10 h-10 text-blue-600" />
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{PRODUCT_NAME}</h1>
          </div>
          <div className="flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
            <Lock className="w-4 h-4" />
            <span className="text-base">Your data is locked</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 border border-slate-200 dark:border-slate-700">
          {view === 'password' && credentialsUnreadable && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">
                This computer can't unlock this data folder
              </h2>
              <p className="text-base text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
                Pulse's sign-in data is protected by the computer and Windows account it was created on, so it can't be read here.
                Your data is safe. To open it on this computer, restore a .pulse-backup file using your password or recovery key.
              </p>
              <button type="button" className="btn-primary w-full" onClick={() => setView('restore')}>
                Restore from a backup
              </button>
            </>
          )}

          {view === 'restore' && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-6">Restore from a backup</h2>
              <RestoreFromBackupForm
                onCancel={() => setView('password')}
                onRestored={() => { setPasswordSetup(true); setLocked(false) }}
              />
            </>
          )}

          {view === 'password' && !credentialsUnreadable && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-6">
                Enter your password
              </h2>

              <form onSubmit={handleUnlock} className="space-y-5">
                <div>
                  <div className="relative">
                    <input
                      ref={inputRef}
                      type={showPassword ? 'text' : 'password'}
                      className="input pr-12"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="hit-44 absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      onClick={() => setShowPassword(v => !v)}
                      tabIndex={-1}
                      title={showPassword ? 'Hide password' : 'Show password'}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {hint && (
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">
                      Hint: {hint}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn-primary w-full"
                  disabled={!password || isSubmitting}
                >
                  {isSubmitting ? 'Unlocking…' : 'Unlock'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  type="button"
                  className="hit-44 text-blue-600 hover:text-blue-700 dark:text-blue-400 text-base"
                  onClick={() => setView(hasRecovery ? 'recovery-key' : 'no-recovery')}
                >
                  Forgot password?
                </button>
              </div>
            </>
          )}

          {view === 'recovery-key' && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <button
                  type="button"
                  onClick={() => setView('password')}
                  className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  ←
                </button>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  Enter recovery key
                </h2>
              </div>

              <p className="text-slate-500 dark:text-slate-400 text-base mb-5">
                Enter the 28-character recovery key you saved during setup.
              </p>

              <form onSubmit={handleRecoveryUnlock} className="space-y-5">
                <input
                  autoFocus
                  type="text"
                  className="input font-mono tracking-wider uppercase"
                  value={recoveryKey}
                  onChange={e => setRecoveryKey(formatRecoveryKey(e.target.value))}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                />

                <button
                  type="submit"
                  className="btn-primary w-full"
                  disabled={!recoveryKey || isSubmitting}
                >
                  {isSubmitting ? 'Verifying…' : 'Unlock with recovery key'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  type="button"
                  className="hit-44 text-slate-500 dark:text-slate-400 text-base"
                  onClick={() => setView('password')}
                >
                  Back to password
                </button>
              </div>
            </>
          )}

          {view === 'no-recovery' && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <button
                  type="button"
                  onClick={() => setView('password')}
                  className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  ←
                </button>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  No recovery key
                </h2>
              </div>

              <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg p-4 mb-6">
                <p className="text-amber-800 dark:text-amber-300 text-base leading-relaxed">
                  Your data is encrypted and no recovery key was set up during initial setup.
                  Without your password, the data cannot be recovered.
                </p>
              </div>

              <p className="text-slate-500 dark:text-slate-400 text-base mb-5">
                If you have a backup, you can restore from it and try again.
              </p>

              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => setView('password')}
              >
                Back to password
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
