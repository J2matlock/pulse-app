import React, { useMemo } from 'react'
import type { GridTableRow } from './gridTable'
import { User, Star, AlertTriangle, MoreHorizontal } from 'lucide-react'
import { BADGE_WIDTH as ACUITY_BADGE_WIDTH } from './AcuityBadge'
import type { GridRow, Column, ParsedAlertRule, CellFormatRule, AcuityLevel } from '../../../shared/types'
import { isNotTypedColumnType } from '../../../shared/types'
import { deadlineCellInfo, rowHighlightStyle, applyCellFormat } from './gridCellStyle'
import { withComputedValues } from '../../utils/computedColumns'
import { CellEditor, type NavDirection } from './CellEditor'
import { pushDiscardedTyping } from '../../utils/discardedTyping'
import { GridLinkEditor } from '../links/LinkPicker'
import { CellDisplay } from './CellDisplay'
import { AcuityBadge } from './AcuityBadge'
import { HANDLE_STYLE, HANDLE_WIDTH, OPEN_COL_WIDTH, STAR_COL_WIDTH, MENU_COL_WIDTH, PROFILE_BTN_WIDTH, TAGS_COL_WIDTH, FROZEN_EDGE_STYLE } from './gridConstants'
import { useVocab } from '../../hooks/useVocab'
import { IconButton } from '../ui/Button'
import { SamplePill } from '../shared/SampleDataBanner'
import { pulseEvents } from '../../events'
import { openDeadlineCard } from '../deadlines/openDeadlineCard'

type CellCoord = { rowId: number; columnId: number }

export interface SortableRowProps {
  row: GridTableRow
  rowIndex: number
  /** Where this row sits for a screen reader: the header row is 1, group headers count (AUDIT-042) */
  ariaRowIndex?: number
  rowHeight: number
  editingRowId: number | null
  editingColId: number | null
  focusedRowId: number | null
  focusedColId: number | null
  /** The cell in this record that takes the list's single Tab stop, if any */
  tabStopColId?: number | null
  columns: Column[]
  columnMap: Map<number, Column>
  alertRuleMap: Map<number, ParsedAlertRule>
  /** Meter readings, quota counts, steps and extensions; a new one redraws deadline colors */
  deadlineContext?: unknown
  cellFormats: Map<string, CellFormatRule[]>
  parsedColumnConfigs: Map<number, { config: Record<string, unknown>; conditionalFormat: CellFormatRule[] }>
  hasAnyHighlightRules: boolean
  highlightColumnIds: Set<number>
  rowMap: Map<number, GridRow>
  /** Some rule colors a cell from another record's cell, so any record's change can redraw this one */
  hasCrossRowRules?: boolean
  containerRef: React.RefObject<HTMLDivElement>
  isSelected: boolean
  selectedCount: number
  onBulkSetAcuityLevel: (levelId: number | null) => void
  acuityEnabled: boolean
  acuityLevels: AcuityLevel[]
  onSetAcuityLevel: (rowId: number, levelId: number | null) => void
  editingCellRef: React.RefObject<CellCoord | null>
  setEditingCell: (c: CellCoord | null) => void
  setFocusedCell: (c: CellCoord | null) => void
  updateCell: (rowId: number, colId: number, value: string | null) => Promise<unknown>
  onCellKeyDown: (e: React.KeyboardEvent, rowId: number, colId: number) => void
  onCellContextMenu: (e: React.MouseEvent, rowId: number, colId: number) => void
  /** The row's "⋯" button, Shift+F10 or the Menu key: the same menu as a right-click, anchored at a point (UX-B-01) */
  onOpenRowMenu?: (rowId: number, colId: number, at: { x: number; y: number }) => void
  onNavigateToProfile: (rowId: number) => void
  onToggleStar?: (rowId: number) => void
  /** The built-in Tags column (G-37) */
  showTags?: boolean
  rowTags?: string[]
  onToggleSelect: (e: React.MouseEvent, rowId: number) => void
  /** Move after an editor's Enter or Tab; false when there's nowhere to go (the list's edge) */
  onNavigateAfterEdit: (rowId: number, colId: number, direction: NavDirection) => boolean
  /** Light this cell and focus it once the list has drawn, found by record and column (a save can re-sort the list) */
  focusCell: (rowId: number, colId: number) => void
  rowId: number
  searchQuery?: string
  findReplaceActiveRowId: number | null
  findReplaceActiveColId: number | null
  frozenLeftOffsets: Map<number, number>
  frozenColumnCount: number
  /** A made-up sample entry (shows a "Sample" pill by its name) */
  isSample?: boolean
  /** Just arrived (lit for a moment) or on its way out (dims and closes up); motion.css (Q6) */
  motionState?: RowMotionState
}

export type RowMotionState = 'flash' | 'leave' | null

const MOTION_CLASS: Record<Exclude<RowMotionState, null>, string> = { flash: 'motion-flash', leave: 'motion-row-leave' }

const COMPUTED_NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'])

export const SortableRow = React.memo(function SortableRow({
  row,
  rowIndex,
  ariaRowIndex,
  rowHeight,
  editingRowId,
  editingColId,
  focusedRowId,
  focusedColId,
  tabStopColId = null,
  columns,
  columnMap,
  alertRuleMap,
  deadlineContext,
  cellFormats,
  parsedColumnConfigs,
  hasAnyHighlightRules,
  highlightColumnIds,
  rowMap,
  containerRef,
  isSelected,
  selectedCount,
  onBulkSetAcuityLevel,
  acuityEnabled,
  acuityLevels,
  onSetAcuityLevel,
  editingCellRef,
  setEditingCell,
  setFocusedCell,
  updateCell,
  onCellKeyDown,
  onCellContextMenu,
  onOpenRowMenu,
  onNavigateToProfile,
  onToggleStar,
  showTags,
  rowTags,
  onToggleSelect,
  onNavigateAfterEdit,
  focusCell,
  rowId: propRowId,
  searchQuery,
  findReplaceActiveRowId,
  findReplaceActiveColId,
  frozenLeftOffsets,
  frozenColumnCount,
  isSample = false,
  motionState = null,
}: SortableRowProps): React.ReactElement {
  const { t } = useVocab()
  const rowId = propRowId

  // Pre-compute row-level formatting (cell rules + column rules with highlightRow=true).
  const rowOriginal = row.original as GridRow
  // Highlight rules on Age and Days-until compare the number the cell shows (bug sweep S5)
  const evalRow = useMemo(() => withComputedValues(rowOriginal, columns, alertRuleMap), [rowOriginal, columns, alertRuleMap, deadlineContext]) // eslint-disable-line react-hooks/exhaustive-deps -- deadlineContext: done flags and counts change what Days-until shows
  const rowFormatStyle = useMemo<React.CSSProperties>(
    () => rowHighlightStyle({ hasAnyHighlightRules, highlightColumnIds, cellFormats, parsedColumnConfigs, evalRow, rowMap, rowId }),
    [hasAnyHighlightRules, highlightColumnIds, cellFormats, parsedColumnConfigs, evalRow, rowMap, rowId],
  )

  const isArchived = row.original.is_active === 0
  // Each cell names its column's place, matching the header (AUDIT-012)
  const priorityColIndex = acuityEnabled ? 5 : undefined
  const tagsColIndex = showTags ? 5 + (acuityEnabled ? 1 : 0) : undefined
  const leadingColCount = 4 + (acuityEnabled ? 1 : 0) + (showTags ? 1 : 0)

  // The row menu's cell actions act on the focused cell when it's in this row, else the name
  const menuColId = focusedRowId === rowId && focusedColId !== null
    ? focusedColId
    : (columns.find(c => c.is_name_column === 1) ?? columns[0])?.id
  const openRowMenuAt = (el: HTMLElement, colId: number) => {
    const rect = el.getBoundingClientRect()
    onOpenRowMenu?.(rowId, colId, { x: rect.left, y: rect.bottom })
  }

  const rowStyle = useMemo<React.CSSProperties>(() => ({
    height: rowHeight,
    opacity: isArchived ? 0.5 : 1,
  }), [rowHeight, isArchived])

  return (
    <div
      role="row"
      aria-rowindex={ariaRowIndex}
      aria-selected={isSelected}
      data-row-index={rowIndex}
      className={`flex border-b border-[var(--border-grid)] hover:bg-slate-50 dark:hover:bg-slate-800/50 group
        ${isArchived ? 'opacity-50' : ''}
        ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
        ${motionState ? MOTION_CLASS[motionState] : ''}
      `}
      style={rowStyle}
    >
      {/* Selection checkbox */}
      <div
        role="gridcell"
        aria-colindex={1}
        className="grid-lead-cell flex-shrink-0 flex items-center justify-center border-b border-[var(--border-grid)] bg-white dark:bg-slate-900"
        style={{
          ...HANDLE_STYLE,
          ...(frozenColumnCount > 0 ? { position: 'sticky' as const, left: 0, zIndex: 10 } : {}),
        }}
      >
        <button
          onClick={e => onToggleSelect(e, rowId)}
          className={`hit-44 flex items-center justify-center w-6 h-6 rounded-sm focus-visible:ring-3 focus-visible:ring-blue-500 focus-visible:ring-offset-1 cursor-pointer
            ${isSelected ? '' : 'opacity-40 group-hover:opacity-100'}
            transition-opacity`}
          tabIndex={-1}
          aria-label={`${isSelected ? 'Deselect' : 'Select'} ${t('record')}`}
          title={`Select ${t('record')}`}
        >
          {isSelected ? (
            <div className="w-4 h-4 rounded-sm border-2 bg-blue-500 border-blue-500 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          ) : (
            <div className="w-4 h-4 rounded-sm border-2 border-slate-300 dark:border-slate-500" />
          )}
        </button>
      </div>

      {/* Open the record */}
      <div
        role="gridcell"
        aria-colindex={2}
        className="grid-lead-cell flex-shrink-0 flex items-center justify-center border-r border-b border-[var(--border-grid)] bg-white dark:bg-slate-900"
        style={{
          width: OPEN_COL_WIDTH, height: rowHeight,
          ...(frozenColumnCount > 0 ? { position: 'sticky' as const, left: HANDLE_WIDTH, zIndex: 10 } : {}),
        }}
      >
        <button
          tabIndex={-1}
          onClick={e => { e.stopPropagation(); onNavigateToProfile(rowId) }}
          className="hit-44 flex items-center justify-center w-7 h-7 profile-btn-glow
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-indigo-500"
          title={`Open ${t('record')}'s page`}
          aria-label={`Open ${t('record')}'s page`}
          {...(rowIndex === 0 ? { 'data-tour': 'profile-icon' } : {})}
        >
          <User className="w-4 h-4" />
        </button>
      </div>

      {/* Star: starred records show it (G-30); every other row shows a faint outline, so the column explains itself (UX-A-23) */}
      <div
        role="gridcell"
        aria-colindex={3}
        className="grid-lead-cell flex-shrink-0 flex items-center justify-center border-r border-b border-[var(--border-grid)] bg-white dark:bg-slate-900"
        style={{
          width: STAR_COL_WIDTH, height: rowHeight,
          ...(frozenColumnCount > 0 ? { position: 'sticky' as const, left: HANDLE_WIDTH + OPEN_COL_WIDTH, zIndex: 10 } : {}),
        }}
      >
        <button
          tabIndex={-1}
          onClick={e => { e.stopPropagation(); onToggleStar?.(rowId) }}
          className={`hit-44 flex items-center justify-center w-7 h-7 rounded focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
            ${row.original.is_starred ? '' : 'opacity-40 group-hover:opacity-70 hover:!opacity-100 focus-visible:opacity-100'}`}
          title={row.original.is_starred ? 'Remove star' : `Star this ${t('record')}`}
          aria-label={row.original.is_starred ? 'Remove star' : `Star this ${t('record')}`}
          aria-pressed={!!row.original.is_starred}
        >
          <Star className={`w-4 h-4 ${row.original.is_starred ? 'fill-yellow-400 text-yellow-500' : 'text-slate-400'}`} />
        </button>
      </div>

      {/* Row menu: the same menu as a right-click, for people who never right-click (UX-B-01) */}
      <div
        role="gridcell"
        aria-colindex={4}
        className="grid-lead-cell flex-shrink-0 flex items-center justify-center border-r border-b border-[var(--border-grid)] bg-white dark:bg-slate-900"
        style={{
          width: MENU_COL_WIDTH, height: rowHeight,
          ...(frozenColumnCount > 0 ? { position: 'sticky' as const, left: HANDLE_WIDTH + OPEN_COL_WIDTH + STAR_COL_WIDTH, zIndex: 10 } : {}),
        }}
      >
        {menuColId !== undefined && (
          <IconButton
            tabIndex={-1}
            size="compact"
            label={`More actions for this ${t('record')}`}
            icon={<MoreHorizontal className="w-4 h-4" />}
            onClick={e => { e.stopPropagation(); openRowMenuAt(e.currentTarget, menuColId) }}
            aria-haspopup="menu"
            data-testid="row-menu-button"
          />
        )}
      </div>

      {/* Acuity badge */}
      {acuityEnabled && (
        <div
          role="gridcell"
          aria-colindex={priorityColIndex}
          className="bg-white dark:bg-slate-900"
          style={frozenColumnCount > 0 ? { position: 'sticky', left: HANDLE_WIDTH + PROFILE_BTN_WIDTH, zIndex: 10 } : undefined}
        >
          <AcuityBadge
            levels={acuityLevels}
            currentLevelId={row.original.acuity_level_id}
            bulkCount={undefined}
            onSetLevel={levelId => {
              if (isSelected && selectedCount > 1) {
                onBulkSetAcuityLevel(levelId)
              } else {
                onSetAcuityLevel(rowId, levelId)
              }
            }}
          />
        </div>
      )}

      {/* Tags from the record's page, as a built-in column (G-37) */}
      {showTags && (
        <div role="gridcell" aria-colindex={tagsColIndex} className="flex-shrink-0 flex items-center gap-1 px-2 overflow-hidden border-r border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
          style={{ width: TAGS_COL_WIDTH, height: rowHeight, ...(frozenColumnCount > 0 ? { position: 'sticky' as const, left: HANDLE_WIDTH + PROFILE_BTN_WIDTH + (acuityEnabled ? ACUITY_BADGE_WIDTH : 0), zIndex: 10 } : {}) }}
          title={rowTags?.join(', ')} data-testid="row-tags-cell">
          {(rowTags ?? []).slice(0, 2).map(tag => (
            <span key={tag} className="truncate max-w-[6rem] px-2 py-0.5 rounded-full text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">{tag}</span>
          ))}
          {(rowTags?.length ?? 0) > 2 && <span className="text-sm text-slate-500 dark:text-slate-400">+{rowTags!.length - 2}</span>}
        </div>
      )}

      {/* Cells – flex-1 to push menu button to the right */}
      {row.getAllCells().map(cell => {
        const colId = parseInt(cell.column.id.replace('col_', ''), 10)
        const col = columnMap.get(colId)
        if (!col) return null
        const value = row.original[`col_${colId}` as keyof GridRow] as string | null
        const isEditing = editingRowId === rowId && editingColId === colId
        const isFocused = focusedRowId === rowId && focusedColId === colId

        // Computed and auto-number columns are never editable
        // Link columns (W04) can't be typed into, but Enter or double-click opens their picker
        const isComputed = isNotTypedColumnType(col.column_type) && col.column_type !== 'link'

        // Date columns with a rule: color, shape, words and tooltip for how they stand (G-09, AUDIT-026)
        const { alertBgClass, alertBgStyle, hasAlertStyle, alertTooltip, alertIcon, alertChip, alertSpoken, hasRule, notADate } =
          deadlineCellInfo(col, value, rowOriginal, parsedColumnConfigs, alertRuleMap, t('record'))

        // Frozen column sticky positioning
        const frozenLeft = frozenLeftOffsets.get(colId)
        const isCellFrozen = frozenLeft !== undefined
        const colIdx = columns.findIndex(c => c.id === colId)
        const isLastFrozenCell = isCellFrozen && colIdx === frozenColumnCount - 1

        // Priority: alert > cell-level format > column format > row highlight
        const cellStyle: React.CSSProperties = {
          width: `var(--cw-${colId})`, height: rowHeight,
          ...(isCellFrozen ? {
            position: 'sticky' as const,
            left: frozenLeft,
            zIndex: 10,
          } : {}),
          ...(isLastFrozenCell ? FROZEN_EDGE_STYLE : {}),
          // An open editor fills the cell: the cell padding (an unlayered rule p-0 can't beat)
          // squeezed a date's digits under its calendar button
          ...(isEditing ? { paddingLeft: 0, paddingRight: 0 } : {}),
        }
        let cellExtraClass = isCellFrozen ? 'bg-white dark:bg-slate-900 ' : ''

        if (hasAlertStyle) {
          Object.assign(cellStyle, alertBgStyle)
        } else {
          cellExtraClass = applyCellFormat(cellStyle, cellExtraClass, {
            cellFmtRules: cellFormats.get(`${rowId}_${colId}`) ?? [],
            colFmtRules: parsedColumnConfigs.get(col.id)?.conditionalFormat ?? [],
            fmtValue: (evalRow[`col_${colId}`] as string | null | undefined) ?? null,
            evalRow, rowMap, rowFormatStyle,
          })
        }

        // Cursor hint: editable cells get text/pointer cursor, computed/display stay default
        const cursorClass = isComputed ? 'cursor-default'
          : col.column_type === 'checkbox' || col.column_type === 'dropdown' || col.column_type === 'status' ? 'cursor-pointer'
          : 'cursor-text'

        return (
          <div
            key={cell.id}
            className={`flex-shrink-0 grid-cell select-text ${cursorClass}
                        ${isFocused && !isEditing ? 'ring-3 ring-inset ring-blue-500' : ''}
                        ${isEditing ? 'p-0' : 'overflow-hidden'}
                        ${alertBgClass} ${cellExtraClass}`}
            style={cellStyle}
            title={alertTooltip || undefined}
            onContextMenu={e => onCellContextMenu(e, rowId, colId)}
            tabIndex={tabStopColId === colId ? 0 : -1}
            role="gridcell"
            aria-colindex={leadingColCount + colIdx + 1}
            aria-selected={isFocused}
            onFocus={() => setFocusedCell({ rowId, columnId: colId })}
            onMouseDown={(e) => {
              // When another cell has a native picker open (date/select), the
              // picker swallows the click event on close. Use mousedown (fires
              // before blur) to claim focus for this cell.
              if (isComputed) return
              const cur = editingCellRef.current
              if (cur && (cur.rowId !== rowId || cur.columnId !== colId)) {
                e.preventDefault()
                // Blur the active editor input first so its onBlur→onSave fires
                // BEFORE we unmount it by clearing editingCell.
                const activeEl = document.activeElement as HTMLElement | null
                if (activeEl && containerRef.current?.contains(activeEl)) {
                  activeEl.blur()
                }
                setFocusedCell({ rowId, columnId: colId })
                setEditingCell(null)
                setTimeout(() => {
                  containerRef.current?.querySelector<HTMLElement>(
                    `[data-row-id="${rowId}"][data-col-id="${colId}"]`
                  )?.focus()
                }, 0)
              }
            }}
            onClick={e => {
              // Single click = select only (checkbox toggles immediately). A double-click's
              // second click is the same press, as everywhere else (useRepeatClickGuard, R3)
              if (e.detail >= 2) return
              if (!isComputed && col.column_type === 'checkbox') {
                const newVal = (value === 'true' || value === '1') ? 'false' : 'true'
                void updateCell(rowId, colId, newVal)
              }
              // A Deadline column's cell can't be typed into: a click opens its card (Done, Extend…)
              if (col.column_type === 'deadline' && hasRule) openDeadlineCard(rowId, colId, e.currentTarget)
            }}
            onDoubleClick={() => {
              // Double-click = enter edit mode (all types except checkbox)
              if (!isComputed && col.column_type !== 'checkbox') {
                setEditingCell({ rowId, columnId: colId })
              }
            }}
            onKeyDown={e => {
              // The keyboard's way to the row menu, anchored under this cell
              if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                e.preventDefault()
                openRowMenuAt(e.currentTarget, colId)
                return
              }
              if (isComputed) {
                // Moving, copying, selecting and opening the record work here too; nothing that writes
                const mod = e.ctrlKey || e.metaKey
                // Space: a deadline's card, or Shift+Space to select the record
                const passes = COMPUTED_NAV_KEYS.has(e.key) || e.key === 'Escape' || e.key === ' '
                  || (mod && (e.key === 'c' || e.key === 'C' || e.key === 'a' || e.key === 'A'))
                  || (e.key === 'Enter' && (mod || e.shiftKey))
                if (passes) onCellKeyDown(e, rowId, colId)
                else if (e.key === 'Enter' && col.column_type === 'deadline' && !hasRule) {
                  // The cell's "Choose a deadline rule" isn't a Tab stop, so Enter opens it
                  e.preventDefault()
                  pulseEvents.emit('column:choose-rule', { columnId: colId })
                }
              } else {
                onCellKeyDown(e, rowId, colId)
              }
            }}
            data-row-id={rowId}
            data-col-id={colId}
          >
            {isEditing && col.column_type === 'link' ? (
              <>
                <CellDisplay column={col} value={value} row={row.original} allColumns={columns} parsedConfig={parsedColumnConfigs.get(col.id)?.config} />
                <GridLinkEditor parsedConfig={parsedColumnConfigs.get(col.id)?.config} rowId={rowId} value={value}
                  anchor={containerRef.current?.querySelector<HTMLElement>(`[data-row-id="${rowId}"][data-col-id="${colId}"]`) ?? null}
                  onClose={() => {
                    setEditingCell(null)
                    focusCell(rowId, colId)
                  }} />
              </>
            ) : isEditing && !isComputed ? (
              <CellEditor
                column={col}
                value={value}
                // An empty name says what to do, as on a record just added (UX-B-39)
                placeholder={col.is_name_column === 1 && !value ? `Type the ${t('record')}'s name, then press Enter` : undefined}
                onSave={(newValue, navDirection) => {
                  // Check if this cell is still the active editing cell.
                  // If another cell already claimed focus (e.g. click-out), skip
                  // focus management to avoid flicker — just save the value.
                  const cur = editingCellRef.current
                  const isStillActive = cur && cur.rowId === rowId && cur.columnId === colId
                  if (isStillActive) {
                    // Clear editing state and navigate synchronously to avoid flicker,
                    // then save in the background (optimistic update handles UI).
                    setEditingCell(null)
                    // Enter on the last record (or Tab on the last cell) has nowhere to go: the
                    // place stays on this cell, not on the page (persona study, Mark)
                    const moved = navDirection ? onNavigateAfterEdit(rowId, colId, navDirection) : false
                    if (!moved) focusCell(rowId, colId)
                  }
                  void updateCell(rowId, colId, newValue)
                }}
                onCancel={() => {
                  setEditingCell(null)
                  focusCell(rowId, colId)
                }}
                // Escape threw typing away: an Undo step puts it back (persona study D5)
                onDiscard={typed => pushDiscardedTyping({ rowId, columnId: colId, columnName: col.name, typed, previous: value })}
              />
            ) : (
              <>
                {/* The shape opens the deadline's card (UX pass Q3). The sr-only words below already
                    say how it stands, so the shape itself isn't read twice; Space is the keyboard's way */}
                {alertIcon && (
                  <button type="button" tabIndex={-1} aria-label="Deadline: mark done or extend…" data-testid="deadline-shape"
                    className="hit-44 inline-flex flex-shrink-0 items-center rounded-lg cursor-pointer focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                    onClick={e => { e.stopPropagation(); openDeadlineCard(rowId, colId, e.currentTarget) }}
                    onDoubleClick={e => e.stopPropagation()}>
                    <span aria-hidden="true" className="contents">{alertIcon}</span>
                  </button>
                )}
                {notADate && (
                  <span className="mr-1.5 inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium text-red-800 dark:text-red-300" data-testid="not-a-date">
                    <AlertTriangle className="w-4 h-4" aria-hidden="true" />Not a date
                  </span>
                )}
                <CellDisplay column={col} value={value} row={row.original} allColumns={columns} parsedConfig={parsedColumnConfigs.get(col.id)?.config} highlightText={searchQuery} isActiveMatch={findReplaceActiveRowId === rowId && findReplaceActiveColId === col.id} />
                {isSample && col.is_name_column === 1 && <SamplePill compact />}
                {/* Faded alone doesn't say why (UX-B-27) */}
                {isArchived && col.is_name_column === 1 && (
                  <span className="ml-1.5 flex-shrink-0 px-2 rounded-full text-sm leading-6 font-medium bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-100" data-testid="archived-pill">Archived</span>
                )}
                {alertChip && <span className="ml-1.5 min-w-0 truncate text-sm text-slate-700 dark:text-slate-200" data-testid="deadline-chip">{alertChip}</span>}
                {alertSpoken && <span className="sr-only">{alertSpoken}</span>}
              </>
            )}
          </div>
        )
      })}

    </div>
  )
}, (prev, next) => {
  if (prev.row.original !== next.row.original) return false
  if (prev.isSelected !== next.isSelected) return false
  if (prev.rowIndex !== next.rowIndex) return false
  if (prev.ariaRowIndex !== next.ariaRowIndex) return false
  // Only compare selectedCount for selected rows (affects AcuityBadge bulkCount display)
  if (prev.isSelected && prev.selectedCount !== next.selectedCount) return false

  const prevEditing = prev.editingRowId === prev.rowId
  const nextEditing = next.editingRowId === next.rowId
  if (prevEditing !== nextEditing) return false
  if (prevEditing && nextEditing && prev.editingColId !== next.editingColId) return false

  const prevFocused = prev.focusedRowId === prev.rowId
  const nextFocused = next.focusedRowId === next.rowId
  if (prevFocused !== nextFocused) return false
  if (prevFocused && nextFocused && prev.focusedColId !== next.focusedColId) return false
  if (prev.tabStopColId !== next.tabStopColId) return false

  if (prev.columns !== next.columns) return false
  if (prev.cellFormats !== next.cellFormats) return false
  if (prev.parsedColumnConfigs !== next.parsedColumnConfigs) return false
  if (prev.hasAnyHighlightRules !== next.hasAnyHighlightRules) return false
  if (prev.highlightColumnIds !== next.highlightColumnIds) return false
  if (prev.acuityEnabled !== next.acuityEnabled) return false
  if (prev.showTags !== next.showTags || prev.rowTags !== next.rowTags) return false
  if (prev.acuityLevels !== next.acuityLevels) return false
  if (prev.alertRuleMap !== next.alertRuleMap) return false
  if (prev.deadlineContext !== next.deadlineContext) return false
  if (prev.searchQuery !== next.searchQuery) return false
  if (prev.findReplaceActiveRowId !== next.findReplaceActiveRowId) return false
  if (prev.findReplaceActiveColId !== next.findReplaceActiveColId) return false
  if (prev.frozenLeftOffsets !== next.frozenLeftOffsets) return false
  if (prev.frozenColumnCount !== next.frozenColumnCount) return false
  if (prev.isSample !== next.isSample) return false
  if ((prev.motionState ?? null) !== (next.motionState ?? null)) return false
  if (prev.rowHeight !== next.rowHeight) return false
  // A "cell of another record" rule reads rowMap: a change to that record redraws this one (AUDIT-038)
  if (prev.hasCrossRowRules !== next.hasCrossRowRules) return false
  if (next.hasCrossRowRules && prev.rowMap !== next.rowMap) return false
  // Stable today, but a new handler must reach the cells (AUDIT-133)
  if (prev.onCellKeyDown !== next.onCellKeyDown || prev.onCellContextMenu !== next.onCellContextMenu || prev.onOpenRowMenu !== next.onOpenRowMenu) return false
  if (prev.onNavigateToProfile !== next.onNavigateToProfile || prev.onNavigateAfterEdit !== next.onNavigateAfterEdit || prev.focusCell !== next.focusCell) return false
  if (prev.onToggleSelect !== next.onToggleSelect || prev.onToggleStar !== next.onToggleStar) return false
  if (prev.updateCell !== next.updateCell || prev.setEditingCell !== next.setEditingCell || prev.setFocusedCell !== next.setFocusedCell) return false
  if (prev.onSetAcuityLevel !== next.onSetAcuityLevel || prev.onBulkSetAcuityLevel !== next.onBulkSetAcuityLevel) return false

  return true
})
