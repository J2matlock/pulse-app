import React, { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useVocab } from '../../hooks/useVocab'
import { useShownCount, shownLabel } from '../../hooks/useShownCount'

export function GridStatusFooter(): React.ReactElement {
  const { t } = useVocab()
  const { rows, columns, selectedRowIds } = useGridStore(useShallow(s => ({
    rows: s.rows, columns: s.columns, selectedRowIds: s.selectedRowIds,
  })))
  const { shown, total } = useShownCount()
  const columnCount = columns.length

  // Totals for the selection, one per number or money column: adding ages to dollars means nothing (G-24)
  const selectionStats = useMemo(() => {
    if (selectedRowIds.size === 0) return null
    const byId = new Map(rows.map(r => [r.row_id, r]))
    const sums: Array<{ name: string; sum: number; currency: boolean }> = []
    for (const col of columns) {
      if (col.column_type !== 'number' && col.column_type !== 'currency') continue
      let sum = 0
      let count = 0
      for (const rowId of selectedRowIds) {
        const val = parseFloat(byId.get(rowId)?.[`col_${col.id}`] as string ?? '')
        if (!isNaN(val)) { sum += val; count++ }
      }
      if (count > 0) sums.push({ name: col.name, sum, currency: col.column_type === 'currency' })
    }
    return { selectedCount: selectedRowIds.size, sums: sums.slice(0, 3) }
  }, [selectedRowIds, rows, columns])

  return (
    <div
      className="flex items-center gap-4 px-4 text-sm text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex-shrink-0"
      style={{ height: 28 }}
      aria-live="polite"
      aria-atomic="true"
    >
      <span data-testid="shown-count">{shownLabel(shown, total, n => t('record', { count: n }))}</span>
      <span>·</span>
      <span>{columnCount} column{columnCount !== 1 ? 's' : ''}</span>
      {selectionStats && (
        <>
          <span>·</span>
          <span className="text-blue-500 dark:text-blue-400">
            Selected: {selectionStats.selectedCount}
            {selectionStats.sums.map(s => (
              <span key={s.name}> · {s.name} total: {s.currency ? '$' : ''}{s.sum.toLocaleString(undefined, { maximumFractionDigits: 2, ...(s.currency ? { minimumFractionDigits: 2 } : {}) })}</span>
            ))}
          </span>
        </>
      )}
    </div>
  )
}
