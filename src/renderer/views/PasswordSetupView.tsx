import React, { useRef, useState } from 'react'
import { usePlatform, cloudFolderAdvice } from '../utils/platformText'
import { Eye, EyeOff, Shield, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSettingsStore } from '../stores/settingsStore'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { RecoveryKeyDisplayModal } from '../components/shared/RecoveryKeyDisplayModal'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { RestoreFromBackupForm } from '../components/shared/RestoreFromBackupForm'
import { PasswordStrength } from '../components/shared/PasswordStrength'
import { FieldError, fieldErrorProps } from '../components/shared/FieldError'
import { checkNewPassword } from '../../shared/passwordPolicy'
import { PRODUCT_NAME } from '../../shared/constants'
import { parseDbOpenFailure, dbOpenFailureText } from '../../shared/dbOpen'

type SetupStep = 'password' | 'recovery-prompt' | 'recovery-display' | 'restore'

export function PasswordSetupView(): React.ReactElement {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [hint, setHint] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [step, setStep] = useState<SetupStep>('password')
  // Shown as a card on the next screen, not a passing toast (audit F-36)
  const [cloudWarning, setCloudWarning] = useState<string | null>(null)
  const platform = usePlatform()
  const [generatedKey, setGeneratedKey] = useState('')
  const [showSkipConfirm, setShowSkipConfirm] = useState(false)
  // What's still missing, said on submit instead of a silently greyed-out button (audit F-25)
  const [missing, setMissing] = useState<string | null>(null)
  // A weak password was submitted: the meter under the box already says why, so the
  // box is marked and focused instead of the same words appearing twice (UX-A-13)
  const [pwRejected, setPwRejected] = useState(false)
  const termsRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  // The password just saved. The recovery-key step confirms with it, so it still works
  // after main's 10-minute no-password setup window has closed (R1-01)
  const savedPasswordRef = useRef<string | null>(null)

  // Just the two actions: a settings change elsewhere needn't redraw this screen (AUDIT-137)
  const setPasswordSetup = useSettingsStore(s => s.setPasswordSetup)
  const setLocked = useSettingsStore(s => s.setLocked)

  const passwordsMatch = password === confirm
  // Which box the submit-time message is about, so that box points at it
  const passwordInvalid = pwRejected && !checkNewPassword(password).ok
  const confirmInvalid = !!missing && !passwordInvalid && !passwordsMatch
  const confirmMismatch = confirm.length > 0 && !passwordsMatch && 'Passwords do not match'

  function finishSetup() {
    setPasswordSetup(true)
    setLocked(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isSubmitting) return
    // Read what's actually in the boxes: a password manager or autofill can fill
    // them without the change events that keep the state up to date
    const form = e.currentTarget as HTMLFormElement
    const boxValue = (id: string, fallback: string) => (form.querySelector<HTMLInputElement>(`#${id}`)?.value ?? fallback)
    const pwNow = boxValue('password-setup-password', password)
    const confirmNow = boxValue('password-setup-confirm', confirm)
    if (pwNow !== password) setPassword(pwNow)
    if (confirmNow !== confirm) setConfirm(confirmNow)
    const matchNow = pwNow === confirmNow
    if (!(checkNewPassword(pwNow).ok && matchNow && acceptedTerms)) {
      const pw = checkNewPassword(pwNow)
      if (!pw.ok) {
        // Only an empty box needs words of its own; otherwise the meter has them
        setMissing(pwNow ? null : 'Type a password first — at least 12 characters.')
        setPwRejected(true)
        passwordRef.current?.focus()
      }
      else if (!matchNow) setMissing("The two passwords don't match. Type the same password in both boxes.")
      else { setMissing('Tick the box to agree to the Terms of Use and Privacy Policy.'); termsRef.current?.focus() }
      return
    }
    setMissing(null)
    setPwRejected(false)

    setIsSubmitting(true)
    try {
      const result = await safeInvoke(IPC.AUTH_SETUP_PASSWORD, pwNow, hint)

      if (!result.ok) {
        const openKind = parseDbOpenFailure(result.error)
        if (openKind) {
          // The password is set but the new data wouldn't open: the lock screen takes it from
          // here (sign in again; it says what's wrong and offers a restore) (F-031)
          toast.error(dbOpenFailureText(openKind, PRODUCT_NAME), { duration: 12000 })
          setPasswordSetup(true)
          setLocked(true)
        } else {
          toast.error("We couldn't set up your password — try again")
        }
        setIsSubmitting(false)
        return
      }

      if (result.data.cloudWarning) setCloudWarning(result.data.cloudWarning)
      savedPasswordRef.current = pwNow

      // Move to recovery key prompt instead of immediately unlocking
      setStep('recovery-prompt')
    } catch {
      toast.error("We couldn't set up your password — try again")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleGenerateRecoveryKey() {
    try {
      const result = await safeInvoke(IPC.AUTH_GENERATE_RECOVERY_KEY, savedPasswordRef.current ?? undefined)
      if (result.ok) {
        savedPasswordRef.current = null
        setGeneratedKey(result.data)
        setStep('recovery-display')
      } else {
        toast.error("We couldn't make a recovery key — try again")
      }
    } catch {
      toast.error("We couldn't make a recovery key — try again")
    }
  }

  // Recovery key display modal
  if (step === 'recovery-display') {
    return (
      <div className="flex h-screen overflow-y-auto items-center-safe justify-center-safe py-8 bg-slate-50 dark:bg-slate-900">
        <RecoveryKeyDisplayModal
          open={true}
          recoveryKey={generatedKey}
          onClose={finishSetup}
        />
      </div>
    )
  }

  // Recovery key prompt
  if (step === 'recovery-prompt') {
    return (
      <div className="flex h-screen overflow-y-auto items-center-safe justify-center-safe py-8 bg-slate-50 dark:bg-slate-900">
        <div className="w-full max-w-md px-4">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-3">
              <Shield className="w-10 h-10 text-blue-600" />
              <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{PRODUCT_NAME}</h1>
            </div>
          </div>

          {cloudWarning && (
            <div role="alert" className="mb-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-4">
              <p className="text-base font-semibold text-amber-900 dark:text-amber-200 mb-1">Your data is in a synced folder</p>
              <p className="text-base text-amber-800 dark:text-amber-300 leading-relaxed">{cloudFolderAdvice(cloudWarning, platform)}</p>
            </div>
          )}

          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <KeyRound className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                Set up a recovery key?
              </h2>
            </div>

            <p className="text-base text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
              A recovery key lets you unlock your data if you ever forget your password. Without one, a forgotten password means permanent data loss.
            </p>

            <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg p-3 mb-6">
              <p className="text-amber-800 dark:text-amber-300 text-base leading-relaxed">
                Takes a minute: we show you a 28-character key to print or write down. You can also do this later in Settings → Security.
              </p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={handleGenerateRecoveryKey}
                className="btn-primary w-full"
                style={{ minHeight: 44 }}
              >
                Show my recovery key
              </button>

              <button
                type="button"
                onClick={() => setShowSkipConfirm(true)}
                className="hit-44 w-full text-center text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-base py-2"
              >
                I understand the risk — skip recovery key
              </button>
              <ConfirmDialog
                open={showSkipConfirm}
                title="Skip recovery key?"
                message="Without a recovery key, a forgotten password means permanent data loss. Are you sure you want to skip?"
                confirmLabel="Skip without a recovery key"
                destructive
                onConfirm={() => { setShowSkipConfirm(false); finishSetup() }}
                onCancel={() => setShowSkipConfirm(false)}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Restore an existing caseload from a .pulse-backup (new computer)
  if (step === 'restore') {
    return (
      <div className="flex h-screen overflow-y-auto items-center-safe justify-center-safe py-8 bg-slate-50 dark:bg-slate-900">
        <div className="w-full max-w-md px-4">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-3">
              <Shield className="w-10 h-10 text-blue-600" />
              <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{PRODUCT_NAME}</h1>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 border border-slate-200 dark:border-slate-700">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">Restore from a backup</h2>
            <p className="text-base text-slate-600 dark:text-slate-400 mb-6">
              Bring your data over from another computer using a .pulse-backup file.
            </p>
            <RestoreFromBackupForm onCancel={() => setStep('password')} onRestored={finishSetup} />
          </div>
        </div>
      </div>
    )
  }

  // Password creation form. Everything fits a 768 px screen, so the button is in view
  // without scrolling (UX-A-04): no repeated encryption notice (the next screen has it),
  // the hint's advice as its label, and tighter spacing.
  return (
    <div className="flex h-screen overflow-y-auto items-center-safe justify-center-safe py-6 bg-slate-50 dark:bg-slate-900">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-5">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Shield className="w-10 h-10 text-blue-600" />
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{PRODUCT_NAME}</h1>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-base">
            Set a password to protect your data. Your data is encrypted with it.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">
            Create your password
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password-setup-password" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  ref={passwordRef}
                  id="password-setup-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-12"
                  value={password}
                  onChange={e => { setPassword(e.target.value); if (!password) setMissing(null) }}
                  placeholder="At least 12 characters"
                  aria-invalid={passwordInvalid || undefined}
                  aria-describedby={passwordInvalid ? 'password-setup-strength password-setup-missing' : 'password-setup-strength'}
                  autoFocus
                  autoComplete="new-password"
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
              <PasswordStrength password={password} id="password-setup-strength" />
            </div>

            <div>
              <label htmlFor="password-setup-confirm" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                Confirm password
              </label>
              <input
                id="password-setup-confirm"
                type={showPassword ? 'text' : 'password'}
                className="input"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                {...fieldErrorProps('password-setup-confirm', confirmMismatch, confirmInvalid ? 'password-setup-missing' : undefined)}
                aria-invalid={confirmMismatch || confirmInvalid ? true : undefined}
              />
              {/* Not announced while typing; the submit message is */}
              <FieldError fieldId="password-setup-confirm" error={confirmMismatch} className="text-red-600 dark:text-red-400 text-base mt-1" announce={false} />
            </div>

            <div>
              <label htmlFor="password-setup-hint" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                Password hint <span className="text-slate-500 dark:text-slate-400 font-normal">(optional — shown on the lock screen)</span>
              </label>
              <input
                id="password-setup-hint"
                type="text"
                className="input"
                value={hint}
                onChange={e => setHint(e.target.value)}
                placeholder="Something only you'd understand"
                autoComplete="off"
              />
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                ref={termsRef}
                type="checkbox"
                checked={acceptedTerms}
                onChange={e => { setAcceptedTerms(e.target.checked); if (e.target.checked) setMissing(null) }}
                className="mt-0.5 w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500 cursor-pointer flex-shrink-0"
              />
              <span className="text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                I agree to the{' '}
                <a
                  href="https://www.baringasoft.com/terms.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300"
                  onClick={e => { e.preventDefault(); safeInvoke(IPC.APP_OPEN_EXTERNAL, 'https://www.baringasoft.com/terms.html') }}
                >
                  Terms of Use
                </a>
                {' '}and{' '}
                <a
                  href="https://www.baringasoft.com/privacy.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300"
                  onClick={e => { e.preventDefault(); safeInvoke(IPC.APP_OPEN_EXTERNAL, 'https://www.baringasoft.com/privacy.html') }}
                >
                  Privacy Policy
                </a>
              </span>
            </label>

            {missing
              ? <p id="password-setup-missing" role="alert" className="text-base text-red-700 dark:text-red-300">{missing}</p>
              // Said once for screen readers; sighted users read the meter under the box
              : passwordInvalid && <p id="password-setup-missing" role="alert" className="sr-only">{checkNewPassword(password).message ?? 'Choose a longer password.'}</p>}

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Setting up…' : 'Create password & continue'}
            </button>
          </form>

          <p className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 text-center text-base text-slate-600 dark:text-slate-400 flex flex-wrap items-center justify-center gap-x-2">
            Already use Pulse on another computer?
            <button
              type="button"
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-base font-medium"
              style={{ minHeight: 44 }}
              onClick={() => setStep('restore')}
            >
              Restore from a backup
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
