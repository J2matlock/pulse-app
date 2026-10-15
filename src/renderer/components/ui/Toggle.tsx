/**
 * On/off switches.
 *
 * Rule: a setting that takes effect at once is a Toggle. A choice inside a
 * form that's saved later (with a Save button) is a checkbox.
 *
 *   <ToggleRow label="Less movement" description="Turn off animations"
 *     checked={reduced} onChange={setReduced} />        a whole 44 px row; clicking its words toggles too
 *   <Toggle checked={on} onChange={setOn} labelId={id} describedBy={descId} />
 *                                                        just the switch, named by a visible label elsewhere
 *
 * role="switch" is on the track button only, and its first child span is the
 * knob, so the forced-colours rules in globals.css find both. On = accent track
 * with a white knob; off = an outlined track with a grey knob (3:1 against the
 * card, A06-30). The words "On" / "Off" show next to it (hidden from screen
 * readers, which already hear the state). Words come from the caller; nothing
 * here names a record or list.
 */
import React, { useId } from 'react'

export interface ToggleProps {
  ref?: React.Ref<HTMLButtonElement>
  checked: boolean
  onChange: (checked: boolean) => void
  /** id of the visible text that names the switch (preferred) */
  labelId?: string
  /** A name for the switch when there's no visible label to point at */
  label?: string
  /** id of the text that says what it does */
  describedBy?: string
  disabled?: boolean
  /** Show "On" / "Off" next to the track (default true) */
  showState?: boolean
  id?: string
  'data-testid'?: string
  'data-tour'?: string
}

export function Toggle({ ref, checked, onChange, labelId, label, describedBy, disabled, showState = true, ...rest }: ToggleProps): React.ReactElement {
  const track = (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-label={labelId ? undefined : label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`hit-44 relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 transition-colors cursor-pointer
        focus:outline-hidden focus-visible:ring-3 focus-visible:ring-accent focus-visible:ring-offset-2
        disabled:opacity-60 disabled:cursor-not-allowed ${checked
        ? 'bg-accent border-accent'
        : 'bg-white border-slate-500 dark:bg-transparent dark:border-slate-400'}`}
      {...rest}
    >
      <span className={`inline-block h-4 w-4 rounded-full transition-transform ${checked
        ? 'translate-x-[22px] bg-white'
        : 'translate-x-0.5 bg-slate-500 dark:bg-slate-400'}`} />
    </button>
  )
  if (!showState) return track
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-2">
      {track}
      <span aria-hidden="true" className={`w-7 text-base font-medium ${checked ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}>
        {checked ? 'On' : 'Off'}
      </span>
    </span>
  )
}

export interface ToggleRowProps {
  icon?: React.ReactNode
  label: string
  /** One line under the label saying what the switch does */
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  /** Not known yet (still being read), or not allowed: the switch can't be pressed */
  disabled?: boolean
  id?: string
  'data-testid'?: string
  'data-tour'?: string
}

/**
 * A setting that is on or off: its name, a one-line description and the
 * switch, in one row at least 44 px tall. Clicking anywhere on the row
 * toggles it, without nesting one control inside another.
 */
export function ToggleRow({ icon, label, description, checked, onChange, disabled, ...rest }: ToggleRowProps): React.ReactElement {
  const labelId = useId()
  const descId = useId()
  function onRowClick(e: React.MouseEvent) {
    // The switch handles its own click
    if (disabled || (e.target as HTMLElement).closest('[role="switch"]')) return
    onChange(!checked)
  }
  return (
    <div
      onClick={onRowClick}
      className={`flex w-full min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-left ${disabled
        ? 'opacity-60'
        : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700'}`}
      {...rest}
    >
      {icon && <span className="flex-shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true">{icon}</span>}
      <span className="flex-1 min-w-0">
        <span id={labelId} className="block text-base text-slate-800 dark:text-slate-100">{label}</span>
        {description && <span id={descId} className="block text-base text-slate-600 dark:text-slate-300">{description}</span>}
      </span>
      <Toggle checked={checked} onChange={onChange} labelId={labelId} describedBy={description ? descId : undefined} disabled={disabled} />
    </div>
  )
}
