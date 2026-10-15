/**
 * Shared motion/react variants and the app's three durations. Every movement
 * takes 120–200 ms (Q6): long enough to show what changed and where it went,
 * short enough that nobody waits for it. The CSS side has the same numbers as
 * --motion-fast / --motion-base / --motion-enter (styles/motion.css).
 *
 * Reduced motion: AppMotionConfig turns transform and layout animations off;
 * anything that animates height (lists) checks useReducedMotionConfig() itself.
 */
import type { Variants } from 'motion/react'

/** Seconds: fast = leaving, small things; base = rows moving; enter = things arriving */
export const MOTION = { fast: 0.12, base: 0.18, enter: 0.2 } as const

/** Arriving: starts quick, settles */
export const easeOut = [0.25, 0.46, 0.45, 0.94] as const
/** Leaving: starts slow, gets out of the way */
export const easeIn = [0.55, 0.06, 0.68, 0.19] as const

/** Dropdowns — a short drop from the button (160 ms in, 120 out) */
export const dropdownVariants = {
  hidden: { opacity: 0, y: -6, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.16, ease: easeOut },
  },
  exit: {
    opacity: 0,
    y: -4,
    scale: 0.98,
    transition: { duration: MOTION.fast, ease: easeIn },
  },
} satisfies Variants

/** Context menus — snappy (180 ms in, 120 out) */
export const contextMenuVariants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: MOTION.base, ease: [0.23, 1, 0.32, 1] as const },
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    transition: { duration: MOTION.fast, ease: easeIn },
  },
} satisfies Variants

/** Backdrop overlay — a fade as long as the panel's (150 ms in, 120 out) */
export const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: MOTION.fast } },
} satisfies Variants

/** Modal/dialog panels — fade, a slight scale and 8 px up; 150 ms so a dialog feels instant (plan-Q9: was 250) */
export const modalPanelVariants = {
  hidden: { opacity: 0, scale: 0.98, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.15, ease: easeOut },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    y: 8,
    transition: { duration: MOTION.fast, ease: easeIn },
  },
} satisfies Variants

/** Tooltips — fast fade+scale (120 ms in, 80 ms out) */
export const tooltipVariants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: MOTION.fast, ease: 'easeOut' as const },
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    transition: { duration: 0.08, ease: 'easeIn' as const },
  },
} satisfies Variants
