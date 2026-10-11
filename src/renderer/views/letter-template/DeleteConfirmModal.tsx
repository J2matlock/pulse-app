import React, { useEffect, useRef, useState } from 'react'
import type { LetterTemplate } from './types'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface DeleteConfirmProps {
  template: LetterTemplate
  onConfirm: () => Promise<void>
  onClose: () => void
}

export function DeleteConfirmModal({ template, onConfirm, onClose }: DeleteConfirmProps): React.ReactElement {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, true)

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleConfirm() {
    setDeleting(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch {
      setError('Could not delete the template. Please try again.')
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="letter-delete-title" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-5">
          <h2 id="letter-delete-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">
            Delete Template
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-300">
            Are you sure you want to delete <strong>{template.name}</strong>? This cannot be undone.
          </p>
          {error && (
            <p className="mt-3 text-base text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                       text-base text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-base font-medium
                       focus:outline-hidden focus:ring-3 focus:ring-red-500 focus:ring-offset-3
                       disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
