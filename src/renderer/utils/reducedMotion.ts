/**
 * Whether movement should be skipped right now: Settings → Reduce motion
 * (useThemeEffect puts .reduce-motion on <html>) or the computer's own
 * setting. For code outside React (stores); components use motion/react's
 * useReducedMotionConfig(), which AppMotionConfig feeds the same two answers.
 * Without a window that can tell (tests, no matchMedia), nothing animates.
 */
export function motionReduced(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return true
  if (document.documentElement.classList.contains('reduce-motion')) return true
  if (typeof window.matchMedia !== 'function') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}

/** How long a leaving record or list item takes to close up (--motion-base in motion.css) */
export const ROW_LEAVE_MS = 180
/** How long a record that just arrived stays lit (.motion-flash) */
export const ROW_FLASH_MS = 1200
