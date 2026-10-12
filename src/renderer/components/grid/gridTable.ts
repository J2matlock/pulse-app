/**
 * The grid's table model (@tanstack/react-table 9): the features DataGrid uses,
 * registered once, and the row/header types the grid components share.
 *
 * Search is a table-wide filter with our own function; sorting uses each
 * column's own sortFn; sizes come from columns.width and are resized by
 * dragging the header edge. Nothing else is registered, so no other table
 * API exists to be used by accident.
 */
import {
  tableFeatures,
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  columnSizingFeature,
  columnResizingFeature,
  createFilteredRowModel,
  createSortedRowModel,
  type Row,
  type Header,
} from '@tanstack/react-table'
import type { GridRow } from '../../../shared/types'

export const gridFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  columnSizingFeature,
  columnResizingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
})

export type GridFeatures = typeof gridFeatures
export type GridTableRow = Row<GridFeatures, GridRow>
export type GridTableHeader = Header<GridFeatures, GridRow, unknown>
