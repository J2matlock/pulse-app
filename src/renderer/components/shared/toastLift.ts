/**
 * Room a bar fixed at the bottom of the window (the grid's bulk-action bar)
 * asks the toast column to keep free, so a toast never lands on its buttons
 * (Q6). The bar reports how far up from the window's bottom edge it reaches;
 * ToastHost puts the column above that.
 */
import { useEffect, useSyncExternalStore } from 'react'

let lift = 0
const listeners = new Set<() => void>()

function setLift(px: number): void {
  if (px === lift) return
  lift = px
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** Pixels from the window's bottom edge the toasts must stay above (0: none) */
export function useToastLift(): number {
  return useSyncExternalStore(subscribe, () => lift, () => 0)
}

/** While mounted, keeps the toasts above this element */
export function useLiftToastsAbove(ref: React.RefObject<HTMLElement | null>, gap: number): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const top = el.getBoundingClientRect().top
      // No layout (jsdom) gives 0 × 0 at the top: nothing to keep free
      setLift(top > 0 ? Math.max(0, window.innerHeight - top + gap) : 0)
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      setLift(0)
    }
  }, [ref, gap])
}
