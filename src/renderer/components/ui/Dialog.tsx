/**
 * The app's dialog shell. Use it instead of building a fixed backdrop, an
 * aria-modal panel and a focus trap by hand (tests/renderer/designSystem.test.ts
 * counts those).
 *
 *   <Dialog open={open} onClose={close} title="Rename column" size="md"
 *     footer={<>
 *       <SecondaryButton onClick={close}>Cancel</SecondaryButton>
 *       <PrimaryButton onClick={save}>Rename</PrimaryButton>
 *     </>}>
 *     …fields…
 *   </Dialog>
 *
 * - Header: the title and an X button labelled "Close". It stays put.
 * - Body: the description, then children. Only this part scrolls, so the
 *   buttons never scroll out of sight in a short window or at 200 % zoom.
 * - Footer (optional): pinned under a line, actions right-aligned. Put Cancel
 *   first and the main action last; the main action's label is a verb that
 *   matches the title ("Rename"), never "OK" (tests/renderer/confirmDialogLabels.test.ts).
 * - size: sm 384 px · md 448 px (default) · lg 512 px · xl 672 px.
 * - role="alertdialog" for a question that interrupts (a destructive confirm).
 * - initialFocus: the element to focus when it opens; otherwise the first
 *   focusable one (the trap's choice), unless something inside took focus.
 * - Escape, the X and a click on the backdrop all call onClose, unless
 *   dismissible={false}: a step that must be finished with its own button
 *   (the recovery key screen) has no X and ignores Escape and the backdrop.
 *   closeOnBackdrop={false} keeps the X and Escape but ignores a click outside,
 *   for a form whose edits a stray click shouldn't throw away. A backdrop click in
 *   the first 350 ms is ignored too: it's the second click of the double-click that
 *   opened the dialog (useRepeatClickGuard drops most of those already).
 * - Other props (data-testid, data-tour, id, aria-*, onKeyDown) go on the panel.
 *
 * Safety details carried over from ConfirmDialog: the shared focus trap (a
 * dialog opened over another takes Tab and Escape until it closes, and focus
 * goes back to where it was, Q-050); Escape is marked handled so page-level
 * Escape handlers leave it alone; clicks inside don't reach a dialog behind
 * it (Q-051); motion variants that follow reduced motion.
 */
import React, { useEffect, useId, useRef } from 'react'
import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { IconButton } from './Button'
import { LAYER } from './layers'

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

// Motion's own drag and animation handlers have different types, so the DOM ones are left out
type PanelAttributes = Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'role' | 'children' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration' | 'onDrag' | 'onDragStart' | 'onDragEnd'>

export interface DialogProps extends PanelAttributes {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  size?: DialogSize
  role?: 'dialog' | 'alertdialog'
  initialFocus?: React.RefObject<HTMLElement | null>
  /** Shown before the title, e.g. a warning icon in a circle */
  icon?: React.ReactNode
  footer?: React.ReactNode
  /** false: no X, and Escape and the backdrop do nothing (default true) */
  dismissible?: boolean
  /** false: a click outside does nothing; the X and Escape still close it (default true) */
  closeOnBackdrop?: boolean
  children?: React.ReactNode
}

/** How long after opening a click on the backdrop is taken as the opening double-click's second half */
export const BACKDROP_GRACE_MS = 350

const WIDTH: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
}

export function Dialog({
  open, onClose, title, description, size = 'md', role = 'dialog', initialFocus, icon, footer, dismissible = true, closeOnBackdrop = true, children,
  className, onKeyDown, ...rest
}: DialogProps): React.ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const openedAt = useRef(0)

  useFocusTrap(panelRef, open, { onEscape: dismissible ? onClose : undefined })

  useEffect(() => {
    if (open) openedAt.current = Date.now()
  }, [open])

  useEffect(() => {
    if (!open || !initialFocus) return
    // After the trap's own first focus (next frame), so this choice wins
    const timer = setTimeout(() => initialFocus.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [open, initialFocus])

  if (!open) return null

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      // preventDefault tells page-level Escape handlers (the record page) it's taken
      e.preventDefault()
      e.stopPropagation()
      if (dismissible) onClose()
      return
    }
    onKeyDown?.(e)
  }

  function handleBackdropClick() {
    if (Date.now() - openedAt.current < BACKDROP_GRACE_MS) return
    onClose()
  }

  const hasChildren = children !== undefined && children !== null && children !== false
  const hasBody = description !== undefined || hasChildren

  return (
    <div
      className={`fixed inset-0 ${LAYER.dialog} flex items-center justify-center p-4`}
      // Opened inside another dialog, a click here must not reach that dialog's backdrop and close it (Q-051)
      onClick={e => e.stopPropagation()}
    >
      <motion.div
        className="fixed inset-0 bg-black/50"
        variants={backdropVariants}
        initial="hidden"
        animate="visible"
        onClick={dismissible && closeOnBackdrop ? handleBackdropClick : undefined}
        data-dialog-backdrop=""
        aria-hidden="true"
      />
      <motion.div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description !== undefined ? descriptionId : undefined}
        className={`relative flex w-full ${WIDTH[size]} max-h-[calc(100vh-2rem)] flex-col rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800 ${className ?? ''}`}
        variants={modalPanelVariants}
        initial="hidden"
        animate="visible"
        onKeyDown={handleKeyDown}
        {...rest}
      >
        <div className={`flex flex-shrink-0 items-start gap-3 pl-6 ${dismissible ? 'pr-16' : 'pr-6'} pt-6 ${hasBody ? 'pb-3' : 'pb-6'}`}>
          {icon && <div className="flex-shrink-0">{icon}</div>}
          <h2 id={titleId} className={`min-w-0 flex-1 ${icon ? 'pt-2' : 'pt-0.5'} text-xl font-semibold text-slate-800 dark:text-slate-100`}>
            {title}
          </h2>
        </div>

        {hasBody && (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {description !== undefined && (
              <p id={descriptionId} className="text-base text-slate-600 dark:text-slate-300">{description}</p>
            )}
            {hasChildren && <div className={description !== undefined ? 'mt-4' : ''}>{children}</div>}
          </div>
        )}

        {footer && (
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-700">
            {footer}
          </div>
        )}

        {/* Last in the tab order, so opening the dialog lands on its content rather than on the X */}
        {dismissible && <IconButton label="Close" size="compact" icon={<X className="w-5 h-5" />} onClick={onClose} className="absolute top-5 right-5" />}
      </motion.div>
    </div>
  )
}
