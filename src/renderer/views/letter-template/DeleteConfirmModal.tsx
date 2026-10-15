import React, { useRef, useState } from 'react'
import type { LetterTemplate } from './types'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'

interface DeleteConfirmProps {
  template: LetterTemplate
  onConfirm: () => Promise<void>
  onClose: () => void
}

/** "Delete <template>?" on the shared confirmation, with the error said out loud if it fails (UX review F-06) */
export function DeleteConfirmModal({ template, onConfirm, onClose }: DeleteConfirmProps): React.ReactElement {
  const [error, setError] = useState<string | null>(null)
  // A second click while the first delete is still running must not delete twice
  const busy = useRef(false)

  async function handleConfirm() {
    if (busy.current) return
    busy.current = true
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch {
      setError("We couldn't delete the template — try again")
    } finally {
      busy.current = false
    }
  }

  return (
    <ConfirmDialog
      open
      title={`Delete "${template.name}"?`}
      message="This can't be undone."
      confirmLabel="Delete"
      onConfirm={() => void handleConfirm()}
      onCancel={onClose}
    >
      {error && <p role="alert" className="mb-4 text-base text-red-600 dark:text-red-400">{error}</p>}
    </ConfirmDialog>
  )
}
