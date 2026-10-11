import React from 'react'

export const ROW_HEIGHTS = { compact: 44, comfortable: 44, spacious: 52 } as const
export const HANDLE_WIDTH = 32  // Width of the row drag-handle column
export const PROFILE_BTN_WIDTH = 64  // Width of per-row open + star buttons column

// Auto-fit column sizing constants
export const CHAR_WIDTH_HEADER = 9
export const CHAR_WIDTH_CELL = 8
export const HEADER_PADDING = 72
export const CELL_PADDING = 32
export const MIN_COL_WIDTH = 60
export const DEFAULT_COL_WIDTH = 80
export const MAX_AUTO_FIT_WIDTH = 400

// Virtual scrolling
export const GROUP_HEADER_HEIGHT = 44
export const VIRTUAL_OVERSCAN = 20

// Pre-computed static style objects to avoid re-creating on each render
export const HANDLE_STYLE: React.CSSProperties = { width: HANDLE_WIDTH }

const _ALERT_BASE = 'inline-flex items-center justify-center flex-shrink-0 mr-1'
const _ALERT_SIZE = 'w-3.5 h-3.5'

// Static SVG nodes for non-overdue alert states (overdue uses dynamic aria-label with day count)
const _ALERT_SHAPE_RED = (
  <span className={_ALERT_BASE} aria-label="Urgent">
    <svg className={_ALERT_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 2L1.5 13.5h13L8 2z"/>
      <path d="M8 7v3" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="8" cy="12" r="0.5" fill="currentColor"/>
    </svg>
  </span>
)
const _ALERT_SHAPE_ORANGE = (
  <span className={_ALERT_BASE} aria-label="Warning">
    <svg className={_ALERT_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 1.5L14.5 8L8 14.5L1.5 8z"/>
    </svg>
  </span>
)
const _ALERT_SHAPE_YELLOW = (
  <span className={_ALERT_BASE} aria-label="Caution">
    <svg className={_ALERT_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1"/>
    </svg>
  </span>
)

/**
 * Returns a small shape indicator for alert thresholds so color is never the sole indicator.
 * Shapes: circle (green/safe), diamond (yellow/caution), triangle (orange/warning),
 * exclamation triangle (red/urgent), double exclamation (pulsing/overdue).
 */
export function alertShapeForThreshold(bgClass: string, daysUntil: number): React.ReactNode {
  if (bgClass === 'alert-pulse' || bgClass === 'alert-pulse-dark') {
    return (
      <span className={_ALERT_BASE} aria-label={`${Math.abs(daysUntil)} days overdue`}>
        <svg className={_ALERT_SIZE} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 1L1 14h14L8 1z" fill="none" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M8 6v4M8 11.5v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </span>
    )
  }
  if (bgClass === 'alert-red') return _ALERT_SHAPE_RED
  if (bgClass === 'alert-orange') return _ALERT_SHAPE_ORANGE
  if (bgClass === 'alert-yellow') return _ALERT_SHAPE_YELLOW
  return null
}
