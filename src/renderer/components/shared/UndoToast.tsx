/**
 * UndoToast — the toast for undoable actions, at the bottom of the app's one
 * toast column (ToastHost places it; other toasts stack above it), not over
 * the buttons in the middle (UX D-28). Shows a countdown bar and an [Undo]
 * button; it waits while the pointer or focus is on it.
 */
import React, { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
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

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg shadow-2xl bg-slate-800 text-white"
      style={{ minWidth: 300, maxWidth: 420 }}
      onMouseEnter={() => hold(true)}
      onMouseLeave={() => hold(false)}
      onFocus={() => hold(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold(false) }}
      role="status"
      aria-live="polite"
    >
      {/* Content row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex-1 text-base break-words min-w-0">{toast.description}</span>
        {action && (
          <SecondaryButton tone="inverse" onClick={() => { dismissToast(); action.run() }}>
            {action.label}
          </SecondaryButton>
        )}
        {canUndo && (
          <PrimaryButton tone="inverse" icon={<RotateCcw className="w-4 h-4" />} title={`Undo (${modHelp('Ctrl+Z')})`} onClick={() => void undoFromToast()}>
            Undo
          </PrimaryButton>
        )}
        <IconButton label="Dismiss" size="compact" tone="inverse" icon={<X className="w-4 h-4" />} onClick={dismissToast} />
      </div>
      {/* Countdown bar */}
      <div className="h-0.5 bg-slate-700">
        <div
          className="h-full bg-blue-500 transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
