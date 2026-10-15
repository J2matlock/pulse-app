/**
 * Done on the dashboard (Q6): the row slides out and closes up (.motion-item-leave,
 * 180 ms) before it's taken out of the list, so it's clear what went where.
 * The rows below move up into its place. Under reduced motion it goes at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motionReduced, ROW_LEAVE_MS } from '../../utils/reducedMotion'

export function useLeavingItems(): {
  leaving: ReadonlySet<string>
  /** Mark the item with this key as leaving, then call remove once it has gone */
  leaveThen: (key: string, remove: () => void) => void
} {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const pending = timers.current
    return () => { for (const t of pending) clearTimeout(t); pending.clear() }
  }, [])

  const leaveThen = useCallback((key: string, remove: () => void) => {
    if (motionReduced()) { remove(); return }
    setLeaving(prev => new Set(prev).add(key))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      remove()
      setLeaving(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }, ROW_LEAVE_MS)
    timers.current.add(timer)
  }, [])

  return { leaving, leaveThen }
}
