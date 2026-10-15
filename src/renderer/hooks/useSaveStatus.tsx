import React, { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useGridStore } from '../stores/gridStore'

/** How long "Saved" stays after a real save */
export const SAVED_SHOWN_MS = 3000

/**
 * "Saving…", "Saved" (for a few seconds after a real save) or the save error, for a
 * footer to show. Null while there's nothing to say (audit 2.11). Shared by the app's
 * bottom bar and the list's own footer (UX-B-42).
 */
export function useSaveStatus(): React.ReactNode {
  const { isSaving, saveError } = useGridStore(useShallow(s => ({ isSaving: s.isSaving, saveError: s.saveError })))
  const [justSaved, setJustSaved] = useState(false)
  const wasSaving = useRef(isSaving)
  useEffect(() => {
    if (wasSaving.current && !isSaving && !saveError) setJustSaved(true)
    wasSaving.current = isSaving
  }, [isSaving, saveError])
  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => setJustSaved(false), SAVED_SHOWN_MS)
    return () => clearTimeout(t)
  }, [justSaved])

  if (isSaving) return <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Saving…</span></>
  if (saveError) return <><AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" /><span className="text-red-600 dark:text-red-400">{saveError}</span></>
  if (justSaved) return <><CheckCircle className="w-3.5 h-3.5 text-green-500" /><span className="text-green-600 dark:text-green-400">Saved</span></>
  return null
}
