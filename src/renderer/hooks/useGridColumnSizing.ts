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
} from '../components/grid/gridConstants'

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
    const headerWidth = col.name.length * CHAR_WIDTH_HEADER + HEADER_PADDING
    // Measure what the cell shows, not what it stores: a date's deadline words, a link's names
    const ruleId = takesDeadlineRule(col.column_type) ? ruleIdFromConfig(col.config) : undefined
    const rule = ruleId !== undefined ? useAlertStore.getState().rules.find(r => r.id === ruleId) : undefined
    const maxContentWidth = sample.reduce((max, row) => {
      const val = cellFitText(col, (row[`col_${colId}` as keyof GridRow] as string | null) ?? null, row, rule)
      return Math.max(max, val.length * CHAR_WIDTH_CELL + CELL_PADDING)
    }, MIN_COL_WIDTH)
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
  // Offsets include the leading fixed-width columns (handle, profile, acuity)
  const frozenLeftOffsets = useMemo(() => {
    const offsets = new Map<number, number>()
    if (frozenColumnCount <= 0) return offsets
    const leadingWidth = HANDLE_WIDTH + PROFILE_BTN_WIDTH + (acuityEnabled ? ACUITY_BADGE_WIDTH : 0) + (showTagsColumn ? TAGS_COL_WIDTH : 0)
    let cumLeft = leadingWidth
    for (let i = 0; i < Math.min(frozenColumnCount, columns.length); i++) {
      const col = columns[i]!
      const w = columnSizing[`col_${col.id}`] ?? col.width
      offsets.set(col.id, cumLeft)
      cumLeft += Math.max(w, 60)
    }
    return offsets
  }, [frozenColumnCount, columns, columnSizing, acuityEnabled, showTagsColumn])

  return { columnSizing, handleColumnSizingChange, autoFitColumn, columnWidthVars, frozenLeftOffsets }
}
