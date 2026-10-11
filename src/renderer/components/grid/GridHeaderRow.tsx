import React, { useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { dndAccessibility } from '../../utils/dndAnnouncements'
import { User, EyeOff } from 'lucide-react'
import type { Header } from '@tanstack/react-table'
import type { GridRow, Column } from '../../../shared/types'
import { ColumnHeader } from './ColumnHeader'
import { HANDLE_WIDTH, PROFILE_BTN_WIDTH, TAGS_COL_WIDTH } from './gridConstants'
import { BADGE_WIDTH as ACUITY_BADGE_WIDTH } from './AcuityBadge'
import { useVocab } from '../../hooks/useVocab'

// ── Sortable column header wrapper ────────────────────────────────────────────

interface SortableColHeaderProps {
  header: Header<GridRow, unknown>
  col: Column
  /** This column's place, counting the leading columns (AUDIT-012) */
  colIndex?: number
  onAutoFit: (colId: number) => void
  rowHeight: number
  frozenLeft: number | undefined
  isLastFrozen: boolean
}

export const SortableColHeader = React.memo(function SortableColHeader({ header, col, colIndex, onAutoFit, rowHeight, frozenLeft, isLastFrozen }: SortableColHeaderProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `col_${col.id}`
  })

  const isFrozen = frozenLeft !== undefined

  return (
    <div
      ref={setNodeRef}
      role="columnheader"
      aria-colindex={colIndex}
      aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}
      className={`relative flex-shrink-0 border-r border-slate-300 dark:border-slate-600
                  bg-slate-50 dark:bg-slate-800 select-none`}
      style={{
        width: `var(--cw-${col.id})`,
        height: rowHeight,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 10 : isFrozen ? 12 : 'auto',
        ...(isFrozen ? { position: 'sticky' as const, left: frozenLeft } : {}),
        ...(isLastFrozen ? { borderRightWidth: 2, borderRightColor: '#94a3b8' } : {}),
      }}
    >
      <ColumnHeader column={col} dragHandleProps={{ ...attributes, ...listeners }} />

      {/* Resize handle — right edge */}
      {header.column.getCanResize() && (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onDoubleClick={e => { e.stopPropagation(); onAutoFit(col.id) }}
          className={`absolute right-0 top-0 w-1.5 h-full cursor-col-resize z-10
                       transition-opacity
                       ${header.column.getIsResizing()
                         ? 'bg-blue-500 opacity-100'
                         : 'bg-slate-400 dark:bg-slate-500 opacity-20 hover:opacity-100 hover:bg-blue-400 active:bg-blue-600'}`}
          style={{ touchAction: 'none', userSelect: 'none' }}
          title="Drag to resize · Double-click to auto-fit"
        />
      )}
    </div>
  )
})

// ── Grid header row ───────────────────────────────────────────────────────────

export interface GridHeaderRowProps {
  headers: Header<GridRow, unknown>[]
  columns: Column[]
  columnIds: string[]
  rowHeight: number
  acuityEnabled: boolean
  acuitySortDir: 'asc' | 'desc' | null
  setAcuitySortDir: React.Dispatch<React.SetStateAction<'asc' | 'desc' | null>>
  selectedRowIds: Set<number>
  filteredRows: GridRow[]
  setSelectedRowIds: React.Dispatch<React.SetStateAction<Set<number>>>
  colSensors: SensorDescriptor<SensorOptions>[]
  onColumnDragEnd: (event: DragEndEvent) => void
  autoFitColumn: (colId: number) => void
  frozenLeftOffsets: Map<number, number>
  frozenColumnCount: number
  setFrozenColumnCount: (count: number) => void
  /** The built-in Tags column (G-37) */
  showTags?: boolean
  onHideTags?: () => void
}

export function GridHeaderRow({
  headers,
  columns,
  columnIds,
  rowHeight,
  acuityEnabled,
  acuitySortDir,
  setAcuitySortDir,
  selectedRowIds,
  filteredRows,
  setSelectedRowIds,
  colSensors,
  onColumnDragEnd,
  autoFitColumn,
  frozenLeftOffsets,
  frozenColumnCount,
  setFrozenColumnCount: _setFrozenColumnCount,
  showTags,
  onHideTags,
}: GridHeaderRowProps): React.ReactElement {
  const { t } = useVocab()
  // Screen readers pair each cell with the header in the same place (AUDIT-012)
  const leadingColCount = 2 + (acuityEnabled ? 1 : 0) + (showTags ? 1 : 0)
  // A dragged column is read out by name, not its id (AUDIT-049)
  const dragA11y = useMemo(() => dndAccessibility(id => columns.find(c => `col_${c.id}` === id)?.name), [columns])
  return (
    <DndContext
      sensors={colSensors}
      collisionDetection={closestCenter}
      onDragEnd={onColumnDragEnd}
      accessibility={dragA11y}
    >
      <div role="rowgroup" className="bg-slate-50 dark:bg-slate-800 border-b-2 border-slate-300 dark:border-slate-600">
        <div className="flex" role="row" aria-rowindex={1}>
          {/* Select-all checkbox in header */}
          <div
            role="columnheader"
            aria-colindex={1}
            className="flex-shrink-0 border-r border-slate-300 dark:border-slate-600 flex items-center justify-center bg-slate-50 dark:bg-slate-800"
            style={{
              width: HANDLE_WIDTH, height: rowHeight,
              ...(frozenColumnCount > 0 ? { position: 'sticky' as const, left: 0, zIndex: 12 } : {}),
            }}
          >
            <button
              onClick={() => {
                if (selectedRowIds.size === filteredRows.length && filteredRows.length > 0) {
                  setSelectedRowIds(new Set())
                } else {
                  setSelectedRowIds(new Set(filteredRows.map(r => r.row_id)))
                }
              }}
              className={`w-5 h-5 flex items-center justify-center focus-visible:ring-3 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded-sm
                ${filteredRows.length === 0 ? 'opacity-0 pointer-events-none' : 'opacity-60 hover:opacity-100'}
                ${selectedRowIds.size > 0 ? 'opacity-100!' : ''}
                transition-opacity`}
              tabIndex={-1}
              role="checkbox"
              aria-checked={
                selectedRowIds.size === filteredRows.length && filteredRows.length > 0
                  ? 'true'
                  : selectedRowIds.size > 0
                    ? 'mixed'
                    : 'false'
              }
              aria-label={selectedRowIds.size === filteredRows.length && filteredRows.length > 0 ? `Deselect all ${t('record', { many: true })}` : `Select all ${t('record', { many: true })}`}
              title={selectedRowIds.size === filteredRows.length ? 'Deselect all' : 'Select all'}
            >
              <div className={`w-4 h-4 rounded-sm border-2 flex items-center justify-center transition-colors
                ${selectedRowIds.size === filteredRows.length && filteredRows.length > 0
                  ? 'bg-blue-500 border-blue-500'
                  : selectedRowIds.size > 0
                    ? 'bg-blue-200 border-blue-400'
                    : 'border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-800'}`
              }>
                {selectedRowIds.size > 0 && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                    {selectedRowIds.size === filteredRows.length
                      ? <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      : <path d="M3 6h6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    }
                  </svg>
                )}
              </div>
            </button>
          </div>
          {/* Profile column header */}
          <div
            role="columnheader"
            aria-colindex={2}
            className="flex-shrink-0 border-r border-slate-300 dark:border-slate-600 flex items-center justify-center bg-slate-50 dark:bg-slate-800"
            style={{
              width: PROFILE_BTN_WIDTH, height: rowHeight,
              ...(frozenColumnCount > 0 ? { position: 'sticky' as const, left: HANDLE_WIDTH, zIndex: 12 } : {}),
            }}
            aria-label="Profile"
          >
            <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          </div>
          {/* Acuity column header — clickable to sort */}
          {acuityEnabled && (
            <div
              role="columnheader"
              aria-colindex={3}
              aria-sort={acuitySortDir === 'asc' ? 'ascending' : acuitySortDir === 'desc' ? 'descending' : 'none'}
              className="flex-shrink-0 border-r border-slate-300 dark:border-slate-600 flex items-center justify-center text-sm font-semibold select-none cursor-pointer
                         hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors bg-slate-50 dark:bg-slate-800"
              style={{
                width: ACUITY_BADGE_WIDTH, height: rowHeight,
                ...(frozenColumnCount > 0 ? { position: 'sticky' as const, left: HANDLE_WIDTH + PROFILE_BTN_WIDTH, zIndex: 12 } : {}),
              }}
              title={acuitySortDir === 'desc' ? 'Sorted: high \u2192 low (click for low \u2192 high)' : acuitySortDir === 'asc' ? 'Sorted: low \u2192 high (click to clear)' : `Click to sort by ${t('priority')}`}
              onClick={() => setAcuitySortDir(prev => prev === null ? 'desc' : prev === 'desc' ? 'asc' : null)}
            >
              <span className={acuitySortDir ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}>{t('priority', { cap: true }).slice(0, 2)}</span>
              {acuitySortDir && (
                <svg className="w-3 h-3 ml-0.5 text-blue-600 dark:text-blue-400" viewBox="0 0 12 12" fill="currentColor">
                  {acuitySortDir === 'desc'
                    ? <path d="M6 8L2 4h8L6 8z" />
                    : <path d="M6 4L2 8h8L6 4z" />
                  }
                </svg>
              )}
            </div>
          )}
          {showTags && (
            <div role="columnheader" aria-colindex={3 + (acuityEnabled ? 1 : 0)} className="flex-shrink-0 flex items-center gap-1 px-2 border-r border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-base font-semibold text-slate-700 dark:text-slate-200"
              style={{ width: TAGS_COL_WIDTH, height: rowHeight, ...(frozenColumnCount > 0 ? { position: 'sticky' as const, left: HANDLE_WIDTH + PROFILE_BTN_WIDTH + (acuityEnabled ? ACUITY_BADGE_WIDTH : 0), zIndex: 12 } : {}) }}>
              <span className="flex-1 truncate" title={`Tags from each ${t('record')}'s page`}>Tags</span>
              {onHideTags && (
                <button type="button" className="hit-44 p-1 rounded text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-3 focus-visible:ring-blue-500"
                  onClick={onHideTags} aria-label="Hide the Tags column" title="Hide the Tags column">
                  <EyeOff className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
            {headers.map((header, i) => {
              const col = columns[i]
              if (!col) return null
              return (
                <SortableColHeader
                  key={header.id}
                  header={header}
                  col={col}
                  colIndex={leadingColCount + i + 1}
                  onAutoFit={autoFitColumn}
                  rowHeight={rowHeight}
                  frozenLeft={frozenLeftOffsets.get(col.id)}
                  isLastFrozen={frozenLeftOffsets.has(col.id) && i === frozenColumnCount - 1}
                />
              )
            })}
          </SortableContext>
        </div>
      </div>
    </DndContext>
  )
}
