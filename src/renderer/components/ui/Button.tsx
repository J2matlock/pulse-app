/**
 * The app's buttons. Use these instead of a <button> with btn-* classes or
 * hand-picked colours (tests/renderer/designSystem.test.ts counts those).
 *
 *   <PrimaryButton onClick={save}>Save</PrimaryButton>              the one main action on a screen or dialog
 *   <SecondaryButton onClick={cancel}>Cancel</SecondaryButton>      every other action
 *   <DangerButton onClick={remove}>Delete</DangerButton>            deletes or loses something
 *   <IconButton label="Close" icon={<X />} onClick={close} />       icon only; the label is its name and tooltip
 *                                                                   (variant: ghost | secondary | primary)
 *
 * All of them:
 * - are 44 px tall (size="compact": 36 px drawn inside a 44 px click area, for toolbars);
 * - are type="button" unless you pass type="submit";
 * - pass every other prop (data-tour, data-testid, id, aria-*, className for margins)
 *   to the real <button>, and take a React 19 `ref`;
 * - busy: disabled and aria-busy while something runs (a spinner comes later, Q6);
 * - tone="inverse" on a dark bar (bulk-action bar, Undo toast).
 *
 * The look stays in globals.css (.btn-primary, .btn-compact-secondary, …) so
 * existing selectors and the high-contrast and forced-colours rules keep working.
 */
import React from 'react'
import { Tooltip } from '../shared/Tooltip'

export type ButtonSize = 'normal' | 'compact'
export type ButtonTone = 'default' | 'inverse'
type Kind = 'primary' | 'secondary' | 'danger'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: React.Ref<HTMLButtonElement>
  size?: ButtonSize
  /** A lucide icon before the text; it's hidden from screen readers */
  icon?: React.ReactNode
  busy?: boolean
  tone?: ButtonTone
}

const KIND_CLASS: Record<Kind, Record<ButtonSize, string>> = {
  primary: { normal: 'btn-primary', compact: 'btn-compact-primary' },
  secondary: { normal: 'btn-secondary', compact: 'btn-compact-secondary' },
  danger: { normal: 'btn-danger', compact: 'btn-compact-danger' },
}

const INVERSE_CLASS: Record<Kind, string> = {
  primary: 'focus-visible:ring-offset-slate-800',
  secondary: 'border-transparent bg-white/10 text-white hover:bg-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 focus-visible:ring-offset-slate-800',
  danger: 'focus-visible:ring-offset-slate-800',
}

const DISABLED = 'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:transform-none'

function classes(kind: Kind, size: ButtonSize, tone: ButtonTone, extra?: string): string {
  return [KIND_CLASS[kind][size], tone === 'inverse' ? INVERSE_CLASS[kind] : '', DISABLED, extra ?? ''].filter(Boolean).join(' ')
}

function makeButton(kind: Kind, displayName: string) {
  function KindButton({ ref, size = 'normal', icon, busy = false, tone = 'default', type = 'button', className, disabled, children, ...rest }: ButtonProps): React.ReactElement {
    return (
      <button
        ref={ref}
        type={type}
        className={classes(kind, size, tone, className)}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...rest}
      >
        {icon && <span aria-hidden="true" className="inline-flex flex-shrink-0">{icon}</span>}
        {children}
      </button>
    )
  }
  KindButton.displayName = displayName
  return KindButton
}

export const PrimaryButton = makeButton('primary', 'PrimaryButton')
export const SecondaryButton = makeButton('secondary', 'SecondaryButton')
export const DangerButton = makeButton('danger', 'DangerButton')

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
  ref?: React.Ref<HTMLButtonElement>
  /** What the button does ("Close", "More actions for Jane"). Becomes aria-label and the tooltip. */
  label: string
  icon: React.ReactNode
  /** Shown after the label in the tooltip, e.g. "Ctrl+F" */
  shortcut?: string
  /** normal: 44 × 44; compact: 36 × 36 drawn inside a 44 px click area */
  size?: ButtonSize
  tone?: ButtonTone
  /** ghost (default): no background until hovered; secondary: outlined; primary: accent fill (a Save tick) */
  variant?: IconVariant
  tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right'
  busy?: boolean
}

export type IconVariant = 'ghost' | 'secondary' | 'primary'
const ICON_SIZE: Record<ButtonSize, string> = { normal: 'w-11 h-11', compact: 'w-9 h-9 hit-44' }
const ICON_VARIANT: Record<IconVariant, Record<ButtonTone, string>> = {
  ghost: {
    default: 'text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100',
    inverse: 'text-slate-200 hover:bg-white/10 hover:text-white',
  },
  secondary: {
    default: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
    inverse: 'border border-white/30 text-white hover:bg-white/10',
  },
  primary: {
    default: 'bg-accent text-white hover:bg-accent-hover dark:bg-accent-hover dark:hover:bg-blue-700',
    inverse: 'bg-accent text-white hover:bg-accent-hover dark:bg-accent-hover dark:hover:bg-blue-700',
  },
}

export function IconButton({
  ref, label, icon, shortcut, size = 'normal', tone = 'default', variant = 'ghost', tooltipPlacement = 'top',
  busy = false, type = 'button', className, disabled, ...rest
}: IconButtonProps): React.ReactElement {
  const cls = [
    'inline-flex items-center justify-center flex-shrink-0 rounded-lg transition-colors cursor-pointer',
    'focus:outline-hidden focus-visible:ring-3 focus-visible:ring-accent',
    ICON_SIZE[size], ICON_VARIANT[variant][tone], DISABLED, className ?? '',
  ].filter(Boolean).join(' ')
  return (
    <Tooltip content={shortcut ? `${label} (${shortcut})` : label} placement={tooltipPlacement}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cls}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...rest}
      >
        <span aria-hidden="true" className="inline-flex">{icon}</span>
      </button>
    </Tooltip>
  )
}
