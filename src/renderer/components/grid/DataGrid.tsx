import toast from 'react-hot-toast'
import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import { parseDbTimestamp } from '../../../shared/dates'
import { useTable, type SortingState } from '@tanstack/react-table'
import { gridFeatures, type GridTableRow } from './gridTable'
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
import { useShallow } from 'zustand/react/shallow'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import { useProfileStore } from '../../stores/profileStore'
import type { GridRow, SortConfig } from '../../../shared/types'
import { matchFilter } from '../../utils/filterMatch'
import { rowMatchesSearch } from '../../utils/searchMatch'
import { CellConditionalFormatPanel } from './CellConditionalFormatPanel'
import { CellHistoryPopover } from '../shared/CellHistoryPopover'
import { getClientName } from '../../utils/clientName'
import { BADGE_WIDTH as ACUITY_BADGE_WIDTH } from './AcuityBadge'
import { SortableRow } from './SortableRow'
import { GridContextMenu } from './GridContextMenu'
import { BulkActionBar } from './BulkActionBar'
import { handleCellKeyDown as handleCellKeyDownImpl, type KeyboardNavDeps } from './gridKeyboardNav'
import { ROW_HEIGHTS, HANDLE_WIDTH, PROFILE_BTN_WIDTH, GROUP_HEADER_HEIGHT, TAGS_COL_WIDTH, ADD_COL_WIDTH, BULK_BAR_ROOM, MIN_COL_WIDTH, FROZEN_MAX_SHARE, NEW_COLUMN_MS, frozenCountThatFits, headerFitWidth } from './gridConstants'
import { useGridSelection } from '../../hooks/useGridSelection'
import { useGridColumnSizing } from '../../hooks/useGridColumnSizing'
import { useGridAnnouncer } from '../../hooks/useGridAnnouncer'
import { useGridRowActions } from '../../hooks/useGridRowActions'
import { useGridRuleInfo } from '../../hooks/useGridRuleInfo'
import { buildTableColumns } from './gridTableColumns'
import { useGridContextMenu } from '../../hooks/useGridContextMenu'
import { useGridGrouping } from '../../hooks/useGridGrouping'
import { useGridVirtualizer } from '../../hooks/useGridVirtualizer'
import { useGridEditing } from '../../hooks/useGridEditing'
import { useGridCellNavigation, type NavDirection } from '../../hooks/useGridCellNavigation'

// Extracted sub-components
import { GridHeaderRow } from './GridHeaderRow'
import { GroupHeaderItem, CollapseExpandBar, GroupContextMenuOverlay } from './GridGroupHeader'
import { MoveToGridDialog, BulkMoveDialog } from './GridDialogs'
import { BulkEditDialog } from './BulkEditDialog'
import { GridLoadingSkeleton, GridEmptyColumns } from './GridLoadingState'
import { GridLoadError, GridEmptyRecords } from './GridNotices'
import { useVocab } from '../../hooks/useVocab'
import { pulseEvents } from '../../events'
import { useFeature } from '../../hooks/useFeature'
import { ACUITY_GROUP_KEY, isNotTypedColumnType } from '../../../shared/types'

const COLUMN_DRAG_SENSOR = { activationConstraint: { distance: 5 } }
/** A dialog or menu is open: keys belong to it, even when focus has fallen to the page */
const OPEN_LAYER = ['dialog', 'alertdialog', 'menu'].map(role => `[role="${role}"]`).join(', ')

// ── Main DataGrid ─────────────────────────────────────────────────────────────

export function DataGrid(): React.ReactElement {
  const { t } = useVocab()
  // Group 1: Data selectors (changes when grid data changes)
  const { columns, rows, sortConfig, searchQuery, findReplaceQuery, findReplaceActiveMatch,
          activeFilters, filterMode,
          rowTagsMap, showStarredOnly, cellFormats,
          acuityEnabled: acuityFlag, acuityLevels, groupByColumnId, isLoading,
          activeGridId, copiedFormatRules, customGroups, activeCustomGroupId,
          lastAddedRowId, flashRowId, leavingRowIds, pinnedRowId, frozenColumnCount, sampleRows, loadedGridId, loadError } = useGridStore(useShallow(s => ({
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
    flashRowId: s.flashRowId, leavingRowIds: s.leavingRowIds,
    pinnedRowId: s.pinnedRowId,
    frozenColumnCount: s.frozenColumnCount,
    sampleRows: s.sampleRows,
    loadedGridId: s.loadedGridId, loadError: s.loadError,
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

  // The built-in Tags column (G-37)
  const showTagsColumn = useGridStore(s => s.showTagsColumn)
  // Filters, grouping and move/copy reach columns a saved view hides too
  const hiddenColumns = useGridStore(s => s.hiddenColumns)
  const allColumns = useMemo(() => [...columns, ...hiddenColumns], [columns, hiddenColumns])
  const setShowTagsColumn = useGridStore(s => s.setShowTagsColumn)
  const alertRules = useAlertStore(s => s.rules)
  const alertRuleMap = useMemo(() => new Map(alertRules.map(r => [r.id, r])), [alertRules])
  // Colors for meter, quota, step and extension rules depend on this; it arrives after the rows
  const deadlineContext = useGridStore(s => s.deadlineContext)
  const navigate = useNavigate()
  const addRecentProfile = useProfileStore(s => s.addRecentProfile)
  const saveScrollTop = useProfileStore(s => s.saveScrollTop)

  const handleNavigateToProfile = useCallback((rowId: number) => {
    const scrollEl = containerRef.current
    const { grids: currentGrids, rows: currentRows, columns: currentCols, activeGridId: currentGridId } = useGridStore.getState()
    if (scrollEl && currentGridId !== null) saveScrollTop(currentGridId, scrollEl.scrollTop)
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

  // Cell navigation (extracted hook). scrollToRowId is set further down, once the rows are known
  const scrollToRowIdRef = useRef<((rowId: number) => void) | null>(null)
  const {
    selectedCell: focusedCell, selectCell, clearSelection: clearFocusedCell,
    navigateCell, focusCell,
  } = useGridCellNavigation({ columns, visualRowIdsRef, containerRef, scrollToRowIdRef })
  // Wrapper matching SortableRow's setFocusedCell(coord | null) interface
  const setFocusedCell = useCallback(
    (c: { rowId: number; columnId: number } | null) => c ? selectCell(c.rowId, c.columnId) : clearFocusedCell(),
    [selectCell, clearFocusedCell],
  )

  // Extracted hooks
  const { contextMenu, setContextMenu, handleCellContextMenu, closeContextMenu } = useGridContextMenu()
  // The row's "⋯" button and the keyboard open the same menu, under the button or cell (UX-B-01)
  const handleOpenRowMenu = useCallback((rowId: number, colId: number, at: { x: number; y: number }) => {
    setContextMenu({ x: at.x, y: at.y, rowId, colId })
  }, [setContextMenu])
  const { selectedRowIds, setSelectedRowIds, selectedRowIdsRef, handleToggleRowSelect } = useGridSelection({ visualRowIdsRef, activeGridId })

  // Refs for values used in handleCellKeyDown
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const filteredRowsRef = useRef<GridRow[]>([])
  const [cellFormatTarget, setCellFormatTarget] = useState<{ rowId: number; colId: number } | null>(null)
  const [bulkMoveTarget, setBulkMoveTarget] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [cellHistoryTarget, setCellHistoryTarget] = useState<{ rowId: number; colId: number; colName: string; x: number; y: number } | null>(null)
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Back from a record's page: scroll to where this list was, once the records are
  // on screen, then forget it. Another list's position is dropped (AUDIT-129)
  const savedScroll = useProfileStore(s => s.savedScroll)
  const listReady = !isLoading && loadedGridId !== null && loadedGridId === activeGridId && rows.length > 0
  useEffect(() => {
    if (!savedScroll) return
    if (savedScroll.gridId !== activeGridId) { useProfileStore.getState().clearSavedScroll(); return }
    if (!listReady) return
    const el = containerRef.current
    if (el) el.scrollTop = savedScroll.top
    useProfileStore.getState().clearSavedScroll()
  }, [savedScroll, activeGridId, listReady])

  // The list's width, for how many columns can be kept in view (UX-B-13)
  const [gridWidth, setGridWidth] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setGridWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const leadingWidth = HANDLE_WIDTH + PROFILE_BTN_WIDTH + (acuityEnabled ? ACUITY_BADGE_WIDTH : 0) + (showTagsColumn ? TAGS_COL_WIDTH : 0)
  // Kept-in-view columns stop at FROZEN_MAX_SHARE of the list, so the rest can still scroll
  // past them instead of piling up under them (UX-B-13). Unknown width (not laid out yet): no cap
  const frozenFitCount = useMemo(
    () => gridWidth > 0 ? frozenCountThatFits(columns, frozenColumnCount, leadingWidth, gridWidth * FROZEN_MAX_SHARE) : frozenColumnCount,
    [columns, frozenColumnCount, leadingWidth, gridWidth],
  )
  // Asking for more than fits is refused, with a sentence, and the setting stays as it was
  const lastFrozenRef = useRef({ gridId: loadedGridId, count: frozenColumnCount })
  useEffect(() => {
    const last = lastFrozenRef.current
    lastFrozenRef.current = { gridId: loadedGridId, count: frozenColumnCount }
    if (last.gridId !== loadedGridId || last.count === frozenColumnCount) return
    if (frozenColumnCount > last.count && frozenFitCount < frozenColumnCount) {
      toast(`Too many columns to keep in view at this window size. Try fewer, or narrower columns.`)
      lastFrozenRef.current = { gridId: loadedGridId, count: last.count }
      setFrozenColumnCount(last.count)
    }
  }, [frozenColumnCount, frozenFitCount, loadedGridId, setFrozenColumnCount])

  const { columnSizing, handleColumnSizingChange, autoFitColumn, columnWidthVars, frozenLeftOffsets } = useGridColumnSizing({
    activeGridId, columns, acuityEnabled, showTagsColumn, frozenColumnCount: frozenFitCount, updateColumn,
  })

  // A column just added: wide enough for its name, scrolled into view, its header lit
  // for a moment, the way a new record is (UX-B-29, UX-B-30)
  const [flashColumnId, setFlashColumnId] = useState<number | null>(null)
  const knownColumnsRef = useRef<{ gridId: number | null; ids: Set<number> }>({ gridId: null, ids: new Set() })
  useEffect(() => {
    const known = knownColumnsRef.current
    const ids = new Set(columns.map(c => c.id))
    knownColumnsRef.current = { gridId: loadedGridId, ids }
    if (known.gridId !== loadedGridId || known.ids.size === 0 || loadedGridId !== activeGridId) return
    const added = columns.filter(c => !known.ids.has(c.id) && c.created_at && Date.now() - parseDbTimestamp(c.created_at).getTime() < NEW_COLUMN_MS)
    const col = added[added.length - 1]
    if (!col) return
    const fit = headerFitWidth(col.name)
    if (fit > col.width) handleColumnSizingChange((prev: Record<string, number>) => ({ ...prev, [`col_${col.id}`]: fit }))
    setFlashColumnId(col.id)
    requestAnimationFrame(() => {
      const el = containerRef.current
      if (!el) return
      const index = columns.findIndex(c => c.id === col.id)
      const left = leadingWidth + columns.slice(0, index).reduce((sum, c) => sum + Math.max(c.width, MIN_COL_WIDTH), 0)
      const right = left + Math.max(fit, col.width)
      if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + ADD_COL_WIDTH
      else if (left < el.scrollLeft) el.scrollLeft = left
    })
  }, [columns, loadedGridId, activeGridId, leadingWidth, handleColumnSizingChange])
  useEffect(() => {
    if (flashColumnId == null) return
    const timer = setTimeout(() => setFlashColumnId(null), 1500)
    return () => clearTimeout(timer)
  }, [flashColumnId])

  // Acuity sort: null → 'desc' (high first) → 'asc' (low first) → null
  const [acuitySortDir, setAcuitySortDir] = useState<'asc' | 'desc' | null>(null)
  // Reset acuity sort when switching grids or disabling acuity
  useEffect(() => { setAcuitySortDir(null) }, [activeGridId, acuityEnabled])

  // Apply starred pre-filter + column filters + acuity sort before passing to TanStack
  const filteredRows = useMemo(() => {
    // A due-status or Days-until filter reads counts, readings and done flags that
    // arrive after the rows (AUDIT-011): filter again when they land
    void deadlineContext
    let result = rows
    // A record just added stays in view until the filter changes (G-28)
    const pinned = (row: GridRow) => row.row_id === pinnedRowId
    if (showStarredOnly) {
      result = result.filter(row => row.is_starred === 1 || pinned(row))
    }
    if (activeFilters.length > 0) {
      const matcher = filterMode === 'or'
        ? (row: GridRow) => activeFilters.some(f => matchFilter(row, f, allColumns, rowTagsMap, alertRuleMap))
        : (row: GridRow) => activeFilters.every(f => matchFilter(row, f, allColumns, rowTagsMap, alertRuleMap))
      result = result.filter(row => matcher(row) || pinned(row))
    }
    return result
  }, [rows, activeFilters, filterMode, allColumns, rowTagsMap, showStarredOnly, pinnedRowId, alertRuleMap, deadlineContext])

  // Changing what's filtered lets the pinned record go (not the first render: the grid may mount after an add)
  const filterMounted = useRef(false)
  useEffect(() => {
    if (!filterMounted.current) { filterMounted.current = true; return }
    if (useGridStore.getState().pinnedRowId !== null) useGridStore.setState({ pinnedRowId: null })
  }, [activeFilters, filterMode, searchQuery, showStarredOnly])

  // Map for O(1) column lookup
  const columnMap = useMemo(() => new Map(columns.map(c => [c.id, c])), [columns])

  // O(1) row lookup by id (all rows, not just filtered).
  // Also used as rowMap for cross-row conditional format evaluation.
  const rowById = useMemo(() => new Map(rows.map(r => [r.row_id, r])), [rows])

  // Alias for conditional format evaluation (same map, same type — no cast needed).
  const rowMap = rowById

  const { parsedColumnConfigs, hasAnyHighlightRules, hasCrossRowRules, highlightColumnIds } = useGridRuleInfo(columns, cellFormats)

  const {
    moveToGridTarget, setMoveToGridTarget,
    handleDeleteRow, handleToggleStar, handleToggleStarProp, handleDuplicateRow, handleArchiveRow, handleUnarchiveRow,
  } = useGridRowActions({ setContextMenu, archiveRow, unarchiveRow, duplicateRow, updateRow, deleteRow, setSelectedRowIds })

  // Sensors: 5px distance threshold so single clicks still work (column reorder only).
  // The options are a constant: a new object each render made new sensors, which redrew
  // every column header on every scroll frame and every edit (UX pass Q9b)
  const colSensors = useSensors(useSensor(PointerSensor, COLUMN_DRAG_SENSOR))

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
  // The comparators read the direction at sort time, to keep blanks last either way
  const sortDescRef = useRef(new Map<string, boolean>())
  sortDescRef.current = new Map(sorting.map(s => [s.id, !!s.desc]))

  const tableColumns = useMemo(
    () => buildTableColumns({ columns, acuityEnabled, acuityLevels, alertRuleMap, alertRules, parsedColumnConfigs, sortDescRef }),
    [columns, acuityEnabled, acuityLevels, alertRuleMap, alertRules, parsedColumnConfigs],
  )

  // Custom global filter: only search name + text/dropdown columns
  // Search: every column that holds text, plus tags, the same as the board (G-25)
  const globalFilterFn = useCallback((row: GridTableRow, _columnId: string, filterValue: string) => {
    if (!filterValue) return true
    if (row.original.row_id === useGridStore.getState().pinnedRowId) return true
    return rowMatchesSearch(row.original, columns, filterValue, rowTagsMap)
  }, [columns, rowTagsMap])

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

  // The deadline comparator reads counts, readings and done flags that arrive after the
  // rows (R1). The table sorts again only when its data or its state change, and it compares
  // state by value, so it gets a new data array when they land.
  const tableData = useMemo(() => {
    void deadlineContext
    return filteredRows.slice()
  }, [filteredRows, deadlineContext])

  const table = useTable({
    features: gridFeatures,
    data: tableData,
    columns: tableColumns,
    state: tableState,
    onSortingChange: handleSortingChange,
    onColumnSizingChange: handleColumnSizingChange,
    getRowId: row => String(row.row_id),
    globalFilterFn,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
  })

  const tableRows = table.getRowModel().rows
  const headerGroups = table.getHeaderGroups()
  // Without the synthetic _acuity_points header. The same array until the headers change, so a
  // scroll or an edit doesn't redraw the header row (UX pass Q9b)
  const headers = useMemo(() => (headerGroups[0]?.headers ?? []).filter(h => h.id !== '_acuity_points'), [headerGroups])
  const hideTagsColumn = useCallback(() => setShowTagsColumn(false), [setShowTagsColumn])
  // The header objects stay the same through these, so they go to the header row as props
  const resizingColumnId = table.state.columnResizing.isResizingColumn || null

  // The rows the filter and search leave, in screen order: export, Find & Replace and
  // the counts act on these (G-05, G-24). Select-all and Ctrl+A use visualRowIds, which
  // also leaves out rows inside collapsed groups (AUDIT-139)
  const visibleRows = useMemo(() => tableRows.map(r => r.original), [tableRows])
  filteredRowsRef.current = visibleRows

  // Keep sortedRowIds in sync so ProfileView can compute prev/next
  useEffect(() => {
    setSortedRowIds(visibleRows.map(r => r.row_id))
  }, [visibleRows, setSortedRowIds])

  // A filter or search that hides selected records also unselects them, so bulk actions only touch what's shown
  useEffect(() => {
    // Nothing picked (the usual case): nothing to check, so an edit doesn't walk every record
    if (selectedRowIdsRef.current.size === 0) return
    const shown = new Set(visibleRows.map(r => r.row_id))
    setSelectedRowIds(prev => [...prev].every(id => shown.has(id)) ? prev : new Set([...prev].filter(id => shown.has(id))))
  }, [visibleRows, setSelectedRowIds, selectedRowIdsRef])

  // Grouping (extracted hook)
  const {
    displayItems, visualRowIds, isGrouped: isGroupedFromHook,
    activeCustomGroup,
    collapseAll: handleCollapseAll, expandAll: handleExpandAll, toggleGroup: handleToggleGroup,
  } = useGridGrouping({
    tableRows, columns: allColumns, acuityLevels, customGroups, activeCustomGroupId,
    // Grouping by priority stops while the priority feature is off
    groupByColumnId: groupByColumnId === ACUITY_GROUP_KEY && !acuityEnabled ? null : groupByColumnId,
  })

  visualRowIdsRef.current = visualRowIds

  // Group headers are their own height, so scrolling to a record lands on it (AUDIT-132).
  // The Collapse all bar sits above the list, outside the scroll area and the grid (AUDIT-042)
  const sizeOf = useMemo(() => isGroupedFromHook
    ? (i: number) => displayItems[i]?.kind === 'group-header' ? GROUP_HEADER_HEIGHT : rowHeight
    : undefined, [isGroupedFromHook, displayItems, rowHeight])

  // Virtual scrolling (extracted hook)
  const { virtualRows, totalSize: totalHeight, paddingTop, paddingBottom, scrollToRow } = useGridVirtualizer({
    parentRef: containerRef,
    count: isGroupedFromHook ? displayItems.length : tableRows.length,
    rowHeight,
    sizeOf,
  })

  /** Bring a record into view, whether or not the list is grouped */
  const scrollToRowId = useCallback((rowId: number) => {
    const tableIdx = tableRows.findIndex(r => r.original.row_id === rowId)
    if (tableIdx < 0) return
    const idx = isGroupedFromHook ? displayItems.findIndex(it => it.kind === 'row' && it.tableRowIndex === tableIdx) : tableIdx
    if (idx >= 0) scrollToRow(idx)
  }, [tableRows, displayItems, isGroupedFromHook, scrollToRow])
  scrollToRowIdRef.current = scrollToRowId

  // Roving tab stop (audit G-32): the list is one Tab stop, and arrows move
  // inside it. The stop is the focused cell while it's on screen, otherwise
  // the first cell of the first record on screen.
  const renderedRowIds: number[] = []
  for (const vr of virtualRows) {
    const item = isGroupedFromHook ? displayItems[vr.index] : undefined
    const row = isGroupedFromHook
      ? (item?.kind === 'row' ? tableRows[item.tableRowIndex] : undefined)
      : tableRows[vr.index]
    if (row) renderedRowIds.push(row.original.row_id)
  }
  const firstCol = columns.find(c => c.is_visible !== 0)
  const tabStopRef = useRef<{ rowId: number; columnId: number } | null>(null)
  const tabStop = focusedCell && renderedRowIds.includes(focusedCell.rowId)
    ? focusedCell
    : renderedRowIds[0] !== undefined && firstCol
      ? { rowId: renderedRowIds[0], columnId: firstCol.id }
      : null
  tabStopRef.current = tabStop

  // Find & Replace: the active match comes into view (G-27)
  useEffect(() => {
    if (findReplaceActiveMatch) scrollToRowId(findReplaceActiveMatch.rowId)
  }, [findReplaceActiveMatch]) // eslint-disable-line react-hooks/exhaustive-deps -- only when the match changes, not on every re-render of the rows

  const totalWidth = HANDLE_WIDTH + PROFILE_BTN_WIDTH + (acuityEnabled ? ACUITY_BADGE_WIDTH : 0) + (showTagsColumn ? TAGS_COL_WIDTH : 0) + table.getTotalSize() + ADD_COL_WIDTH
  const openAddColumn = useCallback(() => pulseEvents.emit('grid:add-column'), [])
  const columnIds = useMemo(() => columns.map(c => `col_${c.id}`), [columns])

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
    editingCellRef, rowsRef, filteredRowsRef, visualRowIdsRef, selectedRowIdsRef,
    columns, columnMap, updateCell, navigateCell,
    setEditingCell, setSelectedRowIds, openRecord: handleNavigateToProfile,
  }), [editingCellRef, selectedRowIdsRef, columns, columnMap, updateCell, navigateCell, setEditingCell, setSelectedRowIds, handleNavigateToProfile])
  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, rowId: number, columnId: number) => {
    handleCellKeyDownImpl(e, rowId, columnId, keyNavDeps)
  }, [keyNavDeps])

  // Navigate to adjacent row after Enter-commit in CellEditor. False at the list's edge:
  // the row then keeps focus on the cell just saved (persona study, Mark)
  const handleNavigateAfterEdit = useCallback(
    (rowId: number, colId: number, direction: NavDirection): boolean => navigateCell(rowId, colId, direction),
    [navigateCell],
  )

  // The drawn box never lies: when focus has fallen to the page (a record that moved, a
  // menu that closed) and a cell is still lit, the keys that move or edit act on that cell
  const focusedCellRef = useRef(focusedCell)
  focusedCellRef.current = focusedCell
  useEffect(() => {
    const KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'F2', 'Tab'])
    const onKeyDown = (e: KeyboardEvent) => {
      const lit = focusedCellRef.current
      if (!lit || !KEYS.has(e.key) || e.defaultPrevented || e.altKey) return
      if (document.activeElement !== document.body && document.activeElement !== null) return
      if (editingCellRef.current || document.querySelector(OPEN_LAYER)) return
      const el = containerRef.current?.querySelector<HTMLElement>(`[data-row-id="${lit.rowId}"][data-col-id="${lit.columnId}"]`)
      e.preventDefault()
      if (!el) { focusCell(lit.rowId, lit.columnId); return }
      el.focus({ preventScroll: true })
      // The same key again, on the cell, so the grid's own handling runs (React hears it at the root)
      el.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, bubbles: true, cancelable: true }))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editingCellRef, focusCell])

  // "Skip to the list" (MainLayout): the lit cell, even scrolled away, or the first one on screen
  useEffect(() => pulseEvents.on('grid:focus-cell', () => {
    const lit = focusedCellRef.current
    const target = lit && visualRowIdsRef.current.includes(lit.rowId) ? lit : tabStopRef.current
    if (target) focusCell(target.rowId, target.columnId)
  }), [focusCell])

  // Auto-edit first editable cell when a new row is added
  useEffect(() => {
    if (!lastAddedRowId) return
    // Show where it went: a long or sorted list puts it out of sight (G-28)
    scrollToRowId(lastAddedRowId)
    const s = useGridStore.getState()
    const newRow = s.rows.find(r => r.row_id === lastAddedRowId)
    const hiddenByFilter = !!newRow && ((s.showStarredOnly && newRow.is_starred !== 1) || !!s.searchQuery
      || (s.activeFilters.length > 0 && !(s.filterMode === 'or'
        ? s.activeFilters.some(f => matchFilter(newRow, f, allColumns, rowTagsMap, alertRuleMap))
        : s.activeFilters.every(f => matchFilter(newRow, f, allColumns, rowTagsMap, alertRuleMap)))))
    if (hiddenByFilter) {
      toast(tt => (
        <span className="flex items-center gap-3 text-base">
          Added — your filter would hide it.
          <button type="button" className="btn-secondary" onClick={() => {
            toast.dismiss(tt.id)
            useGridStore.setState({ activeFilters: [], searchQuery: '', showStarredOnly: false })
          }}>Show all</button>
        </span>
      ), { duration: 8000 })
    }
    const timer = setTimeout(() => {
      // The name first: it's what a new record needs, whatever column comes first (UX-B-39)
      const firstEditableCol = columns.find(c => c.is_name_column === 1 && !isNotTypedColumnType(c.column_type))
        ?? columns.find(c => !isNotTypedColumnType(c.column_type))
      if (firstEditableCol) {
        setFocusedCell({ rowId: lastAddedRowId, columnId: firstEditableCol.id })
        setEditingCell({ rowId: lastAddedRowId, columnId: firstEditableCol.id })
      }
      useGridStore.setState({ lastAddedRowId: null })
    }, 50)
    return () => clearTimeout(timer)
  }, [lastAddedRowId, columns, setEditingCell]) // eslint-disable-line react-hooks/exhaustive-deps -- once per added record

  // Said out loud for screen readers: entering and leaving a cell's editor, and how many records are picked
  const announcement = useGridAnnouncer(editingCell, columnMap, selectedRowIds)

  const handleBulkSetAcuityLevel = useCallback((levelId: number | null) => {
    const ids = Array.from(selectedRowIdsRef.current)
    void bulkSetRowAcuityLevel(ids, levelId)
  }, [bulkSetRowAcuityLevel, selectedRowIdsRef])

  // Render helper for SortableRow — eliminates duplication between grouped and ungrouped paths
  const renderSortableRow = (row: GridTableRow, rowIndex: number, ariaRowIndex: number) => (
    <SortableRow
      key={row.id}
      row={row}
      rowIndex={rowIndex}
      ariaRowIndex={ariaRowIndex}
      rowHeight={rowHeight}
      editingRowId={editingCell?.rowId ?? null}
      editingColId={editingCell?.columnId ?? null}
      focusedRowId={focusedCell?.rowId ?? null}
      focusedColId={focusedCell?.columnId ?? null}
      tabStopColId={tabStop?.rowId === row.original.row_id ? tabStop.columnId : null}
      columns={columns}
      columnMap={columnMap}
      alertRuleMap={alertRuleMap}
      deadlineContext={deadlineContext}
      cellFormats={cellFormats}
      parsedColumnConfigs={parsedColumnConfigs}
      hasAnyHighlightRules={hasAnyHighlightRules}
      highlightColumnIds={highlightColumnIds}
      rowMap={rowMap}
      hasCrossRowRules={hasCrossRowRules}
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
      onOpenRowMenu={handleOpenRowMenu}
      onNavigateToProfile={handleNavigateToProfile}
      onToggleStar={handleToggleStarProp}
      showTags={showTagsColumn}
      rowTags={rowTagsMap.get(row.original.row_id)}
      onToggleSelect={handleToggleRowSelect}
      onNavigateAfterEdit={handleNavigateAfterEdit}
      focusCell={focusCell}
      rowId={row.original.row_id}
      searchQuery={findReplaceQuery || searchQuery || undefined}
      findReplaceActiveRowId={findReplaceActiveMatch?.rowId ?? null}
      findReplaceActiveColId={findReplaceActiveMatch?.colId ?? null}
      frozenLeftOffsets={frozenLeftOffsets}
      frozenColumnCount={frozenFitCount}
      isSample={sampleRows[row.original.row_id] !== undefined}
      motionState={leavingRowIds.has(row.original.row_id) ? 'leave' : flashRowId === row.original.row_id ? 'flash' : null}
    />
  )

  // Only a first load or another list shows the placeholder. A reload of this list keeps the
  // table mounted, so the scroll position and the focused cell stay put (AUDIT-039)
  if (isLoading && loadedGridId !== activeGridId) {
    return <GridLoadingSkeleton rowHeight={rowHeight} />
  }

  if (loadError && !isLoading) {
    return <GridLoadError message={loadError} onRetry={() => { if (activeGridId !== null) void useGridStore.getState().loadGrid(activeGridId) }} />
  }

  if (columns.length === 0) {
    return <GridEmptyColumns hiddenCount={hiddenColumns.length}
      onShowAll={() => void useGridStore.getState().showAllColumns()}
      onAddColumn={() => pulseEvents.emit('grid:add-column')} />
  }

  const isGrouped = isGroupedFromHook
  // Screen readers pair each cell with its header by these numbers, and hear how many
  // records there are while only some are drawn (AUDIT-012, AUDIT-042)
  const leadingColCount = 4 + (acuityEnabled ? 1 : 0) + (showTagsColumn ? 1 : 0)
  // + 1 for the "Add a column" header after the last column (UX-B-03)
  const colCount = leadingColCount + columns.length + 1
  const rowCount = 1 + (isGrouped ? displayItems.length : tableRows.length)
  const isEmpty = tableRows.length === 0 && !isLoading

  return (
    <div
      data-tour="grid"
      className="h-full flex flex-col overflow-hidden"
    >
      {/* Only rows sit inside the grid: the Collapse all bar, the empty-list
          message and the dialogs are outside it, so screen readers stay in table mode */}
      {/* Collapse/Expand All toolbar (grouped mode only, and only with something to fold, UX-B-41) */}
      {isGrouped && tableRows.length > 0 && (
        <div className="flex-shrink-0">
          <CollapseExpandBar onCollapseAll={handleCollapseAll} onExpandAll={handleExpandAll} />
        </div>
      )}

      <div
        role="grid"
        aria-label={t('list', { cap: true })}
        aria-rowcount={rowCount}
        aria-colcount={colCount}
        aria-multiselectable="true"
        className={`${isEmpty ? 'flex-none' : 'flex-1'} min-h-0 flex flex-col overflow-hidden`}
      >
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
            selectableRowIds={visualRowIds}
            setSelectedRowIds={setSelectedRowIds}
            showTags={showTagsColumn}
            onHideTags={hideTagsColumn}
            onAddColumn={openAddColumn}
            colSensors={colSensors}
            onColumnDragEnd={handleColumnDragEnd}
            autoFitColumn={autoFitColumn}
            frozenLeftOffsets={frozenLeftOffsets}
            frozenColumnCount={frozenFitCount}
            setFrozenColumnCount={setFrozenColumnCount}
            flashColumnId={flashColumnId}
            sorting={sorting}
            resizingColumnId={resizingColumnId}
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
          {/* ── Unified virtualized rendering (both grouped and ungrouped) ── */}
          <div role="rowgroup" style={{ position: 'relative', height: totalHeight }}>
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
                      ariaRowIndex={vr.index + 2}
                      colCount={colCount}
                      onToggle={handleToggleGroup}
                      onContextMenu={e => { e.preventDefault(); setGroupContextMenu({ x: e.clientX, y: e.clientY }) }}
                    />
                  )
                }
                // kind === 'row' in grouped mode
                const row = tableRows[item.tableRowIndex]
                if (!row) return null
                return renderSortableRow(row, item.tableRowIndex, vr.index + 2)
              }

              // Ungrouped mode
              const row = tableRows[vr.index]
              if (!row) return null
              return renderSortableRow(row, vr.index, vr.index + 2)
            })}

            {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
            {/* Room under the last row while the bulk bar floats over it (UX-B-25) */}
            {selectedRowIds.size > 0 && <div style={{ height: BULK_BAR_ROOM }} aria-hidden="true" data-testid="bulk-bar-room" />}
          </div>
        </div>

      </div>
      </div>
      </div>

      {/* Empty state */}
      {isEmpty && <GridEmptyRecords searchQuery={searchQuery} hasRecords={rows.length > 0} />}

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="grid-announcer">{announcement}</div>

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
          onDeleteRow={id => void handleDeleteRow(id)}
          onToggleStar={id => void handleToggleStar(id)}
          onOpenRecord={handleNavigateToProfile}
          onDuplicateRow={id => void handleDuplicateRow(id)}
          onArchiveRow={id => void handleArchiveRow(id)}
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

      {/* Move / Copy to Grid modal */}
      <MoveToGridDialog
        moveToGridTarget={moveToGridTarget}
        activeGridId={activeGridId}
        columns={allColumns}
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

      {/* Bulk move to grid modal */}
      <BulkMoveDialog
        open={bulkMoveTarget}
        selectedRowIds={selectedRowIds}
        activeGridId={activeGridId}
        columns={allColumns}
        setSelectedRowIds={setSelectedRowIds}
        setBulkMoveTarget={setBulkMoveTarget}
      />
    </div>
  )
}
