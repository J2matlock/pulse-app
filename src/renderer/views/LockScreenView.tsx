import React, { useState, useRef, useEffect } from 'react'
import { Lock, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSettingsStore } from '../stores/settingsStore'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { friendlyError } from '../utils/friendlyError'
import { RestoreFromBackupForm } from '../components/shared/RestoreFromBackupForm'
import { ToastIcon } from '../components/shared/ToastHost'
import { usePlatform, cloudFolderAdvice, type Platform } from '../utils/platformText'
import { PRODUCT_NAME } from '../../shared/constants'
import { parseDbOpenFailure, type DbOpenFailureKind } from '../../shared/dbOpen'
import { KEYRING_UNAVAILABLE } from '../../shared/authErrors'
import { PulseMark } from '../components/ui/PulseMark'

type LockView = 'password' | 'recovery-key' | 'no-recovery' | 'restore' | 'open-failed'

/** Strip non-alphanumeric, uppercase, cap at 28 chars, insert dashes every 4 */
function formatRecoveryKey(raw: string): string {
  const clean = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 28)
  return clean.replace(/(.{4})(?=.)/g, '$1-')
}

/**
 * The OS password vault isn't ready, so the saved sign-in data can't be read yet
 * (AUDIT-021). Not a wrong password: nothing is erased and it doesn't count toward
 * a lockout, so there's no restore offer either.
 */
function keyringUnavailableText(platform: Platform | null): string {
  const base = `Your computer's password vault isn't available yet, so ${PRODUCT_NAME} can't open your data. ` +
    'If you just signed in, wait a moment and try again.'
  return platform === 'win32' || platform === 'darwin' ? base : `${base} On Linux, make sure your keyring is unlocked.`
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
  const platform = usePlatform()
  const keyRef = useRef<HTMLInputElement>(null)
  // Feedback stays on screen, not in a toast that disappears (audit F-27, F-30)
  const [error, setError] = useState<string | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [capsLock, setCapsLock] = useState(false)
  const [lockoutLeft, setLockoutLeft] = useState(0)
  // Screen readers hear the lockout once (its starting length) and again when it ends,
  // not every second of the countdown (AUDIT-144)
  const [lockoutTotal, setLockoutTotal] = useState(0)
  const [lockoutOver, setLockoutOver] = useState(false)
  // The password or key was right but the data wouldn't open (AUDIT-003)
  const [openFailure, setOpenFailure] = useState<{ kind: DbOpenFailureKind; via: 'password' | 'recovery key' } | null>(null)
  const openFailedRef = useRef<HTMLHeadingElement>(null)

  function showOpenFailure(kind: DbOpenFailureKind, via: 'password' | 'recovery key') {
    setOpenFailure({ kind, via })
    setView('open-failed')
    setTimeout(() => openFailedRef.current?.focus(), 0)
  }

  // A wrong-password lockout counts down; Unlock waits until it's over
  const checkLockout = async () => {
    const r = await safeInvoke(IPC.AUTH_LOCKOUT_REMAINING)
    if (r.ok && r.data > 0) { setLockoutLeft(r.data); setLockoutTotal(r.data); setLockoutOver(false) }
  }
  useEffect(() => {
    if (lockoutLeft <= 0) return
    const t = setTimeout(() => setLockoutLeft(s => {
      const next = s - 1
      if (next <= 0) { setError(null); setLockoutOver(true); setTimeout(() => inputRef.current?.focus(), 0) }
      return next
    }), 1000)
    return () => clearTimeout(t)
  }, [lockoutLeft])

  // One selector each, so settings changes elsewhere don't re-render the lock screen (AUDIT-137)
  const setLocked = useSettingsStore(s => s.setLocked)
  const setRecoverySession = useSettingsStore(s => s.setRecoverySession)
  const setPasswordSetup = useSettingsStore(s => s.setPasswordSetup)
  const idleMinutes = useSettingsStore(s => s.lockedAfterIdleMinutes)

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
    void checkLockout()
  }, [])

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault()
    if (!password || isSubmitting || lockoutLeft > 0) return

    setIsSubmitting(true)
    setError(null)
    setLockoutOver(false)
    try {
      const result = await safeInvoke(IPC.AUTH_VERIFY_PASSWORD, password)
      const openKind = result.ok ? null : parseDbOpenFailure(result.error)
      if (result.ok) {
        if (result.data.cloudWarning) {
          // Same advice as after a restore, with a next step (AUDIT-161)
          toast(cloudFolderAdvice(result.data.cloudWarning, platform), { duration: 20000, icon: <ToastIcon kind="warning" /> })
        }
        const failed = result.data.failedAttempts ?? 0
        if (failed > 0) {
          toast(`${failed} wrong password attempt${failed === 1 ? '' : 's'} since you last unlocked Pulse. If that wasn't you, change your password in Settings → Security.`, { duration: 12000, icon: <ToastIcon kind="warning" /> })
        }
        setLocked(false)
      } else if (openKind) {
        setPassword('')
        showOpenFailure(openKind, 'password')
      } else if (result.error === KEYRING_UNAVAILABLE) {
        // The password may well be right: keep it so "try again" is one click
        setError(keyringUnavailableText(platform))
        inputRef.current?.focus()
      } else {
        // Lockout and unreadable-credential messages are already written for users
        setError(result.error === 'Incorrect password' ? "That password didn't work. Check Caps Lock and try again." : friendlyError(result.error, "Pulse couldn't unlock just now — try again"))
        setPassword('')
        await checkLockout()
        inputRef.current?.focus()
      }
    } catch {
      setError("We couldn't unlock just now — try again")
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
      const openKind = result.ok ? null : parseDbOpenFailure(result.error)
      if (result.ok && result.data) {
        toast.success('Recovery key accepted.')
        setRecoverySession(true)
        setLocked(false)
      } else if (openKind) {
        setRecoveryKey('')
        showOpenFailure(openKind, 'recovery key')
      } else if (!result.ok && result.error === KEYRING_UNAVAILABLE) {
        setKeyError(keyringUnavailableText(platform))
      } else {
        // Keep what was typed: one typo shouldn't mean retyping 28 characters
        setKeyError("That key didn't match. Check each group of 4.")
        setTimeout(() => { keyRef.current?.focus(); keyRef.current?.select() }, 0)
      }
    } catch {
      setKeyError("We couldn't check the key just now — try again")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen overflow-y-auto items-center-safe justify-center-safe py-8 bg-slate-50 dark:bg-slate-900">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <PulseMark size={48} />
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{PRODUCT_NAME}</h1>
          </div>
          <div className="flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
            <Lock className="w-4 h-4" />
            <span className="text-base">Your data is locked</span>
          </div>
          {/* After the idle timer, say so: the screen changing on its own looks like a crash (UX-A-29) */}
          {idleMinutes !== null && (
            <p className="mt-2 text-base text-slate-600 dark:text-slate-400">
              Locked after {idleMinutes} minute{idleMinutes === 1 ? '' : 's'} without activity. Change this in Settings → Security.
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 border border-slate-200 dark:border-slate-700">
          {view === 'password' && credentialsUnreadable && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">
                This computer can't unlock this data folder
              </h2>
              <p className="text-base text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
                Pulse's sign-in data is protected by the computer and the computer account it was created on, so it can't be read here.
                Your data is safe. To open it on this computer, restore a .pulse-backup file using your password or recovery key.
              </p>
              <button type="button" className="btn-primary w-full" onClick={() => setView('restore')}>
                Restore from a backup
              </button>
            </>
          )}

          {view === 'open-failed' && openFailure && (
            <>
              <h2 ref={openFailedRef} tabIndex={-1} className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">
                Your {openFailure.via} is right, but {PRODUCT_NAME} couldn't open your data
              </h2>
              <div role="alert" className="text-base text-slate-600 dark:text-slate-300 mb-6 leading-relaxed space-y-3">
                {openFailure.kind === 'newer' && <>
                  <p>Your data was last saved by a newer version of {PRODUCT_NAME} than this one. Nothing has been changed, and your data is safe.</p>
                  <p>Install the newest version of {PRODUCT_NAME}, then unlock again.</p>
                </>}
                {openFailure.kind === 'migration' && <>
                  <p>{PRODUCT_NAME} was updating how your data is stored, and the update didn't finish. It was undone, so your data is safe as it was.</p>
                  <p>Restart your computer and try again. If it happens again, you can restore a backup file (.pulse-backup), or ask whoever supports {PRODUCT_NAME} for you.</p>
                </>}
                {openFailure.kind === 'unreadable' && <>
                  <p>{PRODUCT_NAME} couldn't read your data file. It may be damaged, or another program may be using it. It hasn't been deleted.</p>
                  <p>Restart your computer and try again. If that doesn't help, restore a backup file (.pulse-backup). Your current data file is kept to one side, not deleted.</p>
                </>}
              </div>
              <div className="space-y-3">
                {openFailure.kind !== 'newer' && (
                  <button type="button" className="btn-primary w-full" onClick={() => setView('restore')}>
                    Restore from a backup
                  </button>
                )}
                <button
                  type="button"
                  className={openFailure.kind === 'newer' ? 'btn-primary w-full' : 'btn-secondary w-full'}
                  onClick={() => { setView('password'); setTimeout(() => inputRef.current?.focus(), 0) }}
                >
                  Try again
                </button>
              </div>
            </>
          )}

          {view === 'restore' && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-6">Restore from a backup</h2>
              <RestoreFromBackupForm
                onCancel={() => setView(openFailure ? 'open-failed' : 'password')}
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
                      onKeyDown={e => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
                      onKeyUp={e => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
                      placeholder="Password"
                      aria-label="Password"
                      aria-describedby="unlock-feedback"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="hit-44 absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      onClick={() => setShowPassword(v => !v)}
                      title={showPassword ? 'Hide password' : 'Show password'}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <div id="unlock-feedback">
                    {capsLock && <p className="text-base text-amber-700 dark:text-amber-300 mt-2">Caps Lock is on</p>}
                    {lockoutLeft > 0
                      ? <>
                          <p role="alert" className="sr-only">Too many tries. You can try again in {lockoutTotal} second{lockoutTotal === 1 ? '' : 's'}.</p>
                          <p aria-hidden="true" className="text-base text-red-700 dark:text-red-300 mt-2">Too many tries. You can try again in {lockoutLeft} second{lockoutLeft === 1 ? '' : 's'}.</p>
                        </>
                      : error && <p role="alert" className="text-base text-red-700 dark:text-red-300 mt-2">{error}</p>}
                    <p role="status" className="sr-only">{lockoutOver ? 'You can try again now.' : ''}</p>
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
                  disabled={!password || isSubmitting || lockoutLeft > 0}
                >
                  {isSubmitting ? 'Unlocking…' : lockoutLeft > 0 ? `Wait ${lockoutLeft}s` : 'Unlock'}
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
                  aria-label="Back to password"
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
                  ref={keyRef}
                  autoFocus
                  type="text"
                  className="input font-mono tracking-wider uppercase"
                  value={recoveryKey}
                  aria-label="Recovery key"
                  onChange={e => { setKeyError(null); setRecoveryKey(formatRecoveryKey(e.target.value)) }}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                />
                {keyError && <p role="alert" className="text-base text-red-700 dark:text-red-300">{keyError}</p>}

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
                  aria-label="Back to password"
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
                  No recovery key was saved for this data. It's encrypted, so without your password it can't be opened by anyone, including us.
                </p>
              </div>

              {/* Honest next steps only: a backup needs the same password, so there's no restore button here (audit F-29) */}
              <ul className="list-disc pl-5 space-y-2 text-slate-600 dark:text-slate-300 text-base mb-5">
                {hint && <li>Your hint: <strong>{hint}</strong></li>}
                <li>Check that Caps Lock is off, and try the passwords you use elsewhere.</li>
                <li>Once you're back in, save a recovery key in Settings → Security so this can't happen again.</li>
              </ul>

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
