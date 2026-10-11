import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../stores/gridStore'

/**
 * How many records the list shows right now (after filters, search and
 * starred) and how many it has (G-24). The table and the board both keep
 * `sortedRowIds` to what they show.
 */
export function useShownCount(): { shown: number; total: number } {
  const { total, sorted } = useGridStore(useShallow(s => ({ total: s.rows.length, sorted: s.sortedRowIds.length })))
  return { shown: Math.min(sorted, total), total }
}

/** "8 clients", or "1 of 8 clients" when some are hidden */
export function shownLabel(shown: number, total: number, word: (count: number) => string): string {
  return shown < total ? `${shown} of ${total} ${word(total)}` : `${total} ${word(total)}`
}
