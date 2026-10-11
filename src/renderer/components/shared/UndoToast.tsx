/**
 * UndoToast — bottom-center floating toast for undoable actions.
 * Shows an 8-second countdown bar and an [Undo] button.
 */
import React, { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useUndoStore } from '../../stores/undoStore'

export function UndoToast(): React.ReactElement | null {
  const { toast, undo, dismissToast, undoStack } = useUndoStore(useShallow(s => ({
    toast: s.toast, undo: s.undo, dismissToast: s.dismissToast, undoStack: s.undoStack,
  })))
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    if (!toast) {
      setProgress(100)
      return
    }
    setProgress(100)
    const start = Date.now()
    const duration = 8000
    const frame = () => {
      const elapsed = Date.now() - start
      const pct = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(pct)
      if (pct > 0) requestAnimationFrame(frame)
    }
    const id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [toast])

  if (!toast) return null

  const canUndo = undoStack.length > 0

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] flex flex-col overflow-hidden rounded-xl shadow-2xl bg-slate-800 text-white"
      style={{ minWidth: 300, maxWidth: 420 }}
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
