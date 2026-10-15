/**
 * Every click is acknowledged at once (Q6): a button that starts slow work is
 * busy from the click (disabled, aria-busy, so a second click can't run it
 * twice) and shows a spinner only once the work has taken SPINNER_AFTER_MS,
 * so quick actions never flash one.
 *
 *   const [save, { busy }] = useBusyAction(async () => { await … })
 *   <PrimaryButton busy={busy} onClick={() => void save()}>Save</PrimaryButton>
 *
 * The shared buttons work out the spinner themselves from `busy`; showSpinner
 * is here for anything else that wants the same timing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { SPINNER_AFTER_MS } from '../../shared/constants'

/** True once `on` has stayed true for `ms`; false again as soon as it's false */
export function useDelayedFlag(on: boolean, ms: number = SPINNER_AFTER_MS): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!on) { setLate(false); return }
    const timer = setTimeout(() => setLate(true), ms)
    return () => clearTimeout(timer)
  }, [on, ms])
  return on && late
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function'
}

/**
 * Wraps fn so it runs once at a time. A fn that returns a promise keeps `busy`
 * true until it settles (also when it fails; the error goes back to the caller);
 * a plain function never sets it, so nothing flickers.
 */
export function useBusyAction<A extends unknown[]>(fn: (...args: A) => unknown): [
  (...args: A) => Promise<void>,
  { busy: boolean; showSpinner: boolean },
] {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const running = useRef(false)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const run = useCallback(async (...args: A) => {
    if (running.current) return
    const result = fnRef.current(...args)
    if (!isThenable(result)) return
    running.current = true
    setBusy(true)
    try {
      await result
    } finally {
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }, [])

  return [run, { busy, showSpinner: useDelayedFlag(busy) }]
}
