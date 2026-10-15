/**
 * Shared Framer Motion (motion/react) variants for the Pulse app.
 * Import these in any component that needs enter/exit transitions.
 */
import type { Variants } from 'motion/react'

/** Dropdowns — "slow and slidey" (280ms ease-out) */
export const dropdownVariants = {
  hidden: { opacity: 0, y: -8, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  exit: {
    opacity: 0,
    y: -6,
    scale: 0.96,
    transition: { duration: 0.18, ease: [0.55, 0.06, 0.68, 0.19] as const },
  },
} satisfies Variants

/** Context menus — snappier spring-like (180ms) */
export const contextMenuVariants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] as const },
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    transition: { duration: 0.12, ease: [0.55, 0.06, 0.68, 0.19] as const },
  },
} satisfies Variants

/** Backdrop overlay — simple fade, as long as the panel's (150ms) */
export const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
} satisfies Variants

/** Modal/dialog panels — scale 0.95→1 + fade + slide up 16px; 150ms so a dialog feels instant (plan-Q9: was 250) */
export const modalPanelVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 16 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 16,
    transition: { duration: 0.15, ease: [0.55, 0.06, 0.68, 0.19] as const },
  },
} satisfies Variants

/** Tooltips — fast fade+scale (120ms in, 80ms out) */
export const tooltipVariants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.12, ease: 'easeOut' as const },
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    transition: { duration: 0.08, ease: 'easeIn' as const },
  },
} satisfies Variants
