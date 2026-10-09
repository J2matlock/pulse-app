import React from 'react'
import { checkNewPassword, type PasswordStrength as Strength } from '../../../shared/passwordPolicy'

const LEVELS: Record<Strength, { label: string; bars: number; color: string; text: string }> = {
  'too-short':  { label: 'Too short',  bars: 1, color: 'bg-red-500',    text: 'text-red-700 dark:text-red-300' },
  'too-common': { label: 'Too common', bars: 1, color: 'bg-red-500',    text: 'text-red-700 dark:text-red-300' },
  fair:         { label: 'Fair',       bars: 2, color: 'bg-amber-500',  text: 'text-amber-800 dark:text-amber-300' },
  good:         { label: 'Good',       bars: 3, color: 'bg-green-500',  text: 'text-green-800 dark:text-green-300' },
  strong:       { label: 'Strong',     bars: 4, color: 'bg-green-600',  text: 'text-green-800 dark:text-green-300' },
}

/** Live feedback for a NEW password, using the same rules the app enforces. */
export function PasswordStrength({ password, id }: { password: string; id?: string }): React.ReactElement | null {
  if (!password) {
    return (
      <p id={id} className="text-sm text-slate-600 dark:text-slate-300 mt-1">
        At least 12 characters. Tip: a short sentence like “blue tractor sings at noon” is strong and easy to remember.
      </p>
    )
  }
  const check = checkNewPassword(password)
  const level = LEVELS[check.strength]
  return (
    <div id={id} className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i < level.bars ? level.color : 'bg-slate-200 dark:bg-slate-700'}`} />
        ))}
      </div>
      <p className={`text-sm mt-1 font-medium ${level.text}`}>
        {level.label}{check.message ? ` — ${check.message}` : ''}
      </p>
    </div>
  )
}
