import React, { useState, useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton, DangerButton } from '../ui/Button'

interface BaseProps {
  open: boolean
  title: string
  message?: string
  /** The button says the title's verb ("Delete", "Restore"), never "OK" or "Confirm" (UX review F-06) */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
  children?: React.ReactNode
}

interface StandardProps extends BaseProps {
  variant?: 'standard'
  requiredPhrase?: never
}

interface TypedProps extends BaseProps {
  variant: 'typed'
  requiredPhrase: string
}

export type ConfirmDialogProps = StandardProps | TypedProps

/**
 * Modal confirmation dialog, built on the shared Dialog (focus trap, Escape,
 * nested-click guard, pinned buttons).
 * variant="standard" — simple yes/no
 * variant="typed"    — user must type requiredPhrase exactly to enable Confirm
 * Enter confirms from the confirm button or a field, never from Cancel or the X.
 */
export function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement | null {
  const { open, title, message, confirmLabel, onConfirm, onCancel, destructive = true, children } = props
  const [typed, setTyped] = useState('')
  const primaryRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // A fresh start each time it opens. Focus goes to the typed field if there is one, otherwise the confirm button (D-020)
  useEffect(() => {
    if (open) setTyped('')
  }, [open])

  const canConfirm = props.variant === 'typed' ? typed === props.requiredPhrase : true

  function handleKeyDown(e: React.KeyboardEvent) {
    // Escape belongs to the Dialog (it cancels). Enter confirms, but never from Cancel or the X.
    if (e.key === 'Enter' && canConfirm) {
      const target = e.target as HTMLElement
      if (target !== primaryRef.current && target.closest('button, a, select, textarea')) return
      e.stopPropagation()
      // The confirm button would also fire its own click on Enter; confirm once.
      e.preventDefault()
      onConfirm()
    }
  }

  const typedField = props.variant === 'typed' && (
    <div className={children ? 'mt-4' : ''}>
      <label htmlFor="confirm-typed-phrase" className="block text-base text-slate-600 dark:text-slate-400 mb-2">
        Type{' '}
        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
          {props.requiredPhrase}
        </span>{' '}
        to confirm
      </label>
      <input
        id="confirm-typed-phrase"
        ref={inputRef}
        type="text"
        className="input w-full"
        value={typed}
        onChange={e => setTyped(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  )

  const ConfirmButton = destructive ? DangerButton : PrimaryButton

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      size="md"
      // A destructive confirmation interrupts the user, which is what alertdialog means
      role={destructive ? 'alertdialog' : 'dialog'}
      initialFocus={props.variant === 'typed' ? inputRef : primaryRef}
      onKeyDown={handleKeyDown}
      icon={destructive ? (
        <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden="true" />
        </div>
      ) : undefined}
      footer={<>
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        <ConfirmButton ref={primaryRef} onClick={onConfirm} disabled={!canConfirm}>
          {confirmLabel}
        </ConfirmButton>
      </>}
    >
      {children || typedField ? <>{children}{typedField}</> : undefined}
    </Dialog>
  )
}
