/**
 * useCopyFeedback — encapsulates the copy-to-clipboard + visual feedback pattern.
 *
 * Supports two modes:
 *  1. Simple boolean: `copied` is true/false after copying.
 *  2. Keyed: `copiedKey` tracks WHICH field was copied (string or number key).
 *
 * Auto-resets after COPY_FEEDBACK_MS. Cleans up the timer on unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export const COPY_FEEDBACK_MS = 2000

/** Simple boolean variant — `copied` is true for 2s after a copy. */
export function useCopyFeedback() {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => { clearTimeout(timerRef.current) }, [])

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await window.api.copyToClipboard(text)
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    } catch { /* clipboard unavailable */ }
  }, [])

  const resetCopied = useCallback(() => {
    setCopied(false)
    clearTimeout(timerRef.current)
  }, [])

  return { copied, copyToClipboard, resetCopied } as const
}

/** Keyed variant — tracks which field was copied via a key (string or number). */
export function useCopyFeedbackKeyed<K extends string | number = string>() {
  const [copiedKey, setCopiedKey] = useState<K | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => { clearTimeout(timerRef.current) }, [])

  const copyToClipboard = useCallback(async (text: string, key: K) => {
    try {
      await window.api.copyToClipboard(text)
      setCopiedKey(key)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopiedKey(null), COPY_FEEDBACK_MS)
    } catch { /* clipboard unavailable */ }
  }, [])

  const resetCopied = useCallback(() => {
    setCopiedKey(null)
    clearTimeout(timerRef.current)
  }, [])

  return { copiedKey, copyToClipboard, resetCopied } as const
}
