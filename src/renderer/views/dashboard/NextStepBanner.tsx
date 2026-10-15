/**
 * The line under the dashboard's title (UX pass Q2): what's most urgent across
 * every list, and one button that opens it. Not a card, so Customize can't
 * hide or move it. When nothing is due it says what the dashboard is for.
 */
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button'
import { useVocab } from '../../hooks/useVocab'
import type { NextStep, NextStepKind } from './nextStep'

const ICON: Record<NextStepKind, React.ReactNode> = {
  // Red is the deadline colour for late: status only, never the button
  overdue: <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden="true" />,
  today: <Clock className="w-5 h-5 text-orange-700 dark:text-orange-400" aria-hidden="true" />,
  next: <CheckCircle className="w-5 h-5 text-green-700 dark:text-green-400" aria-hidden="true" />,
}

export function NextStepBanner({ step }: { step: NextStep | null }): React.ReactElement {
  const navigate = useNavigate()
  // The dashboard spans every list, so the workspace's words
  const { f } = useVocab(null)

  if (!step) {
    return (
      <p data-purpose data-testid="next-step" className="mb-6 text-base text-slate-600 dark:text-slate-300">
        {f('Everything due across your {list:many}, most urgent first.')}
      </p>
    )
  }

  return (
    <div data-testid="next-step" className="mb-6 flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
      {/* The sentence is announced when it changes (after a Done); the button isn't */}
      <div role="status" className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex-shrink-0">{ICON[step.kind]}</span>
        <div className="min-w-0">
          <p className="text-base font-medium text-slate-800 dark:text-slate-100">{step.sentence}</p>
          {step.detail && <p className="text-base text-slate-600 dark:text-slate-300">{step.detail}</p>}
        </div>
      </div>
      {step.kind === 'next' ? (
        <SecondaryButton size="compact" onClick={() => navigate(step.path)}>{step.action}</SecondaryButton>
      ) : (
        <PrimaryButton size="compact" data-primary-action onClick={() => navigate(step.path)}>{step.action}</PrimaryButton>
      )}
    </div>
  )
}
