import { useCallback, useMemo } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'

// Rows drawn past each edge of the visible area: about half a screen at 44 px a row,
// enough for a fast scroll not to show blank rows, without mounting a second screenful
const DEFAULT_OVERSCAN = 10

interface UseGridVirtualizerOptions {
  /** Ref to the scrollable parent container */
  parentRef: React.RefObject<HTMLDivElement | null>
  /** Number of items (rows or display items) to virtualize */
  count: number
  /** Height of each row in pixels */
  rowHeight: number
  /** Height of one item when they differ (group headers vs records); defaults to rowHeight */
  sizeOf?: (index: number) => number
  /** Space inside the scroll element above the list (the grouped list's Collapse all bar) */
  scrollMargin?: number
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
  sizeOf,
  scrollMargin = 0,
  enabled = true,
  overscan = DEFAULT_OVERSCAN,
}: UseGridVirtualizerOptions): UseGridVirtualizerReturn {
  // Each item's real height, so scrolling to one lands on it (AUDIT-132)
  const estimateSize = useCallback((i: number) => sizeOf ? sizeOf(i) : rowHeight, [sizeOf, rowHeight])
  // The virtualizer only works positions out again when the keys change: new sizes, new keys
  const getItemKey = useMemo(() => { void estimateSize; return (i: number) => i }, [estimateSize])
  const virtualizer = useVirtualizer({
    count: enabled ? count : 0,
    getScrollElement: () => parentRef.current,
    estimateSize,
    getItemKey,
    scrollMargin,
    overscan,
  })

  const virtualRows = virtualizer.getVirtualItems()
  // Excludes the scroll margin; item starts include it
  const totalSize = virtualizer.getTotalSize()

  const paddingTop = virtualRows.length > 0 ? virtualRows[0]!.start - scrollMargin : 0
  const paddingBottom = virtualRows.length > 0
    ? totalSize - (virtualRows[virtualRows.length - 1]!.end - scrollMargin)
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
