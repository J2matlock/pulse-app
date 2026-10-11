import React, { useState, useEffect, useRef, useId } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, X } from 'lucide-react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'

interface BaseProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
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
 * Modal confirmation dialog.
 * variant="standard" — simple yes/no
 * variant="typed"    — user must type requiredPhrase exactly to enable Confirm
 */
export function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement | null {
  const { open, title, message, confirmLabel = 'Confirm', onConfirm, onCancel, destructive = true, children } = props
  const [typed, setTyped] = useState('')
  const primaryRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<Element | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement
      setTyped('')
      // Focus the typed input if present, otherwise the confirm button
      setTimeout(() => {
        if (props.variant === 'typed') inputRef.current?.focus()
        else primaryRef.current?.focus()
      }, 50)
    } else {
      // Restore focus on close
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus()
        previousFocusRef.current = null
      }
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- focus management: save/restore focus on open/close; no other deps needed

  const canConfirm = props.variant === 'typed' ? typed === props.requiredPhrase : true

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      // preventDefault tells page-level Escape handlers (the record page) it's taken
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
    if (e.key === 'Enter' && canConfirm) {
      // Enter on Cancel, the X or any other control must do that control's
      // job, never the (usually destructive) confirm.
      const target = e.target as HTMLElement
      if (target !== primaryRef.current && target.closest('button, a, select, textarea')) return
      e.stopPropagation()
      // The confirm button would also fire its own click on Enter; confirm once.
      e.preventDefault()
      onConfirm()
    }
    // Focus trap: Tab/Shift+Tab stays within dialog
    if (e.key === 'Tab' && panelRef.current) {
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={handleKeyDown}
        >
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            onClick={onCancel}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 mx-4"
            variants={modalPanelVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Close button */}
            <button
              onClick={onCancel}
              className="hit-44 absolute top-4 right-4 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
              aria-label="Close"
              title="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div className="flex items-start gap-3 mb-4">
              {destructive && (
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
              )}
              <div className="min-w-0 flex-1 pt-1">
                <h2
                  id={titleId}
                  className="text-base font-semibold text-slate-800 dark:text-slate-100"
                >
                  {title}
                </h2>
                {message && (
                  <p className="mt-1 text-base text-slate-500 dark:text-slate-400">{message}</p>
                )}
              </div>
            </div>

            {/* Optional extra content */}
            {children}

            {/* Typed confirmation input */}
            {props.variant === 'typed' && (
              <div className="mb-5">
                <label htmlFor="confirm-typed-phrase" className="block text-base text-slate-600 dark:text-slate-400 mb-1.5">
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
                  style={{ minHeight: 44 }}
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={onCancel}
                className="btn-secondary"
                style={{ minHeight: 40, padding: '0 16px', fontSize: 15 }}
                title="Cancel (Escape)"
              >
                Cancel
              </button>
              <button
                ref={primaryRef}
                onClick={onConfirm}
                disabled={!canConfirm}
                className={
                  destructive
                    ? 'bg-red-600 hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900/50 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed focus:outline-hidden focus-visible:ring-3 focus-visible:ring-red-500'
                    : 'btn-primary'
                }
                style={{ minHeight: 40, padding: '0 16px', fontSize: 15 }}
                title={confirmLabel}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
}
