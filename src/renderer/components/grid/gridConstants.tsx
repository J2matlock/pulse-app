import React from 'react'

export const ROW_HEIGHTS = { compact: 44, comfortable: 44, spacious: 52 } as const
export const HANDLE_WIDTH = 32  // Width of the row drag-handle column
// The open-record, star and row-menu buttons each have their own column, a 44px click area apiece (Q-103, D-034)
export const OPEN_COL_WIDTH = 44
export const STAR_COL_WIDTH = 44
/** The "⋯" that opens the row's menu by mouse (UX-B-01) */
export const MENU_COL_WIDTH = 44
/** The open, star and menu columns together: the room between the select box and the next column */
export const PROFILE_BTN_WIDTH = OPEN_COL_WIDTH + STAR_COL_WIDTH + MENU_COL_WIDTH
/** The built-in Tags column: a record's tags from its page (G-37) */
export const TAGS_COL_WIDTH = 160
/** The "+" after the last column header that adds a column, as a spreadsheet would (UX-B-03) */
export const ADD_COL_WIDTH = 44

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

// Pre-computed static style objects to avoid re-creating on each render
export const HANDLE_STYLE: React.CSSProperties = { width: HANDLE_WIDTH }

const _ALERT_BASE = 'inline-flex items-center justify-center flex-shrink-0 mr-1'
const _ALERT_SIZE = 'w-3.5 h-3.5'

// Static SVG nodes for non-overdue alert states (overdue uses dynamic aria-label with day count)
const _ALERT_SHAPE_RED = (
  <span className={_ALERT_BASE} role="img" aria-label="Urgent">
    <svg className={_ALERT_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 2L1.5 13.5h13L8 2z"/>
      <path d="M8 7v3" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="8" cy="12" r="0.5" fill="currentColor"/>
    </svg>
  </span>
)
const _ALERT_SHAPE_ORANGE = (
  <span className={_ALERT_BASE} role="img" aria-label="Warning">
    <svg className={_ALERT_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 1.5L14.5 8L8 14.5L1.5 8z"/>
    </svg>
  </span>
)
const _ALERT_SHAPE_YELLOW = (
  <span className={_ALERT_BASE} role="img" aria-label="Caution">
    <svg className={_ALERT_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1"/>
    </svg>
  </span>
)

const _ALERT_SHAPE_CIRCLE = (label: string) => (
  <span className={_ALERT_BASE} role="img" aria-label={label}>
    <svg className={_ALERT_SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5"/>
    </svg>
  </span>
)

/**
 * The shape for a deadline cell, chosen by where its color band sits in the
 * rule's order, not by the color's name (N-04, G-10): built-in and custom
 * rules store hex colors. Late = warning sign, due today = triangle, the
 * nearest band before that = diamond, the next = square, further = circle.
 * The band's own label ("Due soon") is what a screen reader hears.
 */
export function alertShapeForBand(daysUntil: number, threshold: { daysBefore: number; label?: string; bgClass: string }, thresholds: Array<{ daysBefore: number }>): React.ReactNode {
  const label = threshold.label?.trim()
  if (daysUntil < 0) {
    return (
      <span className={_ALERT_BASE} role="img" aria-label={`${label ? `${label}: ` : ''}${Math.abs(daysUntil)} day${daysUntil === -1 ? '' : 's'} overdue`}>
        <svg className={_ALERT_SIZE} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 1L1 14h14L8 1z" fill="none" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M8 6v4M8 11.5v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </span>
    )
  }
  if (daysUntil === 0) return withLabel(_ALERT_SHAPE_RED, label || 'Due today')
  const ahead = [...new Set(thresholds.map(t => t.daysBefore).filter(n => n > 0))].sort((a, b) => a - b)
  const rank = ahead.indexOf(threshold.daysBefore)
  if (rank <= 0) return withLabel(_ALERT_SHAPE_ORANGE, label || 'Due soon')
  if (rank === 1) return withLabel(_ALERT_SHAPE_YELLOW, label || 'Coming up')
  return _ALERT_SHAPE_CIRCLE(label || 'Coming up')
}

function withLabel(node: React.ReactElement, label: string): React.ReactElement {
  return React.cloneElement(node as React.ReactElement<{ 'aria-label'?: string }>, { 'aria-label': label })
}

/**
 * List toolbar buttons (V1, UX-B-09): the toolbar is a size container. Under about
 * 1280px the buttons drop their icons to make room; their names stay at every width,
 * and what still doesn't fit folds into the More menu (GridToolbar's tiers).
 */
export const TOOLBAR_ICON = '@max-7xl:hidden'
