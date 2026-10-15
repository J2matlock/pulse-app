/**
 * UndoToast — the toast for undoable actions, at the bottom of the app's one
 * toast column (ToastHost places it; other toasts stack above it), not over
 * the buttons in the middle (UX D-28). Shows a countdown bar and an [Undo]
 * button; it waits while the pointer or focus is on it. It never takes focus, so
 * Enter meant for the page doesn't land on it, and it says Ctrl+Z works too, for
 * whoever's hands stay on the keyboard (persona study R3).
 */
import React, { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { motion } from 'motion/react'
import { MOTION, easeOut } from '../../utils/animations'
import { useShallow } from 'zustand/react/shallow'
import { useUndoStore, UNDO_TOAST_MS } from '../../stores/undoStore'
import { PrimaryButton, SecondaryButton, IconButton } from '../ui/Button'
import { modHelp } from '../../utils/keys'
import { ArchiveReasonDialog } from './ArchiveReasonDialog'

export function UndoToast(): React.ReactElement {
  // The dialog a toast's "Add a reason…" opens outlives the toast, so it's mounted here, not inside it
  return <><UndoToastBody /><ArchiveReasonDialog /></>
}

function UndoToastBody(): React.ReactElement | null {
  const { toast, undoFromToast, dismissToast, holdToast, topId } = useUndoStore(useShallow(s => ({
    toast: s.toast, undoFromToast: s.undoFromToast, dismissToast: s.dismissToast, holdToast: s.holdToast,
    topId: s.undoStack[s.undoStack.length - 1]?.id,
  })))
  const [progress, setProgress] = useState(100)
  const [held, setHeld] = useState(false)
  const hold = (on: boolean) => { setHeld(on); holdToast(on) }

  useEffect(() => {
    if (!toast || held) {
      setProgress(100)
      // A toast that went away while held leaves the next one free to count down
      if (!toast) setHeld(false)
      return
    }
    setProgress(100)
    const start = Date.now()
    const duration = UNDO_TOAST_MS
    const frame = () => {
      const elapsed = Date.now() - start
      const pct = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(pct)
      if (pct > 0) requestAnimationFrame(frame)
    }
    const id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [toast, held])

  if (!toast) return null

  const canUndo = !!toast.itemId && toast.itemId === topId
  const action = toast.action
  const dismiss = <IconButton label="Dismiss" size="compact" tone="inverse" icon={<X className="w-4 h-4" />} onClick={dismissToast} />

  return (
    // Each new toast rises 12 px into place (Q6); under reduced motion it only fades in
    <motion.div
      key={toast.itemId ?? toast.description}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.enter, ease: easeOut }}
      className="flex flex-col overflow-hidden rounded-lg shadow-2xl bg-slate-800 text-white"
      style={{ minWidth: 300, maxWidth: 420 }}
      onMouseEnter={() => hold(true)}
      onMouseLeave={() => hold(false)}
      onFocus={() => hold(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold(false) }}
      role="status"
      aria-live="polite"
    >
      {/* With a second button the words get their own line, so they aren't squeezed into a narrow column */}
      <div className={`flex gap-3 px-4 py-3 ${action ? 'flex-col' : 'items-center'}`}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="flex-1 text-base break-words min-w-0">
            {toast.description}
            {canUndo && <span className="text-slate-300"> · {modHelp('Ctrl+Z')} also undoes</span>}
          </span>
          {action && dismiss}
        </div>
        <div className="flex items-center justify-end gap-3">
          {action && (
            <SecondaryButton tone="inverse" onClick={() => { dismissToast(); action.run() }}>
              {action.label}
            </SecondaryButton>
          )}
          {canUndo && (
            <PrimaryButton tone="inverse" icon={<RotateCcw className="w-4 h-4" />} title={`Undo (${modHelp('Ctrl+Z')})`} aria-keyshortcuts="Control+Z" onClick={() => void undoFromToast()}>
              Undo
            </PrimaryButton>
          )}
          {!action && dismiss}
        </div>
      </div>
      {/* Countdown bar */}
      <div className="h-0.5 bg-slate-700">
        <div
          className="h-full bg-blue-500 transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </motion.div>
  )
}
