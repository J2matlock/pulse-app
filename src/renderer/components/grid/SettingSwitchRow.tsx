import React, { useId } from 'react'

export interface SettingSwitchRowProps {
  icon?: React.ReactNode
  label: string
  /** One line under the label saying what the switch does */
  description?: string
  checked: boolean
  /** Not known yet (still being read): the switch can't be pressed */
  disabled?: boolean
  onChange: () => void
}

/**
 * A setting that is on or off: a real toggle (track and knob) with its name and a
 * one-line description, so it reads as a switch and not as a menu item (B-10).
 * The whole row is the button, so it's a 44 px target.
 */
export function SettingSwitchRow({ icon, label, description, checked, disabled, onChange }: SettingSwitchRowProps): React.ReactElement {
  const labelId = useId()
  const descId = useId()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      onClick={onChange}
      className="flex items-center gap-3 w-full px-3 py-2 min-h-[44px] text-left rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700
                 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 disabled:opacity-60"
    >
      {icon && <span className="flex-shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true">{icon}</span>}
      <span className="flex-1 min-w-0">
        <span id={labelId} className="block text-base text-slate-800 dark:text-slate-100">{label}</span>
        {description && <span id={descId} className="block text-sm text-slate-600 dark:text-slate-300">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 transition-colors ${checked
          ? 'bg-blue-600 border-blue-600'
          : 'bg-white border-slate-500 dark:bg-transparent dark:border-slate-400'}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full transition-transform ${checked
          ? 'translate-x-[22px] bg-white'
          : 'translate-x-0.5 bg-slate-500 dark:bg-slate-400'}`} />
      </span>
      <span className={`w-7 flex-shrink-0 text-sm font-medium ${checked ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`} aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
    </button>
  )
}
