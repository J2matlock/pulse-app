/**
 * alertColors.ts — Helpers for rendering alert threshold colors.
 *
 * bgClass can be:
 *   - A hex string like "#f87171" → applied as semi-transparent inline background
 *   - A CSS class like "alert-pulse" / "alert-pulse-dark" → className (has keyframe animation)
 *   - A legacy CSS class like "alert-green" → className (still works for old rules)
 */

import type React from 'react'

/** Convert a 6-digit hex color to rgba with the given opacity. */
function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(148, 163, 184, ${opacity})`
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

/**
 * Returns className + style to apply for a given bgClass value.
 * Hex colors are rendered at 30% opacity so text remains legible.
 */
export function resolveAlertColor(bgClass: string): {
  className: string
  style: React.CSSProperties
} {
  if (bgClass.startsWith('#')) {
    return {
      className: '',
      style: { backgroundColor: hexToRgba(bgClass, 0.30) },
    }
  }
  // CSS class (alert-pulse, alert-pulse-dark, legacy alert-green, etc.)
  return { className: bgClass, style: {} }
}
