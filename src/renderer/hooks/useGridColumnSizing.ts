import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnSizingState } from '@tanstack/react-table'
import type { Column, GridRow } from '../../shared/types'
import { takesDeadlineRule } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { useGridStore } from '../stores/gridStore'
import { useAlertStore } from '../stores/alertStore'
import { rlog } from '../utils/rendererLogger'
import { pulseEvents } from '../events'
import { cellFitText } from '../components/grid/CellDisplay'
import { BADGE_WIDTH as ACUITY_BADGE_WIDTH } from '../components/grid/AcuityBadge'
import {
  HANDLE_WIDTH, PROFILE_BTN_WIDTH, CHAR_WIDTH_HEADER, CHAR_WIDTH_CELL, HEADER_PADDING, CELL_PADDING,
  MIN_COL_WIDTH, DEFAULT_COL_WIDTH, MAX_AUTO_FIT_WIDTH, TAGS_COL_WIDTH,
  FIT_HEADER_PADDING, FIT_ICON_RULE, FIT_ICON_SORT, FIT_ICON_MENU, FIT_CELL_PADDING, FIT_CELL_SHAPE,
} from '../components/grid/gridConstants'

// One off-screen canvas for every Fit; none in jsdom, where the character widths stand in
let measureCtx: OffscreenCanvasRenderingContext2D | null = null
function textWidth(text: string, font: string): number | null {
  if (!measureCtx) {
    if (typeof OffscreenCanvas === 'undefined') return null
    measureCtx = new OffscreenCanvas(1, 1).getContext('2d')
    if (!measureCtx) return null
  }
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

const FALLBACK_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
/** The grid's own font, read from a cell on screen: names are semibold, values regular */
function gridFonts(): { cell: string; header: string } {
  const el = typeof document !== 'undefined' ? document.querySelector('.grid-cell') : null
  const cs = el ? getComputedStyle(el) : null
  const family = cs?.fontFamily || FALLBACK_FAMILY
  const size = cs?.fontSize || '15px'
  return { cell: `400 ${size} ${family}`, header: `600 ${size} ${family}` }
}

/** For tests: forget the canvas, so a stubbed one is picked up */
export function resetFitMeasure(): void { measureCtx = null }

function ruleIdFromConfig(config: string | null | undefined): number | undefined {
  try { return (JSON.parse(config || '{}') as { alert_rule_id?: number }).alert_rule_id } catch { return undefined }
}

interface UseGridColumnSizingOptions {
  activeGridId: number | null
  columns: Column[]
  acuityEnabled: boolean
  showTagsColumn: boolean
  frozenColumnCount: number
  updateColumn: (columnId: number, updates: Partial<Column>) => Promise<boolean>
}

/**
 * Column widths in the grid: dragged widths (saved after a pause), Fit and the
 * Wider/Narrower menu items, the CSS width variables and the frozen columns' offsets.
 */
export function useGridColumnSizing({
  activeGridId, columns, acuityEnabled, showTagsColumn, frozenColumnCount, updateColumn,
}: UseGridColumnSizingOptions) {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({})
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Width changes waiting for the debounce, worked out against the list they were made in
  const pendingWidthsRef = useRef<{ columnId: number; width: number }[] | null>(null)
  const flushColumnWidths = useCallback(() => {
    if (resizeTimeoutRef.current) { clearTimeout(resizeTimeoutRef.current); resizeTimeoutRef.current = null }
    const updates = pendingWidthsRef.current
    pendingWidthsRef.current = null
    if (!updates || updates.length === 0) return
    // The new widths stay for this visit either way; only reopening would lose them
    void safeInvoke(IPC.COLUMN_BATCH_UPDATE_WIDTHS, updates).then(res => {
      if (!res.ok) rlog.error('DataGrid', 'Failed to batch update column widths', res.error)
    })
  }, [])

  // Leaving the list (or switching to another) within the debounce saves the widths now
  // instead of dropping them (Q-088)
  useEffect(() => () => flushColumnWidths(), [activeGridId, flushColumnWidths])

  // A drag of a column's edge is saved when it ends, not after the pause (UX pass Q3);
  // the pause stays for Narrower and Wider in the menu, which can be pressed again
  useEffect(() => {
    const end = () => { if (pendingWidthsRef.current) flushColumnWidths() }
    window.addEventListener('mouseup', end)
    window.addEventListener('touchend', end)
    return () => {
      window.removeEventListener('mouseup', end)
      window.removeEventListener('touchend', end)
    }
  }, [flushColumnWidths])

  // Reset column sizing when switching grids
  useEffect(() => {
    setColumnSizing({})
  }, [activeGridId])

  // Handle column sizing changes — debounce persistence to DB
  const handleColumnSizingChange = useCallback((updater: unknown) => {
    setColumnSizing(prev => {
      const next = typeof updater === 'function'
        ? (updater as (old: ColumnSizingState) => ColumnSizingState)(prev)
        : updater as ColumnSizingState

      // Debounce persist — batch all width changes in a single IPC call. The changes are
      // worked out now, against this list's columns, so a flush after a switch saves them
      // to the right columns (Q-088)
      const widthUpdates: { columnId: number; width: number }[] = []
      for (const col of useGridStore.getState().columns) {
        const newWidth = next[`col_${col.id}`]
        if (newWidth !== undefined && Math.round(newWidth) !== col.width) {
          widthUpdates.push({ columnId: col.id, width: Math.round(newWidth) })
        }
      }
      pendingWidthsRef.current = widthUpdates
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current)
      resizeTimeoutRef.current = setTimeout(flushColumnWidths, 500)

      return next
    })
  }, [flushColumnWidths])

  // Auto-fit a column to its content width
  const autoFitColumn = useCallback((colId: number) => {
    const col = useGridStore.getState().columns.find(c => c.id === colId)
    if (!col) return
    const storeRows = useGridStore.getState().rows
    const sample = storeRows.length > 500 ? storeRows.slice(0, 500) : storeRows
    // Measure what the cell shows, not what it stores: a date's deadline words, a link's names
    const ruleId = takesDeadlineRule(col.column_type) ? ruleIdFromConfig(col.config) : undefined
    const rule = ruleId !== undefined ? useAlertStore.getState().rules.find(r => r.id === ruleId) : undefined
    const texts = sample.map(row => cellFitText(col, (row[`col_${colId}` as keyof GridRow] as string | null) ?? null, row, rule))
    // The real widths in the grid's font, with the header's clock, sort arrows and "…" (UX pass Q3)
    const fonts = gridFonts()
    const measuredHeader = textWidth(col.name, fonts.header)
    let headerWidth: number
    let maxContentWidth: number
    if (measuredHeader !== null) {
      const logIcon = (() => { try { return (JSON.parse(col.config || '{}') as { log_changes?: boolean }).log_changes ? 16 : 0 } catch { return 0 } })()
      headerWidth = Math.ceil(measuredHeader) + FIT_HEADER_PADDING + FIT_ICON_SORT + FIT_ICON_MENU + (rule ? FIT_ICON_RULE : 0) + logIcon
      const shape = rule ? FIT_CELL_SHAPE : 0
      maxContentWidth = texts.reduce((max, val) => Math.max(max, Math.ceil(textWidth(val, fonts.cell) ?? 0) + FIT_CELL_PADDING + shape), MIN_COL_WIDTH)
    } else {
      headerWidth = col.name.length * CHAR_WIDTH_HEADER + HEADER_PADDING
      maxContentWidth = texts.reduce((max, val) => Math.max(max, val.length * CHAR_WIDTH_CELL + CELL_PADDING), MIN_COL_WIDTH)
    }
    const newWidth = Math.min(Math.max(headerWidth, maxContentWidth, DEFAULT_COL_WIDTH), MAX_AUTO_FIT_WIDTH)
    setColumnSizing(prev => ({ ...prev, [`col_${colId}`]: newWidth }))
    void updateColumn(colId, { width: newWidth })
  }, [updateColumn])

  // Wider, Narrower and Fit from a column's menu, so widths change without a mouse (AUDIT-150)
  useEffect(() => pulseEvents.on('column:resize', ({ columnId, change }) => {
    if (change === 'fit') { autoFitColumn(columnId); return }
    const col = useGridStore.getState().columns.find(c => c.id === columnId)
    if (!col) return
    const key = `col_${columnId}`
    handleColumnSizingChange((prev: ColumnSizingState) => {
      const cur = prev[key] ?? col.width
      const next = Math.min(800, Math.max(MIN_COL_WIDTH, cur + (change === 'wider' ? 40 : -40)))
      return { ...prev, [key]: next }
    })
  }), [autoFitColumn, handleColumnSizingChange])

  // CSS custom properties for column widths
  const columnWidthVars = useMemo(() => {
    const vars: Record<string, string> = {}
    for (const col of columns) {
      const w = columnSizing[`col_${col.id}`] ?? col.width
      vars[`--cw-${col.id}`] = `${Math.max(w, 60)}px`
    }
    return vars
  }, [columns, columnSizing])

  // Frozen column left offsets for CSS sticky positioning
  // Offsets include the leading fixed-width columns (handle, profile, acuity).
  // The same Map comes back while the offsets are the same, so dragging a column that
  // isn't frozen doesn't redraw every record (each row compares it; UX pass Q3)
  const lastOffsets = useRef<Map<number, number>>(new Map())
  const frozenLeftOffsets = useMemo(() => {
    const offsets = new Map<number, number>()
    if (frozenColumnCount > 0) {
      const leadingWidth = HANDLE_WIDTH + PROFILE_BTN_WIDTH + (acuityEnabled ? ACUITY_BADGE_WIDTH : 0) + (showTagsColumn ? TAGS_COL_WIDTH : 0)
      let cumLeft = leadingWidth
      for (let i = 0; i < Math.min(frozenColumnCount, columns.length); i++) {
        const col = columns[i]!
        const w = columnSizing[`col_${col.id}`] ?? col.width
        offsets.set(col.id, cumLeft)
        cumLeft += Math.max(w, 60)
      }
    }
    const prev = lastOffsets.current
    if (prev.size === offsets.size && [...offsets].every(([id, left]) => prev.get(id) === left)) return prev
    lastOffsets.current = offsets
    return offsets
  }, [frozenColumnCount, columns, columnSizing, acuityEnabled, showTagsColumn])

  return { columnSizing, handleColumnSizingChange, autoFitColumn, columnWidthVars, frozenLeftOffsets }
}
