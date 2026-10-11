import React, { useMemo } from 'react'
import { type Row } from '@tanstack/react-table'
import { User } from 'lucide-react'
import type { GridRow, Column, ParsedAlertRule, CellFormatRule, AcuityLevel } from '../../../shared/types'
import { isNotTypedColumnType, takesDeadlineRule } from '../../../shared/types'
import { getMatchingThreshold, evaluateRuleForRow, formatResultTooltip, deadlineChipText } from '../../utils/deadlineCalc'
import { resolveAlertColor } from '../../utils/alertColors'
import { evalCellFormat } from './CellConditionalFormatPanel'
import { CellEditor, type NavDirection } from './CellEditor'
import { GridLinkEditor } from '../links/LinkPicker'
import { CellDisplay } from './CellDisplay'
import { AcuityBadge } from './AcuityBadge'
import { alertShapeForBand, HANDLE_STYLE, HANDLE_WIDTH, PROFILE_BTN_WIDTH } from './gridConstants'
import { useVocab } from '../../hooks/useVocab'

type CellCoord = { rowId: number; columnId: number }

export interface SortableRowProps {
  row: Row<GridRow>
  rowIndex: number
  rowHeight: number
  editingRowId: number | null
  editingColId: number | null
  focusedRowId: number | null
  focusedColId: number | null
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
  updateCell: (rowId: number, colId: number, value: string | null) => Promise<void>
  onCellKeyDown: (e: React.KeyboardEvent, rowId: number, colId: number) => void
  onCellContextMenu: (e: React.MouseEvent, rowId: number, colId: number) => void
  onNavigateToProfile: (rowId: number) => void
  onToggleSelect: (e: React.MouseEvent, rowId: number) => void
  onNavigateAfterEdit: (rowId: number, colId: number, direction: NavDirection) => void
  rowId: number
  searchQuery?: string
  findReplaceActiveRowId: number | null
  findReplaceActiveColId: number | null
  frozenLeftOffsets: Map<number, number>
  frozenColumnCount: number
}

export const SortableRow = React.memo(function SortableRow({
  row,
  rowIndex,
  rowHeight,
  editingRowId,
  editingColId,
  focusedRowId,
  focusedColId,
  columns,
  columnMap,
  alertRuleMap,
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
  onNavigateToProfile,
  onToggleSelect,
  onNavigateAfterEdit,
  rowId: propRowId,
  searchQuery,
  findReplaceActiveRowId,
  findReplaceActiveColId,
  frozenLeftOffsets,
  frozenColumnCount,
}: SortableRowProps): React.ReactElement {
  const { t } = useVocab()
  const rowId = propRowId

  // Pre-compute row-level formatting (cell rules + column rules with highlightRow=true).
  const rowOriginal = row.original as GridRow
  const rowFormatStyle = useMemo<React.CSSProperties>(() => {
    const style: React.CSSProperties = {}
    if (!hasAnyHighlightRules || highlightColumnIds.size === 0) return style
    for (const colId of highlightColumnIds) {
      try {
        const selfVal = rowOriginal[`col_${colId}`] ?? null
        const cellFmtRules = (cellFormats.get(`${rowId}_${colId}`) ?? []).filter(r => r.highlightRow)
        if (cellFmtRules.length > 0) {
          const cellMatch = evalCellFormat(cellFmtRules, selfVal, rowOriginal, rowMap)
          if (cellMatch && (cellMatch.bgColor || cellMatch.borderColor)) {
            if (cellMatch.bgColor) style.backgroundColor = cellMatch.bgColor
            if (cellMatch.textColor) style.color = cellMatch.textColor
            if (cellMatch.borderColor) style.boxShadow = `inset 0 0 0 2px ${cellMatch.borderColor}`
            return style
          }
        }
        const colFmtRaw = parsedColumnConfigs.get(colId)?.conditionalFormat ?? []
        if (colFmtRaw.length > 0) {
          const colHighlightRules = colFmtRaw.filter((r: CellFormatRule) => r.highlightRow)
          if (colHighlightRules.length > 0) {
            const colMatch = evalCellFormat(colHighlightRules, selfVal, rowOriginal, rowMap)
            if (colMatch && (colMatch.bgColor || colMatch.borderColor)) {
              if (colMatch.bgColor) style.backgroundColor = colMatch.bgColor
              if (colMatch.textColor) style.color = colMatch.textColor
              if (colMatch.borderColor) style.boxShadow = `inset 0 0 0 2px ${colMatch.borderColor}`
              return style
            }
          }
        }
      } catch { /* malformed rule — skip */ }
    }
    return style
  }, [hasAnyHighlightRules, highlightColumnIds, cellFormats, parsedColumnConfigs, rowOriginal, rowMap, rowId])

  const isArchived = row.original.is_active === 0

  const rowStyle = useMemo<React.CSSProperties>(() => ({
    height: rowHeight,
    opacity: isArchived ? 0.5 : 1,
  }), [rowHeight, isArchived])

  return (
    <div
      role="row"
      data-row-index={rowIndex}
      className={`flex border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 group
        ${isArchived ? 'opacity-50' : ''}
        ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
      `}
      style={rowStyle}
    >
      {/* Selection checkbox */}
      <div
        className="flex-shrink-0 flex items-center justify-center bg-white dark:bg-slate-900"
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

      {/* Profile button */}
      <div
        className="flex-shrink-0 flex items-center justify-center border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
        style={{
          width: PROFILE_BTN_WIDTH, height: rowHeight,
          ...(frozenColumnCount > 0 ? { position: 'sticky' as const, left: HANDLE_WIDTH, zIndex: 10 } : {}),
        }}
      >
        <button
          tabIndex={-1}
          onClick={e => { e.stopPropagation(); onNavigateToProfile(rowId) }}
          className="flex items-center justify-center w-7 h-7 profile-btn-glow
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-indigo-500"
          title={`Open ${t('record')} profile`}
          aria-label={`Open ${t('record')} profile`}
          {...(rowIndex === 0 ? { 'data-tour': 'profile-icon' } : {})}
        >
          <User className="w-4 h-4" />
        </button>
      </div>

      {/* Acuity badge */}
      {acuityEnabled && (
        <div
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

      {/* Cells – flex-1 to push menu button to the right */}
      {row.getVisibleCells().map(cell => {
        const colId = parseInt(cell.column.id.replace('col_', ''), 10)
        const col = columnMap.get(colId)
        if (!col) return null
        const value = row.original[`col_${colId}` as keyof GridRow] as string | null
        const isEditing = editingRowId === rowId && editingColId === colId
        const isFocused = focusedRowId === rowId && focusedColId === colId

        // Computed and auto-number columns are never editable
        // Link columns (W04) can't be typed into, but Enter or double-click opens their picker
        const isComputed = isNotTypedColumnType(col.column_type) && col.column_type !== 'link'

        // Alert color for date columns with an alert rule attached
        let alertBgClass = ''
        let alertBgStyle: React.CSSProperties = {}
        let hasAlertStyle = false
        let alertTooltip = ''
        let alertIcon: React.ReactNode = null
        // Date columns with a rule say how they stand, not only by color (G-09)
        let alertChip: string | null = null
        let alertSpoken = ''
        if (takesDeadlineRule(col.column_type)) {
          const cfg = parsedColumnConfigs.get(col.id)?.config as { alert_rule_id?: number } | undefined
          if (cfg?.alert_rule_id) {
            const rule = alertRuleMap.get(cfg.alert_rule_id)
            if (rule) {
              // The shared engine (W05): relative and other kinds can be due with this cell empty
              const res = evaluateRuleForRow(rule, value, rowOriginal as unknown as Record<string, unknown>, col.id)
              const days = res.daysUntil
              if (col.column_type === 'date') alertChip = deadlineChipText(res, value)
              // Unparseable dates yield null — don't let them coerce to "due today"
              const threshold = days !== null ? getMatchingThreshold(days, rule.thresholds) : undefined
              if (days !== null && threshold) {
                const resolved = resolveAlertColor(threshold.bgClass)
                alertBgClass = resolved.className
                alertBgStyle = resolved.style
                hasAlertStyle = !!(resolved.className || Object.keys(resolved.style).length > 0)
                alertTooltip = formatResultTooltip(res)
                alertIcon = alertShapeForBand(days, threshold, rule.thresholds)
                alertSpoken = [threshold.label, alertTooltip].filter(Boolean).join('. ')
              }
            }
          }
        }

        // Frozen column sticky positioning
        const frozenLeft = frozenLeftOffsets.get(colId)
        const isCellFrozen = frozenLeft !== undefined
        const colIdx = columns.findIndex(c => c.id === colId)
        const isLastFrozenCell = isCellFrozen && colIdx === frozenColumnCount - 1

        // Priority: alert > cell-level format > column format > row highlight
        let cellStyle: React.CSSProperties = {
          width: `var(--cw-${colId})`, height: rowHeight,
          ...(isCellFrozen ? {
            position: 'sticky' as const,
            left: frozenLeft,
            zIndex: 10,
          } : {}),
          ...(isLastFrozenCell ? { borderRightWidth: 2, borderRightColor: '#94a3b8' } : {}),
        }
        let cellExtraClass = isCellFrozen ? 'bg-white dark:bg-slate-900 ' : ''

        if (hasAlertStyle) {
          Object.assign(cellStyle, alertBgStyle)
        } else {
          const cellFmtRules = cellFormats.get(`${rowId}_${colId}`) ?? []
          let fmtMatch = evalCellFormat(cellFmtRules, value, rowOriginal, rowMap)

          if (!fmtMatch) {
            const colFmtRules = parsedColumnConfigs.get(col.id)?.conditionalFormat ?? []
            if (colFmtRules.length > 0) {
              fmtMatch = evalCellFormat(colFmtRules, value, rowOriginal, rowMap)
            }
          }

          if (fmtMatch) {
            if (fmtMatch.pulse) {
              cellExtraClass = 'alert-pulse'
            } else if (fmtMatch.bgColor) {
              cellStyle.backgroundColor = fmtMatch.bgColor
            }
            if (fmtMatch.textColor)  cellStyle.color      = fmtMatch.textColor
            if (fmtMatch.bold)       cellStyle.fontWeight  = 'bold'
            if (fmtMatch.italic)     cellStyle.fontStyle   = 'italic'
            if (fmtMatch.borderColor) cellStyle.boxShadow  = `inset 0 0 0 2px ${fmtMatch.borderColor}`
          } else if (Object.keys(rowFormatStyle).length > 0) {
            Object.assign(cellStyle, rowFormatStyle)
          }
        }

        // Cursor hint: editable cells get text/pointer cursor, computed/display stay default
        const cursorClass = isComputed ? 'cursor-default'
          : col.column_type === 'checkbox' || col.column_type === 'dropdown' || col.column_type === 'status' ? 'cursor-pointer'
          : 'cursor-text'

        return (
          <div
            key={cell.id}
            className={`flex-shrink-0 grid-cell select-text ${cursorClass}
                        ${isFocused ? 'ring-3 ring-inset ring-blue-500' : ''}
                        ${isEditing ? 'p-0' : ''}
                        ${alertBgClass} ${cellExtraClass}`}
            style={cellStyle}
            title={alertTooltip || undefined}
            onContextMenu={e => onCellContextMenu(e, rowId, colId)}
            tabIndex={0}
            role="gridcell"
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
            onClick={() => {
              // Single click = select only (checkbox toggles immediately)
              if (!isComputed && col.column_type === 'checkbox') {
                const newVal = (value === 'true' || value === '1') ? 'false' : 'true'
                void updateCell(rowId, colId, newVal)
              }
            }}
            onDoubleClick={() => {
              // Double-click = enter edit mode (all types except checkbox)
              if (!isComputed && col.column_type !== 'checkbox') {
                setEditingCell({ rowId, columnId: colId })
              }
            }}
            onKeyDown={e => {
              if (isComputed) {
                const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End']
                if (navKeys.includes(e.key)) onCellKeyDown(e, rowId, colId)
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
                    setTimeout(() => {
                      containerRef.current?.querySelector<HTMLElement>(`[data-row-id="${rowId}"][data-col-id="${colId}"]`)?.focus()
                    }, 0)
                  }} />
              </>
            ) : isEditing && !isComputed ? (
              <CellEditor
                column={col}
                value={value}
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
                    if (navDirection) {
                      onNavigateAfterEdit(rowId, colId, navDirection)
                    } else {
                      setTimeout(() => {
                        containerRef.current?.querySelector<HTMLElement>(
                          `[data-row-id="${rowId}"][data-col-id="${colId}"]`
                        )?.focus()
                      }, 0)
                    }
                  }
                  void updateCell(rowId, colId, newValue)
                }}
                onCancel={() => {
                  setEditingCell(null)
                  setTimeout(() => {
                    containerRef.current?.querySelector<HTMLElement>(
                      `[data-row-id="${rowId}"][data-col-id="${colId}"]`
                    )?.focus()
                  }, 0)
                }}
              />
            ) : (
              <>
                {alertIcon}
                <CellDisplay column={col} value={value} row={row.original} allColumns={columns} parsedConfig={parsedColumnConfigs.get(col.id)?.config} highlightText={searchQuery} isActiveMatch={findReplaceActiveRowId === rowId && findReplaceActiveColId === col.id} />
                {alertChip && <span className="ml-1.5 text-sm text-slate-700 dark:text-slate-200 whitespace-nowrap" data-testid="deadline-chip">{alertChip}</span>}
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

  if (prev.columns !== next.columns) return false
  if (prev.cellFormats !== next.cellFormats) return false
  if (prev.parsedColumnConfigs !== next.parsedColumnConfigs) return false
  if (prev.hasAnyHighlightRules !== next.hasAnyHighlightRules) return false
  if (prev.highlightColumnIds !== next.highlightColumnIds) return false
  if (prev.acuityEnabled !== next.acuityEnabled) return false
  if (prev.acuityLevels !== next.acuityLevels) return false
  if (prev.alertRuleMap !== next.alertRuleMap) return false
  if (prev.deadlineContext !== next.deadlineContext) return false
  if (prev.searchQuery !== next.searchQuery) return false
  if (prev.findReplaceActiveRowId !== next.findReplaceActiveRowId) return false
  if (prev.findReplaceActiveColId !== next.findReplaceActiveColId) return false
  if (prev.frozenLeftOffsets !== next.frozenLeftOffsets) return false
  if (prev.frozenColumnCount !== next.frozenColumnCount) return false

  return true
})
