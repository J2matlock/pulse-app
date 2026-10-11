import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  createColumnHelper,
  type SortingState,
  type ColumnSizingState,
  type Row,
} from '@tanstack/react-table'
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
} from '@dnd-kit/sortable'
import { AnimatePresence } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useShallow } from 'zustand/react/shallow'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import { useProfileStore } from '../../stores/profileStore'
import type { GridRow, SortConfig, CellFormatRule } from '../../../shared/types'
import { matchFilter } from '../../utils/filterMatch'
import { computeDaysUntil } from '../../utils/deadlineCalc'
import { CellConditionalFormatPanel } from './CellConditionalFormatPanel'
import { CellHistoryPopover } from '../shared/CellHistoryPopover'
import { getClientName } from '../../utils/clientName'
import { BADGE_WIDTH as ACUITY_BADGE_WIDTH } from './AcuityBadge'
import { linkValueText } from '../../../shared/links'
import { CellDisplay } from './CellDisplay'
import { SortableRow } from './SortableRow'
import { GridContextMenu } from './GridContextMenu'
import { BulkActionBar } from './BulkActionBar'
import { handleCellKeyDown as handleCellKeyDownImpl, type KeyboardNavDeps } from './gridKeyboardNav'
import { ROW_HEIGHTS, HANDLE_WIDTH, PROFILE_BTN_WIDTH, CHAR_WIDTH_HEADER, CHAR_WIDTH_CELL, HEADER_PADDING, CELL_PADDING, MIN_COL_WIDTH, DEFAULT_COL_WIDTH, MAX_AUTO_FIT_WIDTH, GROUP_HEADER_HEIGHT } from './gridConstants'
import { rlog } from '../../utils/rendererLogger'
import { useGridSelection } from '../../hooks/useGridSelection'
import { useGridContextMenu } from '../../hooks/useGridContextMenu'
import { useGridClipboard } from '../../hooks/useGridClipboard'
import { useGridGrouping } from '../../hooks/useGridGrouping'
import { useGridVirtualizer } from '../../hooks/useGridVirtualizer'
import { useGridEditing } from '../../hooks/useGridEditing'
import { useGridCellNavigation, type NavDirection } from '../../hooks/useGridCellNavigation'

// Extracted sub-components
import { GridHeaderRow } from './GridHeaderRow'
import { GroupHeaderItem, CollapseExpandBar, GroupContextMenuOverlay } from './GridGroupHeader'
import { ArchiveDialog, DeleteRowDialog, MoveToGridDialog, BulkDeleteDialog, BulkMoveDialog } from './GridDialogs'
import { BulkEditDialog } from './BulkEditDialog'
import { GridLoadingSkeleton, GridEmptyColumns } from './GridLoadingState'
import { useVocab } from '../../hooks/useVocab'
import { pulseEvents } from '../../events'
import { IS_MAC } from '../../utils/keys'
import { useFeature } from '../../hooks/useFeature'
import { ACUITY_GROUP_KEY, isNotTypedColumnType } from '../../../shared/types'

// Stateless column helper — no dependency on props/state, safe at module level
const columnHelper = createColumnHelper<GridRow>()

// ── Main DataGrid ─────────────────────────────────────────────────────────────

export function DataGrid(): React.ReactElement {
  const { t } = useVocab()
  // Group 1: Data selectors (changes when grid data changes)
  const { columns, rows, sortConfig, searchQuery, findReplaceQuery, findReplaceActiveMatch,
          activeFilters, filterMode,
          rowTagsMap, showStarredOnly, cellFormats,
          acuityEnabled: acuityFlag, acuityLevels, groupByColumnId, isLoading,
          activeGridId, copiedFormatRules, customGroups, activeCustomGroupId,
          lastAddedRowId, frozenColumnCount, sampleRows } = useGridStore(useShallow(s => ({
    columns: s.columns, rows: s.rows, sortConfig: s.sortConfig,
    searchQuery: s.searchQuery, findReplaceQuery: s.findReplaceQuery,
    findReplaceActiveMatch: s.findReplaceActiveMatch,
    activeFilters: s.activeFilters,
    filterMode: s.filterMode, rowTagsMap: s.rowTagsMap,
    showStarredOnly: s.showStarredOnly, cellFormats: s.cellFormats,
    acuityEnabled: s.acuityEnabled,
    acuityLevels: s.acuityLevels, groupByColumnId: s.groupByColumnId,
    isLoading: s.isLoading, activeGridId: s.activeGridId,
    copiedFormatRules: s.copiedFormatRules,
    customGroups: s.customGroups, activeCustomGroupId: s.activeCustomGroupId,
    lastAddedRowId: s.lastAddedRowId,
    frozenColumnCount: s.frozenColumnCount,
    sampleRows: s.sampleRows,
  })))
  // A list's own setting, shown only while the feature is switched on
  const priorityOn = useFeature('priority')
  const acuityEnabled = acuityFlag && priorityOn

  // Group 2: Actions (stable function references — never trigger re-renders)
  const { setSortConfig, updateCell, reorderColumns, updateColumn,
          setCellFormat, batchSetCellFormat, setCopiedFormatRules, deleteRow,
          archiveRow, unarchiveRow, duplicateRow, updateRow, setSortedRowIds,
          setRowAcuityLevel, bulkSetRowAcuityLevel, setFrozenColumnCount } = useGridStore(useShallow(s => ({
    setSortConfig: s.setSortConfig, updateCell: s.updateCell,
    reorderColumns: s.reorderColumns, setFrozenColumnCount: s.setFrozenColumnCount,
    updateColumn: s.updateColumn, setCellFormat: s.setCellFormat,
    batchSetCellFormat: s.batchSetCellFormat,
    setCopiedFormatRules: s.setCopiedFormatRules,
    deleteRow: s.deleteRow, archiveRow: s.archiveRow,
    unarchiveRow: s.unarchiveRow, duplicateRow: s.duplicateRow,
    updateRow: s.updateRow, setSortedRowIds: s.setSortedRowIds,
    setRowAcuityLevel: s.setRowAcuityLevel,
    bulkSetRowAcuityLevel: s.bulkSetRowAcuityLevel,
  })))

  const gridDensity = useSettingsStore(s => s.gridDensity)
  const rowHeight = ROW_HEIGHTS[gridDensity]

  const alertRules = useAlertStore(s => s.rules)
  const alertRuleMap = useMemo(() => new Map(alertRules.map(r => [r.id, r])), [alertRules])
  const navigate = useNavigate()
  const addRecentProfile = useProfileStore(s => s.addRecentProfile)
  const saveScrollTop = useProfileStore(s => s.saveScrollTop)

  const handleNavigateToProfile = useCallback((rowId: number) => {
    const scrollEl = containerRef.current
    if (scrollEl) saveScrollTop(scrollEl.scrollTop)
    const { grids: currentGrids, rows: currentRows, columns: currentCols, activeGridId: currentGridId } = useGridStore.getState()
    const grid = currentGrids.find(g => g.id === currentGridId)
    const row = currentRows.find(r => r.row_id === rowId)
    const name = row ? getClientName(row, currentCols, 'Unknown') : 'Unknown'
    if (grid) {
      addRecentProfile({ rowId, gridId: grid.id, name, gridName: grid.name, visitedAt: new Date().toISOString() })
    }
    navigate(`/profile/${rowId}`)
  }, [navigate, addRecentProfile, saveScrollTop])

  const containerRef = useRef<HTMLDivElement>(null)
  const visualRowIdsRef = useRef<number[]>([])

  const { editingCell, setEditingCell, editingCellRef } = useGridEditing({
    onCellUpdate: updateCell,
  })

  // Cell navigation (extracted hook)
  const {
    selectedCell: focusedCell, selectCell, clearSelection: clearFocusedCell,
    navigateCell,
  } = useGridCellNavigation({ columns, visualRowIdsRef, containerRef })
  // Wrapper matching SortableRow's setFocusedCell(coord | null) interface
  const setFocusedCell = useCallback(
    (c: { rowId: number; columnId: number } | null) => c ? selectCell(c.rowId, c.columnId) : clearFocusedCell(),
    [selectCell, clearFocusedCell],
  )

  // Extracted hooks
  const { setClipboard } = useGridClipboard()
  const { contextMenu, setContextMenu, handleCellContextMenu, closeContextMenu } = useGridContextMenu()
  const { selectedRowIds, setSelectedRowIds, selectedRowIdsRef, handleToggleRowSelect } = useGridSelection({ visualRowIdsRef, activeGridId })

  // Refs for values used in handleCellKeyDown
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const filteredRowsRef = useRef<GridRow[]>([])
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({})
  const [cellFormatTarget, setCellFormatTarget] = useState<{ rowId: number; colId: number } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<number | null>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const [moveToGridTarget, setMoveToGridTarget] = useState<number | null>(null)
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState(false)
  const [bulkMoveTarget, setBulkMoveTarget] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [cellHistoryTarget, setCellHistoryTarget] = useState<{ rowId: number; colId: number; colName: string; x: number; y: number } | null>(null)
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number } | null>(null)
  const columnSizingRef = useRef<ColumnSizingState>({})
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore scroll position when returning from profile view
  const savedScrollTop = useProfileStore(s => s.savedScrollTop)
  useEffect(() => {
    if (!savedScrollTop) return
    const el = containerRef.current
    if (el) {
      el.scrollTop = savedScrollTop
    }
  }, []) // Only on mount — intentional

  // Clean up resizeTimeoutRef on unmount to prevent stale callbacks
  useEffect(() => {
    return () => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current)
    }
  }, [])

  // Hint banner — dismissible via localStorage
  const [hintDismissed, setHintDismissed] = useState(() =>
    localStorage.getItem('pulse-grid-hints-dismissed') === '1'
  )
  const dismissHint = useCallback(() => {
    localStorage.setItem('pulse-grid-hints-dismissed', '1')
    setHintDismissed(true)
  }, [])

  // Acuity sort: null → 'desc' (high first) → 'asc' (low first) → null
  const [acuitySortDir, setAcuitySortDir] = useState<'asc' | 'desc' | null>(null)
  // Reset acuity sort when switching grids or disabling acuity
  useEffect(() => { setAcuitySortDir(null) }, [activeGridId, acuityEnabled])

  // Apply starred pre-filter + column filters + acuity sort before passing to TanStack
  const filteredRows = useMemo(() => {
    let result = rows
    if (showStarredOnly) {
      result = result.filter(row => row.is_starred === 1)
    }
    if (activeFilters.length > 0) {
      const matcher = filterMode === 'or'
        ? (row: GridRow) => activeFilters.some(f => matchFilter(row, f, columns, rowTagsMap))
        : (row: GridRow) => activeFilters.every(f => matchFilter(row, f, columns, rowTagsMap))
      result = result.filter(matcher)
    }
    return result
  }, [rows, activeFilters, filterMode, columns, rowTagsMap, showStarredOnly])
  filteredRowsRef.current = filteredRows

  // Map for O(1) column lookup
  const columnMap = useMemo(() => new Map(columns.map(c => [c.id, c])), [columns])

  // O(1) row lookup by id (all rows, not just filtered).
  // Also used as rowMap for cross-row conditional format evaluation.
  const rowById = useMemo(() => new Map(rows.map(r => [r.row_id, r])), [rows])

  // Alias for conditional format evaluation (same map, same type — no cast needed).
  const rowMap = rowById

  // Pre-parse column configs and conditional formats once per columns change
  const parsedColumnConfigs = useMemo(() => {
    const map = new Map<number, { config: Record<string, unknown>; conditionalFormat: CellFormatRule[] }>()
    for (const col of columns) {
      let config: Record<string, unknown> = {}
      let conditionalFormat: CellFormatRule[] = []
      try { config = col.config ? JSON.parse(col.config) : {} } catch { /* malformed */ }
      try { conditionalFormat = col.conditional_format ? JSON.parse(col.conditional_format) : [] } catch { /* malformed */ }
      if (!Array.isArray(conditionalFormat)) conditionalFormat = []
      map.set(col.id, { config, conditionalFormat })
    }
    return map
  }, [columns])

  // Pre-compute once: do any columns have highlight rules?
  const hasAnyHighlightRules = useMemo(() => {
    if (cellFormats.size > 0) return true
    for (const pc of parsedColumnConfigs.values()) {
      if (pc.conditionalFormat.some(r => r.highlightRow)) return true
    }
    return false
  }, [cellFormats, parsedColumnConfigs])

  // Pre-compute the set of column IDs that have highlightRow format rules.
  // SortableRow iterates only these columns instead of all columns.
  const highlightColumnIds = useMemo(() => {
    const ids = new Set<number>()
    // Columns with column-level highlight rules
    for (const [colId, pc] of parsedColumnConfigs.entries()) {
      if (pc.conditionalFormat.some(r => r.highlightRow)) {
        ids.add(colId)
      }
    }
    // Columns referenced by cell-level highlight rules
    for (const [key, rules] of cellFormats.entries()) {
      if (rules.some(r => r.highlightRow)) {
        const colId = parseInt(key.split('_')[1] ?? '', 10)
        if (!isNaN(colId)) ids.add(colId)
      }
    }
    return ids
  }, [cellFormats, parsedColumnConfigs])

  // Reset column sizing when switching grids (selection reset handled by useGridSelection)
  useEffect(() => {
    setColumnSizing({})
    columnSizingRef.current = {}
  }, [activeGridId])

  const handleDeleteRow = useCallback((rowId: number) => {
    setContextMenu(null)
    setDeleteTarget(rowId)
  }, [])

  const handleToggleStar = useCallback(async (rowId: number) => {
    const row = useGridStore.getState().rows.find(r => r.row_id === rowId)
    if (!row) return
    await updateRow(rowId, { is_starred: row.is_starred ? 0 : 1 })
  }, [updateRow])

  const handleDuplicateRow = useCallback(async (rowId: number) => {
    setContextMenu(null)
    await duplicateRow(rowId)
  }, [duplicateRow])

  const handleArchiveConfirm = useCallback(async (opts: { cancelAppointments: boolean }) => {
    if (archiveTarget == null) return
    await archiveRow(archiveTarget, archiveReason.trim() || undefined, opts)
    setArchiveTarget(null)
    setArchiveReason('')
  }, [archiveTarget, archiveReason, archiveRow])

  const handleUnarchiveRow = useCallback(async (rowId: number) => {
    setContextMenu(null)
    await unarchiveRow(rowId)
  }, [unarchiveRow])

  // Sensors: 5px distance threshold so single clicks still work (column reorder only)
  const colSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Handle column sizing changes — debounce persistence to DB
  const handleColumnSizingChange = useCallback((updater: unknown) => {
    setColumnSizing(prev => {
      const next = typeof updater === 'function'
        ? (updater as (old: ColumnSizingState) => ColumnSizingState)(prev)
        : updater as ColumnSizingState
      columnSizingRef.current = next

      // Debounce persist — batch all width changes in a single IPC call
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current)
      resizeTimeoutRef.current = setTimeout(async () => {
        const currentCols = useGridStore.getState().columns
        const widthUpdates: { columnId: number; width: number }[] = []
        for (const col of currentCols) {
          const newWidth = columnSizingRef.current[`col_${col.id}`]
          if (newWidth !== undefined && Math.round(newWidth) !== col.width) {
            widthUpdates.push({ columnId: col.id, width: Math.round(newWidth) })
          }
        }
        if (widthUpdates.length > 0) {
          try {
            await safeInvoke(IPC.COLUMN_BATCH_UPDATE_WIDTHS, widthUpdates)
          } catch (err) {
            rlog.error('DataGrid', 'Failed to batch update column widths', err)
          }
        }
      }, 500)

      return next
    })
  }, [])

  // Auto-fit a column to its content width
  const autoFitColumn = useCallback((colId: number) => {
    const col = useGridStore.getState().columns.find(c => c.id === colId)
    if (!col) return
    const storeRows = useGridStore.getState().rows
    const sample = storeRows.length > 500 ? storeRows.slice(0, 500) : storeRows
    const headerWidth = col.name.length * CHAR_WIDTH_HEADER + HEADER_PADDING
    const maxContentWidth = sample.reduce((max, row) => {
      const val = String(row[`col_${colId}` as keyof GridRow] ?? '')
      return Math.max(max, val.length * CHAR_WIDTH_CELL + CELL_PADDING)
    }, MIN_COL_WIDTH)
    const newWidth = Math.min(Math.max(headerWidth, maxContentWidth, DEFAULT_COL_WIDTH), MAX_AUTO_FIT_WIDTH)
    setColumnSizing(prev => {
      const next = { ...prev, [`col_${colId}`]: newWidth }
      columnSizingRef.current = next
      return next
    })
    updateColumn(colId, { width: newWidth })
  }, [updateColumn])

  // Links changed somewhere (W04): refresh just the link columns
  useEffect(() => window.api.on(IPC.RECORD_LINKS_CHANGED, () => { void useGridStore.getState().refreshLinkValues() }), [])

  // Convert sort config to TanStack format, prepending acuity sort when active
  const sorting: SortingState = useMemo(() => {
    const colSorts = sortConfig.map(s => ({ id: `col_${s.columnId}`, desc: s.direction === 'desc' }))
    if (acuitySortDir && acuityEnabled) {
      return [{ id: '_acuity_points', desc: acuitySortDir === 'desc' }, ...colSorts]
    }
    return colSorts
  }, [sortConfig, acuitySortDir, acuityEnabled])

  const tableColumns = useMemo(() => {
    // Hidden synthetic column for acuity sorting
    const acuityCol = acuityEnabled ? [columnHelper.accessor(
      (row) => {
        if (row.acuity_level_id == null) return -1
        const level = acuityLevels.find(l => l.id === row.acuity_level_id)
        return level?.points ?? -1
      },
      {
        id: '_acuity_points',
        header: () => null,
        cell: () => null,
        sortingFn: (rowA, rowB, colId) => {
          const a = rowA.getValue(colId) as number
          const b = rowB.getValue(colId) as number
          if (a === b) return 0
          if (a === -1) return 1
          if (b === -1) return -1
          return a - b
        },
        enableSorting: true,
        enableResizing: false,
        size: 0,
      }
    )] : []

    return [...acuityCol, ...columns.map(col => {
      const isCalcDays = col.column_type === 'calculated_days'
      const isAge = col.column_type === 'age_from_dob'
      const isLink = col.column_type === 'link'
      const compCfg = (isCalcDays || isAge)
        ? (parsedColumnConfigs.get(col.id)?.config as { source_column_id?: number } | undefined) ?? {}
        : null

      return columnHelper.accessor(`col_${col.id}` as keyof GridRow, {
        id: `col_${col.id}`,
        header: () => null,
        cell: ({ row }) => {
          const value = row.original[`col_${col.id}` as keyof GridRow] as string | null
          return <CellDisplay column={col} value={value} row={row.original} allColumns={columns} parsedConfig={parsedColumnConfigs.get(col.id)?.config} />
        },
        sortingFn: isCalcDays
          ? (rowA, rowB) => {
              const srcId = compCfg?.source_column_id
              if (!srcId) return 0
              const aDate = rowA.original[`col_${srcId}` as keyof GridRow] as string | null
              const bDate = rowB.original[`col_${srcId}` as keyof GridRow] as string | null
              const aVal = aDate ? computeDaysUntil(aDate) : null
              const bVal = bDate ? computeDaysUntil(bDate) : null
              if (aVal == null && bVal == null) return 0
              if (aVal == null) return 1
              if (bVal == null) return -1
              return aVal - bVal
            }
          : isAge
          ? (rowA, rowB) => {
              const srcId = compCfg?.source_column_id
              if (!srcId) return 0
              const aDate = rowA.original[`col_${srcId}` as keyof GridRow] as string | null
              const bDate = rowB.original[`col_${srcId}` as keyof GridRow] as string | null
              if (aDate == null && bDate == null) return 0
              if (aDate == null) return 1
              if (bDate == null) return -1
              return aDate.localeCompare(bDate)
            }
          : (rowA, rowB, colId) => {
              // Link columns (W04) sort by the linked names, not the stored ids
              const a = isLink ? linkValueText(rowA.getValue(colId) as string | null) || null : rowA.getValue(colId) as string | null
              const b = isLink ? linkValueText(rowB.getValue(colId) as string | null) || null : rowB.getValue(colId) as string | null
              if (a == null && b == null) return 0
              if (a == null) return 1
              if (b == null) return -1
              return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
            },
        enableSorting: true,
        enableResizing: true,
        size: col.width,
        minSize: 60,
        maxSize: 800,
      })
    })]
  }, [columns, acuityEnabled, acuityLevels])

  // Custom global filter: only search name + text/dropdown columns
  const globalFilterFn = useCallback((row: Row<GridRow>, _columnId: string, filterValue: string) => {
    if (!filterValue) return true
    const lower = filterValue.toLowerCase()
    const data = row.original
    for (const col of columns) {
      if (col.is_name_column || col.column_type === 'text' || col.column_type === 'dropdown' || col.column_type === 'auto_number') {
        const val = data[`col_${col.id}`]
        if (val && String(val).toLowerCase().includes(lower)) return true
      } else if (col.column_type === 'link' && linkValueText(data[`col_${col.id}`]).toLowerCase().includes(lower)) {
        return true
      }
    }
    return false
  }, [columns])

  const handleSortingChange = useCallback((updater: unknown) => {
    const newSorting = typeof updater === 'function' ? (updater as (old: SortingState) => SortingState)(sorting) : updater as SortingState
    const config: SortConfig[] = newSorting
      .filter(s => s.id !== '_acuity_points')
      .map((s, i) => ({
        columnId: parseInt(s.id.replace('col_', ''), 10),
        direction: s.desc ? 'desc' : 'asc',
        priority: i + 1
      }))
    setSortConfig(config)
  }, [sorting, setSortConfig])

  const tableState = useMemo(() => ({ sorting, globalFilter: searchQuery, columnSizing }), [sorting, searchQuery, columnSizing])

  const table = useReactTable({
    data: filteredRows,
    columns: tableColumns,
    state: tableState,
    onSortingChange: handleSortingChange,
    onColumnSizingChange: handleColumnSizingChange,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: row => String(row.row_id),
    globalFilterFn,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
  })

  const tableRows = table.getRowModel().rows
  const headerGroups = table.getHeaderGroups()

  // Keep sortedRowIds in sync so ProfileView can compute prev/next
  useEffect(() => {
    setSortedRowIds(tableRows.map(r => r.original.row_id))
  }, [tableRows, setSortedRowIds])

  // Grouping (extracted hook)
  const {
    displayItems, visualRowIds, isGrouped: isGroupedFromHook,
    activeCustomGroup,
    collapseAll: handleCollapseAll, expandAll: handleExpandAll, toggleGroup: handleToggleGroup,
  } = useGridGrouping({
    tableRows, columns, acuityLevels, customGroups, activeCustomGroupId,
    // Grouping by priority stops while the priority feature is off
    groupByColumnId: groupByColumnId === ACUITY_GROUP_KEY && !acuityEnabled ? null : groupByColumnId,
  })

  visualRowIdsRef.current = visualRowIds

  // Virtual scrolling (extracted hook)
  const { virtualRows, totalSize: totalHeight, paddingTop, paddingBottom } = useGridVirtualizer({
    parentRef: containerRef,
    count: isGroupedFromHook ? displayItems.length : tableRows.length,
    rowHeight,
  })

  const totalWidth = HANDLE_WIDTH + PROFILE_BTN_WIDTH + (acuityEnabled ? ACUITY_BADGE_WIDTH : 0) + table.getTotalSize()
  const columnIds = useMemo(() => columns.map(c => `col_${c.id}`), [columns])

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
    const leadingWidth = HANDLE_WIDTH + PROFILE_BTN_WIDTH + (acuityEnabled ? ACUITY_BADGE_WIDTH : 0)
    let cumLeft = leadingWidth
    for (let i = 0; i < Math.min(frozenColumnCount, columns.length); i++) {
      const col = columns[i]!
      const w = columnSizing[`col_${col.id}`] ?? col.width
      offsets.set(col.id, cumLeft)
      cumLeft += Math.max(w, 60)
    }
    return offsets
  }, [frozenColumnCount, columns, columnSizing, acuityEnabled])

  // Column drag-end: reorder columns
  const handleColumnDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const cols = useGridStore.getState().columns
    const oldIdx = cols.findIndex(c => `col_${c.id}` === active.id)
    const newIdx = cols.findIndex(c => `col_${c.id}` === over.id)
    if (oldIdx !== -1 && newIdx !== -1) {
      const newOrder = arrayMove(cols, oldIdx, newIdx)
      reorderColumns(newOrder.map(c => c.id))
    }
  }, [reorderColumns])

  // Keyboard navigation
  const keyNavDeps = useMemo<KeyboardNavDeps>(() => ({
    editingCellRef, rowsRef, filteredRowsRef, selectedRowIdsRef,
    columns, columnMap, updateCell, navigateCell,
    setEditingCell, setSelectedRowIds, setClipboard,
  }), [columns, columnMap, updateCell, navigateCell, setEditingCell])
  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, rowId: number, columnId: number) => {
    handleCellKeyDownImpl(e, rowId, columnId, keyNavDeps)
  }, [keyNavDeps])

  // Navigate to adjacent row after Enter-commit in CellEditor
  const handleNavigateAfterEdit = useCallback((rowId: number, colId: number, direction: NavDirection) => {
    navigateCell(rowId, colId, direction)
  }, [navigateCell])

  // Auto-edit first editable cell when a new row is added
  useEffect(() => {
    if (!lastAddedRowId) return
    const timer = setTimeout(() => {
      const firstEditableCol = columns.find(c => !isNotTypedColumnType(c.column_type))
      if (firstEditableCol) {
        setFocusedCell({ rowId: lastAddedRowId, columnId: firstEditableCol.id })
        setEditingCell({ rowId: lastAddedRowId, columnId: firstEditableCol.id })
      }
      useGridStore.setState({ lastAddedRowId: null })
    }, 50)
    return () => clearTimeout(timer)
  }, [lastAddedRowId, columns, setEditingCell])

  const handleBulkSetAcuityLevel = useCallback((levelId: number | null) => {
    const ids = Array.from(selectedRowIdsRef.current)
    void bulkSetRowAcuityLevel(ids, levelId)
  }, [bulkSetRowAcuityLevel])

  // Render helper for SortableRow — eliminates duplication between grouped and ungrouped paths
  const renderSortableRow = (row: Row<GridRow>, rowIndex: number) => (
    <SortableRow
      key={row.id}
      row={row}
      rowIndex={rowIndex}
      rowHeight={rowHeight}
      editingRowId={editingCell?.rowId ?? null}
      editingColId={editingCell?.columnId ?? null}
      focusedRowId={focusedCell?.rowId ?? null}
      focusedColId={focusedCell?.columnId ?? null}
      columns={columns}
      columnMap={columnMap}
      alertRuleMap={alertRuleMap}
      cellFormats={cellFormats}
      parsedColumnConfigs={parsedColumnConfigs}
      hasAnyHighlightRules={hasAnyHighlightRules}
      highlightColumnIds={highlightColumnIds}
      rowMap={rowMap}
      containerRef={containerRef as React.RefObject<HTMLDivElement>}
      isSelected={selectedRowIds.has(row.original.row_id)}
      selectedCount={selectedRowIds.size}
      onBulkSetAcuityLevel={handleBulkSetAcuityLevel}
      acuityEnabled={acuityEnabled}
      acuityLevels={acuityLevels}
      onSetAcuityLevel={setRowAcuityLevel}
      editingCellRef={editingCellRef}
      setEditingCell={setEditingCell}
      setFocusedCell={setFocusedCell}
      updateCell={updateCell}
      onCellKeyDown={handleCellKeyDown}
      onCellContextMenu={handleCellContextMenu}
      onNavigateToProfile={handleNavigateToProfile}
      onToggleSelect={handleToggleRowSelect}
      onNavigateAfterEdit={handleNavigateAfterEdit}
      rowId={row.original.row_id}
      searchQuery={findReplaceQuery || searchQuery || undefined}
      findReplaceActiveRowId={findReplaceActiveMatch?.rowId ?? null}
      findReplaceActiveColId={findReplaceActiveMatch?.colId ?? null}
      frozenLeftOffsets={frozenLeftOffsets}
      frozenColumnCount={frozenColumnCount}
      isSample={sampleRows[row.original.row_id] !== undefined}
    />
  )

  if (isLoading) {
    return <GridLoadingSkeleton rowHeight={rowHeight} />
  }

  if (columns.length === 0) {
    return <GridEmptyColumns />
  }

  // Filter out synthetic _acuity_points header
  const headers = (headerGroups[0]?.headers ?? []).filter(h => h.id !== '_acuity_points')
  const isGrouped = isGroupedFromHook

  return (
    <div
      data-tour="grid"
      className="h-full flex flex-col overflow-hidden"
      role="grid"
      aria-label={`${t('record', { cap: true })} grid`}
    >
      {/* ── Hint banner for new users ─── */}
      {!hintDismissed && tableRows.length > 0 && (
        <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-600 dark:text-blue-300 px-3 py-1.5 flex-shrink-0">
          <span>Tip: Click column headers to sort &middot; Right-click column headers for alerts, tracking &amp; more &middot; Right-click {t('record', { article: true })} for options &middot; Press <kbd className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-800/40 font-mono">Shift+?</kbd> for all shortcuts</span>
          <button
            onClick={dismissHint}
            className="hit-44 ml-3 p-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-400 dark:text-blue-400"
            aria-label="Dismiss tip"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Fixed header (outside vertical scroll) ─── */}
      <div className="flex-shrink-0 overflow-x-hidden" style={{ ...columnWidthVars }}>
        <div style={{ minWidth: totalWidth + 1 }}>
          <GridHeaderRow
            headers={headers}
            columns={columns}
            columnIds={columnIds}
            rowHeight={rowHeight}
            acuityEnabled={acuityEnabled}
            acuitySortDir={acuitySortDir}
            setAcuitySortDir={setAcuitySortDir}
            selectedRowIds={selectedRowIds}
            filteredRows={filteredRows}
            setSelectedRowIds={setSelectedRowIds}
            colSensors={colSensors}
            onColumnDragEnd={handleColumnDragEnd}
            autoFitColumn={autoFitColumn}
            frozenLeftOffsets={frozenLeftOffsets}
            frozenColumnCount={frozenColumnCount}
            setFrozenColumnCount={setFrozenColumnCount}
          />
        </div>
      </div>

      {/* ── Scrollable row body ─── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto min-h-0"
        style={{ WebkitOverflowScrolling: 'touch' }}
        onScroll={(e) => {
          // Sync header horizontal scroll with row body scroll
          const scrollLeft = (e.target as HTMLElement).scrollLeft
          const headerEl = (e.target as HTMLElement).previousElementSibling as HTMLElement | null
          if (headerEl) headerEl.scrollLeft = scrollLeft
        }}
      >
      <div style={{ minWidth: totalWidth + 1, ...columnWidthVars }}>
        {/* ── Row body ─── */}
        <div>
          {/* Collapse/Expand All toolbar (grouped mode only) */}
          {isGrouped && (
            <CollapseExpandBar onCollapseAll={handleCollapseAll} onExpandAll={handleExpandAll} />
          )}
          {/* ── Unified virtualized rendering (both grouped and ungrouped) ── */}
          <div style={{ position: 'relative', height: totalHeight }}>
            {paddingTop > 0 && <div style={{ height: paddingTop }} />}

            {virtualRows.map(vr => {
              if (isGrouped) {
                const item = displayItems[vr.index]
                if (!item) return null
                if (item.kind === 'group-header') {
                  const headerBucketColor = activeCustomGroup
                    ? activeCustomGroup.buckets.find(b => b.label === item.value)?.color
                    : undefined
                  return (
                    <GroupHeaderItem
                      key={`grp-${item.groupKey}-${vr.index}`}
                      value={item.value}
                      count={item.count}
                      groupKey={item.groupKey}
                      isCollapsed={item.isCollapsed}
                      bucketColor={headerBucketColor}
                      height={GROUP_HEADER_HEIGHT}
                      onToggle={handleToggleGroup}
                      onContextMenu={e => { e.preventDefault(); setGroupContextMenu({ x: e.clientX, y: e.clientY }) }}
                    />
                  )
                }
                // kind === 'row' in grouped mode
                const row = tableRows[item.tableRowIndex]
                if (!row) return null
                return renderSortableRow(row, item.tableRowIndex)
              }

              // Ungrouped mode
              const row = tableRows[vr.index]
              if (!row) return null
              return renderSortableRow(row, vr.index)
            })}

            {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
          </div>
        </div>

        {/* Empty state */}
        {tableRows.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            {searchQuery ? (
              <p className="text-base text-slate-500 dark:text-slate-400">
                No {t('record', { many: true })} found matching &ldquo;{searchQuery}&rdquo;
              </p>
            ) : rows.length > 0 ? (
              <>
                <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-3">
                  No {t('record', { many: true })} match your filters
                </h3>
                <button type="button" className="btn-secondary" onClick={() => {
                  useGridStore.setState({ activeFilters: [], showStarredOnly: false })
                  useGridStore.getState().setActiveCustomGroupId(null)
                }}>
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  No {t('record', { many: true })} yet
                </h3>
                <p className="text-base text-slate-500 dark:text-slate-400 mb-4">
                  Add your first {t('record')}{' '}
                  (or press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-base font-mono">{IS_MAC ? '⌘N' : 'Ctrl+N'}</kbd>),
                  or bring them in from a spreadsheet.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button type="button" className="btn-primary" onClick={() => void useGridStore.getState().addRow()}>
                    Add {t('record', { cap: true })}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => pulseEvents.emit('grid:open-import')}>
                    Bring in a spreadsheet
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => pulseEvents.emit('starters:open', { sample: true })}>
                    See an example with sample data
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      </div>

      {/* Right-click context menu */}
      <AnimatePresence>
      {contextMenu && (
        <GridContextMenu
          contextMenu={contextMenu}
          columns={columns}
          rows={rows}
          filteredRows={filteredRows}
          rowById={rowById}
          rowMap={rowMap}
          cellFormats={cellFormats}
          parsedColumnConfigs={parsedColumnConfigs}
          selectedRowIds={selectedRowIds}
          copiedFormatRules={copiedFormatRules}
          onClose={closeContextMenu}
          onDeleteRow={handleDeleteRow}
          onToggleStar={id => void handleToggleStar(id)}
          onDuplicateRow={id => void handleDuplicateRow(id)}
          onArchiveRow={id => { setArchiveTarget(id); setContextMenu(null) }}
          onUnarchiveRow={id => void handleUnarchiveRow(id)}
          onMoveToGrid={id => { setMoveToGridTarget(id); setContextMenu(null) }}
          onCellFormatTarget={setCellFormatTarget}
          onCellHistoryTarget={setCellHistoryTarget}
          updateCell={updateCell}
          setCellFormat={setCellFormat}
          batchSetCellFormat={batchSetCellFormat}
          setCopiedFormatRules={setCopiedFormatRules}
          updateColumn={updateColumn}
        />
      )}
      </AnimatePresence>

      {/* Per-cell conditional format panel */}
      {cellFormatTarget && (
        <CellConditionalFormatPanel
          rowId={cellFormatTarget.rowId}
          columnId={cellFormatTarget.colId}
          onClose={() => setCellFormatTarget(null)}
          selectedRowIds={selectedRowIds}
        />
      )}

      {/* Cell history popover */}
      <AnimatePresence>
        {cellHistoryTarget && (
          <CellHistoryPopover
            rowId={cellHistoryTarget.rowId}
            columnId={cellHistoryTarget.colId}
            columnName={cellHistoryTarget.colName}
            x={cellHistoryTarget.x}
            y={cellHistoryTarget.y}
            onClose={() => setCellHistoryTarget(null)}
          />
        )}
      </AnimatePresence>

      {/* Group header right-click menu */}
      <GroupContextMenuOverlay
        position={groupContextMenu}
        isGrouped={isGrouped}
        onCollapseAll={handleCollapseAll}
        onExpandAll={handleExpandAll}
        onClose={() => setGroupContextMenu(null)}
      />

      {/* Delete row confirmation */}
      <DeleteRowDialog
        deleteTarget={deleteTarget}
        deleteRow={deleteRow}
        setDeleteTarget={setDeleteTarget}
        setSelectedRowIds={setSelectedRowIds}
      />

      {/* Move / Copy to Grid modal */}
      <MoveToGridDialog
        moveToGridTarget={moveToGridTarget}
        activeGridId={activeGridId}
        columns={columns}
        setMoveToGridTarget={setMoveToGridTarget}
      />

      {/* Bulk action bar */}
      {selectedRowIds.size > 0 && (
        <BulkActionBar
          selectedRowIds={selectedRowIds}
          rowById={rowById}
          columns={columns}
          activeGridId={activeGridId}
          acuityEnabled={acuityEnabled}
          acuityLevels={acuityLevels}
          bulkSetRowAcuityLevel={bulkSetRowAcuityLevel}
          setSelectedRowIds={setSelectedRowIds}
          setBulkDeleteTarget={setBulkDeleteTarget}
          setBulkMoveTarget={setBulkMoveTarget}
          setBulkEditOpen={setBulkEditOpen}
        />
      )}

      {/* Bulk edit dialog */}
      <BulkEditDialog
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        selectedRowIds={selectedRowIds}
        columns={columns}
        rowById={rowById}
      />

      {/* Bulk delete confirmation */}
      <BulkDeleteDialog
        open={bulkDeleteTarget}
        selectedCount={selectedRowIds.size}
        selectedRowIds={selectedRowIds}
        activeGridId={activeGridId}
        setSelectedRowIds={setSelectedRowIds}
        setBulkDeleteTarget={setBulkDeleteTarget}
      />

      {/* Bulk move to grid modal */}
      <BulkMoveDialog
        open={bulkMoveTarget}
        selectedRowIds={selectedRowIds}
        activeGridId={activeGridId}
        columns={columns}
        setSelectedRowIds={setSelectedRowIds}
        setBulkMoveTarget={setBulkMoveTarget}
      />

      {/* Archive dialog */}
      <ArchiveDialog
        archiveTarget={archiveTarget}
        archiveReason={archiveReason}
        setArchiveReason={setArchiveReason}
        onConfirm={opts => void handleArchiveConfirm(opts)}
        onCancel={() => { setArchiveTarget(null); setArchiveReason('') }}
      />
    </div>
  )
}
