/**
 * UndoToast — bottom-right floating toast for undoable actions, where the
 * app's other toasts appear (not over the buttons in the middle: UX D-28).
 * Shows a 5-second countdown bar and an [Undo] button; it waits while the
 * pointer or focus is on it.
 */
import React, { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useUndoStore, UNDO_TOAST_MS } from '../../stores/undoStore'

export function UndoToast(): React.ReactElement | null {
  const { toast, undo, dismissToast, holdToast, undoStack } = useUndoStore(useShallow(s => ({
    toast: s.toast, undo: s.undo, dismissToast: s.dismissToast, holdToast: s.holdToast, undoStack: s.undoStack,
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

  const canUndo = undoStack.length > 0

  return (
    <div
      className="fixed bottom-6 right-6 z-[300] flex flex-col overflow-hidden rounded-xl shadow-2xl bg-slate-800 text-white"
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
        <span className="flex-1 text-sm break-words min-w-0">{toast.description}</span>
        {canUndo && (
          <button
            onClick={() => void undo()}
            className="hit-44 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-base font-medium transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-400"
            style={{ minHeight: 36 }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Undo
          </button>
        )}
        <button
          onClick={dismissToast}
          className="hit-44 p-1.5 rounded-sm hover:bg-slate-700 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-slate-400"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        </button>
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
