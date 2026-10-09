import React, { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useVocab } from '../../hooks/useVocab'

export function GridStatusFooter(): React.ReactElement {
  const { t } = useVocab()
  const { rows, columns, searchQuery, selectedRowIds } = useGridStore(useShallow(s => ({
    rows: s.rows, columns: s.columns, searchQuery: s.searchQuery, selectedRowIds: s.selectedRowIds,
  })))

  const clientCount = rows.length
  const columnCount = columns.length

  const selectionStats = useMemo(() => {
    if (selectedRowIds.size === 0) return null

    const numberCols = columns.filter(c => c.column_type === 'number' || c.column_type === 'currency')
    let sum = 0
    let count = 0

    for (const rowId of selectedRowIds) {
      const row = rows.find(r => r.row_id === rowId)
      if (!row) continue
      for (const col of numberCols) {
        const val = parseFloat(row[`col_${col.id}` as keyof typeof row] as string ?? '')
        if (!isNaN(val)) {
          sum += val
          count++
        }
      }
    }

    return {
      selectedCount: selectedRowIds.size,
      sum: count > 0 ? sum : null,
      avg: count > 0 ? sum / count : null,
    }
  }, [selectedRowIds, rows, columns])

  return (
    <div
      className="flex items-center gap-4 px-4 text-sm text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex-shrink-0"
      style={{ height: 28 }}
      aria-live="polite"
      aria-atomic="true"
    >
      <span>
        {searchQuery
          ? `${clientCount} result${clientCount !== 1 ? 's' : ''}`
          : `${clientCount} ${t('record', { count: clientCount })}`}
      </span>
      <span>·</span>
      <span>{columnCount} column{columnCount !== 1 ? 's' : ''}</span>
      {selectionStats && (
        <>
          <span>·</span>
          <span className="text-blue-500 dark:text-blue-400">
            Selected: {selectionStats.selectedCount}
            {selectionStats.sum !== null && (
              <> | Sum: {selectionStats.sum.toLocaleString(undefined, { maximumFractionDigits: 2 })} | Avg: {selectionStats.avg!.toLocaleString(undefined, { maximumFractionDigits: 1 })}</>
            )}
          </span>
        </>
      )}
    </div>
  )
}
