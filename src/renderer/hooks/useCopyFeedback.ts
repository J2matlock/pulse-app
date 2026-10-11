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
import toast from 'react-hot-toast'
import { friendlyError } from '../utils/friendlyError'

export const COPY_FEEDBACK_MS = 2000

const COPY_FAILED = "We couldn't copy that. Select the text and copy it yourself."

/**
 * Put text on the clipboard. True only when main says it did; otherwise the
 * person is told, so nothing says "Copied" for a copy that didn't happen.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const res = await window.api.copyToClipboard(text)
    if (res.ok) return true
    toast.error(friendlyError(res.error, COPY_FAILED))
  } catch {
    toast.error(COPY_FAILED)
  }
  return false
}

/** Simple boolean variant — `copied` is true for 2s after a copy. */
export function useCopyFeedback() {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => { clearTimeout(timerRef.current) }, [])

  const copyToClipboard = useCallback(async (text: string) => {
    if (!await copyText(text)) return
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
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
    if (!await copyText(text)) return
    setCopiedKey(key)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopiedKey(null), COPY_FEEDBACK_MS)
  }, [])

  const resetCopied = useCallback(() => {
    setCopiedKey(null)
    clearTimeout(timerRef.current)
  }, [])

  return { copiedKey, copyToClipboard, resetCopied } as const
}
