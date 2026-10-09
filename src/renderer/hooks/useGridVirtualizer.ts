import { useCallback } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'

const DEFAULT_OVERSCAN = 20

interface UseGridVirtualizerOptions {
  /** Ref to the scrollable parent container */
  parentRef: React.RefObject<HTMLDivElement | null>
  /** Number of items (rows or display items) to virtualize */
  count: number
  /** Height of each row in pixels */
  rowHeight: number
  /** Whether virtualization is enabled (pass false to skip, e.g. when grouped) */
  enabled?: boolean
  /** Number of rows to render beyond the visible area */
  overscan?: number
}

interface UseGridVirtualizerReturn {
  virtualizer: Virtualizer<HTMLDivElement, Element>
  virtualRows: ReturnType<Virtualizer<HTMLDivElement, Element>['getVirtualItems']>
  totalSize: number
  paddingTop: number
  paddingBottom: number
  scrollToRow: (index: number) => void
}

export function useGridVirtualizer({
  parentRef,
  count,
  rowHeight,
  enabled = true,
  overscan = DEFAULT_OVERSCAN,
}: UseGridVirtualizerOptions): UseGridVirtualizerReturn {
  const virtualizer = useVirtualizer({
    count: enabled ? count : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan,
  })

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  const paddingTop = virtualRows.length > 0 ? virtualRows[0]!.start : 0
  const paddingBottom = virtualRows.length > 0
    ? totalSize - virtualRows[virtualRows.length - 1]!.end
    : 0

  const scrollToRow = useCallback(
    (index: number) => {
      virtualizer.scrollToIndex(index, { align: 'auto' })
    },
    [virtualizer]
  )

  return {
    virtualizer,
    virtualRows,
    totalSize,
    paddingTop,
    paddingBottom,
    scrollToRow,
  }
}
