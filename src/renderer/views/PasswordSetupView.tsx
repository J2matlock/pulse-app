import React, { useRef, useState } from 'react'
import { usePlatform, cloudFolderAdvice } from '../utils/platformText'
import { Lock, Eye, EyeOff, Shield, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSettingsStore } from '../stores/settingsStore'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { RecoveryKeyDisplayModal } from '../components/shared/RecoveryKeyDisplayModal'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { RestoreFromBackupForm } from '../components/shared/RestoreFromBackupForm'
import { PasswordStrength } from '../components/shared/PasswordStrength'
import { checkNewPassword } from '../../shared/passwordPolicy'
import { PRODUCT_NAME } from '../../shared/constants'

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
  const termsRef = useRef<HTMLInputElement>(null)

  // Just the two actions: a settings change elsewhere needn't redraw this screen (AUDIT-137)
  const setPasswordSetup = useSettingsStore(s => s.setPasswordSetup)
  const setLocked = useSettingsStore(s => s.setLocked)

  const passwordsMatch = password === confirm

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
      if (!pw.ok) setMissing(pw.message ?? 'Choose a longer password.')
      else if (!matchNow) setMissing("The two passwords don't match. Type the same password in both boxes.")
      else { setMissing('Tick the box to agree to the Terms of Use and Privacy Policy.'); termsRef.current?.focus() }
      return
    }
    setMissing(null)

    setIsSubmitting(true)
    try {
      const result = await safeInvoke(IPC.AUTH_SETUP_PASSWORD, pwNow, hint)

      if (!result.ok) {
        toast.error('Password setup failed. Please try again.')
        setIsSubmitting(false)
        return
      }

      if (result.data.cloudWarning) setCloudWarning(result.data.cloudWarning)

      // Move to recovery key prompt instead of immediately unlocking
      setStep('recovery-prompt')
    } catch {
      toast.error('Setup failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleGenerateRecoveryKey() {
    try {
      const result = await safeInvoke(IPC.AUTH_GENERATE_RECOVERY_KEY)
      if (result.ok) {
        setGeneratedKey(result.data)
        setStep('recovery-display')
      } else {
        toast.error('Failed to generate recovery key.')
      }
    } catch {
      toast.error('Failed to generate recovery key.')
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
              <p className="text-amber-800 dark:text-amber-300 text-sm leading-relaxed">
                We strongly recommend setting up a recovery key now. You can also do this later in Settings.
              </p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={handleGenerateRecoveryKey}
                className="btn-primary w-full"
                style={{ minHeight: 44 }}
              >
                Generate Recovery Key
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
                confirmLabel="Skip"
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

  // Password creation form (original)
  return (
    <div className="flex h-screen overflow-y-auto items-center-safe justify-center-safe py-8 bg-slate-50 dark:bg-slate-900">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <Shield className="w-10 h-10 text-blue-600" />
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{PRODUCT_NAME}</h1>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-base">
            Set a password to protect your data.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-6">
            Create your password
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="password-setup-password" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password-setup-password"
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-12"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 12 characters"
                  aria-describedby="password-setup-strength"
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
              <label htmlFor="password-setup-confirm" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">
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
              />
              {confirm.length > 0 && !passwordsMatch && (
                <p className="text-red-600 dark:text-red-400 text-sm mt-1">Passwords do not match</p>
              )}
            </div>

            <div>
              <label htmlFor="password-setup-hint" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">
                Password hint <span className="text-slate-500 dark:text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="password-setup-hint"
                type="text"
                className="input"
                value={hint}
                onChange={e => setHint(e.target.value)}
                placeholder="e.g. My cat's name"
                autoComplete="off"
              />
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                The hint will be shown on the lock screen — don't make it too obvious.
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
              <div className="flex gap-3">
                <Lock className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-blue-800 dark:text-blue-300 text-sm leading-relaxed">
                  Your data is encrypted with your password. If you forget it, your data cannot be recovered unless you set up a recovery key (available after setup).
                </p>
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                ref={termsRef}
                type="checkbox"
                checked={acceptedTerms}
                onChange={e => { setAcceptedTerms(e.target.checked); if (e.target.checked) setMissing(null) }}
                className="mt-0.5 w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500 cursor-pointer flex-shrink-0"
              />
              <span className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
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

            {missing && <p role="alert" className="text-base text-red-700 dark:text-red-300">{missing}</p>}

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Setting up…' : 'Create password & continue'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-700 text-center">
            <p className="text-base text-slate-600 dark:text-slate-400 mb-2">Already use Pulse on another computer?</p>
            <button
              type="button"
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-base font-medium"
              style={{ minHeight: 44 }}
              onClick={() => setStep('restore')}
            >
              Restore from a backup
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
