import React, { useRef, useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { motion } from 'motion/react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { PasswordStrength } from './PasswordStrength'
import { checkNewPassword, MIN_PASSWORD_LENGTH } from '../../../shared/passwordPolicy'

interface ResetPasswordAfterRecoveryDialogProps {
  open: boolean
  onComplete: () => void
}

export function ResetPasswordAfterRecoveryDialog({ open, onComplete }: ResetPasswordAfterRecoveryDialogProps): React.ReactElement | null {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [hint, setHint] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, open)

  const passwordsMatch = password === confirm
  const isValid = checkNewPassword(password).ok && passwordsMatch

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const result = await safeInvoke(IPC.AUTH_RESET_PASSWORD_AFTER_RECOVERY, password, hint)
      if (result.ok) {
        toast.success('Password updated successfully.')
        onComplete()
      } else {
        setError(result.error || 'Password reset failed. Please try again.')
      }
    } catch {
      setError('Password reset failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {open && (
        <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
          <motion.div ref={trapRef} variants={modalPanelVariants} initial="hidden" animate="visible" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-8">
        <div className="flex items-center gap-3 mb-2">
          <KeyRound className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Set a new password
          </h2>
        </div>
        <p className="text-base text-slate-500 dark:text-slate-400 mb-6">
          You unlocked with your recovery key. You must set a new password before continuing.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
          )}

          <div>
            <label htmlFor="recovery-reset-pw" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">
              New password
            </label>
            <div className="relative">
              <input
                id="recovery-reset-pw"
                type={showPassword ? 'text' : 'password'}
                className="input pr-12 w-full"
                style={{ minHeight: 44 }}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                autoFocus
                autoComplete="new-password"
              />
              <button
                type="button"
                className="hit-44 absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <PasswordStrength password={password} />
          </div>

          <div>
            <label htmlFor="recovery-reset-confirm" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">
              Confirm password
            </label>
            <input
              id="recovery-reset-confirm"
              type={showPassword ? 'text' : 'password'}
              className="input w-full"
              style={{ minHeight: 44 }}
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
            <label htmlFor="recovery-reset-hint" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">
              Password hint <span className="text-slate-500 dark:text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="recovery-reset-hint"
              type="text"
              className="input w-full"
              style={{ minHeight: 44 }}
              value={hint}
              onChange={e => setHint(e.target.value)}
              placeholder="e.g. My cat's name"
              autoComplete="off"
            />
          </div>

          <button
            type="submit"
            className="btn-primary w-full"
            style={{ minHeight: 44 }}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? 'Saving…' : 'Set new password'}
          </button>
        </form>
          </motion.div>
        </motion.div>
      )}
    </>
  )
}
